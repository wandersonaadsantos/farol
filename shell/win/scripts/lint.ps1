# Confere a formatação (dotnet format) sem alterar arquivos.
# -Portable usa o filtro Farol.Portable.slnf; -Fix aplica a formatação em vez de só conferir.
param(
    [switch]$Portable,
    [switch]$Fix
)

$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$raiz = Split-Path -Parent $PSScriptRoot
$alvo = if ($Portable) { Join-Path $raiz 'Farol.Portable.slnf' } else { Join-Path $raiz 'Farol.sln' }

if ($Fix) {
    dotnet format $alvo
} else {
    dotnet format $alvo --verify-no-changes
}
exit $LASTEXITCODE
