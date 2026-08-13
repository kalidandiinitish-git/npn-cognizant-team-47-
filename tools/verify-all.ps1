# Full verification: unit/integration tests, then the end-to-end HTTP smoke test.
# The smoke test spawns its own engine on port 8099, so a dev server on 8000 is
# unaffected.
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "ml-engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$env:PYTHONIOENCODING = "utf-8"

$tests = Start-Process -FilePath $python `
  -ArgumentList "-m", "pytest", "-q" `
  -WorkingDirectory $engine `
  -RedirectStandardOutput (Join-Path $logDir "verify-all-pytest.log") `
  -RedirectStandardError (Join-Path $logDir "verify-all-pytest.err.log") `
  -NoNewWindow -Wait -PassThru

$smoke = Start-Process -FilePath $python `
  -ArgumentList "scripts\smoke_e2e.py", "--limit", "400", "--port", "8099" `
  -WorkingDirectory $engine `
  -RedirectStandardOutput (Join-Path $logDir "verify-all-smoke.log") `
  -RedirectStandardError (Join-Path $logDir "verify-all-smoke.err.log") `
  -NoNewWindow -Wait -PassThru

Write-Output ("pytest=" + $tests.ExitCode + " smoke=" + $smoke.ExitCode)
