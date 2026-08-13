# Start the React dev server.
#   powershell -ExecutionPolicy Bypass -File tools\run-frontend.ps1
# Leave this window open; Ctrl+C stops the server.
#
# This machine has no Node on PATH, so the script falls back to the Node runtime
# bundled with the local tooling. Installing Node 18+ normally is the better
# long-term option, since that cache directory is not permanent.
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"
$vite = Join-Path $frontend "node_modules\vite\bin\vite.js"

if (-not (Test-Path $vite)) {
  Write-Output "Dependencies missing. Run: cd frontend; npm install"
  exit 1
}

$node = "node"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $fallback = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (Test-Path $fallback) {
    $node = $fallback
    Write-Output "Node is not on PATH; using the bundled runtime."
  }
  else {
    Write-Output "Node 18+ is required and no runtime was found. Install it from https://nodejs.org."
    exit 1
  }
}

Write-Output "FraudStream AI dashboard -> http://127.0.0.1:5173"
Push-Location $frontend
& $node $vite --port 5173 --host 127.0.0.1
Pop-Location
