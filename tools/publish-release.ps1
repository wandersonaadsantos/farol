# Farol: publica uma release no GitHub (biudtech/farol) pras copias instaladas
# se atualizarem sozinhas. Sobe DOIS artefatos:
#   - farol-vX.Y.Z.zip     (leve, sem node_modules): e o que o UPDATE baixa.
#   - Farol-Setup-vX.Y.Z.exe (Electron embutido): PRIMEIRA instalacao, arquivo unico
#     (duplo clique instala e abre, sem extrair zip).
# O instalador offline do macOS (.command) deve ser gerado num Mac
# (tools/make-offline-mac.sh) e anexado com:
#   gh release upload vX.Y.Z dist/Farol-Instalar-mac.command --repo biudtech/farol
#
# Pre-req: o codigo desta versao ja commitado e no repo (git push), pra a tag
# apontar pro codigo certo. Requer gh autenticado com acesso ao repo.
$ErrorActionPreference = 'Stop'

$Src = Split-Path -Parent $PSScriptRoot
$pkg = Get-Content (Join-Path $Src 'package.json') -Raw | ConvertFrom-Json
$version = $pkg.version
$repo = 'biudtech/farol'
$tag = "v$version"

Write-Host ''
Write-Host "  Farol · publicar release $tag em $repo" -ForegroundColor Yellow

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
  $lines = Get-Content $changelog
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
  $body = "Farol v$version. Veja o CHANGELOG.md do repositorio."
}
[IO.File]::WriteAllText($notesFile, $body, (New-Object Text.UTF8Encoding($false)))

# --- release ------------------------------------------------------------------
# checa existencia sem deixar o stderr do gh virar erro terminante (ErrorAction=Stop)
$ErrorActionPreference = 'Continue'
& gh release view $tag --repo $repo 1>$null 2>$null
$exists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = 'Stop'
if ($exists) {
  Write-Host "  -> Release $tag ja existe; atualizando notas e anexos" -ForegroundColor Cyan
  & gh release edit $tag --repo $repo --title $tag --notes-file $notesFile
  & gh release upload $tag $light $offline --repo $repo --clobber
} else {
  Write-Host "  -> Criando a release $tag" -ForegroundColor Cyan
  & gh release create $tag $light $offline --repo $repo --title $tag --notes-file $notesFile
}
if ($LASTEXITCODE -ne 0) { throw "gh release falhou (codigo $LASTEXITCODE)" }

Write-Host ''
Write-Host "  ok  release $tag publicada em $repo" -ForegroundColor Green
Write-Host '      As copias instaladas (>= 1.15.0) vao ver o update no proximo ciclo.' -ForegroundColor DarkGray
Write-Host '      macOS: gere o .command num Mac e anexe com gh release upload.' -ForegroundColor DarkGray
Write-Host ''
