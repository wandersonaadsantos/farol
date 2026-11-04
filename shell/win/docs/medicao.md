# Medição de memória da casca Windows

Critério do desenho para o Windows (seção 8, item 0, decisão do dono): medir e
registrar a memória da casca nativa ao lado do Electron. Não há meta numérica
que reprove; o número fica registrado para a comparação.

**A medição NÃO foi feita.** A casca foi escrita num Mac, onde o `Farol.App`
não compila nem roda. A tabela abaixo está vazia de propósito e deve ser
preenchida numa máquina Windows, no mesmo dia para as duas versões.

## Método

- **Processos medidos**: `Farol.exe` (a casca), `node.exe` do motor e todos os
  filhos dele (as sessões do `gh`, do `claude` e afins que estiverem vivas), e
  `msedgewebview2.exe` com todos os filhos (o WebView2 abre vários processos:
  navegador, renderizador, GPU, utilitários). Do lado do Electron: `Farol.exe`
  do Electron com todos os filhos (navegador, renderizador, GPU) e o `node.exe`
  do motor com os filhos.
- **Métrica**: memória privada comprometida (private commit), em MB: o
  `PrivateMemorySize64` do `Get-Process`, que é a coluna "Private Bytes" do
  Process Explorer, usada como conferência. Não é o Working Set privado
  (a parte residente); se quiser também esse número, é a coluna "Private WS" do
  Process Explorer, registrada à parte.
- **Um Farol só**: feche o Electron antes de medir a casca nativa, e o
  contrário. O comando procura processos chamados `Farol`, e com os dois
  abertos somaria os dois.
- **Condição**: o Farol aberto com as contas reais, a janela mostrada uma vez e
  depois parado (sem clicar, sem revisão em curso) por 10 minutos antes da
  primeira leitura.
- **Leituras**: três, com um minuto entre elas. Na tabela vai cada leitura e a
  mediana das três.
- **Mesmo dia, mesma máquina**: a linha do Electron é medida no mesmo dia, com
  as mesmas contas, pelo mesmo método.

## Comando

Cole no PowerShell (não precisa de administrador). Ele soma, por grupo,
a memória privada comprometida de cada processo e de todos os descendentes.

```powershell
$todos = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
function Descendentes($ids) {
  $saida = @($ids)
  $fila = @($ids)
  while ($fila.Count -gt 0) {
    $filhos = @($todos | Where-Object { $fila -contains $_.ParentProcessId } | ForEach-Object ProcessId)
    $filhos = @($filhos | Where-Object { $saida -notcontains $_ })
    $saida += $filhos
    $fila = $filhos
  }
  $saida
}
function PrivadoMB($ids) {
  $soma = 0
  foreach ($id in $ids) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p) { $soma += $p.PrivateMemorySize64 }
  }
  [math]::Round($soma / 1MB, 1)
}
$casca = @(Get-Process -Name Farol -ErrorAction SilentlyContinue | ForEach-Object Id)
$arvore = Descendentes $casca
$node = @($todos | Where-Object { $arvore -contains $_.ProcessId -and $_.Name -eq 'node.exe' } | ForEach-Object ProcessId)
$webview = @($todos | Where-Object { $arvore -contains $_.ProcessId -and $_.Name -eq 'msedgewebview2.exe' } | ForEach-Object ProcessId)
$nodeArvore = Descendentes $node
$webviewArvore = Descendentes $webview
[pscustomobject]@{
  'Farol.exe'                   = PrivadoMB $casca
  'node.exe e filhos'           = PrivadoMB $nodeArvore
  'msedgewebview2.exe e filhos' = PrivadoMB $webviewArvore
  'total'                       = PrivadoMB $arvore
}
```

No Electron, o mesmo comando serve: o `Farol.exe` é o do Electron, o grupo do
WebView2 sai vazio e os processos do Chromium entram no total.

## Resultado

A preencher no Windows.

Valores em MB de memória privada comprometida.

| processo | leitura 1 | leitura 2 | leitura 3 | mediana |
|---|---|---|---|---|
| `Farol.exe` (casca nativa) | a preencher no Windows | | | |
| `node.exe` do motor e filhos | a preencher no Windows | | | |
| `msedgewebview2.exe` e filhos | a preencher no Windows | | | |
| total da casca nativa | a preencher no Windows | | | |
| referência: Electron (total, mesmo dia) | a preencher no Windows | | | |

Registre também a data, a versão da casca, a versão do Electron, a versão do
WebView2 Runtime e o número de contas monitoradas.
