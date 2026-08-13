# Install frontend dependencies using the available Node runtime + pnpm.
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root "frontend"
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$nodeDir = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node"
$node = Join-Path $nodeDir "bin\node.exe"
$pnpm = Join-Path $nodeDir "node_modules\pnpm\bin\pnpm.cjs"

if (-not (Test-Path $node)) { Write-Output "node-missing"; exit 1 }
if (-not (Test-Path $pnpm)) { Write-Output "pnpm-missing"; exit 1 }

$out = Join-Path $logDir "frontend-install.out.log"
$err = Join-Path $logDir "frontend-install.err.log"

$process = Start-Process -FilePath $node `
  -ArgumentList $pnpm, "install", "--no-frozen-lockfile" `
  -WorkingDirectory $frontend `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
