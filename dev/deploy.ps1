# Deploy the pf2e-d20-session-tracker dev stack to the NAS.
#   .\dev\deploy.ps1            # sync the module + compose file only (then reload the browser)
#   .\dev\deploy.ps1 -Init      # first run: sync, docker compose up -d, health poll
#   .\dev\deploy.ps1 -Compose   # sync, then docker compose up -d (apply compose changes)
#   .\dev\deploy.ps1 -Restart   # sync, then restart the container
#
# Pattern from dev/reference/honey-deploy.ps1 and docs/nas-quickstart.MD: BatchMode ssh,
# tar -> scp -> staging -> rsync --delete, secrets never leave the NAS. PS 5.1-safe.
# Binary data never crosses the PowerShell pipeline (tar -> file -> scp).
[CmdletBinding()]
param(
  [switch]$Init,
  [switch]$Compose,
  [switch]$Restart,
  [switch]$SkipHealth,
  [string]$NasHost,
  [string]$HealthUrl
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
# Host details are NOT in the repository. They come from dev/local.ps1 (git-ignored; copy
# dev/local.example.ps1) or from the -NasHost / -HealthUrl parameters.
$LocalConfig = Join-Path $PSScriptRoot 'local.ps1'
if (Test-Path $LocalConfig) { . $LocalConfig }
if (-not $NasHost) { $NasHost = $D20NasHost }
if (-not $HealthUrl -and $D20FoundryUrl) { $HealthUrl = "$D20FoundryUrl/api/status" }
if (-not $NasHost -or -not $HealthUrl) { throw 'Set $D20NasHost and $D20FoundryUrl in dev/local.ps1 (see dev/local.example.ps1), or pass -NasHost and -HealthUrl.' }
$Base = if ($D20NasBase) { $D20NasBase } else { '/mnt/user/appdata/foundry-dev' }
$AppDir = "$Base/app"
$ComposeFile = "$AppDir/docker-compose.yml"
# What ships to the NAS as the module tree (mounted read-only into the container).
$ShippedPaths = @('module.json', 'scripts', 'styles', 'templates', 'languages', 'macros', 'README.md', 'LICENSE', 'CHANGELOG.md')

function Invoke-Ssh([string]$RemoteCmd) {
  & ssh -o BatchMode=yes -o ConnectTimeout=10 $NasHost $RemoteCmd
  if ($LASTEXITCODE -ne 0) { throw "ssh exited $LASTEXITCODE for: $RemoteCmd" }
}

Write-Host '== preflight: ssh =='
Invoke-Ssh 'echo ok'

Write-Host '== staging =='
$Stage = Join-Path $env:TEMP 'pf2e-d20-stage'
if (Test-Path $Stage) { Remove-Item $Stage -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $Stage 'module') | Out-Null
Copy-Item (Join-Path $RepoRoot 'dev\docker-compose.yml') (Join-Path $Stage 'docker-compose.yml')
foreach ($p in $ShippedPaths) {
  $src = Join-Path $RepoRoot $p
  if (Test-Path $src) { Copy-Item $src (Join-Path $Stage 'module') -Recurse -Force }
}

Write-Host '== packing =='
$Tgz = Join-Path $env:TEMP 'pf2e-d20-deploy.tgz'
if (Test-Path $Tgz) { Remove-Item $Tgz -Force }
Push-Location $Stage
try {
  & tar.exe -czf $Tgz .
  if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
} finally { Pop-Location }
Remove-Item $Stage -Recurse -Force

Write-Host '== shipping =='
& scp -o BatchMode=yes -q $Tgz "${NasHost}:/tmp/pf2e-d20-deploy.tgz"
if ($LASTEXITCODE -ne 0) { throw "scp failed ($LASTEXITCODE)" }
Remove-Item $Tgz -Force

Write-Host '== installing on NAS (staging -> rsync --delete) =='
Invoke-Ssh "set -e; rm -rf $Base/.staging; mkdir -p $Base/.staging $AppDir; tar -xzf /tmp/pf2e-d20-deploy.tgz -C $Base/.staging; rsync -a --delete $Base/.staging/ $AppDir/; rm -rf $Base/.staging /tmp/pf2e-d20-deploy.tgz"

$containerAction = $false
if ($Init -or $Compose) {
  Write-Host '== compose up =='
  Invoke-Ssh "docker compose -f $ComposeFile up -d"
  $containerAction = $true
} elseif ($Restart) {
  Write-Host '== restart container =='
  Invoke-Ssh "docker compose -f $ComposeFile restart"
  $containerAction = $true
} else {
  Write-Host '== files synced; no container action (reload the browser) =='
}

if ($containerAction -and -not $SkipHealth) {
  Write-Host "== health poll: $HealthUrl =="
  $healthy = $false
  $resp = $null
  # First start unpacks a 250 MB release; allow up to ~4 minutes.
  for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Seconds 2
    try {
      $resp = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 3
      if ($resp.version) { $healthy = $true; break }
    } catch { }
  }
  if ($healthy) {
    Write-Host ("HEALTHY: " + ($resp | ConvertTo-Json -Compress))
  } else {
    Write-Host '== UNHEALTHY: last 50 log lines =='
    & ssh -o BatchMode=yes $NasHost "docker compose -f $ComposeFile logs --tail=50"
    throw 'deploy failed health check'
  }
}

Write-Host '== deploy complete =='
