# Compila a solução inteira da casca Windows (inclui o Farol.App, que só compila no Windows).
# -Portable usa o filtro Farol.Portable.slnf (Contrato, Sidecar e Tests), que compila fora do Windows.
param(
    [switch]$Portable,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$raiz = Split-Path -Parent $PSScriptRoot
$alvo = if ($Portable) { Join-Path $raiz 'Farol.Portable.slnf' } else { Join-Path $raiz 'Farol.sln' }

dotnet build $alvo -c $Configuration
exit $LASTEXITCODE
