# Quick training smoke test: small row cap, small forests.
$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "ml-engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "train-smoke.log"

Push-Location $engine
& $python -m src.training.train --max-rows 30000 --fast --latency-samples 150 --no-stream-file *> $log
$code = $LASTEXITCODE
Pop-Location

Add-Content -Path $log -Value "EXIT_CODE=$code"
Write-Output "exit=$code log=$log"
