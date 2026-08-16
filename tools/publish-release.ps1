# Farol: publica uma release no GitHub (wandersonaadsantos/farol) pras copias instaladas
# se atualizarem sozinhas. Sobe DOIS artefatos:
#   - farol-vX.Y.Z.zip     (leve, sem node_modules): e o que o UPDATE baixa.
#   - Farol-Setup-vX.Y.Z.exe (Electron embutido): PRIMEIRA instalacao, arquivo unico
#     (duplo clique instala e abre, sem extrair zip).
# O instalador offline do macOS (.command) RODA EM QUALQUER SO
# (tools/make-offline-mac.sh baixa o zip darwin do GitHub e embute); anexe com:
#   gh release upload vX.Y.Z dist/Farol-Instalar-mac.command --repo wandersonaadsantos/farol
#
# Pre-req: o codigo desta versao ja commitado e no repo (git push), pra a tag
# apontar pro codigo certo. Requer gh autenticado com acesso ao repo.
$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $Src 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$repo = 'wandersonaadsantos/farol'
$tag = "v$version"

Write-Host ''
Write-Host "  Farol · publicar release $tag em $repo" -ForegroundColor Yellow

# --- versionamento: a referencia e a ULTIMA RELEASE PUBLICADA -----------------
# Historico real de erro (ver CLAUDE.md, "Versionamento"): fonte ja esteve 2
# versoes a frente do publicado, e sessoes paralelas ja colidiram no mesmo
# numero (a segunda sobrescrevia a release da primeira em silencio). Regra:
# so publica se a versao do package.json for MAIOR que a ultima publicada.
# Republicar a MESMA versao de proposito (consertar nota/anexo) exige
# FAROL_REPUBLISH=1 no ambiente, nunca acontece por acidente.
$ErrorActionPreference = 'Continue'
$latestTag = (& gh release view --repo $repo --json tagName --jq '.tagName') 2>$null
$ErrorActionPreference = 'Stop'
if ($LASTEXITCODE -eq 0 -and $latestTag) {
  $latestV = [version]($latestTag.TrimStart('v'))
  $thisV = [version]$version
  if ($thisV -lt $latestV) {
    throw "package.json esta em v$version mas a ultima release publicada e ${latestTag}: o numero ja passou. Rebase a versao na ULTIMA PUBLICADA (gh release view) e renumere package.json + CHANGELOG + RELEASE_NOTES antes de publicar."
  }
  if ($thisV -eq $latestV -and -not $env:FAROL_REPUBLISH) {
    throw "a release $tag JA EXISTE publicada. Se outra sessao publicou esse numero primeiro, renumere (package.json + CHANGELOG + RELEASE_NOTES) e publique como versao nova. Pra republicar $tag de proposito (consertar nota/anexo), rode com FAROL_REPUBLISH=1."
  }
} else {
  Write-Host '  !  nao consegui ler a ultima release publicada (conta do gh? rede?); seguindo sem a checagem de numero' -ForegroundColor Yellow
}

# --- build dos artefatos ------------------------------------------------------
Write-Host '  -> Gerando o pacote leve (update)' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'make-package.ps1') | Out-Null
$light = Join-Path $Src "dist\farol-v$version.zip"
if (-not (Test-Path $light)) { throw "pacote leve nao gerado: $light" }

Write-Host '  -> Gerando o instalador unico do Windows (primeira instalacao)' -ForegroundColor Cyan
& (Join-Path $PSScriptRoot 'make-installer.ps1') | Out-Null
$offline = Join-Path $Src "dist\Farol-Setup-v$version.exe"
if (-not (Test-Path $offline)) { throw "instalador nao gerado: $offline" }

# --- notas: extrai a secao desta versao do CHANGELOG.md -----------------------
$changelog = Join-Path $Src 'CHANGELOG.md'
$notesFile = Join-Path $Src "dist\release-notes-v$version.md"
$body = $null
if (Test-Path $changelog) {
  # -Encoding UTF8: sem isso o PS 5.1 le o CHANGELOG (UTF-8) como ANSI e dobra a
  # codificacao, mojibakeando acentos/emojis no corpo da release.
  $lines = Get-Content $changelog -Encoding UTF8
  $start = -1
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^##\s+v$([regex]::Escape($version))\b") { $start = $i + 1; break }
  }
  if ($start -ge 0) {
    $end = $lines.Count
    for ($j = $start; $j -lt $lines.Count; $j++) {
      if ($lines[$j] -match '^##\s') { $end = $j; break }
    }
    $body = ($lines[$start..($end - 1)] -join "`n").Trim()
  }
}
if (-not $body) {
  Write-Host "  !  CHANGELOG.md sem secao v$version; usando nota generica" -ForegroundColor Yellow
  $body = "Farol v$version."
}
# rodape padrao (Instalar/Atualizar + Anexos): por padrao SEMPRE presente, com a
# versao preenchida. Lido como UTF-8 pra nao mojibakear. Assim o CHANGELOG so
# descreve o que mudou e o padrao das notas fica garantido em toda release.
$footerFile = Join-Path $Src 'tools\release-footer.md'
if (-not (Test-Path $footerFile)) {
  Write-Host "  !  tools\release-footer.md ausente; release sai SEM o rodape Instalar/Anexos" -ForegroundColor Yellow
}
else {
  $footerRaw = ((Get-Content $footerFile -Encoding UTF8) -join "`n").Replace('{VERSION}', $version)
  # separa Instalar/Atualizar de Anexos, pra o dedup atingir SO o bloco duplicado
  # (se o CHANGELOG trouxe um Instalar manual, os Anexos ainda entram).
  $idx = $footerRaw.IndexOf('## Anexos')
  $install = if ($idx -ge 0) { $footerRaw.Substring(0, $idx).Trim() } else { $footerRaw.Trim() }
  $anexos = if ($idx -ge 0) { $footerRaw.Substring($idx).Trim() } else { '' }
  $add = @()
  if ($body -match '(?m)^#{2,}\s+.*Instalar') {
    Write-Host "  !  o CHANGELOG ja tem 'Instalar'; anexo so os Anexos (nao duplico o bloco Instalar)" -ForegroundColor Yellow
  } else {
    $add += $install
  }
  if ($anexos -and ($body -notmatch '(?m)^#{2,}\s+Anexos')) { $add += $anexos }
  if ($add.Count) { $body = $body.TrimEnd() + "`n`n" + ($add -join "`n`n") }
}
[IO.File]::WriteAllText($notesFile, $body, (New-Object Text.UTF8Encoding($false)))

# --- release ------------------------------------------------------------------
# checa existencia sem deixar o stderr do gh virar erro terminante (ErrorAction=Stop)
$ErrorActionPreference = 'Continue'
& gh release view $tag --repo $repo 1>$null 2>$null
$exists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if ($exists) {
  # so chega aqui com FAROL_REPUBLISH=1 (a checagem de versionamento la em cima
  # barra o caso acidental) ou se a release nasceu ENTRE a checagem e agora
  # (outra sessao publicando em paralelo): nesse ultimo caso, aborta.
  if (-not $env:FAROL_REPUBLISH) {
    throw "a release $tag apareceu no meio da publicacao (outra sessao?). Renumere e publique como versao nova, ou rode com FAROL_REPUBLISH=1 se sobrescrever for intencional."
  }
  Write-Host "  -> Release $tag ja existe; FAROL_REPUBLISH=1: atualizando notas e anexos" -ForegroundColor Cyan
  & gh release edit $tag --repo $repo --title "Farol $tag" --notes-file $notesFile
  if ($LASTEXITCODE -ne 0) { throw "gh release edit falhou (codigo $LASTEXITCODE)" }
  & gh release upload $tag $light $offline --repo $repo --clobber
} else {
  Write-Host "  -> Criando a release $tag" -ForegroundColor Cyan
  & gh release create $tag $light $offline --repo $repo --title "Farol $tag" --notes-file $notesFile
}
if ($LASTEXITCODE -ne 0) { throw "gh release falhou (codigo $LASTEXITCODE)" }

Write-Host ''
Write-Host "  ok  release $tag publicada em $repo" -ForegroundColor Green
Write-Host '      As copias instaladas (>= 1.15.0) vao ver o update no proximo ciclo.' -ForegroundColor DarkGray
Write-Host '      macOS: bash tools/make-offline-mac.sh (roda em qualquer SO) e anexe com gh release upload.' -ForegroundColor DarkGray
Write-Host ''
