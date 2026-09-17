# Evidência: transferência e tomada pela tela

Branch `md/tela-transferencia`, cortada de `md/integracao` (`da736f5`). Desenho: quadros
`C8TransferenciaTomada` e `C5RadarFila`. Nada foi empurrado; nenhum serviço real foi tocado
(banco e identidade falsos, `FAROL_HOME` temporário).

| SHA | O quê |
|---|---|
| `e0d08e5` | andamento remoto com `matTag`, `heranca` e `pr` resolvido pelo catálogo; herança gravada na sessão |
| `e39f494` | destinos da transferência (rota nova), head da sessão na transferência, head atual na tomada, comando amarrado ao PR, motivo da espera |
| `62851f3` | tela: Transferir e Tomar utilizáveis, nota do comando no card, motivo da espera, lista de tomadas, CSS |
| `6e98bcb` | teste ponta a ponta entre dois engines com a tela real |
| `04f0f2a` | reforço antes das contraprovas; remoção de uma checagem de consentimento inalcançável |

## 1. O que passou a existir e de onde vem cada dado

| Campo ou rota | Fonte |
|---|---|
| `sync-live.operacoes[].matTag` | `sessao.headSha` (gravado pelo `runHeadlessReview`), virado tag em `lib/sync/andamento.js`; o SHA não sobe |
| `sync-live.operacoes[].heranca` (`integral`/`parcial`/`reinicio`/vazio) | `herdarCheckpoint`, gravado na sessão por `lib/engine/review.js` só quando a leitura aconteceu |
| `sync-live.operacoes[].pr: { key, account, title, author } \| null` | `prDaTag` (`lib/engine/sync-publicacao.js`) sobre `lerDoCatalogo`/`catalogoLru`; conta pelo mapeamento local owner para conta; `null` quando o catálogo não abre ou a linha não é da tag |
| catálogo publicado | `prsDoCatalogo` passou a incluir o PR de cada sessão viva, uma linha por chave |
| `POST /api/sync/transfer-targets` `{ dono, acctTag }` → `{ ok, destinos: [{ deviceId, nome, apto, motivo, souEu }], origem: { deviceId, motivo } }` | registro `rt.devices` e capacidade cifrada `live/deviceStatus` (uma leitura), avaliados por `motivoDoDestino`/`motivoDaOrigem` (`lib/sync/transferencia.js`), que reusam `destinoApto` do executor. Classe `leitura-sensivel` na A4 (69 para 70 rotas) |
| motivos de destino | `dono-atual`, `aposentado`, `versao-antiga`, `sem-chave`, `sem-sinal`, `sem-consentimento`, `pausado`, `sem-ia`, `sem-vaga`, `sem-credencial`, `memoria-desconhecida`, `memoria-baixa` |
| `sync.comandosEmitidos[].prTag`, `.prKey`, `.destino` | argumentos saneados do comando; `prKey` por `prDaTag` (vazio se não abre). Registro local, não sobe |
| `sync.distribuicao.esperando[].motivo` | `rt.motivosDaEspera`, anotado pelo agendador (admin) e pela recusa local, só para item que este aparelho publicou |
| Funções puras novas | `transferenciaDialogo`, `transferenciaConfirmacao`, `notaComandoHtml`, `tomadasFeitasHtml` (`ui/pure/compartilhado-posse.js`); `nomeDoAparelho` exportado |
| Tela | `transferirOperacao`, `#mdTomadasWrap`/`#mdTomadas`, `atualizarRecibos(lista, { forcar })` |

Defeitos reais corrigidos no caminho (sem afrouxar gate): a transferência lia o head em
`sessao.pr.headSha`, que nunca existe, e o candidato republicado saía sem head; a tomada
conferia `pr.headSha` de um PR da fila, que a busca não traz. Nos dois casos todo pedido real
voltava `head_mudou`. Agora o head vem da sessão (transferir) ou é perguntado agora
(`engine.headSha`, tomar); head desconhecido continua recusando. O executor ganhou uma recusa
a mais: destino com `aceitarAdmin === false` é `destino_inapto`. O fechamento do bloco CSS de
620 px da visão compartilhada, perdido no merge `4158305`, voltou.

## 2. Os quatro casos provados

Arquivo `test/sync-transferencia-tela.test.js` (admin e origem como dois `Engine`, tela real
no DOM de mentira, `fetch` da tela indo ao servidor HTTP do admin):

1. **Elegível e utilizável**: "transferir pela tela: botão habilitado, corpo exato, a origem
   aplica e a tela lê o recibo" e "tomar pela tela: aviso lido do lease real, confirmação, o
   admin aplica e registra o recibo". Corpos exatos: `{ dono, acctTag }`,
   `{ alvo: origem, tipo: 'transferir', args: { prTag, matTag, destino } }`,
   `{ prKey, account }`, `{ alvo: admin, tipo: 'tomar', args: { prTag, matTag, confirmado: true } }`.
2. **Inelegível com motivo**: "a rota de destinos lista quem pode receber, e cada inapto com o
   motivo certo", "destino sem consentimento, pausado, sem credencial ou com memória
   desconhecida é inapto", "a origem que não aceita comandos aparece como tal, e a tela não
   oferece o envio", "escolha forjada fora da lista de aptos não sai".
3. **Ponta a ponta com recibo**: os dois casos do item 1 terminam com `cicloDosComandos` no
   executor e `aplicado` lido pela tela.
4. **Estado muda entre seleção e execução**: "o head muda depois da seleção" (`head_mudou`),
   "o destino perde o consentimento depois da seleção" (`destino_inapto`), "o head muda antes
   da tomada" (`head_mudou`, também com head que não dá para perguntar); a tela mostra a recusa.

Também: dado que chega (commit, tags, `pr`, `pr` nulo sem catálogo e com linha de outro PR),
o relógio entregando o `pr` resolvido. Unitários de tela em `test/ui-radar-compartilhado.test.js`
(6 casos novos) e puros em `test/ui-pure-compartilhado-posse.test.js` (12 casos); motivo da
espera em `test/sync-distribuicao.test.js` (2 casos); projeção em `test/sync-andamento.test.js`;
fiação da herança em `test/sync-checkpoint-remoto.test.js` (leitura do fonte, como o caso vizinho).

Testes antigos ajustados, declarados nos commits: chaves congeladas da projeção do andamento;
`prKey`/`account` soltos na operação (o engine nunca mandou) viraram `op.pr`; o caso que
afirmava "transferir sempre indisponível" passou a afirmar "indisponível sem permissão";
contagem do inventário 69 para 70.

Ciclo vermelho: `verificacoes-saidas/tela-transferencia-vermelho.txt` (25 de 25 vermelhos antes
da implementação).

## 3. Contraprovas por mutação

Script `verificacoes-saidas/tela-transferencia-mutacoes.cjs` (limite de 4 minutos por rodada de
teste, restauração conferida por sha256).

- Rodada 1 (`tela-transferencia-mutacoes-1.txt`): 45 mutações, 44 reprovaram, **1 inerte**
  (N41, "tela sem confirmação"). A inércia era da MUTAÇÃO, não da asserção: `!true || !await
  confirmar(...)` ainda chama a confirmação. Corrigida para `false && ...`.
- Rodada 2 (`tela-transferencia-mutacoes-2.txt`): N41 reprovou (4 casos).
- Antes da rodada 1, três pontos que seriam inertes foram reforçados (`04f0f2a`): relógio lendo
  cru, destinos sem ordenação (a frota do teste punha o apto primeiro) e tomada com head
  impossível de perguntar; e uma checagem inalcançável foi removida em vez de testada.
- Todas as 45 restauradas byte a byte; a árvore de código terminou limpa.

## 4. Gates

| Rodada | Código | Comando | Resultado | Saída |
|---|---|---|---|---|
| 1 | árvore de `62851f3` antes do commit | `npm run check` / `npm run lint` | 0 / 0 | (terminal) |
| 1 | idem | `npm test` | **1**: 4134 testes, 4104 passam, 2 falham, 28 pulados | `tela-transferencia-test-1.txt` |
| 1 | idem | os dois arquivos isolados | 0: 20 passam | `tela-transferencia-isolado-1.txt` |
| 2 | `04f0f2a` | `npm run check` | 0, 554 arquivos | `tela-transferencia-check-2.txt` |
| 2 | idem | `npm run lint` | 0, sem regressão | `tela-transferencia-lint-2.txt` |
| 2 | idem | `npm test` | 0: 4135 testes, 4107 passam, 0 falham, 28 pulados (15610 MB livres) | `tela-transferencia-test-2.txt` |

As falhas da rodada 1 foram `test/session-unsee-on-exit.test.js` (tempo esgotado esperando
processo real) e `test/sync-pendencias-remoto.test.js` (login do motor sob carga); nenhum dos
dois toca esta entrega, e os dois passaram isolados e na rodada 2.

## 5. Divergências da evidência da tela do Radar

| # | Situação |
|---|---|
| 2 Transferir indisponível | **Resolvida**: commit no andamento, rota de destinos com motivo, envio e recibo |
| 3 Tomar indisponível na prática | **Resolvida**: `op.pr` pelo catálogo e head atual no executor |
| 4 Comando sem PR no card | **Resolvida**: `prTag`/`prKey`/`destino` no emitido e `notaComandoHtml` no card; só amarra quando o catálogo resolveu |
| 5 Motivo da espera | **Resolvida em parte**: o motivo chega quando ESTE aparelho sabe (agendador no admin, recusa local). Aparelho que publicou e não é admin não conhece o veredito do agendador, porque o relatório dele não é publicado (`cicloDoAgendador` só devolve `relatorio` ao chamador); levar isso exige nó novo de sincronização, fora do escopo. O detalhe por aparelho ("o Notebook está sem vaga") também não é derivado: `escolha.aparelhosPara` filtra sem dizer por quê |
| 9 Herança da memória | **Resolvida**: `heranca` na operação do destino. O "lote 4 de 13" do envio segue sem dado |
| 10 Histórico de tomadas | **Resolvida**: lista "Tomadas feitas por este aparelho" a partir de `sync.tomadas` |

Fora desta entrega: `repetir` no executor tem o mesmo defeito de `pr.headSha` da fila que a
tomada tinha (não pedido aqui). Na main e em `md/integracao`, `ui/app.css` tem um `}` a mais por
volta da linha 1233 (o bloco de 620 px das telas antigas fecha na 1212), anterior a esta frente.
Sem jornada visual: nenhuma instância do app subiu.
