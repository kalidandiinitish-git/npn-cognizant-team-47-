# Run the ML engine test suite.
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "ml-engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "pytest.out.log"
$err = Join-Path $logDir "pytest.err.log"

$env:PYTHONIOENCODING = "utf-8"
$process = Start-Process -FilePath $python `
  -ArgumentList "-m", "pytest", "-v" `
  -WorkingDirectory $engine `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
