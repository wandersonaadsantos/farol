# Handoff: plano da sincronização entre dispositivos executável por Haiku

> **ESTADO EM 11/09/2026, FIM DO DIA.** Falta UMA coisa: o aceite com o modelo menor.
> Tudo o mais fechou (revisão de L1..L4, M1..M12, interface, contrato, replay limpo,
> plano gerado e executor perfeito). Detalhe em `revisoes/rodada2-lacunas-B-e-revisao-A.md`.
>
> **Duas coisas que dependem de ação humana:**
> 1. O contrato atualizado (220 linhas novas) está **SEM COMMIT** no checkout principal,
>    em `docs/superpowers/plans/2026-09-10-sync-00-contrato.md`. Há uma cópia de
>    segurança aqui, em `contrato-atualizado.md`. Ele precisa entrar por branch e PR.
> 2. `npm run eng` está **VERMELHO na main**, por divergência entre o recorte versionado
>    e o catálogo local 0.10.0. Não foi causado por nenhum trabalho desta sessão.
>
> **Para retomar o aceite:** `gerador/PROMPT-ACEITE-HAIKU.md`. O worktree
> `.worktrees/sync-aceite` já existe; zere com `git reset --hard 1ddee35 && git clean -fd`
> antes de recomeçar. O alvo da comparação final é `8cee935` (ponta do replay).

Data: 11/09/2026. Sessão anterior interrompida no meio da segunda rodada do protótipo.

## O pedido do Wanderson

> "Refine o plano e entenda se temos pontas soltas, e corrija somente quando estiver
> 100% executável pelo Haiku. Você me retorna dizendo que concluiu o planejamento."

O entregável é um conjunto de planos de implementação (skill `superpowers:writing-plans`)
que um Claude Haiku consiga executar do começo ao fim sem adivinhar nada. Nada de feature
publicado, nada de PR aberto: é PLANEJAMENTO. Só reportar "concluí" quando a prova de
execução (seção "Critério de pronto") passar.

## Documentos no repositório (checkout principal, `main` em 1ddee35)

| arquivo | estado |
|---|---|
| `docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md` | spec funcional do Wanderson (893 linhas). Commitado no PR #71. É a fonte do "o quê". |
| `docs/superpowers/plans/2026-09-10-sync-00-contrato.md` | contrato de implementação que escrevi (Fase 0 fechada: decisões D1..D19, árvore remota, arquivos, assinaturas, índice T1..T24). Commitado no PR #71 e com **26 linhas não commitadas** (seção "Atualização pós-#71"). Está DESATUALIZADO em relação ao protótipo: ver "Contrato: o que precisa mudar". |

Nenhum plano de tarefas (`-01`, `-02`...) foi escrito ainda. De propósito: ver "Método".

## Método escolhido (e por quê)

Escrever tarefas com código literal direto do contrato gera plano com defeito que só
aparece na execução (foi o que aconteceu no plano do Jira: 4 defeitos de plano achados
durante a execução, 2 críticos só na revisão final da branch). Então:

1. **Protótipo primeiro.** Opus implementa o contrato num worktree descartável, com TDD,
   gate verde por tarefa e revisão adversarial com prova de mutação por bloco. Todo defeito
   de contrato aparece aqui, e é corrigido aqui.
2. **Replay limpo.** O histórico do protótipo é bagunçado (tarefa, depois fix que reescreve
   a tarefa). Um agente reconstrói a MESMA árvore final num worktree novo a partir da base,
   em tarefas limpas em ordem topológica, gate verde em cada commit. Prova: `git diff`
   entre o replay e o protótipo vazio.
3. **Plano gerado por máquina** a partir dos commits limpos (`gerador/gerar-plano.mjs`):
   arquivo novo entra inteiro; arquivo existente entra como pares "localize este trecho /
   troque por este", com o gerador PROVANDO que cada trecho aparece uma única vez no estado
   anterior (amplia o contexto até ficar único). Prosa (título, por quê, interfaces) é
   acrescentada por cima.
4. **Executor perfeito** (`gerador/executor-perfeito.mjs`): aplica o plano gerado sobre a
   base e confere tarefa a tarefa que o resultado bate byte a byte com o commit. Se passa,
   o plano é internamente consistente.
5. **Aceite com Haiku.** Um Haiku executa os planos num worktree novo a partir da `main`.
   Critério: gate verde em cada tarefa e `git diff` final vazio contra o replay limpo.

Os passos 3 e 4 já foram testados nos 9 primeiros commits do protótipo: "ok: 9 tarefas
reproduzem os commits byte a byte".

## Estado do protótipo

- Worktree: `C:\Users\wanderson\Documents\farol\.worktrees\sync-prova`, HEAD destacado
  `151992c`, base `1ddee35`, **50 commits**. Sem `node_modules` (de propósito).
- Último gate (medido pelo agente no HEAD 151992c): `check` ok em 259 arquivos, `lint` sem
  regressão, `npm test` **2717 testes, 2701 pass, 0 fail, 16 skipped**. Estabilidade:
  `test/sync-auth.test.js` 0 falhas em 40 execuções; `sync-*.test.js` 0 falhas em 10.

### Pronto e revisado

| bloco | tarefas | observação |
|---|---|---|
| C1 infraestrutura | T1..T8 (constantes, erros, chaves, config, credencial/aparelho, auth, SSE, cliente REST, taxonomia) | revisão achou 2 important (classe transitória levava a retry/estacionamento; SSE entregava evento cortado), corrigidos |
| C2 composição | T9 (lib/engine/sync.js, fachadas, rotas, snapshot), T10 (firebase/ regras e README) | revisão achou 8 important (log repetindo por tick, toast falso no boot, fiação sem teste, fail-closed só em 'erro', erase não provado, boot sem teste, Fase 5 impossível sem URL do emulador de Auth, e-mail no snapshot), corrigidos |
| C3 coordenação | T13..T16 (lease, recibos, rodadas, coordenador) | revisão achou 6 important (heartbeat nunca declarava perda com rede fora além do TTL, relógio congelado antes do preflight, if-match sem teste em renew e startRound, dia de Brasília não provado no coordenador, redoReceipt ausente), corrigidos |
| C4 chamadores | T17..T20 (gate no runClaudeStream, review/self/pushback/chat/tools, clique manual) | revisão achou 5 important (gate falhava ABERTO com admissão malformada, lease perdido depois da sessão não impedia postar, rodadaAutomatica vazava e gastava teto em dobro, label pública antes da admissão, ordem D14 só provada no approve), corrigidos |
| C5 consumo | T22, T23 (outbox, consolidado) | revisão achou 4 important (falha do envio derrubava a coordenação, rejeição por 429/proxy, janela com um dia a mais, dedupe da outbox sem prova), corrigidos |
| rodada 2, lacunas A | L1..L4 | ver abaixo |

Rodada 2, lacunas A (commits `407450e`, `609b068`, `06f40f7`, `151992c`), **sem revisão
adversarial ainda**:

- **L1** teste instável no Windows: a causa NÃO era keep-alive (hipótese refutada por
  medição). Os dublês agora chamam `test/helpers/sem-tier-wasm.js`, que roda
  `v8.setFlagsFromString('--no-wasm-dynamic-tiering')` e `'--no-wasm-tier-up'` antes do
  primeiro fetch; sem isso o `process.exit` do `--test-force-exit` aborta o node numa
  asserção da libuv. Os `DRENO_MS` dos testes foram removidos.
- **L2** tempo real: `lib/engine/sync-stream.js` abre o SSE de `/users/{uid}/leases` com a
  coordenação ativa, mantém a árvore remota, deriva `leasesVistos`/`leasesOutros`, backoff,
  `auth_revoked`, `cancel`, vigia de inatividade (`SYNC.STREAM_IDLE_MS` 90 s, alimentada por
  `onActivity` novo no `rtdb.stream`).
- **L3** retenção: faxina diária em `lib/engine/sync-faxina.js` (`SYNC.FAXINA_MS`,
  `SYNC.FAXINA_MAX_PRS`); remoção antecipada de recibo por "PR saiu do panorama" saiu do MVP.
- **L4** ETag ausente: `rtdb.get` que pediu ETag e não recebeu devolve `resposta_invalida`;
  nenhuma escrita sai incondicional.

Detalhe completo: `revisoes/rodada2-lacunas-A.txt`.

### Feito na sessão de 11/09/2026 (tarde)

Protótipo agora em `ff9f818` (10 commits novos sobre `151992c`). Gate: `check` ok em 261
arquivos, `lint` sem regressão, **2759 testes, 2742 pass, 0 fail**.

- **L1..L4 revisados.** Um achado important, corrigido: `soltarConexao` fechava o stream
  sem zerar `leasesVistos`, e uma reconexão que falha deixava "outro aparelho está
  analisando" na tela por tempo indefinido.
- **M1..M12 corrigidos**, todos com prova de mutação nomeada.
- **Interface U1..U4 construída** e provada num navegador real (zero erro de console).
  O smoke do Electron reprovou por motivo alheio (piso 44.1 contra o 44.3 local).
- Detalhe e os 9 desvios NOVOS para o contrato: `revisoes/rodada2-lacunas-B-e-revisao-A.md`.

### Replay limpo, plano gerado e executor perfeito (11/09/2026, fim da tarde)

O replay deixou de ser "um agente reimplementa em ordem limpa" e virou MECÂNICO, que é o
que o torna confiável: `gerador/replay.mjs` monta o worktree `.worktrees/sync-replay` a
partir da base e, tarefa a tarefa, escreve a versão FINAL dos arquivos daquela tarefa,
roda o gate inteiro e commita. Cada arquivo aparece em EXATAMENTE UMA tarefa, então não
existe versão intermediária inventada à mão e a árvore final é, por construção, a que o
protótipo provou (o script confere isso no fim e reprova se divergir).

O que carrega o trabalho é a ORDEM, em `gerador/tarefas-replay.json`: um módulo só entra
depois de tudo que ele importa, e um teste só entra depois de tudo que ELE importa. Duas
lições que só apareceram rodando:

- `test/sync-constants.test.js` confere as portas do emulador contra o `firebase.json`,
  então os arquivos de `firebase/` nascem na PRIMEIRA tarefa, junto das constantes.
- `test/facades.test.js` deriva a aridade das fachadas do FONTE, e a fachada
  `classifyPushback` ganhou um parâmetro. Implementação e fachada têm que nascer no mesmo
  commit, senão a tarefa da fiação nasce vermelha.

Depois do replay, a cadeia roda sozinha: `montar-manifesto.mjs` junta a decomposição, os
commits limpos e a prosa (`prosa-tarefas.json`, o porquê e a falha esperada de cada
tarefa, que é o que nenhuma máquina deduz); `gerar-plano.mjs` produz `plano-sync.md`; e
`executor-perfeito.mjs` aplica o plano sobre a base e confere que cada tarefa reproduz o
commit BYTE A BYTE.

Falta só o aceite com o modelo menor. O prompt está pronto em
`gerador/PROMPT-ACEITE-HAIKU.md`.

### NÃO feito (ordem sugerida)

1. ~~**Revisar L1..L4**~~ (prompt pronto: `REVIEW_PROMPT('lacunas', ...)` em
   `workflows/sync-prototipo-2-wf_016a8029-756.js`) e corrigir os critical/important.
2. ~~**M1..M12**~~, defeitos menores reais que as revisões apontaram e ninguém corrigiu. A
   especificação de cada um está no mesmo script, constante `LACUNAS_B`: conta vazia no
   coordenador, lease não liberado em exceção pós-aquisição, preflight tratando o lease do
   próprio aparelho como alheio, TypeError no envio da outbox após logout, cursor da outbox
   não amarrado ao destino (uid + databaseUrl), mensagem "sem login" no boot com login,
   Diagnóstico dizendo "coordenação" com a coordenação desligada, ordem D14 do pushback,
   redoReceipt apagando qualquer recibo e antes de saber se relança, toast "cancelada" na
   autoanálise com lease perdido, `launchReview` fora do `EXCECOES` do facades.test, login
   concorrente com start em voo.
3. ~~**Interface**~~ (T12, parte de UI da T20, T21, T24), especificação na constante `UI` do
   mesmo script. Desenho pronto em `desenho/` (`gerar.mjs` tem o CSS e o markup; os
   `*.dc.html` são as telas: Main, Estados, Confirmacoes, Fila, Consumo, Mobile). Usar os
   tokens do `ui/app.css`, nunca os hex do desenho.
4. **Aceite com o modelo menor** (`gerador/PROMPT-ACEITE-HAIKU.md`).
5. **Revisão final da branch inteira** por duas lentes (segurança/produção e
   conformidade/transcrição), prompts no mesmo script, e correção.
6. ~~**Atualizar o contrato**~~ FEITO: seção "Atualização pós-protótipo" no contrato.
   ~~Atualizar o contrato~~ com todos os desvios `defeito-contrato` (ver abaixo).
7. ~~**Replay limpo, geração dos planos, executor perfeito**~~ FEITO (ver acima); falta o aceite.

## Contrato: o que precisa mudar

Todo desvio classificado como `defeito-contrato` tem o texto novo sugerido nos arquivos de
`revisoes/`. Os principais, pra não perder:

- `urlFor` é síncrono e não embute token; `auth` entra por query e sai primeiro.
- `SYNC.AUTH_EMULATOR_IDENTITY_URL` / `AUTH_EMULATOR_TOKEN_URL` e `authUrlsFor(databaseUrl)`
  (sem isso a Fase 5 com emulador é impossível).
- E-mail no snapshot: exceção declarada, só em `sync.email`; nunca em log, toast ou rota.
- Admissão: relê `rt.agora()` imediatamente antes do `acquireLease`; heartbeat com
  `indisponivel` também declara perda quando passa da validade local do lease.
- Gate: `decidirAdmissao` falha FECHADO para qualquer forma que não seja
  `{ admitted: true, handle }` ou `bypass`; `pararSeLeasePerdido` colado antes de cada
  `postReview`; label `<conta>:revisando` só em `onAdmitted` (depois da admissão).
- `rodadaAutomatica` e os overrides são consumidos na admissão (zerados no objeto do PR);
  overrides só valem com `manual: true`; o preflight do clique roda sempre.
- `recusaDoLease` leva `operationKind`.
- Outbox: só 400/413 contam tentativa; qualquer outra falha pausa. Janela do consolidado:
  `brasiliaDay(agora - (days - 1) * DIA_MS)`, n dias civis.
- `DECISIVE_REVIEW_STATES` exportado de `decision.js` e usado pelo coordenador.
- `lib/engine/sync-usage.js`, `sync-stream.js` e `sync-faxina.js` existem (sync.js estava no
  teto de 380 linhas úteis).
- D17 reescrito (faxina diária), `STREAM_IDLE_MS`, `onActivity` no stream, dublês com
  `sem-tier-wasm.js`.

## Replay limpo: decomposição sugerida

Ordem topológica pelos imports do código FINAL (cada tarefa cria módulos na forma final
com seus testes; hunks em arquivos compartilhados entram na tarefa cujo módulo eles usam),
agrupada em PRs inertes com o sync desligado:

- PR 1 (folhas, sem fiação): constantes/erros, chaves, config (+settings, PARSERS, boot),
  credencial/aparelho, auth + dublê de identidade, SSE, rtdb + dublê RTDB, taxonomia,
  lease, recibos, rodadas, coordenador (+ export em decision.js), outbox, consolidado.
- PR 2 (fiação): lib/engine/sync*.js, server.js, http-server.js, usage.js, gate no
  session.js, chamadores (review, selfpr, pushback, chat, tools), clique manual.
- PR 3: interface. PR 4: `firebase/` (regras, config do emulador, README).

Isso difere do índice T1..T24 do contrato (que separava coordenação e consolidação em
planos 02 e 03); atualizar o índice do contrato junto.

## Critério de pronto (quando reportar "concluí o planejamento")

1. Protótipo com gate verde, sem achado critical/important aberto, smoke do Electron
   rodado localmente depois da interface.
2. Contrato atualizado e coerente com o código.
3. Planos gerados com `gerador/gerar-plano.mjs` e `executor-perfeito.mjs` dizendo ok.
4. Um Haiku executou os planos do zero num worktree novo: gate verde em cada tarefa e
   `git diff` final vazio contra o replay.

## Cuidados que custaram caro

- **node_modules**: o worktree não tem. Para o smoke do Electron, criar junção com
  `cmd //c mklink /J node_modules ..\..\node_modules` DENTRO do worktree e remover com
  `cmd //c rmdir node_modules`. **Nunca `rm -rf`**: apagaria o node_modules do checkout
  principal através da junção. Smoke: `node tools/electron-smoke.js --output <dir>
  --allow-desktop` (abre uma janela temporária com perfil vazio; Electron local 44.3).
- Nunca push, nunca abrir PR, nunca `git stash` (a pilha é compartilhada com outros
  worktrees), nunca atribuição de IA em commit.
- Os scripts de workflow em `workflows/` não retomam em outra sessão (o `resumeFromRunId`
  só vale na mesma sessão); servem como texto dos prompts.
- O gerador usa `git diff --no-index`, que sai com código 1 quando há diferença: tratado.
- Limite de uso do plano estourou duas vezes no meio dos workflows; agentes que caem por
  limite voltam com erro e o workflow segue com `null` naquele item.

## Arquivos deste handoff (`.worktrees/sync-handoff/`, ignorado pelo git)

| caminho | conteúdo |
|---|---|
| `desenho/` | telas do Claude Design e o `gerar.mjs` com CSS e markup |
| `gerador/` | gerador de plano, executor perfeito e o manifesto de teste |
| `workflows/` | os três scripts de workflow (auditoria inicial, rodada 1, rodada 2 com os prompts de M1..M12, UI e revisão final) |
| `revisoes/rodada1-desvios-e-achados.txt` | resumo legível de todos os desvios e achados da rodada 1 |
| `revisoes/rodada2-lacunas-A.txt` | resumo de L1..L4 |
| `revisoes/*.jsonl` | retorno completo de cada agente |

---

## Aceite CONCLUÍDO (11/09/2026)

As 23 tarefas do plano foram executadas num worktree limpo (`.worktrees/sync-aceite`,
base `1ddee35`), por agentes que só tinham o plano em mãos. HEAD final `3da74ff`.

**Critério duplo, os dois cumpridos e conferidos por mim, não pelo relato do executor:**

- `git diff 8cee935 3da74ff` VAZIO: o aceite reproduz o replay byte a byte.
- `git diff ff9f818 3da74ff` VAZIO: o aceite reproduz o PROTÓTIPO (60 commits) byte a byte.
- Gate rodado por mim no artefato final: sintaxe 261 arquivos, gate sem regressão,
  higiene limpa, suíte saída 0 sem nenhuma linha `not ok`.

O plano de 23 tarefas é, portanto, equivalente aos 60 commits do protótipo no produto
final. "100% executável por um modelo menor" deixou de ser hipótese.

**A correção que fez a diferença.** Na rodada reprovada, a T08 inseriu a classe
`coordenacao-indisponivel` depois de `rede`, reescreveu a lista de ordem esperada no teste
e apagou o caso que provava a regra; a suíte ficou verde sobre uma regressão real. Depois
que a conferência por hash passou a cobrir arquivos MODIFICADOS (51 -> 73 pontos no
plano), a mesma T08 passou limpa e bateu byte a byte.

**Contrato:** commit `a97337a` na branch `docs/sync-contrato-atualizado` (as 219 linhas
estavam soltas na `main` e agora não se perdem num checkout).

### O que continua em aberto, e não é pouco

1. **Nada foi entregue.** Os 60 commits vivem só em worktree; `protocolo/sync-de-linhagem`
   não os tem, e não há PR. O caminho é o do CLAUDE.md: branch -> PR -> CI verde -> merge,
   sem bypass de admin.
2. **Revisão final da branch inteira** nunca foi feita. As revisões existentes cobriram os
   cinco blocos de backend; as quatro lacunas (L1-L4), os defeitos menores e a interface
   entraram depois e não passaram por revisão.
3. **Os worktrees seguem no disco** (`sync-prova`, `sync-replay`, `sync-aceite`,
   `sync-handoff`). Só remover depois da entrega.
