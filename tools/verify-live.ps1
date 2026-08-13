# Screenshot every console page against already-running servers.
#   frontend dev server on 5173, FastAPI engine on 8000.
param(
  [string]$AppUrl = "http://localhost:5173",
  [string]$ApiUrl = "http://localhost:8000"
)

$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$node = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$script = Join-Path $PSScriptRoot "screenshot-console.cjs"
$screens = Join-Path $logDir "screens"

$process = Start-Process -FilePath $node `
  -ArgumentList ('"' + $script + '"'), $AppUrl, $ApiUrl, ('"' + $screens + '"') `
  -WorkingDirectory $root `
  -RedirectStandardOutput (Join-Path $logDir "verify-live.out.log") `
  -RedirectStandardError (Join-Path $logDir "verify-live.err.log") `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
