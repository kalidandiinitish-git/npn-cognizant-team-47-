# Index labelled fraud positions inside data/stream_test.csv.
$root = Split-Path -Parent $PSScriptRoot
$engine = Join-Path $root "ml-engine"
$python = Join-Path $engine ".venv\Scripts\python.exe"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "stream-index.out.log"
$err = Join-Path $logDir "stream-index.err.log"

$process = Start-Process -FilePath $python `
  -ArgumentList "-m", "src.streaming.index" `
  -WorkingDirectory $engine `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
