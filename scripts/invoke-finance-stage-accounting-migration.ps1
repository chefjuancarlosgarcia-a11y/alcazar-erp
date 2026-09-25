#Requires -Version 5.1
<#
.SYNOPSIS
  Fail-closed wrapper to apply one finance accounting migration phase (202, 203, or 204) on Stage.

.DESCRIPTION
  Validates URI, post-bootstrap snapshot manifest, git worktree, operator confirmation,
  and pre-phase database state. Applies exactly one closed migration + postcheck pair
  inside a single transaction, then re-runs postcheck READ ONLY.

  Remote execution MUST use this wrapper — one phase per invocation. STOP after each phase.

.PARAMETER Phase
  Migration phase: 202, 203, or 204 only.

.PARAMETER SnapshotManifestPath
  Path to manifest-*.json from a normal (post-bootstrap) stage-finance-accounting-snapshot.ps1 run.

.PARAMETER MaxSnapshotAgeHours
  Maximum allowed snapshot age (default 24).

.PARAMETER OperatorConfirmation
  Non-interactive confirmation: must equal "APPLY <Phase> TO <StageProjectRef>" exactly.

.PARAMETER ValidateOnly
  Validate URI, manifest, git worktree, and operator confirmation without connecting.

.NOTES
  Lab-only env (never set in production):
  - ALCAZAR_FINANCE_MIGRATION_LAB_INJECT_FAILURE=1  -> SELECT 1/0 before COMMIT
  - ALCAZAR_FINANCE_MIGRATION_LAB_INJECT_BREAK=postcheck -> break state before postcheck (202 only)
#>
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("202", "203", "204")]
  [string]$Phase,
  [Parameter(Mandatory = $true)]
  [string]$SnapshotManifestPath,
  [int]$MaxSnapshotAgeHours = 24,
  [string]$OperatorConfirmation = "",
  [switch]$ValidateOnly
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "finance-stage-postgres-connection.ps1")

$PhaseMap = @{
  "202" = @{
    MigrationRel = "supabase/schema/202_finance_accounting_chart_of_accounts.sql"
    PostcheckRel = "supabase/stage-fixtures/finance_accounting_postcheck_202.sql"
    PostcheckLabel = "finance_accounting_postcheck_202"
  }
  "203" = @{
    MigrationRel = "supabase/schema/203_finance_accounting_multibranch_foundation.sql"
    PostcheckRel = "supabase/stage-fixtures/finance_accounting_postcheck_203.sql"
    PostcheckLabel = "finance_accounting_postcheck_203"
  }
  "204" = @{
    MigrationRel = "supabase/schema/204_finance_accounting_journal_engine.sql"
    PostcheckRel = "supabase/stage-fixtures/finance_accounting_postcheck_204.sql"
    PostcheckLabel = "finance_accounting_postcheck_204"
  }
}

function Write-MigrationStep([string]$Message) {
  Write-Host "[finance-migration] $Message"
}

function Get-Sha256([string]$Path) {
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-GitWorktreeClean {
  if ($env:ALCAZAR_FINANCE_MIGRATION_LAB_SKIP_GIT_CHECK -eq '1') {
    Write-MigrationStep "Git worktree check skipped (lab only)."
    return
  }
  $repoRoot = Split-Path $PSScriptRoot -Parent
  Push-Location $repoRoot
  try {
    $porcelain = (git status --porcelain 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
      throw "git status failed."
    }
    if (-not $porcelain) { return }
    foreach ($line in ($porcelain -split "`r?`n" | Where-Object { $_ })) {
      $path = $line.Substring(3).Trim().Trim('"')
      $normalized = ($path -replace '\\', '/').TrimEnd('/')
      if ($line -match '^\?\? ' -and ($normalized -eq '.local-backup' -or $normalized.StartsWith('.local-backup/'))) {
        continue
      }
      throw "Refusing migration apply: git worktree has relevant changes outside .local-backup/: $line"
    }
  } finally {
    Pop-Location
  }
  Write-MigrationStep "Git worktree clean (only .local-backup/ allowed untracked)."
}

function Test-NormalSnapshotManifest {
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
  $manifest = (Get-Content -LiteralPath $resolvedManifest -Raw -Encoding UTF8) | ConvertFrom-Json

  if ($manifest.manifest_version -lt 1) {
    throw "Snapshot manifest version unsupported."
  }
  if ($manifest.dry_run) {
    throw "Refusing migration apply: snapshot manifest is dry_run."
  }
  if ($manifest.uninitialized_stage) {
    throw "Refusing migration apply: snapshot must be post-bootstrap (uninitialized_stage=false)."
  }
  if ($manifest.stage_project_ref.ToLowerInvariant() -ne $StageRef.ToLowerInvariant()) {
    throw "Refusing migration apply: snapshot stage_project_ref mismatch."
  }
  if ($manifest.production_project_ref.ToLowerInvariant() -ne $ProductionRef.ToLowerInvariant()) {
    throw "Refusing migration apply: snapshot production_project_ref mismatch."
  }
  if (-not $manifest.created_at) {
    throw "Refusing migration apply: snapshot manifest missing created_at."
  }
  $createdAt = [datetime]::Parse($manifest.created_at, $null, [Globalization.DateTimeStyles]::RoundtripKind)
  $age = (Get-Date).ToUniversalTime() - $createdAt.ToUniversalTime()
  if ($age.TotalHours -gt $MaxAgeHours) {
    throw "Refusing migration apply: snapshot older than $MaxAgeHours hour(s) (age=$([Math]::Round($age.TotalHours, 2))h)."
  }

  foreach ($entry in $manifest.files) {
    $filePath = $entry.path
    if (-not [System.IO.Path]::IsPathRooted($filePath)) {
      $filePath = Join-Path $manifestDir $filePath
    }
    if (-not (Test-Path -LiteralPath $filePath)) {
      throw "Snapshot artifact missing: $filePath"
    }
    $hash = Get-Sha256 $filePath
    if ($hash -ne $entry.sha256) {
      throw "Snapshot artifact SHA-256 mismatch: $filePath"
    }
  }

  Write-MigrationStep "Snapshot manifest verified (post-bootstrap, age=$([Math]::Round($age.TotalHours, 2))h)."
  return @{
    Path = $resolvedManifest
    AgeHours = $age.TotalHours
  }
}

function Confirm-OperatorAuthorization {
  param(
    [string]$Phase,
    [string]$StageRef,
    [string]$ProvidedConfirmation
  )
  $expected = "APPLY $Phase TO $StageRef"
  if ($ProvidedConfirmation) {
    if ($ProvidedConfirmation -cne $expected) {
      throw "Operator confirmation rejected: must equal '$expected' exactly."
    }
    Write-MigrationStep "Operator confirmation accepted (non-interactive)."
    return
  }
  Write-Host ""
  Write-Host "Type exactly: $expected"
  Write-Host ""
  $typed = Read-Host "Confirmation"
  if ($typed -cne $expected) {
    throw "Operator confirmation rejected."
  }
  Write-MigrationStep "Operator confirmation accepted."
}

function Assert-MigrationSqlHasNoTransactionControl {
  param([string]$Sql, [string]$Label)
  $stripped = ($Sql -replace '/\*[\s\S]*?\*/', '' -replace '--[^\r\n]*', '')
  if ($stripped -match '(?im)(^|[;\s])(BEGIN|COMMIT|ROLLBACK)\s*;') {
    throw "$Label contains explicit transaction control (BEGIN/COMMIT/ROLLBACK). Wrapper owns atomicity."
  }
}

function Get-ReadOnlyPostcheckSql {
  param([string]$PostcheckSql)
  return @"
SET default_transaction_read_only = on;
BEGIN READ ONLY;
$PostcheckSql
ROLLBACK;
"@
}

function Get-ReadOnlyPreflightSql {
  param(
    [string]$StageRef,
    [string]$ProductionRef
  )
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $preflightPath = Join-Path $repoRoot "supabase/stage-fixtures/finance_accounting_stage_preflight.sql"
  $preflightSql = Get-Content -LiteralPath $preflightPath -Raw -Encoding UTF8
  return Get-ReadOnlyPostcheckSql @"
SELECT set_config('alcazar.finance_stage_project_ref', '$StageRef', true);
SELECT set_config('alcazar.finance_production_project_ref', '$ProductionRef', true);
$preflightSql
"@
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
  return @{ Result = $result; BlockingDetail = $detail }
}

function Parse-PostcheckSummary {
  param(
    [string]$Output,
    [string]$Label
  )
  foreach ($line in ($Output -split "`r?`n")) {
    if ($line -match "^\s*$([regex]::Escape($Label))\s*\|\s*(PASS|FAIL)\s*\|") {
      return $Matches[1]
    }
  }
  if ($Output -match "$([regex]::Escape($Label))[\s\S]{0,400}?\bPASS\b") { return "PASS" }
  if ($Output -match "$([regex]::Escape($Label))[\s\S]{0,400}?\bFAIL\b") { return "FAIL" }
  return $null
}

function Get-PreStateFlag {
  param(
    [hashtable]$ConnParts,
    [string]$Query
  )
  $val = Invoke-StagePostgresPsqlAt -ConnParts $ConnParts -Query $Query
  return ($val -eq 't')
}

function Assert-PrePhaseState {
  param(
    [string]$Phase,
    [hashtable]$ConnParts,
    [string]$StageRef,
    [string]$ProductionRef,
    [string]$RepoRoot
  )
  Write-MigrationStep "Probing pre-phase database state..."
  $chartAbsent = Get-PreStateFlag $ConnParts "select to_regclass('public.finance_chart_accounts') is null;"
  $branchesAbsent = Get-PreStateFlag $ConnParts "select to_regclass('public.branches') is null;"
  $costCentersAbsent = Get-PreStateFlag $ConnParts "select to_regclass('public.finance_cost_centers') is null;"
  $journalAbsent = Get-PreStateFlag $ConnParts "select to_regclass('public.finance_journal_entries') is null;"
  $flags = @{
    chart_absent = $chartAbsent
    branches_absent = $branchesAbsent
    cost_centers_absent = $costCentersAbsent
    journal_absent = $journalAbsent
    chart_present = -not $chartAbsent
    branches_present = -not $branchesAbsent
    cost_centers_present = -not $costCentersAbsent
  }

  if ($Phase -eq "202") {
    $preflight = Invoke-MigrationPsql -ConnParts $ConnParts -Sql (Get-ReadOnlyPreflightSql -StageRef $StageRef -ProductionRef $ProductionRef) -Label "preflight-pre-202" -EvidenceDir $null
    $summary = Parse-PreflightSummary $preflight.Output
    if ($summary.Result -ne "READY") {
      throw "Phase 202 requires Stage identity preflight READY (got $($summary.Result); $($summary.BlockingDetail))."
    }
    if (-not $flags.chart_absent -or -not $flags.branches_absent -or -not $flags.journal_absent) {
      throw "Phase 202 requires finance 202/203/204 objects absent (partial or out-of-order state detected)."
    }
    return @{ Preflight = "READY"; Probe = $flags }
  }

  if ($Phase -eq "203") {
    $post202Path = Join-Path $RepoRoot $PhaseMap["202"].PostcheckRel
    $post202Sql = Get-Content -LiteralPath $post202Path -Raw -Encoding UTF8
    $post202 = Invoke-MigrationPsql -ConnParts $ConnParts -Sql (Get-ReadOnlyPostcheckSql $post202Sql) -Label "postcheck-202-pre" -EvidenceDir $null -AllowFailure
    $post202Result = Parse-PostcheckSummary -Output $post202.Output -Label $PhaseMap["202"].PostcheckLabel
    if ($post202Result -ne "PASS") {
      throw "Phase 203 requires postcheck 202 PASS before apply (got $post202Result)."
    }
    if (-not $flags.chart_present -or -not $flags.branches_absent -or -not $flags.journal_absent) {
      throw "Phase 203 requires 202 applied and 203/204 absent (partial or out-of-order state detected)."
    }
    return @{ Postcheck202 = "PASS"; Probe = $flags }
  }

  $post203Path = Join-Path $RepoRoot $PhaseMap["203"].PostcheckRel
  $post203Sql = Get-Content -LiteralPath $post203Path -Raw -Encoding UTF8
  $post203 = Invoke-MigrationPsql -ConnParts $ConnParts -Sql (Get-ReadOnlyPostcheckSql $post203Sql) -Label "postcheck-203-pre" -EvidenceDir $null -AllowFailure
  $post203Result = Parse-PostcheckSummary -Output $post203.Output -Label $PhaseMap["203"].PostcheckLabel
  if ($post203Result -ne "PASS") {
    throw "Phase 204 requires postcheck 203 PASS before apply (got $post203Result)."
  }
  if (-not $flags.chart_present -or -not $flags.branches_present -or -not $flags.cost_centers_present -or -not $flags.journal_absent) {
    throw "Phase 204 requires 203 applied and 204 absent (partial or out-of-order state detected)."
  }
  return @{ Postcheck203 = "PASS"; Probe = $flags }
}

function New-MigrationEvidenceDir {
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $base = Join-Path (Join-Path $repoRoot ".local-backup") "finance-stage-accounting-migration-wrapper"
  $dir = Join-Path $base (Get-Date -Format "yyyyMMdd-HHmmss")
  if (Test-Path -LiteralPath $dir) {
    throw "Refusing to overwrite existing evidence directory: $dir"
  }
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
  return $dir
}

function Redact-PsqlOutput {
  param(
    [string]$Text,
    [hashtable]$ConnParts,
    [string]$StageRef
  )
  $redacted = $Text -replace [regex]::Escape($ConnParts.Password), "***"
  if ($ConnParts.Password) {
    $redacted = $redacted -replace "postgres(?:\.$([regex]::Escape($StageRef)))?:$([regex]::Escape($ConnParts.Password))@", "postgres:***@"
  }
  return $redacted
}

function Invoke-MigrationPsql {
  param(
    [hashtable]$ConnParts,
    [string]$Sql,
    [string]$Label,
    [string]$EvidenceDir,
    [switch]$AllowFailure
  )
  $repoRoot = Split-Path $PSScriptRoot -Parent
  $result = Invoke-StagePostgresPsql -ConnParts $ConnParts -Sql $Sql -DockerExtraArgs @("-v", "${repoRoot}:/repo:ro")
  $text = $result.Output
  if ($EvidenceDir) {
    $redacted = Redact-PsqlOutput -Text $text -ConnParts $ConnParts -StageRef $env:ALCAZAR_STAGE_PROJECT_REF
    $logFile = Join-Path $EvidenceDir "$Label.log"
    if (Test-Path -LiteralPath $logFile) {
      throw "Refusing to overwrite existing log evidence: $logFile"
    }
    Set-Content -Path $logFile -Value $redacted -Encoding UTF8
  }
  if (-not $AllowFailure -and $result.ExitCode -ne 0) {
    throw "$Label failed (exit $($result.ExitCode))."
  }
  return @{ Output = $text; ExitCode = $result.ExitCode }
}

function Build-TransactionalApplySql {
  param(
    [string]$Phase,
    [string]$StageRef,
    [string]$ProductionRef,
    [string]$MigrationSql,
    [string]$PostcheckSql
  )
  Assert-MigrationSqlHasNoTransactionControl -Sql $MigrationSql -Label "Migration $Phase"
  Assert-MigrationSqlHasNoTransactionControl -Sql $PostcheckSql -Label "Postcheck $Phase"

  $parts = @(
    "SET client_min_messages = warning;",
    "BEGIN;",
    "SELECT set_config('alcazar.finance_stage_project_ref', '$StageRef', true);",
    "SELECT set_config('alcazar.finance_production_project_ref', '$ProductionRef', true);",
    $MigrationSql
  )

  if ($env:ALCAZAR_FINANCE_MIGRATION_LAB_INJECT_BREAK -eq 'postcheck' -and $Phase -eq '202') {
    $parts += "DROP TABLE IF EXISTS public.finance_chart_accounts CASCADE;"
  }

  $parts += $PostcheckSql

  if ($env:ALCAZAR_FINANCE_MIGRATION_LAB_INJECT_FAILURE -eq '1') {
    $parts += "SELECT 1/0 AS lab_injected_failure;"
  }

  $parts += "COMMIT;"
  return ($parts -join "`n")
}

function Write-MigrationEvidence {
  param(
    [string]$EvidenceDir,
    [hashtable]$Payload
  )
  $jsonPath = Join-Path $EvidenceDir "evidence.json"
  if (Test-Path -LiteralPath $jsonPath) {
    throw "Refusing to overwrite evidence.json"
  }
  $json = $Payload | ConvertTo-Json -Depth 8
  [System.IO.File]::WriteAllText($jsonPath, $json, [System.Text.UTF8Encoding]::new($false))
}

# --- Main ---

if (-not $env:ALCAZAR_STAGE_DATABASE_URL) {
  throw "ALCAZAR_STAGE_DATABASE_URL is required."
}
$stageRef = $env:ALCAZAR_STAGE_PROJECT_REF
$productionRef = $env:ALCAZAR_PRODUCTION_PROJECT_REF
if (-not $stageRef) { throw "ALCAZAR_STAGE_PROJECT_REF is required." }
if (-not $productionRef) { throw "ALCAZAR_PRODUCTION_PROJECT_REF is required." }

$repoRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repoRoot
try {
  $gitHead = (& git rev-parse HEAD 2>&1 | Out-String).Trim()
} finally {
  Pop-Location
}
if (-not $gitHead) { throw "Unable to resolve git HEAD." }

Write-MigrationStep "Phase $Phase selected (single-phase apply only)."
Assert-GitWorktreeClean

Write-MigrationStep "Validating connection target (URI not logged)."
$connParts = Test-StagePostgresConnectionUri -ConnectionString $env:ALCAZAR_STAGE_DATABASE_URL -StageRef $stageRef -ProductionRef $productionRef -AllowLabLocal
Write-MigrationStep "Connection target: $(Redact-StageConnectionTarget $connParts)"

$manifestInfo = Test-NormalSnapshotManifest -ManifestPath $SnapshotManifestPath -StageRef $stageRef -ProductionRef $productionRef -MaxAgeHours $MaxSnapshotAgeHours
Confirm-OperatorAuthorization -Phase $Phase -StageRef $stageRef -ProvidedConfirmation $OperatorConfirmation

$phaseInfo = $PhaseMap[$Phase]
$migrationPath = Join-Path $repoRoot $phaseInfo.MigrationRel
$postcheckPath = Join-Path $repoRoot $phaseInfo.PostcheckRel
if (-not (Test-Path -LiteralPath $migrationPath)) { throw "Migration file missing: $($phaseInfo.MigrationRel)" }
if (-not (Test-Path -LiteralPath $postcheckPath)) { throw "Postcheck file missing: $($phaseInfo.PostcheckRel)" }

$migrationSql = Get-Content -LiteralPath $migrationPath -Raw -Encoding UTF8
$postcheckSql = Get-Content -LiteralPath $postcheckPath -Raw -Encoding UTF8
$migrationHash = Get-Sha256 $migrationPath
$postcheckHash = Get-Sha256 $postcheckPath

Write-MigrationStep "Migration SHA-256: $migrationHash"
Write-MigrationStep "Postcheck SHA-256: $postcheckHash"

if ($ValidateOnly) {
  Write-MigrationStep "ValidateOnly - preflight checks passed. No database connection."
  exit 0
}

$evidenceDir = New-MigrationEvidenceDir
Write-MigrationStep "Evidence directory: $evidenceDir"

$tooling = Initialize-StagePostgresTooling -ConnParts $connParts -RequirePgDump:$false
Write-MigrationStep "PostgreSQL tooling: psql=$($tooling.PsqlSource) server=$($tooling.ServerVersion)"

$preState = $null
$transactionResult = "SKIPPED"
$postcheckReadOnly = "SKIPPED"
try {
  $preState = Assert-PrePhaseState -Phase $Phase -ConnParts $connParts -StageRef $stageRef -ProductionRef $productionRef -RepoRoot $repoRoot
  Write-MigrationStep "Pre-phase state confirmed."

  $applySql = Build-TransactionalApplySql -Phase $Phase -StageRef $stageRef -ProductionRef $productionRef -MigrationSql $migrationSql -PostcheckSql $postcheckSql
  Write-MigrationStep "Applying phase $Phase inside single transaction (migration + postcheck)..."
  $apply = Invoke-MigrationPsql -ConnParts $connParts -Sql $applySql -Label "apply-phase-$Phase" -EvidenceDir $evidenceDir
  $inTxnResult = Parse-PostcheckSummary -Output $apply.Output -Label $phaseInfo.PostcheckLabel
  if ($inTxnResult -ne "PASS") {
    throw "In-transaction postcheck did not PASS (got $inTxnResult)."
  }
  $transactionResult = "PASS"
  Write-MigrationStep "Transaction committed (migration + in-transaction postcheck PASS)."

  Write-MigrationStep "Running post-commit postcheck READ ONLY..."
  $post = Invoke-MigrationPsql -ConnParts $connParts -Sql (Get-ReadOnlyPostcheckSql $postcheckSql) -Label "postcheck-readonly-$Phase" -EvidenceDir $evidenceDir
  $postcheckReadOnly = Parse-PostcheckSummary -Output $post.Output -Label $phaseInfo.PostcheckLabel
  if ($postcheckReadOnly -ne "PASS") {
    throw "Post-commit READ ONLY postcheck must PASS (got $postcheckReadOnly)."
  }
  Write-MigrationStep "Post-commit READ ONLY postcheck PASS."

  Write-MigrationEvidence -EvidenceDir $evidenceDir -Payload @{
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    phase = $Phase
    git_head = $gitHead
    stage_project_ref = $stageRef
    production_project_ref = $productionRef
    snapshot_manifest = $manifestInfo.Path
    migration_file = $phaseInfo.MigrationRel
    migration_sha256 = $migrationHash
    postcheck_file = $phaseInfo.PostcheckRel
    postcheck_sha256 = $postcheckHash
    connection_mode = $connParts.ConnectionMode
    tooling = @{
      psql = $tooling.PsqlSource
      server_version = $tooling.ServerVersion
      docker_image = $tooling.DockerImage
    }
    pre_state = $preState
    transaction_result = $transactionResult
    postcheck_readonly = $postcheckReadOnly
    migration_has_explicit_tx_control = $false
  }

  Write-MigrationStep "STOP - phase $Phase complete. Do NOT apply the next phase without separate authorization."
  exit 0
} catch {
  Write-MigrationEvidence -EvidenceDir $evidenceDir -Payload @{
    timestamp = (Get-Date).ToUniversalTime().ToString("o")
    phase = $Phase
    git_head = $gitHead
    stage_project_ref = $stageRef
    production_project_ref = $productionRef
    snapshot_manifest = $manifestInfo.Path
    migration_file = $phaseInfo.MigrationRel
    migration_sha256 = $migrationHash
    postcheck_file = $phaseInfo.PostcheckRel
    postcheck_sha256 = $postcheckHash
    connection_mode = $connParts.ConnectionMode
    pre_state = $preState
    transaction_result = "FAIL"
    postcheck_readonly = $postcheckReadOnly
    error = $_.Exception.Message
  }
  throw
}
