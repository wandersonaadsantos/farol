# Evidência: Panorama e Meus PRs remotos, e a identificação dos PRs

Branch `md/tela-escopo-remoto`, cortada de `md/integracao` (`da736f5`). Fecha as divergências
1, 6, 7 e 8 de `tela-radar-compartilhado.md`, e o "lote N de M" do quadro `C3Historico`.

Commits:

| SHA | O quê |
|---|---|
| `3cdcf34` | engine: leitura das listas remotas, PR nomeado nas pendências, falha que é falha |
| `9d3e0ef` | funções puras (`ui/pure/listas-remotas.js`, `ui/pure/pr-compartilhado.js`) |
| `c714f92` | tela (`ui/telas/listas-remotas.js`), contêineres, fiação do SSE e CSS |
| `ee160f4` | ajuste declarado de três travas antigas |
| `5891a13` | reuso do `prDaTag` da frente de transferência e reforço de contraprova |
| `cf21ce6` | uma guarda só para a busca inicial (a mutação M27 era equivalente) |
| `11a8c36` | "lote N de M" no envio do histórico |

Sem jornada visual: nenhuma instância do app subiu, por instrução. A jornada fica com quem
coordena.

## 1. O que passou a existir, e a fonte de cada dado

### Panorama e Meus PRs de outros aparelhos (divergência 6)

| Peça | Onde | Fonte do dado |
|---|---|---|
| Leitura por conta, no relógio | `lib/engine/sync-listas.js` (`lerListasRemotas`), chamado no `ciclo` depois de `publicarEscopos` | ponteiro `live/rev/{tipo}/{escopo}`, metas `panoramaMeta`/`myPrsMeta` e `lerEscopo` incremental (`desdeU`) |
| Origem da linha | `dev` do meta do escopo (um publicador por conta) e o nome em `rt.devices[dev].name` | `{tipo}Meta/{escopo}` |
| Só leitura | `somenteLeitura` da linha e a nota "Merge desabilitado aqui" | `lerEscopo` (Meus PRs) |
| Dedup | `mesclarListaRemota` (`ui/pure/listas-remotas.js`): chave em minúsculas, o PR local vence, e entre remotos vale a linha com o `u` maior | projeção + lista local da aba |
| Filtros das abas | a aba passa o filtro que já aplica: Panorama manda `scopeVisible`, Meus PRs manda `scopeVisible` mais os ocultos efetivos | `ui/telas/radar.js`, `ui/telas/meus-prs.js` |
| Contagem sem dobra | `#panoCount` e `#myPRsCount` somam locais + remotas que o filtro deixou | telas |
| Indisponível | `estadoDasListas`: desligada, bloqueada, aguardando, indisponível (`sem-frota`, `sem-chave`, `sem-credencial`) | `sync.shared`/`bloqueioCompartilhamento` e `listas.estado` (código do `podePublicar`) |
| Desatualizado | `estadoDoEscopo`: leitura boa mais velha que `limiteMs`, ou publicador cuja confirmação venceu | `lidoEm`, `confirmadoAte` (o `x` do meta) e `SYNC.LISTAS_IDADE_MAX_MS` |
| Leitura que falhou | escopo em `falhou`, com `falhaEm` e a visão anterior preservada | `lerEscopo` com `ok: false` |
| Linha que não abriu | `naoAbriram` por escopo, somado na tela ("não verificável") | `lerEscopo` |
| Transporte | evento SSE `sync-lists` (quando a projeção muda, e a cada `SYNC.LISTAS_BATIMENTO_MS`) e `POST /api/sync/lists` na abertura | `lib/engine/sync-listas.js`, `lib/http-server.js` |

Escopo por conta: as contas lidas são as de `accountList()` deste aparelho, porque a tag do
escopo (`acctTag`) exige o login em claro. **Conta que só existe no outro aparelho não é
lida**, e isso está declarado aqui, não escondido na tela.

O escopo cujo publicador é ESTE aparelho não vira linha remota (estado `local`): as linhas
dali são as mesmas que a aba já mostra.

### Identificação dos PRs (divergência 1)

- O engine resolve a tag pelo catálogo cifrado com `prDaTag(engine, cfg, tag)`
  (`lib/engine/sync-publicacao.js`), a MESMA função que a frente `md/tela-transferencia`
  criou para as operações: o trecho entrou aqui idêntico ao dela, e o módulo próprio que eu
  tinha escrito (`sync-identificacao.js`) foi removido no `5891a13`, para a integração não
  ter duas funções com o mesmo papel.
- As pendências passam a levar `pr: { key, account, title, author } | null`
  (`aplicarPendenciasIdentificadas`, usado no relógio). `lerPendencias` nasce com `pr: null`,
  e um campo `pr` plantado dentro do item cifrado é ignorado.
- O catálogo publicado passou a incluir o PR das pendências e o das sessões vivas (uma linha
  por chave), senão a tag da pendência nunca teria nome.
- A tela usa uma função pura única, `prIdentificadoHtml(pr, generico)`
  (`ui/pure/pr-compartilhado.js`), nos DOIS blocos: "Precisa de você em todos os aparelhos" e
  "Em outros aparelhos". Com nome: menção navegável (`prRefMention`), título e autor
  (`personMention`). Sem nome: o rótulo genérico, que diz que o catálogo não abriu aqui.

### Revisões: falha é falha (divergência 7)

`lerRecentes` devolve `null` quando a leitura do banco falha (antes devolvia `[]`), e a rota
`POST /api/sync/reviews` responde `{ ok: false, code: 'indisponivel', motivo }`. Banco sem
revisão continua sendo `{ ok: true, revisoes: [] }`. A tela já separava "carregando", "falha
da chamada" e "vazio", e agora a falha do banco cai na frase de falha.

Fora desta entrega: a contagem de "1 revisão não abriu" do C3Historico. `lerRecentes`
descarta o índice que não decifra sem contar, e expor a contagem muda o retorno da função
(hoje um array) usado em quatro casos do `sync-historico-remoto`. Ficou registrado como
dependência concreta, não como esquecimento.

### Andamento: a leitura que falha (divergência 8)

O engine SABE que falhou: `lerNoRemoto` tratava `ok: false` como nó vazio (o cliente do banco
não lança, responde `{ ok: false }`), então uma queda de rede apagava o andamento dos outros
da tela. Agora `ok: false` vira `null`, o ciclo emite `sync-live` com `falhaEm` e a visão
anterior, e a faixa diz "A última leitura falhou às HH:MM. Mostrando o andamento de HH:MM".
A hora da última leitura BOA não é sobrescrita pela falha.

### Lote N de M no envio do histórico (acréscimo do coordenador)

Derivável: o lote é fixo (`LOTE`), o total é a lista inteira da impressão medida e o
progresso em disco diz o que já subiu. `medirEnvio` passou a devolver `lote` (o próximo) e
`lotes`; `enviarHistorico` devolve o `lote` que acabou de subir e `lotes`; as duas rotas
deixam os campos passar pela allowlist. A tela mostra "lote 4 de 13 (200 enviadas, 450
faltando)" e, sem os campos, não calcula nada.

## 2. Provas

Ambiente de teste autorizado: `test/helpers/fake-rtdb.js` e `fake-identity.js`, dois motores
reais no mesmo processo com `FAROL_HOME` temporário (o segundo troca o `deviceId` depois do
login, porque os dois dividem o `STATE_DIR`), e o DOM de mentira de `test/helpers/dom-stub.js`.

- `test/sync-listas-remotas.test.js` (23 casos): A publica e B lê (origem, conta, hora, Meus
  PRs só leitura); a tela mostra deduplicado, com a origem certa (o teste chama as funções
  puras da tela com a projeção real); ponteiro parado não relê, ponteiro que anda lê só o
  novo; tombstone some; linha que não abre é contada; leitura que falha mantém a visão e não
  tranca o ponteiro; falha do ponteiro marca todos os escopos; escopo publicado aqui é
  `local`; `desligada`, `sem-frota` e `sem-chave` são ditos; o ciclo do relógio lê; o evento
  não se repete sem mudança e volta no batimento; a pendência chega nomeada (e o HTML tem a
  menção, o título e o autor); catálogo adulterado, de outra época, ou que nomeia outro PR
  caem no genérico; campo `pr` plantado dentro do item é ignorado; o catálogo inclui
  pendências e sessões vivas; a falha do andamento chega com a visão anterior; a falha das
  revisões chega como falha pela rota HTTP de verdade; `POST /api/sync/lists` responde com
  envelope.
- `test/ui-pure-listas-remotas.test.js` (18 casos): estados geral e por escopo; dedup local e
  entre escopos; filtro da aba; visão desligada/bloqueada/indisponível não mostra linha
  guardada; avisos com as duas horas; contagem de "não abriu"; HTML da linha remota (menção,
  autor, origem, hora, rascunho, sem botão), escape do que vem de fora, Meus PRs só leitura;
  `prIdentificadoHtml` nos dois blocos; faixa de falha do andamento; "lote N de M".
- `test/ui-listas-remotas.test.js` (12 casos): o `ui/app.js` inteiro contra o DOM de mentira;
  busca inicial única; `sync-lists` pelo bootstrap; contagem sem dobra; escopo de conta e PR
  oculto filtrando as remotas; desligada e bloqueada; falhou x desatualizada; `sync-live` com
  falha; lista de revisões com falha; leitura do trecho de `connect()`; contêineres no HTML.
- `test/sync-envio-historico.test.js`: dois casos novos (número do lote na medida, no envio e
  na retomada; e as duas rotas levando o lote até a tela).

Rodada vermelha, na árvore de `md/integracao` com os três arquivos novos copiados
(`verificacoes-saidas/tela-escopo-vermelho.txt`): 12 casos, 11 reprovam, com
`ERR_MODULE_NOT_FOUND` de `lib/engine/sync-listas.js` e `does not provide an export named
'estadoDasListas'`. Rodada vermelha do lote (`tela-escopo-lote-vermelho.txt`): 3 casos novos
reprovam, 28 passam. Verde correspondente em `tela-escopo-engine-2.txt`,
`tela-escopo-verde-2.txt` e `tela-escopo-lote-verde.txt`.

**Ajuste declarado de teste antigo** (commit `ee160f4`), sem afrouxar a intenção de nenhum:
`local-auth-inventario` (69 virou 70 caminhos, com a rota nova), `ui-pure-compartilhado` (a
frase "não viaja entre aparelhos" virou "não abriu no catálogo cifrado", porque a primeira
passou a ser falsa; o caso continua exigindo que a tag não apareça e que não haja link) e
`ui-widgets` (o contador de Meus PRs segue contando só o visível, agora somado às remotas que
passaram pelo mesmo filtro de ocultos).

## 3. Contraprovas por mutação

Script: `verificacoes-saidas/tela-escopo-mutacoes.cjs` (39 mutações). Cada uma troca um
trecho do código de produção, roda os testes que a guardam com limite de 4 minutos, confere a
reprovação e restaura o arquivo com sha256 conferido byte a byte.

| Rodada | Saída | Resultado |
|---|---|---|
| 1 (`tela-escopo-mutacoes-1.txt`) | 32 mutações | 29 reprovaram, **3 inertes** (M27, M30, M32) |
| 2 (`tela-escopo-mutacoes-2.txt`) | 32 mutações | 31 reprovaram, **1 inerte** (M27) |
| 3 (`tela-escopo-mutacoes-3.txt`) | as 6 de tela | 6 de 6 reprovaram |
| lote (`tela-escopo-mutacoes-lote.txt`) | M33 a M39 | 7 de 7 reprovaram |

Os inertes e o que foi feito:

- **M32** (o nome vindo de dentro da pendência cifrada): o caso que existia usava árvore
  vazia. Reforço: caso novo que cifra uma pendência com um campo `pr` plantado e exige `null`.
- **M30** (a falha do andamento sobrescrevendo a hora da leitura boa): nenhum caso olhava a
  hora. Reforço: caso com relógio fixo que exige "falhou às 10:05" e "Mostrando o andamento
  de 10:00".
- **M27** (a busca inicial das listas): inerte duas vezes, e a segunda mostrou por quê: a
  guarda estava DUPLICADA (no chamador e dentro de `buscarListas`), então tirar uma não
  mudava nada. A mutação era equivalente, não a asserção era fraca. Ficou uma guarda só
  (commit `cf21ce6`) e a mutação passou a reprovar.

## 4. Gates

| Rodada | Código | Comando | Resultado | Saída |
|---|---|---|---|---|
| 1 | `c714f92` | `npm run check` | 0, 559 arquivos | `tela-escopo-check-1.txt` |
| 1 | idem | `npm run lint` | 0, sem regressão | `tela-escopo-lint-1.txt` |
| 1 | idem | `npm test` | **1**: 4148 testes, 3 falham (as três travas antigas acima) | `tela-escopo-test-1.txt` |
| 2 | `cf21ce6` | `npm run check` | 0 | `tela-escopo-check-2.txt` |
| 2 | idem | `npm run lint` | 0, sem regressão | `tela-escopo-lint-2.txt` |
| 3 | `11a8c36` | `npm run check` | 0, 558 arquivos | `tela-escopo-check-3.txt` |
| 3 | idem | `npm run lint` | 0, sem regressão | `tela-escopo-lint-3.txt` |
| 3 | idem | `npm test` | **0**: 4154 testes, 4126 passam, 0 falham, 28 pulados | `tela-escopo-test-3.txt` |

A baseline do ratchet não subiu: a única violação nova (`ternarioAninhado` em
`sync-listas.js`) foi corrigida no código, não na baseline.

## 5. Divergências: o que fechou e o que não

| Divergência | Estado |
|---|---|
| 1 (PR sem nome na pendência e no andamento) | **resolvida** na pendência (catálogo pelo `prDaTag`) e na tela dos dois blocos; a montagem das operações é da frente `md/tela-transferencia`, que usa o mesmo campo |
| 6 (Panorama e Meus PRs de outros aparelhos) | **resolvida** |
| 7 (falha da lista de revisões) | **resolvida** na falha; a contagem de "1 revisão não abriu" fica de fora, e a dependência é mudar o retorno de `lerRecentes` (array hoje) para levar a contagem |
| 8 (leitura atrasada x leitura que falhou) | **resolvida**: o engine emite `falhaEm` e a tela afirma a falha |

Fora do escopo, sem mudança: a origem da linha remota é o publicador ATUAL da conta (o `dev`
do meta), não quem escreveu cada linha, porque a linha não guarda autor; quando o publicador
troca, a leitura recomeça do zero. Conta que este aparelho não monitora não é lida.
