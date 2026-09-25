# FELplex Stage concurrency + recovery coordinator
# Project ref: tgrqarxfmpwgrkntvgma ONLY - aborts on mismatch.
# No passwords, tokens, or connection URLs in this script.

[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$SimulateFinallyFailure
)

$ErrorActionPreference = 'Stop'
$ExpectedProjectRef = 'tgrqarxfmpwgrkntvgma'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$SqlDir = Join-Path $RepoRoot 'supabase\stage-tests\felplex-concurrency'
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "felplex-concurrency-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
$HoldSeconds = 10
$SessionBDelaySeconds = 2

$State = @{
  DocumentId = $null
  OrderId = $null
  ActorId = $null
  AttemptId = $null
  PreflightSnapshot = $null
  SessionBElapsedMs = $null
  SessionBSuccess = $false
  SessionBRejected = $false
  CleanupConfirmed = $false
  Timeline = @()
}

function Add-Timeline([string]$Event) {
  $entry = @{ at = (Get-Date).ToString('o'); event = $Event }
  $State.Timeline += $entry
  Write-Host "[$(Get-Date -Format 'HH:mm:ss.fff')] $Event"
}

function Assert-ProjectRef {
  $linkedPath = Join-Path $RepoRoot 'supabase\.temp\linked-project.json'
  if (-not (Test-Path $linkedPath)) {
    throw "Linked project file missing. Link Stage with ref $ExpectedProjectRef first."
  }
  $linked = Get-Content $linkedPath -Raw | ConvertFrom-Json
  if ($linked.ref -ne $ExpectedProjectRef) {
    throw "Project ref mismatch: expected $ExpectedProjectRef got $($linked.ref)"
  }
  Add-Timeline "Project ref confirmed: $ExpectedProjectRef"
}

function Invoke-StageQuery {
  param(
    [Parameter(Mandatory)][string]$SqlFile,
    [string]$Label = 'query'
  )
  if (-not (Test-Path $SqlFile)) { throw "SQL file not found: $SqlFile" }
  Add-Timeline "SQL $Label -> $(Split-Path $SqlFile -Leaf)"
  if ($DryRun) {
    Write-Host "  [DRY-RUN] npx supabase db query --linked --project-ref $ExpectedProjectRef -f $SqlFile"
    return @{ dry_run = $true; label = $Label }
  }
  Push-Location $RepoRoot
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & npx supabase db query --linked --project-ref $ExpectedProjectRef -f $SqlFile 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      throw "Stage query failed ($Label): exit $LASTEXITCODE`n$output"
    }
    return $output
  } finally {
    $ErrorActionPreference = $prevEap
    Pop-Location
  }
}

function Expand-SqlTemplate {
  param(
    [Parameter(Mandatory)][string]$TemplatePath,
    [Parameter(Mandatory)][string]$OutputPath,
    [Parameter(Mandatory)][hashtable]$Vars
  )
  $content = Get-Content $TemplatePath -Raw
  foreach ($key in $Vars.Keys) {
    $content = $content.Replace("{{$key}}", [string]$Vars[$key])
  }
  if ($content -match '\{\{[A-Z_]+\}\}') {
    throw "Unresolved placeholder in $(Split-Path $TemplatePath -Leaf): $($Matches[0])"
  }
  New-Item -ItemType Directory -Force -Path (Split-Path $OutputPath) | Out-Null
  $content = ($content -replace "`r`n", "`n").Replace("`r", "")
  [System.IO.File]::WriteAllText($OutputPath, $content)
  return $OutputPath
}

function Parse-Preflight {
  param([string]$RawOutput)
  if ($DryRun) { return }
  $jsonStart = $RawOutput.IndexOf('"preflight"')
  if ($jsonStart -lt 0) { throw 'Could not locate preflight JSON in query output' }
  $snippet = $RawOutput.Substring($jsonStart)
  if ($snippet -match '"preflight"\s*:\s*"((?:\\.|[^"\\])*)"') {
    $inner = $Matches[1] -replace '\\n', "`n" -replace '\\"', '"'
    $data = $inner | ConvertFrom-Json
  } else {
    throw 'Failed to parse preflight JSON payload'
  }
  $counts = $data.preflight_counts
  if ($counts.environment -ne 'stage') { throw "Preflight fail: environment=$($counts.environment)" }
  if ($counts.emission_enabled -ne $false) { throw 'Preflight fail: emission_enabled must be false' }
  if ($counts.processing_documents -ne 0) { throw 'Preflight fail: processing_documents must be 0' }
  if ($counts.fel_attempts -ne 0) { throw 'Preflight fail: fel_attempts must be 0' }
  if ([int]$data.valid_candidate_count -lt 2) { throw 'Preflight fail: fewer than 2 fixture candidates' }
  if (-not $data.selected) { throw 'Preflight fail: no fixture selected' }
  $sel = $data.selected
  $State.DocumentId = [string]$sel.document_id
  $State.OrderId = [string]$sel.order_id
  $State.ActorId = [string]$sel.actor_id
  $State.PreflightSnapshot = $data
  if ($sel.doc_status -ne 'pending_certification') { throw 'Selected doc not pending_certification' }
  if ([int]$sel.attempt_count -ne 0) { throw 'Selected doc has prior attempts' }
  Add-Timeline "Fixture selected document=$($State.DocumentId) order=$($State.OrderId)"
}

function Parse-Verify {
  param([string]$RawOutput)
  if ($DryRun) { return }
  if ($RawOutput -match '\\"attempts_for_document\\"\s*:\s*(\d+)') {
    $attemptCount = [int]$Matches[1]
  } elseif ($RawOutput -match '"attempts_for_document"\s*:\s*(\d+)') {
    $attemptCount = [int]$Matches[1]
  } else {
    throw "Could not parse attempts_for_document from verify output tail: $($RawOutput.Substring([Math]::Max(0, $RawOutput.Length - 600)))"
  }
  if ($attemptCount -ne 1) {
    throw "Verify fail: expected 1 attempt, got $attemptCount"
  }
  if ($RawOutput -match '\\"attempt_id\\"\s*:\s*"([0-9a-f-]{36})"') {
    $State.AttemptId = $Matches[1]
  } elseif ($RawOutput -match '"attempt_id"\s*:\s*"([0-9a-f-]{36})"') {
    $State.AttemptId = $Matches[1]
  } else {
    throw 'Could not parse attempt_id from verify output'
  }
  if ($RawOutput -notmatch '\\"status\\"\s*:\s*"processing"' -and $RawOutput -notmatch '"status"\s*:\s*"processing"') {
    throw 'Verify fail: document not in processing after concurrency'
  }
  Add-Timeline "Verify OK: attempt_id=$($State.AttemptId) attempts=1 processing=1"
}

function Parse-SessionB {
  param([string]$RawOutput)
  if ($DryRun) { return }
  # Supabase CLI returns nested JSON; match session_b_result fields anywhere in output.
  if ($RawOutput -match '"elapsed_ms"\s*:\s*([0-9]+(?:\.[0-9]+)?)') {
    $State.SessionBElapsedMs = [decimal]$Matches[1]
  }
  if ($RawOutput -match '"rejected"\s*:\s*true') {
    $State.SessionBRejected = $true
  }
  if ($RawOutput -match 'FEL_ALREADY_PROCESSING') {
    $State.SessionBRejected = $true
  }
  if ($RawOutput -match 'SESSION_B_UNEXPECTED_SUCCESS') {
    throw 'Session B succeeded unexpectedly'
  }
  if (-not $State.SessionBRejected) {
    throw "Session B did not reject with FEL_ALREADY_PROCESSING. Output tail: $($RawOutput.Substring([Math]::Max(0, $RawOutput.Length - 800)))"
  }
  if ($null -eq $State.SessionBElapsedMs) {
    Write-Warning 'Session B elapsed_ms not parsed; lock wait inferred from rejection only'
  } elseif ($State.SessionBElapsedMs -lt 1000) {
    throw "Session B elapsed ${State.SessionBElapsedMs}ms - insufficient lock wait evidence"
  }
  Add-Timeline "Session B rejected after $($State.SessionBElapsedMs)ms wait"
}

function Test-RestoreOutputOk {
  param([string]$Out)
  $emissionOk = ($Out -match '"emission_enabled"\s*:\s*false') -or ($Out -match '\\"emission_enabled\\"\s*:\s*false')
  $attemptsOk = ($Out -match '"fel_attempts"\s*:\s*0') -or ($Out -match '\\"fel_attempts\\"\s*:\s*0')
  $processingOk = ($Out -match '"processing_documents"\s*:\s*0') -or ($Out -match '\\"processing_documents\\"\s*:\s*0')
  return ($emissionOk -and $attemptsOk -and $processingOk)
}

function Invoke-Cleanup {
  param([string]$Reason = 'finally')
  if (-not $State.DocumentId -or -not $State.OrderId) {
    Write-Warning "Cleanup skipped ($Reason): missing document/order ids"
    return $false
  }
  $attemptId = if ($State.AttemptId) { $State.AttemptId } else { '00000000-0000-4000-8000-000000000000' }
  $vars = @{
    DOCUMENT_ID = $State.DocumentId
    ORDER_ID = $State.OrderId
    ATTEMPT_ID = $attemptId
  }
  $cleanupSql = Expand-SqlTemplate `
    -TemplatePath (Join-Path $SqlDir 'cleanup.sql') `
    -OutputPath (Join-Path $TempDir 'cleanup.sql') `
    -Vars $vars
  if ($SimulateFinallyFailure -and $Reason -eq 'finally') {
    Add-Timeline 'SimulateFinallyFailure: skipping cleanup execution'
    return $false
  }
  $out = Invoke-StageQuery -SqlFile $cleanupSql -Label "cleanup-$Reason"
  if ($DryRun) { return $true }
  $emissionFalse = ($out -match '"emission_enabled"\s*:\s*false') -or ($out -match '\\"emission_enabled\\"\s*:\s*false')
  if (-not $emissionFalse) {
    throw "Cleanup fail: emission_enabled not false. Output tail: $($out.Substring([Math]::Max(0, $out.Length - 400)))"
  }
  if ($out -match '"fel_attempts"\s*:\s*(\d+)' -and [int]$Matches[1] -ne 0) {
    throw 'Cleanup fail: fel_attempts not 0'
  }
  if ($out -match '"processing_documents"\s*:\s*(\d+)' -and [int]$Matches[1] -ne 0) {
    throw 'Cleanup fail: processing_documents not 0'
  }
  $State.CleanupConfirmed = $true
  Add-Timeline "Cleanup confirmed ($Reason)"
  return $true
}

function Test-PostCleanupPreflight {
  if ($DryRun) { return $true }
  $out = Invoke-StageQuery -SqlFile (Join-Path $SqlDir 'preflight.sql') -Label 'post-cleanup-preflight'
  $emissionOk = ($out -match '"emission_enabled"\s*:\s*false') -or ($out -match '\\"emission_enabled\\"\s*:\s*false')
  if (-not $emissionOk) { throw 'Post-cleanup: emission_enabled not false' }
  $attemptsOk = ($out -match '"fel_attempts"\s*:\s*0') -or ($out -match '\\"fel_attempts\\"\s*:\s*0')
  if (-not $attemptsOk) { throw 'Post-cleanup: fel_attempts not 0' }
  $processingOk = ($out -match '"processing_documents"\s*:\s*0') -or ($out -match '\\"processing_documents\\"\s*:\s*0')
  if (-not $processingOk) { throw 'Post-cleanup: processing not 0' }
  Add-Timeline 'Post-cleanup preflight matches baseline'
  return $true
}

try {
  New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
  Add-Timeline "Temp SQL dir: $TempDir"
  Assert-ProjectRef

  $preflightOut = Invoke-StageQuery -SqlFile (Join-Path $SqlDir 'preflight.sql') -Label 'preflight'
  if (-not $DryRun) {
    Parse-Preflight -RawOutput ([string]$preflightOut)
  } else {
    $State.DocumentId = '00000000-0000-4000-8000-000000000001'
    $State.OrderId = '00000000-0000-4000-8000-000000000002'
    $State.ActorId = '00000000-0000-4000-8000-000000000003'
    Add-Timeline 'DRY-RUN using placeholder fixture UUIDs for template expansion'
  }

  $vars = @{
    DOCUMENT_ID = $State.DocumentId
    ORDER_ID = $State.OrderId
    ACTOR_ID = $State.ActorId
    ATTEMPT_ID = '00000000-0000-4000-8000-000000000000'
  }

  $enableSql = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'enable-window.sql') -OutputPath (Join-Path $TempDir 'enable-window.sql') -Vars $vars
  $sessionASql = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'session-a.sql') -OutputPath (Join-Path $TempDir 'session-a.sql') -Vars $vars
  $sessionBSql = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'session-b.sql') -OutputPath (Join-Path $TempDir 'session-b.sql') -Vars $vars

  if ($DryRun) {
    Invoke-StageQuery -SqlFile $enableSql -Label 'enable-window' | Out-Null
    Invoke-StageQuery -SqlFile $sessionASql -Label 'session-a' | Out-Null
    Invoke-StageQuery -SqlFile $sessionBSql -Label 'session-b' | Out-Null
    $verifySqlDry = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'verify.sql') -OutputPath (Join-Path $TempDir 'verify.sql') -Vars $vars
    Invoke-StageQuery -SqlFile $verifySqlDry -Label 'verify' | Out-Null
    $vars.ATTEMPT_ID = '00000000-0000-4000-8000-000000000004'
    $recoverySqlDry = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'recovery-failed.sql') -OutputPath (Join-Path $TempDir 'recovery-failed.sql') -Vars $vars
    Invoke-StageQuery -SqlFile $recoverySqlDry -Label 'recovery' | Out-Null
    $cleanupSqlDry = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'cleanup.sql') -OutputPath (Join-Path $TempDir 'cleanup.sql') -Vars $vars
    Invoke-StageQuery -SqlFile $cleanupSqlDry -Label 'cleanup' | Out-Null
    Add-Timeline 'DRY-RUN complete - commands enumerated, Stage not mutated'
    Write-Host "`nDRY-RUN PASS"
    exit 0
  }

  Invoke-StageQuery -SqlFile $enableSql -Label 'enable-window' | Out-Null
  Add-Timeline 'Emission window opened (emission_enabled=true)'

  $sessionAProc = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    "Set-Location '$RepoRoot'; `$ErrorActionPreference='Continue'; npx supabase db query --linked --project-ref $ExpectedProjectRef -f '$sessionASql'"
  ) -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $TempDir 'session-a.out') -RedirectStandardError (Join-Path $TempDir 'session-a.err')

  Start-Sleep -Seconds $SessionBDelaySeconds
  Add-Timeline "Session B starting (${SessionBDelaySeconds}s after A)"

  $sessionBOut = Invoke-StageQuery -SqlFile $sessionBSql -Label 'session-b'
  Parse-SessionB -RawOutput ([string]$sessionBOut)

  if (-not $sessionAProc.HasExited) {
    $null = $sessionAProc.WaitForExit(120000)
  }
  $sessionAOut = (Get-Content (Join-Path $TempDir 'session-a.out') -Raw -ErrorAction SilentlyContinue)
  $sessionAErr = (Get-Content (Join-Path $TempDir 'session-a.err') -Raw -ErrorAction SilentlyContinue)
  if ($null -ne $sessionAProc.ExitCode -and $sessionAProc.ExitCode -ne 0) {
    throw "Session A failed: exit $($sessionAProc.ExitCode)`n$sessionAOut`n$sessionAErr"
  }
  if ($sessionAOut -notmatch 'session_a_result') {
    throw "Session A missing session_a_result: $sessionAOut`n$sessionAErr"
  }
  Add-Timeline 'Session A committed after hold'

  $verifySql = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'verify.sql') -OutputPath (Join-Path $TempDir 'verify.sql') -Vars $vars
  $verifyOut = Invoke-StageQuery -SqlFile $verifySql -Label 'verify'
  Parse-Verify -RawOutput ([string]$verifyOut)

  $vars.ATTEMPT_ID = $State.AttemptId
  $recoverySql = Expand-SqlTemplate -TemplatePath (Join-Path $SqlDir 'recovery-failed.sql') -OutputPath (Join-Path $TempDir 'recovery-failed.sql') -Vars $vars
  $recoveryOut = Invoke-StageQuery -SqlFile $recoverySql -Label 'recovery'
  if ($recoveryOut -notmatch 'FEL_TEST_CONCURRENCY' -and $recoveryOut -notmatch '\\"outcome\\"\s*:\s*"failed"' -and $recoveryOut -notmatch '"outcome"\s*:\s*"failed"') {
    throw 'Recovery without HTTP did not finalize failed'
  }
  Add-Timeline 'Recovery without HTTP: finalize failed OK'

  if (-not (Invoke-Cleanup -Reason 'normal')) {
    throw 'CRITICAL_STAGE_CLEANUP_REQUIRED'
  }
  Test-PostCleanupPreflight | Out-Null

  $result = @{
    verdict = 'PASS'
    session_a_success = 1
    session_b_success = 0
    session_b_rejected = 1
    session_b_elapsed_ms = $State.SessionBElapsedMs
    attempts_created = 1
    recovery_without_http = 'PASS'
    cleanup = 'PASS'
    document_id = $State.DocumentId
    attempt_id = $State.AttemptId
    timeline = $State.Timeline
  }
  Write-Host "`nCONCURRENCY TEST PASS"
  $result | ConvertTo-Json -Depth 6
  exit 0
}
catch {
  Add-Timeline "ERROR: $($_.Exception.Message)"
  $cleanupOk = $false
  try {
    $restoreSql = Join-Path $SqlDir 'emergency-restore.sql'
    if (Test-Path $restoreSql) {
      $restoreOut = Invoke-StageQuery -SqlFile $restoreSql -Label 'emergency-restore'
      if (Test-RestoreOutputOk ([string]$restoreOut)) {
        $cleanupOk = $true
        $State.CleanupConfirmed = $true
        Add-Timeline 'Emergency restore confirmed baseline'
      }
    }
    if (-not $cleanupOk) {
      $cleanupOk = Invoke-Cleanup -Reason 'emergency'
    }
  } catch {
    Add-Timeline "Emergency cleanup error: $($_.Exception.Message)"
  }
  if (-not $cleanupOk) {
    Write-Error 'CRITICAL_STAGE_CLEANUP_REQUIRED'
    exit 2
  }
  Write-Error $_.Exception.Message
  exit 1
}
finally {
  if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue
  }
}
