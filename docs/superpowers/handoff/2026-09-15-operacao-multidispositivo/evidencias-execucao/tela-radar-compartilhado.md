# Evidência: a visão compartilhada no Radar

Branch `md/tela-radar`, cortada de `md/integracao` (`e9f8183`). Desenho de referência: quadros
`C5RadarFila`, `C3RadarCompartilhado`, `C8TransferenciaTomada`, `C3Historico`, `CelRadar` e
`CelTomada` em `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-anexos/B2-design/quadros/`.
Brief: itens 2.7, 2.8, 2.9 e 2.11 e seção 5 de `B2-brief-claude-design.md`.

Commits:

| SHA | O quê |
|---|---|
| `73eb777` | engine: o comando emitido guarda o prazo gravado no nó (`vence`) |
| `89b4603` | funções puras (`ui/pure/compartilhado.js`, `ui/pure/compartilhado-historico.js`, extensão de `prCoordNoteHtml`) |
| `bc54fcc` | tela (`ui/telas/radar-compartilhado.js`), contêineres no `ui/index.html`, repasse dos eventos SSE no `connect()`, CSS |
| `2778e60` | reforço das duas contraprovas que ficaram inertes na primeira rodada |

Não houve jornada visual: por instrução, o navegador embutido não foi usado e nenhuma
instância do app subiu. A jornada fica com quem coordena.

## 1. O que foi feito, por item do brief

### 2.7 Visão compartilhada

| Peça | Onde | Fonte do dado |
|---|---|---|
| Só aparece com a visão valendo | `visaoCompartilhada` (três estados: `ligada`, `bloqueada`, `desligada`); a tela esconde `#mdCompartilhado` e `#mdHistorico` fora de `ligada` | `sync.shared`, `sync.bloqueioCompartilhamento` |
| Bloqueada pelo Farol aparece como bloqueada | `compartilhadoBloqueioHtml`, faixa no topo do Radar com o motivo e `data-goto="sys:sync"` | `sync.bloqueioCompartilhamento` |
| Precisa de você em todos os aparelhos | `pendenciasCompartilhadasHtml`: aparelho dono, veredito, quantidade de motivos, bloqueio, selo "nova" e "visto"; toast quando chegam novas | evento SSE `sync-pending` (`{ pendencias, novas }`) |
| Marcar como visto | `marcarVisto` manda `POST /api/sync/seen` `{ itemId }`; falha vira toast e o card NÃO muda | rota existente |
| Em outros aparelhos | `operacoesRemotasHtml`: aparelho, tipo, etapa (vocabulário fechado), tempo somado, subagentes, modelo, selo "sem renovar" para nó vencido | evento SSE `sync-live` (`{ operacoes }`) |
| Leitura atrasada | `andamentoAtrasado`/`andamentoAtrasadoHtml`: passados 45 s do último `sync-live`, a faixa diz a hora da última leitura e a visão anterior continua na tela; a tela reavalia a cada 10 s | instante de chegada do evento |
| Revisões de todos os aparelhos | `revisoesCompartilhadasHtml` com origem (este ou nome do aparelho), veredito, desfecho, escopo "Todos os aparelhos"/"Só este"; carregando, falha e vazio com frases diferentes | `POST /api/sync/reviews` `{ dev }` |
| Corpo sob demanda | `revisaoAbertaHtml` num diálogo; falha da chamada e corpo que não abriu são frases diferentes; PR em claro do corpo vira `prRefMention` | `POST /api/sync/review-body` `{ reviewId }` |
| Envio do histórico local | `envioHistoricoHtml` e `envioDepoisDoLote`: inicial, medindo, medido (com número, tamanho cifrado medido e aviso de volume grande acima de 5 MB), enviando (progresso acumulado), mudou desde a medida, interrompido (com "Continuar"), concluído, nada a enviar, falha | `POST /api/sync/history-measure`, `POST /api/sync/history-send` `{ impressao }` |
| O que é local | `oQueELocalHtml`: Destaques, Kudos e Time não sobem nem descem | texto fixo |

O envio manda a MESMA impressão em todo lote e para no primeiro lote que não sobe nada: o
engine responde `ok` com zero enviados quando o primeiro item do lote falha, e sem essa
guarda a tela giraria para sempre.

### 2.8 Distribuição e fila global

| Peça | Onde | Fonte do dado |
|---|---|---|
| Faixa do modo | `modoDistribuicaoHtml`, só com `config.sync.distribution.enabled === true` e a visão valendo: `distribuido` (nome do distribuidor, ou "este aparelho distribui"), distribuidor sem sinal (admin conhecido com `fresca !== true`: aviso da janela de até três giros), `local` (volta aos poucos), modo vazio ("ainda não decidido", como estado); quantos PRs esperam colocação | `sync.distribuicao.modo`, `sync.distribuicao.esperando`, `sync.admin` |
| Nota por PR esperando distribuição | `notaDistribuicaoHtml`, somada por `prCoordNoteHtml` no card da fila, com o tempo de espera | `sync.distribuicao.esperando[{ key, desde }]` |

### 2.9 Comandos remotos, transferência e tomada

| Peça | Onde | Fonte do dado |
|---|---|---|
| Quem pode comandar | `comandoPermitido`: sem admin conhecido, admin que não é este aparelho e admin sem sinal fresco têm motivos diferentes; sem permissão, o card mostra o motivo em vez do botão | `sync.admin` |
| Decidir no aparelho dono | diálogo com "Aprovar" e "Pedir mudanças"; só `approve`/`reject` saem; `POST /api/sync/command` `{ alvo: dev, tipo: 'decidir', args: { itemId, acao } }` | `lib/sync/comando.js` (`decidirDe`) |
| Cancelar | confirmação antes; `{ alvo: dev, tipo: 'cancelar', args: { prTag } }` | `cancelarDe` |
| Tomar | `acoesDaOperacao` só libera com commit (`matTag`) e PR em claro (`prKey`, `account`); o aviso (`POST /api/sync/takeover-notice`) é lido ANTES; `tomadaDialogo` mostra o texto do engine e o risco; só a confirmação manda `{ alvo: este aparelho, tipo: 'tomar', args: { prTag, matTag, confirmado: true } }`; aviso que diz "nada a tomar" não vira comando | `tomarDe`, `avisoDaTomada` |
| Transferir | indisponível, com o motivo escrito no card (ver divergências) | |
| Comandos enviados | `comandosEmitidosHtml` com `reciboEstado`: recibo `aplicado`, `recusado` e `ignorado` com o porquê traduzido (código desconhecido aparece cru), `pendente`; sem recibo, só `enviado` (com o prazo) ou `vencido`; consulta de recibo que falhou aparece como tal; a consulta para quando o recibo é final | `sync.comandosEmitidos`, `POST /api/sync/command-status` `{ cmdId }` |
| Prazo do comando | o registro do emitido ganhou `vence`, que é o `ttl` gravado no nó (commit `73eb777`); a tela não recalcula TTL | `lib/engine/sync-comandos.js`, `lib/engine/sync-telas.js` |
| Tomada sofrida | `notaTomadaSofridaHtml` no card da fila: quem tomou, quando, geração, e que nada será postado daqui | `sync.tomadasSofridas[{ prKey, para, geracao, at }]` |

### 2.11 Postagem coordenada e retomada

Nada novo nesta entrega. Os estados de postagem incerta, não enviada e retomada já moram no
card da fila e no estacionamento (`parkedNoteHtml`, `staleCardMeta`), e o desenho do C5 não
pede dado que o snapshot não tenha. O card da fila continua com o estacionamento vencendo a
nota de coordenação, como antes.

### Fiação

- `connect()` do `ui/app.js` escuta `sync-live` e `sync-pending` e só repassa a
  `aoAndamentoRemoto`/`aoPendenciasRemotas`. O servidor já repassava os dois eventos
  (`lib/http-server.js`, travado em `test/sync-andamento-remoto.test.js`); nada mudou lá.
- A tela registra com `registrarTela({ id: 'radar-compartilhado', aoEstado })` por chamada
  explícita depois de `registrarTelaConsumo()`. Registrar no import a poria antes de
  `sistema`; a ordem travada em `test/app-carrega.test.js` passou a incluir a tela nova no fim.
- Diálogos: `confirmModal` para cancelar; para decidir, tomar e ler revisão, um diálogo com
  opções na anatomia de `.modal-card` (`escolherModal`, dentro da tela).
- CSS apendado ao fim de `ui/app.css`, só com tokens existentes, quebras 860, 720 e 620, alvo
  de 44 px no estreito e quebra de linha em vez de rolagem horizontal.

## 2. Divergências entre desenho e contrato (a tela não inventou)

1. **PR sem nome em "Precisa de você" e "Em outros aparelhos".** Os quadros mostram
   `acme-exemplo/app-web#37`, título e autor. A pendência e o andamento viajam com o PR como
   TAG (`lib/sync/pendencia.js`, `lib/sync/andamento.js`), e a tela não tem a chave para
   resolver a tag. A tela diz "um PR seu, analisado no X" e explica que o endereço não viaja.
   O catálogo cifrado existe no engine (`catalogoLru`), mas não é projetado para a tela.
2. **Transferir sempre indisponível.** O comando exige `matTag` e o destino; o andamento não
   traz o commit, e o snapshot não traz a capacidade dos outros aparelhos (`devices` tem nome,
   sistema, versão e datas), então não há lista de destinos com motivo de inaptidão honesta.
   O card escreve o motivo no lugar do botão.
3. **Tomar indisponível na prática.** A fiação existe e está testada (aviso antes, confirmação,
   `confirmado: true`), mas `acoesDaOperacao` só a libera com `matTag`, `prKey` e `account`,
   que o andamento remoto não traz. Mesmo motivo escrito no card.
4. **Comando sem PR no card da fila.** O quadro C5 mostra "Comando enviado ao Desktop antigo:
   cancelar" dentro do card de um PR. O registro `comandosEmitidos` tem só `cmdId`, `tipo`,
   `alvo`, `at` (e agora `vence`), sem o PR. Os comandos aparecem numa lista própria
   ("Comandos enviados"), nunca amarrados a um card por palpite.
5. **Motivo da espera da distribuição.** O quadro C5 diz "nenhum aparelho apto agora (o
   Notebook de teste está sem vaga)". `distribuicao.esperando` traz só `key` e `desde`. A nota
   diz há quanto tempo o PR espera e que o motivo não chega à tela. Pelo mesmo motivo, os
   estados "sem executor apto", "aparelho pausado", "memória desconhecida", "recusa por peso"
   e "recusa do executor com código" do C5 ficaram de fora do Radar.
6. **Panorama e Meus PRs de outros aparelhos (item 5 do pedido): fora.** `lerEscopo`
   (`lib/engine/sync-escopo.js`) existe, mas ninguém o chama e o snapshot não traz linha de
   outro aparelho. Os quadros "deste aparelho e de 1 outro" e "do Desktop antigo, só
   leitura" não foram implementados.
7. **Falha da lista de revisões pode chegar como vazio.** `lerRecentes` devolve `[]` quando a
   leitura do banco falha, e a rota responde `{ ok: true, revisoes: [] }`. A tela separa
   carregando, falha da CHAMADA e vazio, mas não consegue separar "o banco falhou" de "não há
   revisões". O item "1 revisão não abriu" do C3Historico também não tem contagem no contrato.
8. **Leitura atrasada é pela idade, não pela falha.** O engine não emite evento quando a
   leitura do andamento falha (a visão anterior é mantida em silêncio). A tela afirma só o que
   sabe: a idade da última leitura recebida.
9. **Herança da memória na transferência** (integral, parcial, reinício) e o "lote 4 de 13"
   do envio não têm dado no contrato da tela; o envio mostra enviadas e faltando.
10. **Histórico de tomadas feitas** (`sync.tomadas`) não foi desenhado no Radar nesta entrega:
    o quadro C8 o põe numa lista própria, e só a tomada sofrida tem lugar óbvio (o card).

## 3. Testes

- `test/ui-pure-compartilhado.test.js` (34 casos): visão e bloqueio, faixa do modo em todos os
  modos e sem o interruptor, notas por PR e a soma em `prCoordNoteHtml`, `comandoPermitido`,
  pendências (vazio, nova, vista, sem permissão, PR não nomeado, escape), operações (etapa,
  tempo, subagentes, nó vencido, ações indisponíveis com motivo), leitura atrasada, recibos
  (sem recibo nunca concluído, vencido, códigos, consulta que falhou, final), aviso da tomada,
  revisões (três estados, origem, escopo, corpo), envio (todas as fases e o acúmulo de lotes).
- `test/ui-radar-compartilhado.test.js` (22 casos): carrega o `ui/app.js` inteiro contra o DOM
  de mentira; visibilidade ligada, bloqueada, desligada e sem projeção; `sync-live` e
  `sync-pending` chegando pelo bootstrap; leitura do trecho de `connect()` (só o corpo da
  função); corpo exato de cada rota (visto, decidir, cancelar, aviso da tomada, tomar, medir,
  enviar) e ausência de chamada antes da confirmação ou sem permissão.
- `test/contrato-telas.test.js`: o `vence` do emitido é o `ttl` do nó no banco falso.
- `test/ui-pure-superficie.test.js`: 20 nomes novos na lista congelada.
- `test/app-carrega.test.js`: a ordem de registro travada inclui `radar-compartilhado` no fim.

## 4. Contraprovas por mutação

Script: `verificacoes-saidas/tela-radar-mutacoes.cjs`. Cada mutação é aplicada na cópia de
trabalho, o teste que a guarda roda, e o arquivo volta byte a byte (sha256 conferido).

Rodada 1 (`verificacoes-saidas/tela-radar-mutacoes-1.txt`): 19 de 21 reprovaram; **2 inertes**:

- M15 (tirar a tomada sofrida de `prCoordNoteHtml`): o teste da soma só conferia a nota da
  distribuição. Reforço: o mesmo teste confere a tomada sofrida pela boca única.
- M17 (enviar com medida sem impressão): o teste usava medida nula, que outra guarda já pega.
  Reforço: caso novo com medida `ok` e sem impressão.

Rodada 2 (`verificacoes-saidas/tela-radar-mutacoes-2.txt`): **21 de 21 reprovaram**, todas
restauradas byte a byte.

| Mutação | Garantia |
|---|---|
| M1, M8 | bloqueada nunca aparece como ligada (pura e tela) |
| M2, M3 | sem recibo nunca vira aplicado; vencido existe |
| M4 | falha da lista não vira vazio |
| M5, M6, M10 | tomar exige aviso, confirmação, commit e PR em claro |
| M7, M20 | o bootstrap repassa `sync-live` e `sync-pending` |
| M9 | lote vazio interrompe o envio |
| M11, M19 | só o admin com sinal fresco comanda |
| M12 | o prazo do comando vem do nó |
| M13 | faixa só com a distribuição pedida |
| M14 | cancelar pede confirmação |
| M15 | tomada sofrida chega ao card |
| M16 | decidir só com `approve`/`reject` |
| M17 | enviar só com a impressão da medida |
| M18 | leitura velha aparece como atrasada |
| M21 | visto que falha não finge ter marcado |

## 5. Gates

| Rodada | Código | Comando | Resultado | Saída |
|---|---|---|---|---|
| 1 | `bc54fcc` (antes dos commits, mesma árvore) | `npm run check` | 0, 541 arquivos | `tela-radar-check-1.txt` |
| 1 | idem | `npm run lint` | 0, sem regressão | `tela-radar-lint-1.txt` |
| 1 | idem | `npm test` | 0: 4013 testes, 3985 passam, 0 falham, 28 pulados | `tela-radar-test-1.txt` |
| 2 | `2778e60` | `npm run check` | 0, 541 arquivos | `tela-radar-check-2.txt` |
| 2 | idem | `npm run lint` | 0, sem regressão | `tela-radar-lint-2.txt` |
| 2 | idem | `npm test` | **1**: 4014 testes, 3983 passam, **3 falham**, 28 pulados | `tela-radar-test-2.txt` |
| 2 | idem | os dois arquivos isolados | **1**: 26 passam, 3 falham | `tela-radar-isolado-memoria.txt` |
| 3 | idem | `npm test` (repetida uma vez) | **1**: 4014 testes, 3985 passam, **1 falha**, 28 pulados | `tela-radar-test-3.txt` |
| 3 | idem | os dois arquivos isolados | 0: 29 passam | `tela-radar-isolado-memoria-2.txt` |
| 4 | `15ce282` (esta evidência) | `npm run check` | 0, 541 arquivos | `tela-radar-check-4.txt` |
| 4 | idem | `npm run lint` | 0, sem regressão | `tela-radar-lint-4.txt` |
| 4 | idem | `npm test` | 0: 4014 testes, 3986 passam, 0 falham, 28 pulados (5823 MB livres) | `tela-radar-test-4.txt` |

**As falhas das rodadas 2 e 3 não são desta entrega e dependem da memória livre da máquina.**
Os casos são `test/sync-consumo-grupo-remoto.test.js` ("outra conta, sem teto de grupo que a
segure, continua saindo") e `test/sync-device-status.test.js` ("a capacidade leva o resumo da
admissão" e "a RAM viaja em faixa"). A admissão mede a memória pelo MENOR entre
`os.freemem()` e `process.availableMemory()` (`lib/engine/admissao.js`, `memoriaLivreMb`), com
piso de 1024 MB (`SYNC.PISO_MEMORIA_MB`). O teste da faixa troca só `os.freemem`, e a outra
medida continua sendo a real. Medido: 1031 MB livres logo depois da rodada 2 (a primeira
falha diz `memoria-insuficiente`), 2699 MB antes da rodada 3 e 5443 MB quando os dois arquivos
passaram isolados. Nenhum dos três arquivos toca o que esta entrega mudou (o diff em `lib/` é
só o `vence` do comando emitido), e os três passaram na rodada 1.

## 6. Rodada final

A rodada 4, com a máquina folgada (5823 MB livres), fecha verde nos três gates, e é a
confirmação de que as falhas das rodadas 2 e 3 eram da memória livre, não da entrega.
