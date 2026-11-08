param([string]$Destination = 'artifacts/fiscal-reference-downloads')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$folder = (Resolve-Path $Destination).Path
$cookies = Join-Path $folder 'portal-cookies.txt'
$page = Join-Path $folder 'portal-esquemas.html'
$source = 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=BMPFMBoln3w%3D'
& curl.exe -sS -L --fail --max-time 45 --max-redirs 6 -c $cookies -b $cookies $source -o $page
if ($LASTEXITCODE -ne 0) { throw 'Não foi possível baixar a página oficial' }
$html = [IO.File]::ReadAllText($page)
$start = $html.IndexOf('VERSÕES OFICIAIS (em uso)')
$end = $html.IndexOf('VERSÕES ANTERIORES (em desuso)', $start)
if ($start -lt 0 -or $end -le $start) { throw 'Estrutura do catálogo mudou; revise antes de baixar' }
$active = $html.Substring($start, $end - $start)
$matches = [regex]::Matches($active, '<a[^>]+href="(?<href>exibirArquivo\.aspx\?conteudo=[^"]+)"[^>]*>(?<title>.*?)</a>', [Text.RegularExpressions.RegexOptions]::Singleline)
$records = @()
$index = 0
foreach ($match in $matches) {
  $index++
  $title = [Net.WebUtility]::HtmlDecode([regex]::Replace($match.Groups['title'].Value, '<[^>]*>', '')).Trim()
  $code = [Net.WebUtility]::HtmlDecode($match.Groups['href'].Value).Split('=', 2)[1].Replace(' ', '+')
  $url = 'https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=' + [uri]::EscapeDataString($code)
  $slug = [regex]::Replace($title.Normalize([Text.NormalizationForm]::FormD), '\p{Mn}', '')
  $slug = [regex]::Replace($slug.ToLowerInvariant(), '[^a-z0-9]+', '-').Trim('-')
  if ($slug.Length -gt 115) { $slug = $slug.Substring(0, 115) }
  $filename = '{0:D2}-{1}.zip' -f $index, $slug
  $target = Join-Path $folder $filename
  & curl.exe -sS -L --fail --max-time 45 --max-redirs 6 -c $cookies -b $cookies $url -o $target
  $ok = $LASTEXITCODE -eq 0
  $entries = 0
  if ($ok) {
    try { $zip = [IO.Compression.ZipFile]::OpenRead($target); $entries = $zip.Entries.Count; $zip.Dispose() }
    catch { $ok = $false }
  }
  $record = [ordered]@{ title = $title; url = $url; filename = $filename; validZip = $ok; entryCount = $entries }
  if ($ok) {
    $record.sha256 = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
    $record.bytes = (Get-Item -LiteralPath $target).Length
  }
  $records += $record
  [IO.File]::WriteAllText((Join-Path $folder 'downloads.json'), (ConvertTo-Json -InputObject $records -Depth 8))
  Write-Output ('{0}/{1}: {2} [{3}]' -f $index, $matches.Count, $title, $(if ($ok) {'ZIP válido'} else {'falhou'}))
}
if (@($records | Where-Object { !$_.validZip }).Count) { throw 'Há downloads inválidos; consulte downloads.json' }
