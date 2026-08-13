# Full training run on the complete creditcard.csv dataset.
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "ml-engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "train-full.out.log"
$err = Join-Path $logDir "train-full.err.log"

$env:PYTHONIOENCODING = "utf-8"
$process = Start-Process -FilePath $python `
  -ArgumentList "-m", "src.training.train", "--latency-samples", "500" `
  -WorkingDirectory $engine `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
