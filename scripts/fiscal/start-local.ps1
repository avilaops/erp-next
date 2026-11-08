param(
  [string]$EnvironmentFile = (Join-Path $env:LOCALAPPDATA 'AvilaOps/erp-next-local/api-effective.env'),
  [string]$DatabaseSshHost = 'applications',
  [int]$DatabasePort = 55441,
  [int]$ApiPort = 8081,
  [int]$EnginePort = 8082,
  [int]$McpPort = 8093,
  [switch]$UpdateWebEnvironment
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$runtime = Join-Path $env:LOCALAPPDATA 'AvilaOps/erp-next-local'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$statePath = Join-Path $runtime 'processes.json'
$previous = if (Test-Path -LiteralPath $statePath) { Get-Content -Raw -LiteralPath $statePath | ConvertFrom-Json } else { $null }
$allowed = @('DATABASE_URL','AUTH_ISSUER','AUTH_USERINFO_URL','FISCAL_A1_KEYRING','NFE_PRODUCTION_ENABLED','NFE_PRODUCTION_TENANT_ID')
foreach ($line in [IO.File]::ReadAllLines($EnvironmentFile)) {
  if ($line.StartsWith('#') -or !$line.Contains('=')) { continue }
  $pair = $line.Split('=', 2)
  if ($allowed -contains $pair[0]) { [Environment]::SetEnvironmentVariable($pair[0], $pair[1], 'Process') }
}
if (!$env:DATABASE_URL) { throw 'Informe DATABASE_URL no arquivo privado de configuração' }
$database = [uri]::new($env:DATABASE_URL)
if ($database.Scheme -notin @('postgres','postgresql') -or !$database.UserInfo) { throw 'Configuração PostgreSQL inválida' }
$env:DATABASE_URL = $database.Scheme + '://' + $database.UserInfo + '@127.0.0.1:' + $DatabasePort + $database.PathAndQuery
$env:DATABASE_MAX_CONNECTIONS = '6'
$env:API_BIND_ADDRESS = '127.0.0.1:' + $ApiPort
$env:ERP_BACKGROUND_WORKERS_ENABLED = 'false'
$env:ERP_CNPJ_WS_ENABLED = 'true'
$env:RUST_LOG = 'warn'
$env:ERP_FISCAL_ENGINE_URL = 'http://127.0.0.1:' + $EnginePort
$tokenPath = Join-Path $runtime 'engine-token'
if (!(Test-Path -LiteralPath $tokenPath)) { [IO.File]::WriteAllText($tokenPath, [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))) }
$env:ERP_FISCAL_ENGINE_TOKEN = [IO.File]::ReadAllText($tokenPath).Trim()
$env:FISCAL_ENGINE_PORT = [string]$EnginePort
$env:FISCAL_ENGINE_BIND = '127.0.0.1'
$env:DANFE_MCP_URL = 'http://127.0.0.1:' + $McpPort + '/mcp'
$env:DANFE_MCP_TOKEN = $env:ERP_FISCAL_ENGINE_TOKEN
$env:DANFE_MCP_TOOL_PREFIX = 'bare'
$env:DANFE_CA_BUNDLE_FILE = Join-Path $workspace 'deploy/fiscal/icp-brasil-roots.pem'
foreach ($port in @($ApiPort, $EnginePort)) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { throw "Porta local $port ocupada; encerre somente o processo de desenvolvimento correspondente antes de iniciar" }
}
$null = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $McpPort + '/health') -TimeoutSec 5
$tunnel = Get-NetTCPConnection -State Listen -LocalPort $DatabasePort -ErrorAction SilentlyContinue
$supervisorPid = if ($previous) { $previous.databaseSupervisor } else { $null }
if ($tunnel) {
  $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $tunnel.OwningProcess)
  if (!$previous -or $previous.databaseTunnel -ne $owner.ProcessId -or !$owner.CommandLine.Contains([string]$DatabasePort) -or $owner.ExecutablePath -notlike '*OpenSSH\ssh.exe') { throw 'A porta do túnel pertence a outro processo' }
  $tunnelPid = $owner.ProcessId
} else {
  $supervisor = if ($supervisorPid) { Get-CimInstance Win32_Process -Filter ('ProcessId='+$supervisorPid) } else { $null }
  if (!$supervisor -or $supervisor.CommandLine -notlike '*keep-database-tunnel.ps1*') {
    $helper = Join-Path $PSScriptRoot 'keep-database-tunnel.ps1'
    $supervisor = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList @('-NoProfile','-File',('"'+$helper+'"'),'-DatabaseSshHost',$DatabaseSshHost,'-DatabasePort',[string]$DatabasePort) -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'db-supervisor.log') -RedirectStandardError (Join-Path $runtime 'db-supervisor.err.log') -PassThru
    $supervisorPid = $supervisor.Id
  }
  for ($attempt=0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    $tunnel = Get-NetTCPConnection -State Listen -LocalPort $DatabasePort -ErrorAction SilentlyContinue
    if ($tunnel) { break }
  }
  if (!$tunnel) { throw 'Conexão com o banco indisponível; o supervisor continuará tentando reconectar' }
  $tunnelPid = $tunnel.OwningProcess
}
$engine = Start-Process -FilePath 'node.exe' -ArgumentList @('--import','./scripts/register.mjs','src/server.ts') -WorkingDirectory (Join-Path $workspace 'apps/fiscal-engine') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'engine.log') -RedirectStandardError (Join-Path $runtime 'engine.err.log') -PassThru
Start-Sleep -Seconds 2
$api = Start-Process -FilePath (Join-Path $workspace 'target/debug/erp-next-api.exe') -WorkingDirectory $workspace -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtime 'api.log') -RedirectStandardError (Join-Path $runtime 'api.err.log') -PassThru
$state = @{ databaseTunnel=$tunnelPid; databaseSupervisor=$supervisorPid; databasePort=$DatabasePort; backgroundWorkers=$false; apiPort=$ApiPort; enginePort=$EnginePort; engine=$engine.Id; api=$api.Id; mcpPort=$McpPort }
[IO.File]::WriteAllText($statePath, ($state | ConvertTo-Json))
if ($UpdateWebEnvironment) {
  $webEnv = Join-Path $workspace 'apps/web/.env.local'
  $text = if (Test-Path -LiteralPath $webEnv) { [IO.File]::ReadAllText($webEnv) } else { '' }
  if (Test-Path -LiteralPath $webEnv) { [IO.File]::Copy($webEnv, (Join-Path $runtime ('web-env-before-' + (Get-Date -Format 'yyyyMMddHHmmss')))) }
  $entry = 'ERP_FISCAL_API_URL=http://127.0.0.1:' + $ApiPort
  $baseEntry = 'ERP_API_URL=http://127.0.0.1:' + $ApiPort
  $text = if ($text -match '(?m)^ERP_API_URL=') { [regex]::Replace($text, '(?m)^ERP_API_URL=[^\r\n]*', $baseEntry) } else { $text.TrimEnd() + "`n" + $baseEntry + "`n" }
  $text = if ($text -match '(?m)^ERP_FISCAL_API_URL=') { [regex]::Replace($text, '(?m)^ERP_FISCAL_API_URL=[^\r\n]*', $entry) } else { $text.TrimEnd() + "`n" + $entry + "`n" }
  [IO.File]::WriteAllText($webEnv, $text)
}
$state | ConvertTo-Json
