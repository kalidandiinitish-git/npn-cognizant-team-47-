# Start the FastAPI detection engine.
#   powershell -ExecutionPolicy Bypass -File tools\run-backend.ps1
# Leave this window open; Ctrl+C stops the server.
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "ml-engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"

if (-not (Test-Path $python)) {
  Write-Output "Virtual environment missing. Create it first:"
  Write-Output "  cd ml-engine"
  Write-Output "  python -m venv .venv"
  Write-Output "  .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
  exit 1
}

$env:PYTHONIOENCODING = "utf-8"
Write-Output "FraudStream AI engine -> http://127.0.0.1:8000  (docs at /docs)"
Push-Location $engine
& $python -m uvicorn src.api.main:app --host 127.0.0.1 --port 8000
Pop-Location
