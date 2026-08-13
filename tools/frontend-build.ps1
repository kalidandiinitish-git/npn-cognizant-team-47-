# Production build of the React frontend.
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$nodeDir = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
$node = Join-Path $nodeDir "bin\node.exe"
$vite = Join-Path $frontend "node_modules\vite\bin\vite.js"

if (-not (Test-Path $vite)) { Write-Output "vite-missing-run-install-first"; exit 1 }

$out = Join-Path $logDir "frontend-build.out.log"
$err = Join-Path $logDir "frontend-build.err.log"

# The repository path contains spaces, so the script path must be quoted.
$quotedVite = '"' + $vite + '"'

$process = Start-Process -FilePath $node `
  -ArgumentList $quotedVite, "build" `
  -WorkingDirectory $frontend `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
