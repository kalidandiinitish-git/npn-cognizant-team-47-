# End-to-end smoke test: spawns uvicorn, streams transactions, checks every endpoint.
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "ml-engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "smoke-e2e.out.log"
$err = Join-Path $logDir "smoke-e2e.err.log"

$env:PYTHONIOENCODING = "utf-8"
$process = Start-Process -FilePath $python `
  -ArgumentList "scripts\smoke_e2e.py", "--limit", "400" `
  -WorkingDirectory $engine `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
