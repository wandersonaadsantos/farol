# Farol: instalador. Copia o app para %LOCALAPPDATA%\Farol, cria atalhos e
# migra o estado do PR Reviewer antigo (se encontrado).
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File installer\install.ps1 [-NoDesktop] [-LegacyPath <pasta>]
param(
  [switch]$NoDesktop,
  [switch]$NoShortcuts,   # nao cria atalho nenhum (usado em teste, pra nao mexer no Menu Iniciar real)
  [string]$Root = (Join-Path $env:USERPROFILE '.farol'),  # raiz da instalacao (override so em teste)
  [string]$LegacyPath = "$env:USERPROFILE\Downloads\utils\pr-reviewer-windows\windows"
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Src  = Split-Path -Parent $PSScriptRoot
# fora do AppData de proposito: o Claude Code empacotado (MSIX) enxerga o
# %LOCALAPPDATA% virtualizado e as escritas dele iriam pro overlay do pacote
$App  = Join-Path $Root 'app'
$Ws   = Join-Path $Root 'workspace'
$OldRoot = Join-Path $env:LOCALAPPDATA 'Farol'

function Step([string]$msg) { Write-Host "  -> $msg" -ForegroundColor Cyan }
function Ok([string]$msg)   { Write-Host "     $msg" -ForegroundColor DarkGray }
function Die([string]$msg)  { Write-Host "  x  $msg" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host '  Farol · instalador' -ForegroundColor Yellow
Write-Host '  ==================' -ForegroundColor DarkGray

# --- pre-requisitos ---------------------------------------------------------
# Node/npm NAO sao exigidos no modo offline (o Electron ja viaja embutido no
# pacote e so e copiado). So o caminho de fallback (baixar o Electron) precisa
# de npm, e a checagem vive la embaixo. gh e claude sao avisos (o app precisa
# deles pra funcionar, mas instala sem).
foreach ($opt in @(@('gh', 'GitHub CLI (https://cli.github.com)'), @('claude', 'Claude Code CLI'))) {
  if (-not (Get-Command $opt[0] -ErrorAction SilentlyContinue)) {
    Write-Host ("  !  '{0}' nao encontrado no PATH: o Farol instala, mas precisa dele pra funcionar ({1})." -f $opt[0], $opt[1]) -ForegroundColor Yellow
  }
}

# --- encerra instancias em execucao ------------------------------------------
Step 'Encerrando instancias do Farol em execucao (se houver)'
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*\Farol\app*' -or $_.CommandLine -like '*\.farol\app*' } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
Start-Sleep -Milliseconds 600

# --- copia do app -------------------------------------------------------------
Step "Copiando o app para $App"
New-Item -ItemType Directory -Force -Path $App | Out-Null
foreach ($f in @('main.js', 'server.js', 'package.json', 'README.md', 'CLAUDE.md')) {
  if (Test-Path (Join-Path $Src $f)) { Copy-Item (Join-Path $Src $f) (Join-Path $App $f) -Force }
}
# /MIR e nao /E: como o rm -rf + cp do install.sh, espelha a fonte e APAGA no
# destino arquivo que a versao nova removeu; /E era aditivo e um lib/engine/foo.js
# deletado sobrevivia pra sempre em ~/.farol/app, update apos update.
# 'installer' entra na copia (paridade com o mac): sem ele, quem instalou pelo
# Setup.exe e apagou o download nao tinha como desinstalar.
# 'tools' carrega runtime (jira-mcp.js): sem ela, revisao com Jira cadastrado
# dispara o dialogo do Electron "Unable to find Electron app at .../tools/jira-mcp.js".
foreach ($d in @('lib', 'ui', 'assets', 'workspace-template', 'installer', 'tools')) {
  $srcDir = Join-Path $Src $d
  if (-not (Test-Path $srcDir)) { continue }
  robocopy $srcDir (Join-Path $App $d) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Die "Falha ao copiar a pasta '$d' (robocopy $LASTEXITCODE)." }
}
if (Test-Path (Join-Path $Src 'Desinstalar.cmd')) { Copy-Item (Join-Path $Src 'Desinstalar.cmd') (Join-Path $App 'Desinstalar.cmd') -Force }

# --- dependencias (Electron) ---------------------------------------------------
$electronExe = Join-Path $App 'node_modules\electron\dist\electron.exe'
if (Test-Path (Join-Path $Src 'node_modules\electron\dist\electron.exe')) {
  Step 'Copiando dependencias ja baixadas (node_modules)'
  robocopy (Join-Path $Src 'node_modules') (Join-Path $App 'node_modules') /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { Die 'Falha ao copiar node_modules.' }
} elseif (-not (Test-Path $electronExe)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Die 'Electron nao veio embutido e npm nao esta no PATH pra baixa-lo. Use o instalador offline (Farol-Setup.exe), que ja traz o Electron.'
  }
  Step 'Baixando o Electron (npm install, pode levar alguns minutos)'
  Push-Location $App
  npm install --omit=dev --no-audit --no-fund 2>&1 | Out-Null
  Pop-Location
}
if (-not (Test-Path $electronExe)) { Die 'Electron nao instalado (node_modules\electron ausente). Rode npm install em ' + $App }

# executavel com o nome do app (hardlink: zero disco extra, assinatura preservada)
$farolExe = Join-Path (Split-Path $electronExe) 'Farol.exe'
if (-not (Test-Path $farolExe)) {
  try { New-Item -ItemType HardLink -Path $farolExe -Target $electronExe -ErrorAction Stop | Out-Null }
  catch { $farolExe = $electronExe }
}

# --- workspace do Claude -------------------------------------------------------
Step "Preparando o workspace do Claude em $Ws"
New-Item -ItemType Directory -Force -Path (Join-Path $Ws 'state\authors') | Out-Null
# protocolo sempre atualizado a partir do template; state\ nunca e tocado
Copy-Item (Join-Path $App 'workspace-template\CLAUDE.md') (Join-Path $Ws 'CLAUDE.md') -Force
# /MIR como o rm -rf do install.sh: comando de slash removido do template tem que
# sumir do workspace tambem (o /E aditivo deixava agente/comando morto vivo)
robocopy (Join-Path $App 'workspace-template\.claude') (Join-Path $Ws '.claude') /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
robocopy (Join-Path $App 'workspace-template\prompts') (Join-Path $Ws 'prompts') /E /NFL /NDL /NJH /NJS /NP | Out-Null

# --- migracao do estado antigo -------------------------------------------------
$seen = Join-Path $Ws 'state\seen'
$oldWsState = Join-Path $OldRoot 'workspace\state'
if (-not (Test-Path $seen) -and (Test-Path $oldWsState)) {
  # instalacao anterior do Farol em %LOCALAPPDATA%: migra e MESCLA com o overlay
  # MSIX (Packages\...\LocalCache), onde o Claude empacotado escreveu estado
  Step "Migrando o estado do Farol anterior ($OldRoot)"
  robocopy $oldWsState (Join-Path $Ws 'state') /E /NFL /NDL /NJH /NJS /NP | Out-Null
  $overlays = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -ErrorAction SilentlyContinue |
    ForEach-Object { Join-Path $_.FullName 'LocalCache\Local\Farol\workspace\state' } |
    Where-Object { Test-Path $_ }
  foreach ($ov in $overlays) {
    Ok "mesclando overlay MSIX: $ov"
    $realSeen = Join-Path $Ws 'state\seen'
    $ovSeen = Join-Path $ov 'seen'
    robocopy $ov (Join-Path $Ws 'state') /E /IS /IT /NFL /NDL /NJH /NJS /NP | Out-Null
    if ((Test-Path $ovSeen) -and (Test-Path $realSeen)) {
      # seen = uniao das duas linhas do tempo (real + overlay)
      $merged = @(Get-Content $realSeen -ErrorAction SilentlyContinue) + @(Get-Content $ovSeen -ErrorAction SilentlyContinue) |
        Where-Object { $_ } | Select-Object -Unique
      Set-Content -Path $realSeen -Value $merged
    }
  }
  if (Test-Path (Join-Path $OldRoot 'config.json')) {
    Copy-Item (Join-Path $OldRoot 'config.json') (Join-Path $Root 'config.json') -Force
  }
  Ok 'seen, autores, destaques, log e config preservados (real + overlay).'
}
elseif (-not (Test-Path $seen) -and (Test-Path (Join-Path $LegacyPath 'state'))) {
  Step "Migrando o estado do PR Reviewer antigo ($LegacyPath)"
  robocopy (Join-Path $LegacyPath 'state') (Join-Path $Ws 'state') /E /NFL /NDL /NJH /NJS /NP | Out-Null
  Ok 'seen, autores, destaques e log preservados.'
}
$oldLog = Join-Path $Ws 'state\pr-reviewer.log'
if (Test-Path $oldLog) { Move-Item $oldLog (Join-Path $Ws 'state\farol.log') -Force }

# aposenta a instalacao antiga em %LOCALAPPDATA% (e o overlay), pra nao divergir de novo
if (Test-Path $OldRoot) {
  Step 'Removendo a instalacao antiga em %LOCALAPPDATA%\Farol'
  Remove-Item $OldRoot -Recurse -Force -ErrorAction SilentlyContinue
}
Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Packages') -Directory -ErrorAction SilentlyContinue |
  ForEach-Object { Join-Path $_.FullName 'LocalCache\Local\Farol' } |
  Where-Object { Test-Path $_ } |
  ForEach-Object { Remove-Item $_ -Recurse -Force -ErrorAction SilentlyContinue }

# --- atalhos --------------------------------------------------------------------
if ($NoShortcuts) {
  Ok 'atalhos pulados (-NoShortcuts)'
} else {
Step 'Criando atalhos'
$shell = New-Object -ComObject WScript.Shell
$targets = @([IO.Path]::Combine($env:APPDATA, 'Microsoft\Windows\Start Menu\Programs\Farol.lnk'))
if (-not $NoDesktop) { $targets += [IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Farol.lnk') }
foreach ($lnkPath in $targets) {
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath = $farolExe
  $lnk.Arguments = '"' + $App + '"'
  $lnk.WorkingDirectory = $App
  $lnk.IconLocation = (Join-Path $App 'assets\farol.ico') + ',0'
  $lnk.Description = 'Farol · radar de Pull Requests'
  $lnk.Save()
  Ok $lnkPath
}
# AUMID nos atalhos: sem isso a barra de tarefas usa o icone do exe (atomo do Electron)
try {
  & (Join-Path $PSScriptRoot 'set-aumid.ps1') -ShortcutPath $targets | ForEach-Object { Ok $_ }
} catch {
  Write-Host "  !  nao consegui gravar o AUMID nos atalhos ($($_.Exception.Message)); o icone da barra de tarefas pode sair como o do Electron." -ForegroundColor Yellow
}
}

Write-Host ''
Write-Host '  Instalacao concluida.' -ForegroundColor Green
Write-Host '  Abra o Farol pelo Menu Iniciar (ou pelo atalho na area de trabalho).' -ForegroundColor Gray
Write-Host "  Dados e estado: $Ws" -ForegroundColor DarkGray
Write-Host ''
