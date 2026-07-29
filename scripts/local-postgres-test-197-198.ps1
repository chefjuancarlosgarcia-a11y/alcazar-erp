# Local PostgreSQL smoke for migrations 197 + 198 (optional)
# Requires Docker. Does NOT apply baseline schema — only runs if container + DB already has prior migrations.

param(
  [string]$ContainerName = "alcazar-pg-test",
  [string]$DbName = "postgres",
  [string]$DbUser = "postgres",
  [string]$DbPassword = "postgres"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$schema = Join-Path $root "supabase\schema"

function Invoke-PsqlFile($file) {
  $path = Join-Path $schema $file
  if (-not (Test-Path $path)) { throw "Missing $path" }
  Write-Host "Applying $file ..."
  Get-Content $path -Raw | docker exec -i -e PGPASSWORD=$DbPassword $ContainerName `
    psql -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -f -
  if ($LASTEXITCODE -ne 0) { throw "psql failed for $file" }
}

$running = docker ps -q -f "name=$ContainerName"
if (-not $running) {
  Write-Host "Starting Postgres container $ContainerName ..."
  docker run --name $ContainerName -e POSTGRES_PASSWORD=$DbPassword -p 54329:5432 -d postgres:16 | Out-Null
  Start-Sleep -Seconds 4
}

Write-Host "Preflight 198 (expect partial failures if empty DB)..."
Get-Content (Join-Path $schema "diagnose_operational_station_pos_preflight_198.sql") -Raw |
  docker exec -i -e PGPASSWORD=$DbPassword $ContainerName psql -U $DbUser -d $DbName -f - | Out-Host

Invoke-PsqlFile "197_fix_operational_pin_module_station_type.sql"
Invoke-PsqlFile "198_operational_station_pos_shared_foundation.sql"

Write-Host "Postflight 198..."
Get-Content (Join-Path $schema "diagnose_operational_station_pos_postflight_198.sql") -Raw |
  docker exec -i -e PGPASSWORD=$DbPassword $ContainerName psql -U $DbUser -d $DbName -f - | Out-Host

Write-Host "Test harness 198 (ROLLBACK)..."
Get-Content (Join-Path $schema "198_test_operational_station_pos_shared.sql") -Raw |
  docker exec -i -e PGPASSWORD=$DbPassword $ContainerName psql -U $DbUser -d $DbName -f - | Out-Host

Write-Host "Done. Full pass requires baseline schema through 196 applied first."
