#Requires -Version 5.1
<#
.SYNOPSIS
  Stage finance accounting snapshot wrapper (schema + targeted table backups).

.DESCRIPTION
  - Reads connection ONLY from $env:ALCAZAR_STAGE_DATABASE_URL (never from repo files).
  - Uses native psql/pg_dump when compatible; otherwise Docker postgres:<major>-alpine fallback.
  - Validates Supabase Session pooler (5432) or Direct (5432); rejects Transaction pooler (6543).
  - Supports -DryRun (stdout plan only; no connection and no files written).
  - Supports -UninitializedStage for first snapshot before deployment_environment exists.
  - Does NOT print passwords or store connection strings in output files.

.NOTES
  Remote operators without psql/pg_dump in PATH need Docker Desktop only.
  Do NOT run against Production. Stage application requires explicit authorization.
#>
param(
  [string]$OutputRoot = "",
  [switch]$DryRun,
  [switch]$UninitializedStage
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "finance-stage-postgres-connection.ps1")

function Write-Step([string]$Message) {
  Write-Host "[snapshot] $Message"
}

function Assert-ProjectRefPair {
  if (-not $env:ALCAZAR_STAGE_PROJECT_REF) {
    throw "ALCAZAR_STAGE_PROJECT_REF is required for UninitializedStage mode."
  }
  if (-not $env:ALCAZAR_PRODUCTION_PROJECT_REF) {
    throw "ALCAZAR_PRODUCTION_PROJECT_REF is required for UninitializedStage mode."
  }
  if ($env:ALCAZAR_STAGE_PROJECT_REF -ceq $env:ALCAZAR_PRODUCTION_PROJECT_REF) {
    throw "Refusing snapshot: Stage and Production project refs must differ."
  }
}

function Get-Sha256([string]$Path) {
  (Get-FileHash -Path $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

if ($UninitializedStage) {
  Assert-ProjectRefPair
}

$connParts = $null
$allowLabLocal = $false
if (-not $DryRun -and $env:ALCAZAR_STAGE_DATABASE_URL) {
  try {
    $probe = Parse-PostgresUri $env:ALCAZAR_STAGE_DATABASE_URL
    $allowLabLocal = Test-IsLabLocalHost $probe.Host
  } catch {
    throw
  }
}

if (-not $DryRun) {
  if (-not $env:ALCAZAR_STAGE_DATABASE_URL) {
    throw "ALCAZAR_STAGE_DATABASE_URL is required (unless -DryRun)."
  }
  $conn = $env:ALCAZAR_STAGE_DATABASE_URL
  if ($UninitializedStage -or ($env:ALCAZAR_STAGE_PROJECT_REF -and $env:ALCAZAR_PRODUCTION_PROJECT_REF)) {
    $connParts = Test-StagePostgresConnectionUri -ConnectionString $conn `
      -StageRef $env:ALCAZAR_STAGE_PROJECT_REF `
      -ProductionRef $env:ALCAZAR_PRODUCTION_PROJECT_REF `
      -AllowLabLocal:$allowLabLocal
  } elseif ($allowLabLocal) {
    $connParts = Parse-PostgresUri $conn
    $connParts.ConnectionMode = "lab_local"
  } else {
    throw "Refusing snapshot: provide project refs for Supabase remote URI or use local lab host."
  }

  Write-Step "Connection target: $(Redact-StageConnectionTarget $connParts)"
  $tooling = Initialize-StagePostgresTooling -ConnParts $connParts -RequirePgDump
  Write-Step ("PostgreSQL server={0} pg_dump={1} tooling={2} docker_image={3}" -f `
      $tooling.ServerVersion, $tooling.PgDumpVersion, $tooling.Mode, $tooling.DockerImage)

  if ($UninitializedStage) {
    $markerExists = Invoke-StagePostgresPsqlAt -ConnParts $connParts `
      -Query "select exists(select 1 from public.app_settings where key = 'deployment_environment');"
    if ($markerExists -eq "t") {
      throw "Refusing UninitializedStage snapshot: deployment_environment already exists."
    }
    $envName = Invoke-StagePostgresPsqlAt -ConnParts $connParts `
      -Query "select coalesce((select lower(value->>'name') from public.app_settings where key = 'deployment_environment'), '');"
    if ($envName -in @("production", "prod")) {
      throw "Refusing UninitializedStage snapshot: environment indicates production."
    }
  }
}

$repoRoot = Split-Path $PSScriptRoot -Parent
if (-not $OutputRoot) {
  $OutputRoot = Join-Path (Join-Path $repoRoot ".local-backup") "stage-finance-accounting"
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"

$targetTables = @(
  "public.finance_chart_accounts",
  "public.branches",
  "public.finance_cost_centers",
  "public.finance_accounting_periods",
  "public.finance_journal_entries",
  "public.finance_journal_lines",
  "public.finance_journal_entry_counters",
  "public.user_roles"
)

if ($DryRun) {
  Write-Step "DRY RUN - no database connection, no files written"
  if ($UninitializedStage) {
    Write-Step "Mode: UninitializedStage (deployment_environment must be absent)"
    Write-Step "Stage project ref configured: yes"
    Write-Step "Production project ref configured: yes"
  }
  $pgDumpInv = Get-PgToolInvocation "pg_dump"
  $psqlInv = Get-PgToolInvocation "psql"
  Write-Step ("Tooling: pg_dump={0}, psql={1}" -f $(if ($pgDumpInv.UseDocker) { "docker" } else { "native" }), $(if ($psqlInv.UseDocker) { "docker" } else { "native" }))
  Write-Step "Would create timestamped directory under: $OutputRoot"
  Write-Step "Would write schema-only dump, target table data dump, baseline counts, manifest with SHA-256"
  Write-Step "Target tables: $($targetTables -join ', ')"
  Write-Step "Dry run complete."
  exit 0
}

$outDir = Join-Path $OutputRoot $timestamp
if (Test-Path -LiteralPath $outDir) {
  throw "Output directory already exists: $outDir"
}

$schemaFile = Join-Path $outDir "schema-only-$timestamp.sql"
$tablesFile = Join-Path $outDir "finance-target-tables-$timestamp.sql"
$baselineFile = Join-Path $outDir "baseline-counts-$timestamp.txt"
$manifestFile = Join-Path $outDir "manifest-$timestamp.json"

Write-Step "Output directory: $outDir"
if ($UninitializedStage) { Write-Step "Mode: UninitializedStage" }

$createdOutDir = $false
try {
  New-Item -ItemType Directory -Path $outDir -Force | Out-Null
  $createdOutDir = $true

  Write-Step "Schema-only dump..."
  Invoke-StagePostgresPgDump -ConnParts $connParts `
    -DumpArgs @("--schema-only", "--no-owner", "--no-privileges") `
    -OutputFile $schemaFile `
    -MountDir $outDir

  Write-Step "Target table data dump..."
  $tableDumpArgs = @("--data-only", "--no-owner", "--no-privileges")
  foreach ($table in $targetTables) {
    $tableDumpArgs += @("-t", $table)
  }
  Invoke-StagePostgresPgDump -ConnParts $connParts `
    -DumpArgs $tableDumpArgs `
    -OutputFile $tablesFile `
    -MountDir $outDir

  Write-Step "Baseline counts..."
  @(
    "finance_bank_accounts=",
    "finance_payables=",
    "finance_receivables=",
    "deployment_environment_present="
  ) | Set-Content -Path $baselineFile -Encoding UTF8

  $countQueries = @(
    "select 'finance_bank_accounts=' || count(*)::text from public.finance_bank_accounts",
    "select 'finance_payables=' || count(*)::text from public.finance_payables",
    "select 'finance_receivables=' || count(*)::text from public.finance_receivables",
    "select 'deployment_environment_present=' || exists(select 1 from public.app_settings where key = 'deployment_environment')::text"
  )
  foreach ($q in $countQueries) {
    $line = Invoke-StagePostgresPsqlAt -ConnParts $connParts -Query $q
    Add-Content -Path $baselineFile -Value $line -Encoding UTF8
  }

  $manifest = @{
    manifest_version = 1
    dry_run = $false
    uninitialized_stage = [bool]$UninitializedStage
    stage_project_ref = $env:ALCAZAR_STAGE_PROJECT_REF
    production_project_ref = $env:ALCAZAR_PRODUCTION_PROJECT_REF
    timestamp = $timestamp
    created_at = (Get-Date).ToUniversalTime().ToString("o")
    files = @(
      @{ path = $schemaFile; sha256 = (Get-Sha256 $schemaFile) },
      @{ path = $tablesFile; sha256 = (Get-Sha256 $tablesFile) },
      @{ path = $baselineFile; sha256 = (Get-Sha256 $baselineFile) }
    )
    target_tables = $targetTables
  }
  $manifestJson = $manifest | ConvertTo-Json -Depth 6
  [System.IO.File]::WriteAllText($manifestFile, $manifestJson, [System.Text.UTF8Encoding]::new($false))
  Write-Step "Snapshot complete. Manifest written."
} catch {
  if ($createdOutDir -and (Test-Path -LiteralPath $outDir)) {
    Remove-Item -LiteralPath $outDir -Recurse -Force
    Write-Step "Removed incomplete snapshot directory after failure."
  }
  throw
}
