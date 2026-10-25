# Comparação nativa da interface

Execute com um binário Electron de teste, nunca com a instalação em uso:

```powershell
$proc = Start-Process -FilePath '<runtime-isolado>/electron.exe' -ArgumentList @(
  'tools/benchmark-ui-native.js',
  '--baseline', '<checkout-anterior-completo>',
  '--target', '<checkout-da-entrega>',
  '--output', '<evidencias>/ui-native-comparacao.json'
) -WindowStyle Hidden -PassThru -Wait
$proc.ExitCode
```

O binário carrega a interface completa e seus assets de cada checkout por HTTP/SSE
em loopback, com partições de sessão e dados inteiramente sintéticos. Não inicia
o engine, os provedores, o autostart nem processos da instalação do usuário. Uma
sonda com domínio `.invalid` confirma o bloqueio anterior à requisição externa.

O traço contém 12 PRs na fila, 20 no panorama, um PR próprio e seis relatórios de
20 itens. Compara lote de 100 deltas, oito deltas espaçados em 120 ms, três em um
segundo, configuração e PR em abas ocultas, foco e rascunho sob atualizações,
ação de salvar e checar, ocultação e retorno reais da janela e 1.500 atividades.
As duas cadências exercitam atualizações frequentes e lentas; não representam
uma distribuição medida da carga de uso do usuário.

As asserções confirmam o estado final equivalente, a projeção ao abrir abas,
os corpos das ações e a ausência de erros de página. A entrega também precisa
preservar o rascunho e suspender as seções ocultas. Diferenças de comportamento
do baseline, como perda de rascunho, ficam registradas em vez de serem ocultadas.

O JSON identifica SHA dos checkouts, alterações locais observadas, hashes dos
arquivos servidos e ferramentas, runtime, arquitetura e configuração. O hash do
manifesto e a conferência dos arquivos durante cada medição permitem atribuir o
resultado mesmo quando outros colaboradores trabalham no checkout da entrega.

Contagens são atribuições de `innerHTML` em cinco contêineres, não todos os
mutations do DOM. Duração inclui esperas deliberadas e não é tempo exclusivo de
CPU. Os snapshots brutos de `app.getAppMetrics()` referem-se ao renderer isolado:
memória está em KiB, CPU cumulativa em segundos; a porcentagem nativa usa sua
própria janela de amostragem. Uma execução com ordem fixa não permite estimar
economia percentual de CPU/RAM, custo do engine, GPU ou carga real de reviews.
O sandbox temporário contém somente a sessão sintética e é identificado no JSON.
