param([string]$DatabaseSshHost = 'applications', [int]$DatabasePort = 55441)
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $env:LOCALAPPDATA 'AvilaOps/erp-next-local'
$statePath = Join-Path $runtime 'processes.json'
while ($true) {
  if (Get-NetTCPConnection -State Listen -LocalPort $DatabasePort -ErrorAction SilentlyContinue) { exit 1 }
  $tunnel = Start-Process -FilePath 'ssh.exe' -ArgumentList @('-N','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2','-L',('127.0.0.1:'+$DatabasePort+':127.0.0.1:5432'),$DatabaseSshHost) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'db-tunnel.log') -RedirectStandardError (Join-Path $runtime 'db-tunnel.err.log') -PassThru
  $state = if (Test-Path -LiteralPath $statePath) { Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } else { [pscustomobject]@{} }
  $state | Add-Member -NotePropertyName databaseTunnel -NotePropertyValue $tunnel.Id -Force
  $state | Add-Member -NotePropertyName databaseSupervisor -NotePropertyValue $PID -Force
  [IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json))
  $tunnel.WaitForExit()
  Add-Content -LiteralPath (Join-Path $runtime 'db-tunnel-reconnect.log') -Value ((Get-Date -Format o) + ' SSH disconnected; reconnecting')
  Start-Sleep -Seconds 3
}
