# Roda os testes da casca Windows.
# -Portable usa o filtro Farol.Portable.slnf (Contrato, Sidecar e Tests), que compila fora do Windows.
param(
    [switch]$Portable,
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Debug'
)

$ErrorActionPreference = 'Stop'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'

# Os testes miram net8.0. Numa máquina só com runtime mais novo (o SDK 10 sem o runtime 8,
# por exemplo), o testhost não sobe; o roll forward deixa ele rodar no runtime maior instalado.
$temRuntime8 = (dotnet --list-runtimes 2>$null) -match '^Microsoft\.NETCore\.App 8\.'
if (-not $temRuntime8) {
    $env:DOTNET_ROLL_FORWARD = 'Major'
}

$raiz = Split-Path -Parent $PSScriptRoot
$alvo = if ($Portable) { Join-Path $raiz 'Farol.Portable.slnf' } else { Join-Path $raiz 'Farol.sln' }

dotnet test $alvo -c $Configuration
exit $LASTEXITCODE
