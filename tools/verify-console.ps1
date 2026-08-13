# Rebuild with the local env, then render every console page in a headless browser.
# Assumes the FastAPI engine is already listening on port 8000.
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$nodeDir = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
$node = Join-Path $nodeDir "bin\node.exe"
$vite = Join-Path $frontend "node_modules\vite\bin\vite.js"
$script = Join-Path $PSScriptRoot "screenshot-console.cjs"
$screens = Join-Path $logDir "screens"

# 1. Build with .env.local applied
$build = Start-Process -FilePath $node `
  -ArgumentList ('"' + $vite + '"'), "build" `
  -WorkingDirectory $frontend `
  -RedirectStandardOutput (Join-Path $logDir "verify-build.out.log") `
  -RedirectStandardError (Join-Path $logDir "verify-build.err.log") `
  -NoNewWindow -Wait -PassThru
if ($build.ExitCode -ne 0) { Write-Output "build-failed"; exit 1 }

# 2. Serve the build
$preview = Start-Process -FilePath $node `
  -ArgumentList ('"' + $vite + '"'), "preview", "--port", "4173" `
  -WorkingDirectory $frontend `
  -RedirectStandardOutput (Join-Path $logDir "verify-preview.out.log") `
  -RedirectStandardError (Join-Path $logDir "verify-preview.err.log") `
  -NoNewWindow -PassThru
Start-Sleep -Seconds 4

try {
  $shots = Start-Process -FilePath $node `
    -ArgumentList ('"' + $script + '"'), "http://localhost:4173", "http://localhost:8000", ('"' + $screens + '"') `
    -WorkingDirectory $root `
    -RedirectStandardOutput (Join-Path $logDir "screenshot-console.out.log") `
    -RedirectStandardError (Join-Path $logDir "screenshot-console.err.log") `
    -NoNewWindow -Wait -PassThru
  Write-Output ("shots-exit=" + $shots.ExitCode)
}
finally {
  if (-not $preview.HasExited) { Stop-Process -Id $preview.Id -Force }
}
