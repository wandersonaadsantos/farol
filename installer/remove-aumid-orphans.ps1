# Farol: remove atalhos (.lnk) que carregam o AUMID do Farol mas nao sao os
# atalhos oficiais. A barra de tarefas resolve o icone pelo AUMID: se houver um
# atalho estranho com o mesmo ID (ex.: "Electron.lnk" sem icone, criado fora do
# instalador), ela pode escolher esse e mostrar o atomo do Electron.
# Imprime o caminho de cada atalho removido.
param(
  [string[]]$Keep = @(),
  [string]$AppId = 'com.biud.farol'
)
$ErrorActionPreference = 'Stop'

$keepSet = @{}
foreach ($k in $Keep) { if ($k) { $keepSet[[IO.Path]::GetFullPath($k).ToLowerInvariant()] = $true } }

$dirs = @(
  [IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs'),
  [Environment]::GetFolderPath('Desktop')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

$shell = New-Object -ComObject Shell.Application
foreach ($dir in $dirs) {
  Get-ChildItem -LiteralPath $dir -Recurse -Filter *.lnk -File -ErrorAction SilentlyContinue | ForEach-Object {
    $full = $_.FullName
    if ($keepSet.ContainsKey($full.ToLowerInvariant())) { return }
    $item = $shell.NameSpace($_.DirectoryName).ParseName($_.Name)
    if (-not $item) { return }
    $aumid = $item.ExtendedProperty('System.AppUserModel.ID')
    if ($aumid -eq $AppId) {
      Remove-Item -LiteralPath $full -Force
      $full
    }
  }
}
