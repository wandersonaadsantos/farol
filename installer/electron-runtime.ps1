# Preparar o runtime antes de encerrar processos ou alterar a instalacao atual.
function Clear-ElectronRuntimeStage([string]$Stage) {
  if ([string]::IsNullOrWhiteSpace($Stage)) { return }
  $full = [IO.Path]::GetFullPath($Stage)
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
  if (-not $full.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
      -not [string]::Equals([IO.Path]::GetDirectoryName($full), $tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($full) -notmatch '^farol-runtime-[0-9a-f]{32}$') {
    throw 'Caminho de runtime temporario fora do diretorio permitido.'
  }
  if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

function Test-ElectronRuntime([string]$Candidate) {
  if (-not (Test-Path -LiteralPath $Candidate)) { return $false }
  $previous = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    & $Candidate (Join-Path $Src 'lib\electron-runtime.js') check-running (Join-Path $Src 'package.json') 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
  finally { $env:ELECTRON_RUN_AS_NODE = $previous }
}

function Prepare-ElectronRuntime {
  $relative = 'node_modules\electron\dist\electron.exe'
  $bundled = Join-Path $Src $relative
  if (Test-Path -LiteralPath $bundled) {
    if (-not (Test-ElectronRuntime $bundled)) { Die 'O Electron do pacote nao atende ao package.json ou nao roda neste sistema. A instalacao existente foi preservada.' }
    return @{ Source = (Join-Path $Src 'node_modules'); Stage = $null }
  }
  if (Test-ElectronRuntime (Join-Path $App $relative)) {
    Ok 'Electron instalado atende ao runtime exigido; sera preservado'
    return @{ Source = (Join-Path $App 'node_modules'); Stage = $null }
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Die 'O Electron exigido nao esta disponivel e npm nao foi encontrado. Use o instalador offline. A instalacao existente foi preservada.'
  }
  $stage = Join-Path ([IO.Path]::GetTempPath()) ('farol-runtime-' + [Guid]::NewGuid().ToString('N'))
  try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    Copy-Item -LiteralPath (Join-Path $Src 'package.json') -Destination (Join-Path $stage 'package.json')
    $arch = 'x64'
    if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
    Step 'Preparando o Electron exigido em pasta temporaria'
    Push-Location $stage
    try {
      & npm install --omit=dev --no-audit --no-fund "--arch=$arch" | Out-Host
      if ($LASTEXITCODE -ne 0) { throw 'npm install falhou' }
      if (-not (Test-Path -LiteralPath (Join-Path $stage $relative))) {
        $previousArch = $env:npm_config_arch
        try {
          $env:npm_config_arch = $arch
          & node (Join-Path $stage 'node_modules\electron\install.js') | Out-Host
          if ($LASTEXITCODE -ne 0) { throw 'download do binario Electron falhou' }
        } finally { $env:npm_config_arch = $previousArch }
      }
    } finally { Pop-Location }
    if (-not (Test-ElectronRuntime (Join-Path $stage $relative))) { throw 'O Electron preparado nao atende ao runtime exigido ou nao executa' }
    return @{ Source = (Join-Path $stage 'node_modules'); Stage = $stage }
  } catch {
    Clear-ElectronRuntimeStage $stage
    Die 'Falha ao preparar o Electron exigido. A instalacao existente foi preservada.'
  }
}
