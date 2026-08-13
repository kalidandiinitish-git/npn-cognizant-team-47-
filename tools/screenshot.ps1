# Render the built frontend in a headless browser and capture screenshots.
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$out = Join-Path $logDir "screenshot.out.log"
$err = Join-Path $logDir "screenshot.err.log"

$node = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$script = Join-Path $PSScriptRoot "screenshot.cjs"
$screens = Join-Path $logDir "screens"

$process = Start-Process -FilePath $node `
  -ArgumentList ('"' + $script + '"'), "http://localhost:4173", ('"' + $screens + '"') `
  -WorkingDirectory $root `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -NoNewWindow -Wait -PassThru

Write-Output ("exit=" + $process.ExitCode)
