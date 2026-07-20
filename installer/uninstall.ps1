# Farol: desinstalador. Remove app, atalhos e autostart.
# O estado (workspace com memoria do time, seen, log) e preservado por padrao;
# use -RemoveData para apagar tudo.
param([switch]$RemoveData)
$ErrorActionPreference = 'SilentlyContinue'

$Root = Join-Path $env:USERPROFILE '.farol'
$App  = Join-Path $Root 'app'

Write-Host ''
Write-Host '  Farol · desinstalador' -ForegroundColor Yellow

Write-Host '  -> Encerrando o app'
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*\.farol\app*' -or $_.CommandLine -like '*\Farol\app*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-Sleep -Milliseconds 800

Write-Host '  -> Removendo atalhos'
Remove-Item ([IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Farol.lnk')) -Force
Remove-Item ([IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Farol.lnk')) -Force

Write-Host '  -> Removendo inicio automatico (se configurado)'
$run = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
Get-Item $run | Select-Object -ExpandProperty Property | ForEach-Object {
  $v = (Get-ItemProperty $run -Name $_).$_
  if ($v -like '*\.farol\app*' -or $v -like '*\Farol\app*') { Remove-ItemProperty $run -Name $_ }
}

Write-Host '  -> Removendo o app'
Remove-Item $App -Recurse -Force
Remove-Item (Join-Path $env:LOCALAPPDATA 'Farol') -Recurse -Force

if ($RemoveData) {
  Write-Host '  -> Removendo dados e estado (-RemoveData)'
  Remove-Item $Root -Recurse -Force
} else {
  Write-Host "     Estado preservado em $Root\workspace (memoria do time, seen, log)." -ForegroundColor DarkGray
}

Write-Host ''
Write-Host '  Desinstalacao concluida.' -ForegroundColor Green
Write-Host ''
