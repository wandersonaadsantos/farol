# Farol: assina o MSIX da casca do Windows com o certificado de assinatura de codigo e
# confere a assinatura em seguida (signtool verify /pa).
#
#   tools\release\assinar-win.ps1 --msix <Farol-X.Y.Z.msix> [--dry-run]
#
# O certificado vem SO do ambiente, nunca de argumento nem de arquivo versionado:
#   WIN_SIGNING_CERT_PFX       caminho do .pfx que o job do CI materializou do secret
#   WIN_SIGNING_CERT_PASSWORD  a senha do .pfx (nunca impressa: o dry-run mostra /p ****)
#   WIN_SIGNTOOL               opcional: o signtool.exe, quando ele nao esta no PATH
#
# O Publisher do Package.appxmanifest tem de ser IGUAL ao subject do certificado, senao o
# signtool recusa o pacote. O CN=BIUD de hoje e provisorio; a Task 5 do plano 4 documenta
# o checklist de troca para o subject do certificado definitivo.
$ErrorActionPreference = 'Stop'

function Falhar([string]$msg) {
  [Console]::Error.WriteLine("assinar-win: $msg")
  exit 1
}

$msix = ''
$dryRun = $false
$i = 0
while ($i -lt $args.Count) {
  $opcao = [string]$args[$i]
  switch ($opcao) {
    '--dry-run' { $dryRun = $true; $i += 1 }
    '--msix' {
      if ($i + 1 -ge $args.Count) { Falhar "falta o valor de $opcao" }
      $msix = [string]$args[$i + 1]
      $i += 2
    }
    default { Falhar "argumento desconhecido: $opcao" }
  }
}
if (-not $msix) { Falhar 'falta --msix <arquivo>' }
if (-not (Test-Path -LiteralPath $msix -PathType Leaf)) { Falhar "msix ausente: $msix" }

$pfx = [Environment]::GetEnvironmentVariable('WIN_SIGNING_CERT_PFX')
$senha = [Environment]::GetEnvironmentVariable('WIN_SIGNING_CERT_PASSWORD')
if (-not $pfx) { Falhar 'falta a variavel de ambiente WIN_SIGNING_CERT_PFX (caminho do .pfx)' }
if (-not $senha) { Falhar 'falta a variavel de ambiente WIN_SIGNING_CERT_PASSWORD (senha do .pfx)' }
if (-not (Test-Path -LiteralPath $pfx -PathType Leaf)) { Falhar "certificado ausente em WIN_SIGNING_CERT_PFX: $pfx" }

$signtool = [Environment]::GetEnvironmentVariable('WIN_SIGNTOOL')
if (-not $signtool) { $signtool = 'signtool' }

$assinar = @('sign', '/fd', 'SHA256', '/tr', 'http://timestamp.digicert.com', '/td', 'SHA256', '/f', $pfx, '/p')
$conferir = @('verify', '/pa', $msix)

if ($dryRun) {
  Write-Output "$signtool $($assinar -join ' ') **** $msix"
  Write-Output "$signtool $($conferir -join ' ')"
  exit 0
}

$executavel = Get-Command $signtool -ErrorAction SilentlyContinue
if (-not $executavel) { Falhar "signtool nao encontrado ($signtool): ponha no PATH ou aponte WIN_SIGNTOOL" }

# a linha com a senha nunca e impressa; o signtool nao a ecoa
& $executavel.Source @assinar $senha $msix | Out-Host
if ($LASTEXITCODE -ne 0) { Falhar "signtool sign falhou (codigo $LASTEXITCODE): $msix" }
& $executavel.Source @conferir | Out-Host
if ($LASTEXITCODE -ne 0) { Falhar "signtool verify /pa reprovou a assinatura: $msix" }
[Console]::Error.WriteLine("assinar-win: $msix assinado e conferido")
