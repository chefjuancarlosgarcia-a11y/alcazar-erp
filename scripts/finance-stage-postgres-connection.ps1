# Shared PostgreSQL connection helpers for Stage finance wrappers.
# Dot-source from scripts/stage-finance-accounting-snapshot.ps1 and
# scripts/invoke-finance-stage-identity-bootstrap.ps1

function Parse-PostgresUri([string]$ConnectionString) {
  if ([string]::IsNullOrWhiteSpace($ConnectionString)) {
    throw "Connection URI is empty."
  }
  $normalized = $ConnectionString.Trim()
  if ($normalized -notmatch '^(postgres(?:ql)?://)(.+)$') {
    throw "Invalid PostgreSQL URI scheme."
  }
  $remainder = $Matches[2]
  if ($remainder -notmatch '^([^:@/]+)(?::([^@]*))?@([^/?#]+)(?:/([^?#]*))?(?:\?.*)?$') {
    throw "Invalid PostgreSQL URI format (expected user[:password]@host:port/database)."
  }
  $username = [Uri]::UnescapeDataString($Matches[1])
  $password = if ($null -ne $Matches[2]) { [Uri]::UnescapeDataString($Matches[2]) } else { "" }
  $database = if ($Matches[4]) { [Uri]::UnescapeDataString($Matches[4]) } else { "postgres" }
  $hostPort = $Matches[3]
  if ($hostPort -notmatch '^(.+):(\d+)$') {
    throw "Invalid PostgreSQL URI: port must be explicit in the host (required for Supabase Session/Direct validation)."
  }
  return @{
    Username = $username
    Password = $password
    Host = $Matches[1]
    Port = [int]$Matches[2]
    Database = $database
    DockerImage = $null
    ConnectionMode = $null
  }
}

function Test-IsLabLocalHost([string]$HostName) {
  return ($HostName.ToLowerInvariant() -in @("127.0.0.1", "localhost", "host.docker.internal"))
}

function Resolve-DockerPgHost([string]$HostName) {
  if (Test-IsLabLocalHost $HostName) {
    return "host.docker.internal"
  }
  return $HostName
}

function Get-PostgresMajorFromVersionString([string]$VersionText) {
  if ($VersionText -match '(?:PostgreSQL\s+|server_version\s+)?(\d+)') {
    return [int]$Matches[1]
  }
  throw "Unable to parse PostgreSQL version from: $VersionText"
}

function Get-DockerPostgresImageForServerMajor([int]$ServerMajor) {
  if ($env:ALCAZAR_FINANCE_PG_DOCKER_TAG) {
    return $env:ALCAZAR_FINANCE_PG_DOCKER_TAG.Trim()
  }
  if ($ServerMajor -lt 12) {
    throw "Unsupported PostgreSQL server major version: $ServerMajor"
  }
  $clientMajor = [Math]::Min([Math]::Max($ServerMajor, 12), 17)
  return "postgres:${clientMajor}-alpine"
}

function Test-StagePostgresConnectionUri {
  param(
    [string]$ConnectionString,
    [string]$StageRef,
    [string]$ProductionRef,
    [switch]$AllowLabLocal
  )
  if ([string]::IsNullOrWhiteSpace($StageRef)) {
    throw "ALCAZAR_STAGE_PROJECT_REF is required."
  }
  if ([string]::IsNullOrWhiteSpace($ProductionRef)) {
    throw "ALCAZAR_PRODUCTION_PROJECT_REF is required."
  }
  if ($StageRef -ceq $ProductionRef) {
    throw "Refusing connection: Stage and Production project refs must differ."
  }
  if ($ConnectionString -match '(?i)(^|[^a-z0-9])(prod|production)([^a-z0-9]|$)') {
    throw "Refusing connection: URI appears to target Production."
  }

  $parts = Parse-PostgresUri $ConnectionString
  $stageRefNorm = $StageRef.ToLowerInvariant()
  $prodRefNorm = $ProductionRef.ToLowerInvariant()
  $usernameNorm = $parts.Username.ToLowerInvariant()
  $hostNorm = $parts.Host.ToLowerInvariant()

  if ($parts.Port -eq 6543) {
    throw "Refusing connection: port 6543 (Transaction pooler) is not supported. Use Session pooler on port 5432."
  }

  $productionPoolerUser = "postgres.$prodRefNorm"
  $productionDirectHost = "db.$prodRefNorm.supabase.co"
  if ($usernameNorm -ceq $productionPoolerUser -or $hostNorm -ceq $productionDirectHost) {
    throw "Refusing connection: target matches Production project ref."
  }

  if ($AllowLabLocal -and (Test-IsLabLocalHost $parts.Host)) {
    $parts.ConnectionMode = "lab_local"
    return $parts
  }

  if ($parts.Port -ne 5432) {
    throw "Refusing connection: Supabase Session/Direct connections must use port 5432."
  }

  $expectedPoolerUser = "postgres.$stageRefNorm"
  $expectedDirectHost = "db.$stageRefNorm.supabase.co"
  $isSessionPooler = ($usernameNorm -ceq $expectedPoolerUser) -and ($hostNorm.EndsWith(".pooler.supabase.com"))
  $isDirect = ($usernameNorm -eq "postgres") -and ($hostNorm -ceq $expectedDirectHost)

  if ($isSessionPooler) {
    $parts.ConnectionMode = "session_pooler"
    return $parts
  }
  if ($isDirect) {
    $parts.ConnectionMode = "direct"
    return $parts
  }

  throw "Refusing connection: URI must be Session pooler (postgres.<stage-ref>@*.pooler.supabase.com:5432) or Direct (postgres@db.<stage-ref>.supabase.co:5432)."
}

function Redact-StageConnectionTarget([hashtable]$Parts) {
  $user = $Parts.Username
  if ($user -match '^postgres\.([a-z0-9]+)$') {
    $user = "postgres.$($Matches[1].Substring(0, [Math]::Min(4, $Matches[1].Length)))..."
  }
  return "mode=$($Parts.ConnectionMode) host=$($Parts.Host):$($Parts.Port) user=$user db=$($Parts.Database)"
}

function Get-PgToolInvocation([string]$ToolName) {
  $cmd = Get-Command $ToolName -ErrorAction SilentlyContinue
  if ($cmd) {
    return @{
      UseDocker = $false
      Executable = $cmd.Source
    }
  }
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw "$ToolName not found in PATH and Docker is unavailable for fallback."
  }
  return @{
    UseDocker = $true
    Executable = $docker.Source
  }
}

function Get-PgDumpClientVersion {
  param(
    [switch]$UseDocker,
    [string]$DockerImage = "postgres:16-alpine"
  )
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($UseDocker) {
      $text = (& docker run --rm $DockerImage pg_dump --version 2>&1 | Out-String).Trim()
    } else {
      $inv = Get-PgToolInvocation "pg_dump"
      if ($inv.UseDocker) {
        $text = (& docker run --rm $DockerImage pg_dump --version 2>&1 | Out-String).Trim()
      } else {
        $text = (& $inv.Executable --version 2>&1 | Out-String).Trim()
      }
    }
  } finally {
    $ErrorActionPreference = $prevEap
  }
  return @{
    Raw = $text
    Major = (Get-PostgresMajorFromVersionString $text)
  }
}

function Invoke-StagePostgresPsqlAt {
  param(
    [hashtable]$ConnParts,
    [string]$Query
  )
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $ConnParts.Password
  try {
    $inv = Get-PgToolInvocation "psql"
    if ($inv.UseDocker) {
      $dockerImage = if ($ConnParts.DockerImage) { $ConnParts.DockerImage } else { "postgres:16-alpine" }
      $pgHost = Resolve-DockerPgHost $ConnParts.Host
      $args = @(
        "run", "--rm", "-i",
        "-e", "PGPASSWORD",
        $dockerImage,
        "psql",
        "-h", $pgHost,
        "-p", $ConnParts.Port.ToString(),
        "-U", $ConnParts.Username,
        "-d", $ConnParts.Database,
        "-v", "ON_ERROR_STOP=1",
        "-At",
        "-c", $Query
      )
      $result = & docker @args 2>&1 | Out-String
    } else {
      $result = & $inv.Executable `
        "-h", $ConnParts.Host `
        "-p", $ConnParts.Port.ToString() `
        "-U", $ConnParts.Username `
        "-d", $ConnParts.Database `
        "-v", "ON_ERROR_STOP=1" `
        "-At" `
        "-c", $Query 2>&1 | Out-String
    }
    if ($LASTEXITCODE -ne 0) {
      throw "psql query failed."
    }
    return $result.Trim()
  } finally {
    $ErrorActionPreference = $prevEap
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Invoke-StagePostgresPsql {
  param(
    [hashtable]$ConnParts,
    [string]$Sql,
    [string[]]$DockerExtraArgs = @()
  )
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $ConnParts.Password
  try {
    $inv = Get-PgToolInvocation "psql"
    if ($inv.UseDocker) {
      $dockerImage = if ($ConnParts.DockerImage) { $ConnParts.DockerImage } else { "postgres:16-alpine" }
      $pgHost = Resolve-DockerPgHost $ConnParts.Host
      $args = @(
        "run", "--rm", "-i",
        "-e", "PGPASSWORD"
      ) + $DockerExtraArgs + @(
        $dockerImage,
        "psql",
        "-h", $pgHost,
        "-p", $ConnParts.Port.ToString(),
        "-U", $ConnParts.Username,
        "-d", $ConnParts.Database,
        "-v", "ON_ERROR_STOP=1",
        "-f", "-"
      )
      $result = $Sql | & docker @args 2>&1
      $exitCode = $LASTEXITCODE
    } else {
      $result = $Sql | & $inv.Executable `
        "-h", $ConnParts.Host `
        "-p", $ConnParts.Port.ToString() `
        "-U", $ConnParts.Username `
        "-d", $ConnParts.Database `
        "-v", "ON_ERROR_STOP=1" `
        "-f", "-" 2>&1
      $exitCode = $LASTEXITCODE
    }
    return @{ Output = ($result | Out-String); ExitCode = $exitCode }
  } finally {
    $ErrorActionPreference = $prevEap
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Invoke-StagePostgresPgDump {
  param(
    [hashtable]$ConnParts,
    [string[]]$DumpArgs,
    [string]$OutputFile,
    [string]$MountDir
  )
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $env:PGPASSWORD = $ConnParts.Password
  try {
    $inv = Get-PgToolInvocation "pg_dump"
    if ($inv.UseDocker) {
      $dockerImage = if ($ConnParts.DockerImage) { $ConnParts.DockerImage } else { "postgres:16-alpine" }
      $pgHost = Resolve-DockerPgHost $ConnParts.Host
      $fileName = Split-Path -Leaf $OutputFile
      $args = @(
        "run", "--rm",
        "-e", "PGPASSWORD",
        "-v", "${MountDir}:/backup:rw",
        $dockerImage,
        "pg_dump",
        "-h", $pgHost,
        "-p", $ConnParts.Port.ToString(),
        "-U", $ConnParts.Username,
        "-d", $ConnParts.Database
      ) + $DumpArgs + @("-f", "/backup/$fileName")
      & docker @args 2>&1 | Out-Null
    } else {
      $args = @(
        "-h", $ConnParts.Host,
        "-p", $ConnParts.Port.ToString(),
        "-U", $ConnParts.Username,
        "-d", $ConnParts.Database
      ) + $DumpArgs + @("-f", $OutputFile)
      & $inv.Executable @args 2>&1 | Out-Null
    }
    if ($LASTEXITCODE -ne 0) {
      throw "pg_dump failed."
    }
  } finally {
    $ErrorActionPreference = $prevEap
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }
}

function Initialize-StagePostgresTooling {
  param(
    [hashtable]$ConnParts,
    [switch]$RequirePgDump
  )
  $serverVersionRaw = Invoke-StagePostgresPsqlAt -ConnParts $ConnParts -Query "SHOW server_version;"
  $serverMajor = Get-PostgresMajorFromVersionString $serverVersionRaw
  $dockerImage = Get-DockerPostgresImageForServerMajor $serverMajor
  $pgDumpInv = Get-PgToolInvocation "pg_dump"

  $nativePgDump = $null
  if (-not $pgDumpInv.UseDocker) {
    $nativePgDump = Get-PgDumpClientVersion -UseDocker:$false
  }
  $dockerPgDump = Get-PgDumpClientVersion -UseDocker -DockerImage $dockerImage

  $psqlInv = Get-PgToolInvocation "psql"
  $selected = @{
    Mode = "docker"
    ServerVersion = $serverVersionRaw
    ServerMajor = $serverMajor
    PgDumpVersion = $dockerPgDump.Raw
    PgDumpMajor = $dockerPgDump.Major
    DockerImage = $dockerImage
    PsqlSource = if ($psqlInv.UseDocker) { "docker" } else { "native" }
  }

  if (-not $pgDumpInv.UseDocker -and $nativePgDump.Major -ge $serverMajor) {
    $selected.Mode = "native"
    $selected.PgDumpVersion = $nativePgDump.Raw
    $selected.PgDumpMajor = $nativePgDump.Major
    $ConnParts.DockerImage = $dockerImage
  } else {
    if ($RequirePgDump -and $dockerPgDump.Major -lt $serverMajor) {
      throw "pg_dump client major $($dockerPgDump.Major) is older than server major $serverMajor (server=$serverVersionRaw, client=$($dockerPgDump.Raw))."
    }
    $ConnParts.DockerImage = $dockerImage
  }

  if ($RequirePgDump -and $selected.PgDumpMajor -lt $serverMajor) {
    throw "pg_dump client major $($selected.PgDumpMajor) is older than server major $serverMajor."
  }

  return $selected
}
