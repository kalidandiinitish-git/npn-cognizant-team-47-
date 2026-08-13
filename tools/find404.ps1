param([string]$Url = "http://127.0.0.1:5173/login")
$root = Split-Path -Parent $PSScriptRoot
$node = "C:\Users\Nitish\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$script = Join-Path $PSScriptRoot "find404.cjs"
$log = Join-Path $root "logs\find404.log"
$process = Start-Process -FilePath $node `
  -ArgumentList ('"' + $script + '"'), $Url `
  -WorkingDirectory $root -RedirectStandardOutput $log -RedirectStandardError (Join-Path $root "logs\find404.err.log") `
  -NoNewWindow -Wait -PassThru
Write-Output ("exit=" + $process.ExitCode)
