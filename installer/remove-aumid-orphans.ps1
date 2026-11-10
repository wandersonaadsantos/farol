# Farol: remove atalhos (.lnk) que carregam o AUMID do Farol sem o icone do
# Farol. A barra de tarefas resolve o icone pelo AUMID: se houver um atalho
# assim (ex.: "Electron.lnk" sem icone, criado fora do instalador), ela pode
# escolher esse e mostrar o atomo do Electron. Copia do Farol.lnk feita pelo
# usuario carrega o farol.ico e fica.
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
$wsh = New-Object -ComObject WScript.Shell
foreach ($dir in $dirs) {
  Get-ChildItem -LiteralPath $dir -Recurse -Filter *.lnk -File -ErrorAction SilentlyContinue | ForEach-Object {
    $full = $_.FullName
    if ($keepSet.ContainsKey($full.ToLowerInvariant())) { return }
    $folder = $shell.NameSpace($_.DirectoryName)
    if (-not $folder) { return }
    $item = $folder.ParseName($_.Name)
    if (-not $item) { return }
    if ($item.ExtendedProperty('System.AppUserModel.ID') -ne $AppId) { return }
    $icone = [string]$wsh.CreateShortcut($full).IconLocation
    if ($icone -match 'farol\.ico') { return }
    try {
      Remove-Item -LiteralPath $full -Force
      $full
    } catch {
      Write-Warning "nao consegui remover ${full}: $($_.Exception.Message)"
    }
  }
}
