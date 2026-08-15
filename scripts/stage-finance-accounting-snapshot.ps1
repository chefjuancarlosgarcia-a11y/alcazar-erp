#Requires -Version 5.1
<#
.SYNOPSIS
  Stage finance accounting snapshot wrapper (schema + targeted table backups).

.DESCRIPTION
  - Reads connection ONLY from $env:ALCAZAR_STAGE_DATABASE_URL (never from repo files).
  - Refuses production-like environment names in normal mode.
  - Supports -DryRun (stdout plan only; no connection and no files written).
  - Supports -UninitializedStage for first snapshot before deployment_environment exists.
  - Does NOT print passwords or store connection strings in output files.

.NOTES
  Do NOT run against Production. Stage application requires explicit authorization.
#>
param(
  [string]$OutputRoot = "",
  [switch]$DryRun,
  [switch]$UninitializedStage
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[snapshot] $msg" }

function Assert-ProjectRefPair {
  if (-not $env:ALCAZAR_STAGE_PROJECT_REF) {
    throw "ALCAZAR_STAGE_PROJECT_REF is required for UninitializedStage mode."
  }
  if (-not $env:ALCAZAR_PRODUCTION_PROJECT_REF) {
    throw "ALCAZAR_PRODUCTION_PROJECT_REF is required for UninitializedStage mode."
  }
  if ($env:ALCAZAR_STAGE_PROJECT_REF -eq $env:ALCAZAR_PRODUCTION_PROJECT_REF) {
    throw "Refusing snapshot: Stage and Production project refs must differ."
  }
}

function Assert-ConnectionProjectRefs([string]$Conn) {
  if ($Conn -match [regex]::Escape($env:ALCAZAR_PRODUCTION_PROJECT_REF)) {
    throw "Refusing snapshot: connection URL contains Production project ref."
  }
  if ($Conn -notmatch [regex]::Escape($env:ALCAZAR_STAGE_PROJECT_REF)) {
    throw "Refusing snapshot: connection URL must contain expected Stage project ref."
  }
}

if ($UninitializedStage) {
  Assert-ProjectRefPair
}

if (-not $DryRun) {
  if (-not $env:ALCAZAR_STAGE_DATABASE_URL) {
    throw "ALCAZAR_STAGE_DATABASE_URL is required (unless -DryRun)."
  }
  $conn = $env:ALCAZAR_STAGE_DATABASE_URL
  if ($conn -match '(?i)(prod|production)') {
    throw "Refusing snapshot: connection appears to be Production."
  }
  if ($UninitializedStage) {
    Assert-ConnectionProjectRefs $conn
    $markerExists = (& psql $env:ALCAZAR_STAGE_DATABASE_URL -At -c "select exists(select 1 from public.app_settings where key = 'deployment_environment');").Trim()
    if ($markerExists -eq 't') {
      throw "Refusing UninitializedStage snapshot: deployment_environment already exists."
    }
    $envName = (& psql $env:ALCAZAR_STAGE_DATABASE_URL -At -c "select coalesce((select lower(value->>'name') from public.app_settings where key = 'deployment_environment'), '');").Trim()
    if ($envName -in @('production', 'prod')) {
      throw "Refusing UninitializedStage snapshot: environment indicates production."
    }
  } elseif ($conn -notmatch '(?i)(stage|staging|localhost|127\.0\.0\.1)') {
    throw "Refusing snapshot: connection must look like Stage or local lab."
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
  Write-Step "Would create timestamped directory under: $OutputRoot"
  Write-Step "Would write schema-only dump, target table data dump, baseline counts, manifest with SHA-256"
  Write-Step "Target tables: $($targetTables -join ', ')"
  Write-Step "Dry run complete."
  exit 0
}

$outDir = Join-Path $OutputRoot $timestamp
if (Test-Path $outDir) { throw "Output directory already exists: $outDir" }

$schemaFile = Join-Path $outDir "schema-only-$timestamp.sql"
$tablesFile = Join-Path $outDir "finance-target-tables-$timestamp.sql"
$baselineFile = Join-Path $outDir "baseline-counts-$timestamp.txt"
$manifestFile = Join-Path $outDir "manifest-$timestamp.json"

Write-Step "Output directory: $outDir"
if ($UninitializedStage) { Write-Step "Mode: UninitializedStage" }

New-Item -ItemType Directory -Path $outDir -Force | Out-Null

Write-Step "Schema-only dump..."
& pg_dump $env:ALCAZAR_STAGE_DATABASE_URL --schema-only --no-owner --no-privileges -f $schemaFile
if ($LASTEXITCODE -ne 0) { throw "pg_dump schema-only failed" }

Write-Step "Target table data dump..."
$tableArgs = ($targetTables | ForEach-Object { "-t $_" }) -join " "
$dumpCmd = "pg_dump `"$env:ALCAZAR_STAGE_DATABASE_URL`" --data-only --no-owner --no-privileges $tableArgs -f `"$tablesFile`""
Invoke-Expression $dumpCmd
if ($LASTEXITCODE -ne 0) { throw "pg_dump data-only failed" }

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
  & psql $env:ALCAZAR_STAGE_DATABASE_URL -At -c $q | Add-Content -Path $baselineFile -Encoding UTF8
  if ($LASTEXITCODE -ne 0) { throw "baseline counts failed" }
}

function Get-Sha256($path) {
  (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
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
$manifest | ConvertTo-Json -Depth 6 | Set-Content -Path $manifestFile -Encoding UTF8
Write-Step "Snapshot complete. Manifest written."
