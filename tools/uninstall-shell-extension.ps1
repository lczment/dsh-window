# Undo the dsh-window shell extension. Quit DeepSeek Harness first (tray menu -> Quit).
param(
  [string]$AppRoot = $(if ($env:DSH_DESKTOP_ROOT) { $env:DSH_DESKTOP_ROOT } else { 'D:\DeepSeek Harness' })
)

$ErrorActionPreference = 'Stop'

$root = $AppRoot
$resources = Join-Path $root 'resources'
$asar = Join-Path $resources 'app.asar'
$backup = Join-Path $resources 'app.asar.orig'
$appDir = Join-Path $resources 'app'
$ext = Join-Path $resources 'dsh-window-extension'

if (-not (Test-Path -LiteralPath $asar) -and -not (Test-Path -LiteralPath $backup)) {
  Write-Output 'nothing to restore: neither app.asar nor app.asar.orig exists'
  exit 1
}

if (Test-Path -LiteralPath $backup) {
  if (Test-Path -LiteralPath $asar) { Remove-Item -LiteralPath $asar -Force }
  Move-Item -LiteralPath $backup -Destination $asar
  Write-Output 'restored resources\app.asar from app.asar.orig'
} else {
  Write-Output 'app.asar already present; leaving it untouched'
}

if (Test-Path -LiteralPath $appDir) {
  Remove-Item -LiteralPath $appDir -Recurse -Force
  Write-Output 'removed resources\app'
}

if (Test-Path -LiteralPath $ext) {
  Remove-Item -LiteralPath $ext -Recurse -Force
  Write-Output 'removed resources\dsh-window-extension'
}

Remove-Item -LiteralPath (Join-Path $resources '.dsh-window-staging') -Recurse -Force -ErrorAction SilentlyContinue
Write-Output 'shell extension uninstalled. Restart DeepSeek Harness.'
