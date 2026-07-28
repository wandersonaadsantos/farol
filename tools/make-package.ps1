# Farol: gera o pacote de distribuicao para o time (dist\farol-vX.Y.Z.zip).
# So entra o que e do app: nada de config.json, state, sessions, logs ou node_modules.
# No final, audita o conteudo do zip contra vazamento e falha se achar algo suspeito.
$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $Src 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$dist = Join-Path $Src 'dist'
$zip = Join-Path $dist "farol-v$version.zip"
$staging = Join-Path $env:TEMP "farol-pkg-$([guid]::NewGuid().ToString('N').Substring(0,8))"

Write-Host ''
Write-Host "  Farol · empacotador v$version" -ForegroundColor Yellow

# --- whitelist: o que viaja no pacote -----------------------------------------
New-Item -ItemType Directory -Force -Path $staging | Out-Null
foreach ($f in @('main.js', 'server.js', 'package.json', 'README.md', 'CLAUDE.md',
    'Instalar.cmd', 'Desinstalar.cmd', 'Instalar.command', 'Desinstalar.command')) {
  Copy-Item (Join-Path $Src $f) (Join-Path $staging $f)
}
foreach ($d in @('lib', 'ui', 'assets', 'workspace-template', 'installer')) {
  robocopy (Join-Path $Src $d) (Join-Path $staging $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "robocopy falhou em $d" }
}
New-Item -ItemType Directory -Force -Path (Join-Path $staging 'tools') | Out-Null
foreach ($t in @('make-icons.ps1', 'pack-ico.js', 'make-package.ps1', 'make-icns.sh')) {
  Copy-Item (Join-Path (Join-Path $Src 'tools') $t) (Join-Path (Join-Path $staging 'tools') $t)
}

# --- zip ------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip
Remove-Item $staging -Recurse -Force

# --- auditoria anti-vazamento -----------------------------------------------------
Add-Type -AssemblyName System.IO.Compression.FileSystem
$entries = [IO.Compression.ZipFile]::OpenRead($zip).Entries | ForEach-Object { $_.FullName }
$proibidos = $entries | Where-Object {
  $_ -match 'node_modules|config\.json|(^|/)state/|(^|/)sessions/|\.log|(^|/)seen$|baselined|highlights\.md|(^|/)authors/'
}
if ($proibidos) {
  Write-Host '  x  ARQUIVOS PROIBIDOS NO PACOTE:' -ForegroundColor Red
  $proibidos | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
  Remove-Item $zip -Force
  exit 1
}

$leak = @()
foreach ($e in $entries) { if ($e -match '\.(js|md|json|cmd|ps1|html|css)$') {
  $tmpDir = Join-Path $env:TEMP "farol-audit-$([guid]::NewGuid().ToString('N').Substring(0,8))"
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  break
} }
# extrai e procura credenciais/contas pessoais nos textos
Expand-Archive -Path $zip -DestinationPath $tmpDir -Force
$hits = Get-ChildItem $tmpDir -Recurse -File -Include *.js, *.md, *.json, *.cmd, *.ps1, *.html, *.css |
  Where-Object { $_.Name -ne 'make-package.ps1' } |
  Select-String -Pattern 'wandersonbiuder|ghp_|github_pat_|gho_|ATATT|Bearer ' -SimpleMatch:$false
Remove-Item $tmpDir -Recurse -Force
if ($hits) {
  Write-Host '  x  POSSIVEL CREDENCIAL/CONTA PESSOAL NO PACOTE:' -ForegroundColor Red
  $hits | Select-Object -First 10 | ForEach-Object { Write-Host ("     {0}:{1}  {2}" -f $_.Filename, $_.LineNumber, $_.Line.Trim()) -ForegroundColor Red }
  Remove-Item $zip -Force
  exit 1
}

$size = '{0:N0} KB' -f ((Get-Item $zip).Length / 1KB)
Write-Host "  ok  pacote limpo: $zip ($size, $($entries.Count) arquivos)" -ForegroundColor Green
Write-Host '      auditado: sem estado, sem config, sem tokens, sem conta pessoal.' -ForegroundColor DarkGray
Write-Host ''
