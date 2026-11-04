# Copia do app para o Windows: pasta nova, conferida e gravada no disco, com troca de nome no fim.
#
# Medido em 03/11/2026 na v2.78.30: o Windows reiniciou 25 s depois de o update comecar e seis
# arquivos de app ficaram com o tamanho certo e o conteudo todo nulo; o Electron abria com SyntaxError.
# Instalar de novo saia com sucesso sem consertar: o robocopy pula arquivo de mesmo tamanho e data,
# e /IS /IT nao resolvem sempre (test/instalador-copia-integral.test.js). Pasta nova nao tem o que
# pular, e nada do conteudo novo chega ao lugar definitivo antes de estar conferido e no disco.
#
# A troca e item a item: reinicio bem no meio pode misturar versoes, mas nunca deixa arquivo zerado.
# package.json vai por ultimo, porque e ele que diz a versao no proximo boot: troca interrompida nao
# anuncia a versao nova, o update roda de novo e a proxima instalacao devolve o que tiver ficado
# guardado em app.antigo (Restore-ItensGuardados).

function Get-ArquivosRelativos([string]$Pasta) {
  # A enumeracao devolve o caminho com o prefixo recebido; Get-ChildItem expande o nome curto (RUNNER~1)
  # e o recorte pelo tamanho erraria. Arquivo oculto entra.
  $base = $Pasta.TrimEnd('\', '/')
  [IO.Directory]::EnumerateFiles($base, '*', 'AllDirectories') | ForEach-Object { $_.Substring($base.Length + 1) }
}

function Get-Sha256([string]$Arquivo) {
  $sha = [Security.Cryptography.SHA256]::Create()
  $fluxo = [IO.File]::OpenRead($Arquivo)
  try { [BitConverter]::ToString($sha.ComputeHash($fluxo)) }
  finally { $fluxo.Dispose(); $sha.Dispose() }
}

function Test-ArquivoIgual([string]$A, [string]$B) {
  if (-not (Test-Path -LiteralPath $B -PathType Leaf)) { return $false }
  if ((Get-Item -LiteralPath $A -Force).Length -ne (Get-Item -LiteralPath $B -Force).Length) { return $false }
  return (Get-Sha256 $A) -eq (Get-Sha256 $B)
}

# O que difere pelo CONTEUDO, dos dois lados: tamanho e data sao exatamente o que mentiu.
function Get-DiferencasDaCopia([string]$Origem, [string]$Copia) {
  $daOrigem = @(Get-ArquivosRelativos $Origem)
  $diferentes = @($daOrigem | Where-Object { -not (Test-ArquivoIgual (Join-Path $Origem $_) (Join-Path $Copia $_)) })
  $conhecidos = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($rel in $daOrigem) { [void]$conhecidos.Add($rel) }
  $sobrando = @(Get-ArquivosRelativos $Copia | Where-Object { -not $conhecidos.Contains($_) })
  return @($diferentes) + @($sobrando)
}

function Assert-CopiaIgual([string]$Origem, [string]$Copia) {
  $diferencas = @(Get-DiferencasDaCopia $Origem $Copia)
  if ($diferencas.Count) { throw ('copia diferente do pacote: ' + (($diferencas | Select-Object -First 5) -join ', ')) }
}

# Fechar o arquivo nao garante que ele chegou ao disco: sem isto, o reinicio zera o que o cache segurava.
function Write-NoDisco([string]$Arquivo) {
  $info = New-Object IO.FileInfo $Arquivo
  if ($info.IsReadOnly) { $info.IsReadOnly = $false }
  $fluxo = [IO.File]::Open($Arquivo, 'Open', 'ReadWrite', 'Read')
  try { $fluxo.Flush($true) } finally { $fluxo.Dispose() }
}

function Write-PastaNoDisco([string]$Pasta) {
  Get-ArquivosRelativos $Pasta | ForEach-Object { Write-NoDisco (Join-Path $Pasta $_) }
}

# Antivirus e indexador seguram pasta por instantes: novas tentativas antes de dar por falha.
function Move-ItemDoApp([string]$De, [string]$Para) {
  for ($restantes = 4; ; $restantes--) {
    try { Move-Item -LiteralPath $De -Destination $Para -Force; return }
    catch {
      if (-not $restantes) { throw }
      Start-Sleep -Milliseconds 500
    }
  }
}

# Volta o que uma troca interrompida deixou so em app.antigo. Vem antes de apagar qualquer coisa: a
# pasta pode ter a unica copia de um item, e o proximo passo a limpa.
function Restore-ItensGuardados([string]$App, [string]$Antigo) {
  if (-not (Test-Path -LiteralPath $Antigo)) { return }
  foreach ($item in @(Get-ChildItem -LiteralPath $Antigo -Force)) {
    $atual = Join-Path $App $item.Name
    if (-not (Test-Path -LiteralPath $atual)) { Move-ItemDoApp $item.FullName $atual }
  }
}

# Desfaz os itens trocados, do ultimo para o primeiro. $false: nem tudo voltou, e app.antigo fica.
function Undo-TrocaDoApp([string]$App, [string]$Antigo, [System.Collections.ArrayList]$Trocados) {
  $completo = $true
  for ($i = $Trocados.Count - 1; $i -ge 0; $i--) {
    $feito = $Trocados[$i]
    $atual = Join-Path $App $feito.Item
    try {
      if (Test-Path -LiteralPath $atual) { Remove-Item -LiteralPath $atual -Recurse -Force }
      if ($feito.Tinha) { Move-ItemDoApp (Join-Path $Antigo $feito.Item) $atual }
    } catch { $completo = $false }
  }
  return $completo
}

function Switch-ItensDoApp([string]$Novo, [string]$App, [string]$Antigo, [string[]]$Itens, [System.Collections.ArrayList]$Trocados) {
  foreach ($item in $Itens) {
    $atual = Join-Path $App $item
    $guardado = Join-Path $Antigo $item
    $tinha = Test-Path -LiteralPath $atual
    if ($tinha) { Move-ItemDoApp $atual $guardado }
    # Registra antes de colocar o novo: se esse passo falhar, o desfazer devolve o guardado.
    [void]$Trocados.Add(@{ Item = $item; Tinha = $tinha })
    Move-ItemDoApp (Join-Path $Novo $item) $atual
  }
}

function Assert-AppIgualAoPacote([string]$Src, [string]$App, [string[]]$Pastas, [string[]]$ArquivosDeTopo, [string[]]$Guias) {
  foreach ($d in $Pastas) {
    $origem = Join-Path $Src $d
    if (Test-Path -LiteralPath $origem) { Assert-CopiaIgual $origem (Join-Path $App $d) }
  }
  foreach ($f in $ArquivosDeTopo) {
    $origem = Join-Path $Src $f
    if ((Test-Path -LiteralPath $origem) -and -not (Test-ArquivoIgual $origem (Join-Path $App $f))) { throw "instalado diferente do pacote: $f" }
  }
  foreach ($doc in $Guias) {
    if (-not (Test-ArquivoIgual (Join-Path (Join-Path $Src 'docs') $doc) (Join-Path (Join-Path $App 'docs') $doc))) { throw "instalado diferente do pacote: docs/$doc" }
  }
}

function New-PastaNovaDoApp([string]$Src, [string]$Novo, [string[]]$Pastas, [string[]]$ArquivosDeTopo, [string[]]$Guias) {
  foreach ($d in $Pastas) {
    $origem = Join-Path $Src $d
    if (-not (Test-Path -LiteralPath $origem)) { continue }
    robocopy $origem (Join-Path $Novo $d) /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy $LASTEXITCODE em '$d'" }
    Assert-CopiaIgual $origem (Join-Path $Novo $d)
  }
  foreach ($f in $ArquivosDeTopo) {
    $origem = Join-Path $Src $f
    if (Test-Path -LiteralPath $origem) { Copy-Item -LiteralPath $origem -Destination (Join-Path $Novo $f) -Force }
  }
  # Allowlist de guias (decisao de 15/09/2026): guia que sai da lista nao fica na copia instalada.
  New-Item -ItemType Directory -Force -Path (Join-Path $Novo 'docs') | Out-Null
  foreach ($doc in $Guias) {
    $origem = Join-Path (Join-Path $Src 'docs') $doc
    if (-not (Test-Path -LiteralPath $origem)) { throw "Guia ausente na origem: docs/$doc" }
    Copy-Item -LiteralPath $origem -Destination (Join-Path (Join-Path $Novo 'docs') $doc) -Force
  }
  Write-PastaNoDisco $Novo
}

function Install-AppTransacional {
  param([string]$Src, [string]$App, [string[]]$Pastas, [string[]]$Arquivos, [string[]]$Avulsos = @(), [string[]]$Guias)
  $Novo = "$App.novo"
  $Antigo = "$App.antigo"
  $deTopo = @($Arquivos) + @($Avulsos)
  New-Item -ItemType Directory -Force -Path $App | Out-Null
  Restore-ItensGuardados $App $Antigo
  foreach ($sobra in @($Novo, $Antigo)) {
    if (Test-Path -LiteralPath $sobra) { Remove-Item -LiteralPath $sobra -Recurse -Force }
  }
  New-Item -ItemType Directory -Force -Path $Novo | Out-Null
  try { New-PastaNovaDoApp $Src $Novo $Pastas $deTopo $Guias }
  catch {
    Remove-Item -LiteralPath $Novo -Recurse -Force -ErrorAction SilentlyContinue
    throw
  }
  New-Item -ItemType Directory -Force -Path $Antigo | Out-Null
  $itens = @(Get-ChildItem -LiteralPath $Novo -Force | ForEach-Object { $_.Name } | Sort-Object { $_ -eq 'package.json' })
  $trocados = New-Object System.Collections.ArrayList
  try {
    Switch-ItensDoApp $Novo $App $Antigo $itens $trocados
    # A prova vem antes de jogar fora a versao anterior: se falhar, ainda ha para onde voltar.
    Assert-AppIgualAoPacote $Src $App $Pastas $deTopo $Guias
  } catch {
    $erro = $_
    if (Undo-TrocaDoApp $App $Antigo $trocados) {
      Remove-Item -LiteralPath $Antigo -Recurse -Force -ErrorAction SilentlyContinue
    } else {
      # Nunca apagar aqui: pode ser a unica copia. A proxima instalacao devolve o que faltar.
      Write-Warning "Parte da versao anterior ficou em $Antigo; a proxima instalacao a recupera."
    }
    Remove-Item -LiteralPath $Novo -Recurse -Force -ErrorAction SilentlyContinue
    throw $erro
  }
  Remove-Item -LiteralPath $Novo -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $Antigo -Recurse -Force -ErrorAction SilentlyContinue
}
