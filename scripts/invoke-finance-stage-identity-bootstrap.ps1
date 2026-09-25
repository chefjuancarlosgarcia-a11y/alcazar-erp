#Requires -Version 5.1
<#
.SYNOPSIS
  Fail-closed wrapper for Stage finance accounting identity bootstrap.

.DESCRIPTION
  Validates PostgreSQL URI against expected Stage/Production project refs,
  verifies an UninitializedStage snapshot manifest, runs READ ONLY preflight,
  executes finance_accounting_stage_identity_bootstrap.sql, and re-runs preflight.

  Remote execution MUST use this wrapper — do not paste bootstrap SQL manually.

.PARAMETER SnapshotManifestPath
  Explicit path to manifest-*.json from stage-finance-accounting-snapshot.ps1 -UninitializedStage.

.PARAMETER MaxSnapshotAgeHours
  Maximum allowed snapshot age (default 24). Manifest created_at must be within this window.

.PARAMETER OperatorConfirmation
  Non-interactive confirmation: must equal ALCAZAR_STAGE_PROJECT_REF exactly.
  When omitted, prompts the operator to type the Stage project ref.

.NOTES
  - Reads ALCAZAR_STAGE_DATABASE_URL, ALCAZAR_STAGE_PROJECT_REF, ALCAZAR_PRODUCTION_PROJECT_REF from env.
  - Does NOT print passwords or full connection URIs.
  - Does NOT clear ALCAZAR_STAGE_DATABASE_URL from the parent process.
  - Stops before migrations 202–204.
#>
param(
  [Parameter(Mandatory = $true)]
  [string]$SnapshotManifestPath,
  [int]$MaxSnapshotAgeHours = 24,
  [string]$OperatorConfirmation = "",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "finance-stage-postgres-connection.ps1")

$IdentityOnlyBlockers = @(
  "deployment_project_ref_present",
  "environment_is_stage",
  "project_ref_matches"
)

function Write-BootstrapStep([string]$Message) {
  Write-Host "[identity-bootstrap] $Message"
}

function Test-SnapshotManifest {
  param(
    [string]$ManifestPath,
    [string]$StageRef,
    [string]$ProductionRef,
    [int]$MaxAgeHours
  )
  if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Snapshot manifest not found: $ManifestPath"
  }
  $resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
  $manifestDir = Split-Path -Parent $resolvedManifest
  $raw = Get-Content -LiteralPath $resolvedManifest -Raw -Encoding UTF8
  $manifest = $raw | ConvertFrom-Json

  if ($manifest.manifest_version -lt 1) {
    throw "Snapshot manifest version unsupported."
  }
  if ($manifest.dry_run) {
    throw "Refusing bootstrap: snapshot manifest is dry_run."
  }
  if (-not $manifest.uninitialized_stage) {
    throw "Refusing bootstrap: snapshot must be UninitializedStage (deployment_environment absent at snapshot time)."
  }
  if ($manifest.stage_project_ref.ToLowerInvariant() -ne $StageRef.ToLowerInvariant()) {
    throw "Refusing bootstrap: snapshot stage_project_ref does not match ALCAZAR_STAGE_PROJECT_REF."
  }
  if ($manifest.production_project_ref.ToLowerInvariant() -ne $ProductionRef.ToLowerInvariant()) {
    throw "Refusing bootstrap: snapshot production_project_ref does not match ALCAZAR_PRODUCTION_PROJECT_REF."
  }
  if (-not $manifest.created_at) {
    throw "Refusing bootstrap: snapshot manifest missing created_at."
  }
  $createdAt = [datetime]::Parse($manifest.created_at, $null, [Globalization.DateTimeStyles]::RoundtripKind)
  $age = (Get-Date).ToUniversalTime() - $createdAt.ToUniversalTime()
  if ($age.TotalHours -gt $MaxAgeHours) {
    throw "Refusing bootstrap: snapshot is older than $MaxAgeHours hour(s) (age=$([Math]::Round($age.TotalHours, 2))h). Capture a fresh UninitializedStage snapshot."
  }

  foreach ($entry in $manifest.files) {
    $filePath = $entry.path
    if (-not [System.IO.Path]::IsPathRooted($filePath)) {
      $filePath = Join-Path $manifestDir $filePath
    }
    if (-not (Test-Path -LiteralPath $filePath)) {
      throw "Snapshot artifact missing: $filePath"
    }
    $hash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) {
      throw "Snapshot artifact SHA-256 mismatch: $filePath"
    }
  }

  Write-BootstrapStep "Snapshot manifest verified (UninitializedStage, age=$([Math]::Round($age.TotalHours, 2))h)."
  return $resolvedManifest
}

function Confirm-OperatorAuthorization {
  param(
    [string]$StageRef,
    [string]$ProvidedConfirmation
  )
  if ($ProvidedConfirmation) {
    if ($ProvidedConfirmation -cne $StageRef) {
      throw "Operator confirmation rejected: must equal Stage project ref exactly."
    }
    Write-BootstrapStep "Operator confirmation accepted (non-interactive)."
    return
  }
  Write-Host ""
  Write-Host "Type the Stage project ref exactly to authorize identity bootstrap."
  Write-Host ""
  $typed = Read-Host "Confirmation"
  if ($typed -cne $StageRef) {
    throw "Operator confirmation rejected."
  }
  Write-BootstrapStep "Operator confirmation accepted."
}

function Invoke-FinancePsql {
  param(
    [hashtable]$ConnParts,
    [string]$Sql,
    [string]$Label,
    [switch]$AllowFailure
  )
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $result = Invoke-StagePostgresPsql -ConnParts $ConnParts -Sql $Sql -DockerExtraArgs @("-v", "${repoRoot}:/repo:ro")
  $text = $result.Output
  $redacted = $text -replace [regex]::Escape($ConnParts.Password), "***"
  if ($ConnParts.Password) {
    $redacted = $redacted -replace "postgres(?:\.$([regex]::Escape($env:ALCAZAR_STAGE_PROJECT_REF)))?:$([regex]::Escape($ConnParts.Password))@", "postgres:***@"
  }
  $logDir = Join-Path (Join-Path $repoRoot ".local-backup") "finance-stage-identity-bootstrap-wrapper"
  if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
  $logFile = Join-Path $logDir "$Label-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff').log"
  if (Test-Path -LiteralPath $logFile) {
    throw "Refusing to overwrite existing log evidence: $logFile"
  }
  Set-Content -Path $logFile -Value $redacted -Encoding UTF8
  if (-not $AllowFailure -and $result.ExitCode -ne 0) {
    throw "$Label failed (exit $($result.ExitCode)). See redacted log: $logFile"
  }
  return @{ Output = $text; ExitCode = $result.ExitCode; LogFile = $logFile }
}

function Get-ReadOnlyPreflightSql {
  param(
    [string]$StageRef,
    [string]$ProductionRef
  )
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $preflightPath = Join-Path $repoRoot "supabase/stage-fixtures/finance_accounting_stage_preflight.sql"
  $preflightSql = Get-Content -LiteralPath $preflightPath -Raw -Encoding UTF8
  return @"
SET default_transaction_read_only = on;
BEGIN READ ONLY;
SELECT set_config('alcazar.finance_stage_project_ref', '$StageRef', true);
SELECT set_config('alcazar.finance_production_project_ref', '$ProductionRef', true);
$preflightSql
ROLLBACK;
"@
}

function Get-IdentityBootstrapSql {
  param(
    [string]$StageRef,
    [string]$ProductionRef
  )
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $bootstrapPath = Join-Path $repoRoot "supabase/stage-fixtures/finance_accounting_stage_identity_bootstrap.sql"
  $bootstrapSql = Get-Content -LiteralPath $bootstrapPath -Raw -Encoding UTF8
  $refs = @"
SELECT set_config('alcazar.finance_stage_project_ref', '$StageRef', true);
SELECT set_config('alcazar.finance_production_project_ref', '$ProductionRef', true);
"@
  if ($bootstrapSql -notmatch '-- alcazar:session_refs') {
    throw "Bootstrap fixture missing -- alcazar:session_refs injection point."
  }
  return $bootstrapSql.Replace("-- alcazar:session_refs", $refs.Trim())
}

function Parse-PreflightSummary([string]$Output) {
  $result = $null
  $detail = ""
  foreach ($line in ($Output -split "`r?`n")) {
    if ($line -match '^\s*(READY|NOT_READY)\s*\|\s*(\d+)\s*\|\s*(.*)\s*$') {
      $result = $Matches[1]
      $detail = $Matches[3].Trim()
      break
    }
  }
  $gates = @()
  if ($detail) {
    $gates = $detail -split ',\s*' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
  }
  return @{
    Result = $result
    BlockingGates = $gates
    BlockingDetail = $detail
  }
}

function Assert-IdentityOnlyNotReady {
  param([hashtable]$Summary)
  if ($Summary.Result -ne "NOT_READY") {
    throw "Preflight must be NOT_READY before bootstrap (got $($Summary.Result))."
  }
  $expectedSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$IdentityOnlyBlockers)
  $actualSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$Summary.BlockingGates)
  if ($actualSet.Count -ne $expectedSet.Count) {
    throw "Unexpected preflight blockers: $($Summary.BlockingDetail) (expected exactly: $($IdentityOnlyBlockers -join ', '))."
  }
  foreach ($gate in $IdentityOnlyBlockers) {
    if (-not $actualSet.Contains($gate)) {
      throw "Missing expected blocker '$gate'. Actual: $($Summary.BlockingDetail)"
    }
  }
  Write-BootstrapStep "Preflight NOT_READY with identity-only blockers confirmed."
}

function Assert-PreflightReady {
  param([hashtable]$Summary)
  if ($Summary.Result -ne "READY") {
    throw "Post-bootstrap preflight must be READY (got $($Summary.Result); blockers: $($Summary.BlockingDetail))."
  }
  Write-BootstrapStep "Post-bootstrap preflight READY confirmed."
}

# --- Main ---

if (-not $env:ALCAZAR_STAGE_DATABASE_URL) {
  throw "ALCAZAR_STAGE_DATABASE_URL is required."
}
$stageRef = $env:ALCAZAR_STAGE_PROJECT_REF
$productionRef = $env:ALCAZAR_PRODUCTION_PROJECT_REF
if (-not $stageRef) { throw "ALCAZAR_STAGE_PROJECT_REF is required." }
if (-not $productionRef) { throw "ALCAZAR_PRODUCTION_PROJECT_REF is required." }

Write-BootstrapStep "Validating connection target (URI not logged)."
$connParts = Test-StagePostgresConnectionUri -ConnectionString $env:ALCAZAR_STAGE_DATABASE_URL -StageRef $stageRef -ProductionRef $productionRef -AllowLabLocal
Write-BootstrapStep "Connection target: $(Redact-StageConnectionTarget $connParts)"

$resolvedManifestPath = Test-SnapshotManifest -ManifestPath $SnapshotManifestPath -StageRef $stageRef -ProductionRef $productionRef -MaxAgeHours $MaxSnapshotAgeHours
Write-BootstrapStep "Snapshot manifest path locked."

Confirm-OperatorAuthorization -StageRef $stageRef -ProvidedConfirmation $OperatorConfirmation

if ($ValidateOnly) {
  Write-BootstrapStep "ValidateOnly - URL, manifest, and operator confirmation passed. No database connection."
  exit 0
}

$tooling = Initialize-StagePostgresTooling -ConnParts $connParts -RequirePgDump:$false
Write-BootstrapStep "PostgreSQL tooling: psql=$($tooling.PsqlSource) server=$($tooling.ServerVersion) pg_dump=$($tooling.PgDumpVersion)"

Write-BootstrapStep "Running preflight READ ONLY..."
$preSql = Get-ReadOnlyPreflightSql -StageRef $stageRef -ProductionRef $productionRef
$pre = Invoke-FinancePsql -ConnParts $connParts -Sql $preSql -Label "preflight-before" -AllowFailure
$preSummary = Parse-PreflightSummary $pre.Output
Assert-IdentityOnlyNotReady $preSummary

Write-BootstrapStep "Executing identity bootstrap (transactional)..."
$bootSql = Get-IdentityBootstrapSql -StageRef $stageRef -ProductionRef $productionRef
$boot = Invoke-FinancePsql -ConnParts $connParts -Sql $bootSql -Label "bootstrap"
if ($boot.Output -notmatch 'finance_accounting_stage_identity_bootstrap_result[\s\S]*PASS') {
  throw "Bootstrap did not report PASS."
}
Write-BootstrapStep "Bootstrap PASS."

Write-BootstrapStep "Running post-bootstrap preflight READ ONLY..."
$post = Invoke-FinancePsql -ConnParts $connParts -Sql $preSql -Label "preflight-after"
$postSummary = Parse-PreflightSummary $post.Output
Assert-PreflightReady $postSummary

Write-BootstrapStep "STOP - identity bootstrap complete. Do NOT apply migrations 202-204 without separate authorization."
