# Registers the one-minute completion task for the dsh-window shell extension.
# After DeepSeek Harness exits, the task swaps app.asar -> app.asar.orig, proves the
# patch, relaunches the app and deletes itself.
# The task runs through a VBS launcher so it never shows a console window.
#
# Set DSH_DESKTOP_ROOT when DeepSeek Harness is not installed at the default path.
param(
  [string]$AppRoot = $(if ($env:DSH_DESKTOP_ROOT) { $env:DSH_DESKTOP_ROOT } else { 'D:\DeepSeek Harness' })
)

$ErrorActionPreference = 'Stop'
$taskName = 'DSH Window Extension Completion'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$vbs = Join-Path $here 'complete-shell-extension.vbs'
$cmd = Join-Path $here 'complete-shell-extension.cmd'

if (-not (Test-Path -LiteralPath $vbs)) { throw "missing $vbs" }
if (-not (Test-Path -LiteralPath $cmd)) { throw "missing $cmd" }
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'DeepSeek Harness.exe'))) { throw "DeepSeek Harness.exe not found under $AppRoot" }

$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$action = '"{0}" "{1}"' -f $wscript, $vbs

$previous = $ErrorActionPreference
$ErrorActionPreference = 'SilentlyContinue'
& schtasks.exe /Delete /TN $taskName /F 2>&1 | Out-Null
$ErrorActionPreference = $previous
& schtasks.exe /Create /TN $taskName /TR $action /SC MINUTE /MO 1 /F /RL LIMITED
if ($LASTEXITCODE -ne 0) { throw "schtasks create failed with $LASTEXITCODE" }

& schtasks.exe /Query /TN $taskName /V /FO LIST
