# Compila a solução inteira da casca Windows (inclui o Farol.App, que só compila no Windows).
param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

$raiz = Split-Path -Parent $PSScriptRoot
$solucao = Join-Path $raiz 'Farol.sln'

dotnet build $solucao -c $Configuration
exit $LASTEXITCODE
