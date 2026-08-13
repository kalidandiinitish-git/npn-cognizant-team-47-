# Drive the real user interactions against the running servers.
param(
  [string]$AppUrl = "http://127.0.0.1:5173",
  [string]$ApiUrl = "http://127.0.0.1:8000"
)
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$node = "node"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $node = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
}
$script = Join-Path $PSScriptRoot "ui-flows.cjs"

$process = Start-Process -FilePath $node `
  -ArgumentList ('"' + $script + '"'), $AppUrl, $ApiUrl `
  -WorkingDirectory $root `
  -RedirectStandardOutput (Join-Path $logDir "ui-flows.out.log") `
  -RedirectStandardError (Join-Path $logDir "ui-flows.err.log") `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
