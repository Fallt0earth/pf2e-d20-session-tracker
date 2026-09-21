# Back up the dev Foundry data (worlds + Config) from the NAS to .\backups\ on this PC.
#   .\dev\backup.ps1           # tar+gzip on the NAS, pull the archive, prune old archives on the NAS
#   .\dev\backup.ps1 -NoPull   # archive on the NAS only
# Run before any world re-import and before storage tests (docs/nas-quickstart.MD rule 7). PS 5.1-safe.
[CmdletBinding()]
param(
  [switch]$NoPull,
  [int]$Keep = 5,
  [string]$NasHost
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
# Host details are NOT in the repository: dev/local.ps1 (git-ignored; copy dev/local.example.ps1) or -NasHost.
$LocalConfig = Join-Path $PSScriptRoot 'local.ps1'
if (Test-Path $LocalConfig) { . $LocalConfig }
if (-not $NasHost) { $NasHost = $D20NasHost }
if (-not $NasHost) { throw 'Set $D20NasHost in dev/local.ps1 (see dev/local.example.ps1), or pass -NasHost.' }
$Base = if ($D20NasBase) { $D20NasBase } else { '/mnt/user/appdata/foundry-dev' }
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Name = "foundry-dev-data-$Stamp.tgz"

function Invoke-Ssh([string]$RemoteCmd) {
  & ssh -o BatchMode=yes -o ConnectTimeout=10 $NasHost $RemoteCmd
  if ($LASTEXITCODE -ne 0) { throw "ssh exited $LASTEXITCODE for: $RemoteCmd" }
}

Write-Host "== archive on NAS: $Name =="
Invoke-Ssh "set -e; cd $Base/data; tar --ignore-failed-read -czf $Base/backups/$Name Data/worlds Config; ls -l $Base/backups/$Name"

if (-not $NoPull) {
  $Dest = Join-Path $RepoRoot 'backups'
  if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest | Out-Null }
  Write-Host '== pulling =='
  & scp -o BatchMode=yes -q "${NasHost}:$Base/backups/$Name" (Join-Path $Dest $Name)
  if ($LASTEXITCODE -ne 0) { throw "scp failed ($LASTEXITCODE)" }
}

Write-Host "== prune on NAS (keep $Keep) =="
Invoke-Ssh "cd $Base/backups && (ls -1t foundry-dev-data-*.tgz 2>/dev/null | tail -n +$($Keep + 1) | xargs -r rm -f); ls -l $Base/backups"

Write-Host '== backup complete =='
