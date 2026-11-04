# Completes the dsh-window shell-extension install once DeepSeek Harness has exited.
# Registered as a repeating scheduled task (tools/register-completion-task.ps1); each run is quick.
param(
  [switch]$Force,
  [string]$AppRoot = $(if ($env:DSH_DESKTOP_ROOT) { $env:DSH_DESKTOP_ROOT } else { 'D:\DeepSeek Harness' })
)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = $AppRoot
$resources = Join-Path $root 'resources'
$asar = Join-Path $resources 'app.asar'
$backup = Join-Path $resources 'app.asar.orig'
$appDir = Join-Path $resources 'app'
$mainFile = Join-Path $appDir 'lib\main.js'
$pending = Join-Path $appDir '.dsh-window-pending'
$extensionLog = Join-Path $resources 'dsh-window-extension\extension.log'
$log = Join-Path $here 'install-shell-extension.log'
$marker = Join-Path $here '.complete-shell-extension.started'
$taskName = 'DSH Window Extension Completion'

function Write-Log([string]$message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
  Add-Content -LiteralPath $log -Value $line
}

function Remove-Task {
  & schtasks.exe /Delete /TN $taskName /F 2>&1 | Out-Null
}

function Start-App {
  Start-Process -FilePath (Join-Path $root 'DeepSeek Harness.exe') -WorkingDirectory $root -PassThru
}

if (-not (Test-Path -LiteralPath $marker)) {
  Set-Content -LiteralPath $marker -Value (Get-Date -Format 'o') -Encoding ascii
}

if (-not (Test-Path -LiteralPath $asar)) {
  Write-Log 'app.asar already renamed; nothing left to do'
  Remove-Task
  exit 0
}

if (-not (Test-Path -LiteralPath $mainFile)) {
  Write-Log 'staged app directory is missing; aborting'
  Remove-Task
  exit 1
}

$started = [datetime]::Parse((Get-Content -LiteralPath $marker -Raw).Trim())
if (-not $Force -and (Get-Date) -gt $started.AddMinutes(1440)) {
  Write-Log 'timed out waiting for the app to exit; nothing was changed'
  Remove-Task
  exit 2
}

try {
  if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
  Rename-Item -LiteralPath $asar -NewName 'app.asar.orig'
} catch {
  # The app is still running and keeps app.asar open; the task will retry next minute.
  exit 0
}

Write-Log 'renamed app.asar -> app.asar.orig'

$main = Get-Content -LiteralPath $mainFile -Raw
if ($main -notmatch '__dshWindowClose') {
  Write-Log 'patched main.js is missing the close hook; restoring the original archive'
  Rename-Item -LiteralPath $backup -NewName 'app.asar' -ErrorAction SilentlyContinue
  Remove-Task
  exit 3
}

$beforeLength = 0
if (Test-Path -LiteralPath $extensionLog) {
  $beforeLength = (Get-Item -LiteralPath $extensionLog).Length
}

Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue
Write-Log 'launching DeepSeek Harness with the shell extension'
$process = Start-App

$healthy = $false
$deadline = (Get-Date).AddSeconds(75)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 1500
  if ($process.HasExited) { break }
  if (-not (Test-Path -LiteralPath $extensionLog)) { continue }
  $text = Get-Content -LiteralPath $extensionLog -Raw
  if ($null -eq $text) { continue }
  $appended = if ($text.Length -gt $beforeLength) { $text.Substring([Math]::Min($beforeLength, $text.Length)) } else { $text }
  if ($appended -match 'shell extension installed') { $healthy = $true; break }
}

if (-not $healthy) {
  Write-Log 'shell extension did not report a successful startup; rolling back'
  if (-not $process.HasExited) {
    try { Stop-Process -Id $process.Id -Force -ErrorAction Stop } catch { }
  }
  Start-Sleep -Seconds 3
  Remove-Item -LiteralPath $pending -Force -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $backup) {
    Move-Item -LiteralPath $backup -Destination $asar -Force
  }
  Write-Log 'relaunching the unmodified app'
  Start-App | Out-Null
  Remove-Task
  exit 4
}

Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
Write-Log 'extension reported startup; done'
Remove-Task
exit 0
