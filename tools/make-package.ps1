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

# --- guarda de arvore suja (incidente de 15/08/2026) --------------------------
# O pacote e construido dos ARQUIVOS EM DISCO, nao do commit. Duas sessoes
# paralelas no mesmo repo fizeram um release empacotar codigo nao commitado de
# outra sessao (a v2.42.2 saiu contaminada e precisou de republicacao). Arvore
# suja nos arquivos empacotados agora RECUSA o build; o caminho certo e uma
# worktree limpa no commit da release. FAROL_ALLOW_DIRTY=1 e a escotilha
# consciente (dev local, teste), nunca o fluxo de publicacao.
if ($env:FAROL_ALLOW_DIRTY -ne '1') {
  $dirty = git -C $Src status --porcelain -- main.js server.js package.json lib ui assets workspace-template installer 2>$null
  if ($LASTEXITCODE -eq 0 -and $dirty) {
    Write-Host '  ERRO: arvore com mudancas nao commitadas nos arquivos do pacote:' -ForegroundColor Red
    $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    throw 'arvore suja: o pacote sairia diferente do commit. Commite, ou construa de uma worktree limpa (FAROL_ALLOW_DIRTY=1 so pra teste local).'
  }
}

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
# O separador das entradas TEM que ser '/' (regra do formato zip). O Compress-Archive
# do Windows PowerShell grava '\', o unzip do macOS recusa o pacote inteiro e o
# auto-update no Mac morre em "appears to use backslashes as path separators".
# Por isso montamos as entradas na mao, com o nome normalizado.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force -Path $dist | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }
# a raiz e o enumerador saem do MESMO caminho resolvido: $env:TEMP volta em formato
# curto (WANDER~1) e misturar as duas formas desalinha a subtracao do prefixo.
$raiz = (Get-Item $staging).FullName.TrimEnd('\')
$archive = [IO.Compression.ZipFile]::Open($zip, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in (Get-ChildItem -LiteralPath $raiz -Recurse -File)) {
    $nome = $file.FullName.Substring($raiz.Length).Replace('\', '/').TrimStart('/')
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $nome) | Out-Null
  }
} finally { $archive.Dispose() }
Remove-Item $staging -Recurse -Force

# --- auditoria anti-vazamento -----------------------------------------------------
$zr = [IO.Compression.ZipFile]::OpenRead($zip)
try { $entries = @($zr.Entries | ForEach-Object { $_.FullName }) } finally { $zr.Dispose() }

# caminho torto (backslash ou raiz absoluta) invalida o pacote no macOS: falha antes de publicar
$torto = $entries | Where-Object { $_ -match '\\' -or $_.StartsWith('/') }
if ($torto) {
  Write-Host '  x  ENTRADAS COM CAMINHO INVALIDO (quebra o unzip do macOS):' -ForegroundColor Red
  $torto | Select-Object -First 5 | ForEach-Object { Write-Host "     $_" -ForegroundColor Red }
  Remove-Item $zip -Force
  exit 1
}

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
# *.sh e *.command entram na varredura: sao os artefatos de mac que o pacote
# transporta, e ficavam fora do pente de credencial (achado da auditoria 16/08)
$hits = Get-ChildItem $tmpDir -Recurse -File -Include *.js, *.md, *.json, *.cmd, *.ps1, *.html, *.css, *.sh, *.command |
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
