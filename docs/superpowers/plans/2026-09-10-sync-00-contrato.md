# Sincronização entre dispositivos: contrato de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** implementar, atrás de um opt-in desligado por padrão, a coordenação de análises (lease + recibo) e a consolidação de consumo entre os Farols da mesma pessoa, usando o Firebase Realtime Database por REST, sem dependência npm.

**Architecture:** módulos novos em `lib/sync/` (folhas puras ou de IO simples, sem estado do engine) compostos por `lib/engine/sync.js` (o único que junta config, credencial, cliente, coordenação e outbox). O gate mora em `runClaudeStream` (estrangulamento único de todo provedor de IA). Estado local continua fonte de verdade; a nuvem só coordena e agrega.

**Tech Stack:** Node 22 (`fetch` nativo, `node:crypto`, `node:http` só nos dublês de teste), Firebase Realtime Database REST (ETag/`if-match`, SSE) e Firebase Auth REST (Identity Toolkit, e-mail e senha). Zero pacote npm.

**Spec:** `docs/PLANO-SINCRONIZACAO-DISPOSITIVOS.md` (o plano funcional). Este contrato é a Fase 0 fechada dele: toda decisão que o spec deixava "a cargo do executor" está decidida aqui. Os três planos de tarefas (`2026-09-10-sync-01-fundacao.md`, `-02-coordenacao.md`, `-03-consolidacao.md`) transcrevem este contrato em tarefas com código e teste literais.

---

## Global Constraints

Valem para TODAS as tarefas dos três planos. Copiadas e conferidas contra o checkout de 10/09/2026.

**Os três comandos não são a mesma coisa:**

- `npm run check` roda só `node tools/check-syntax.js`. Pega erro de sintaxe, e mais nada.
- `npm run lint` roda `node tools/quality/gate.js && node tools/quality/higiene.js`. **É este que reprova violação de contrato.**
- `npm test` roda `node --test --test-force-exit`.

**Regras do gate (`tools/quality/rules.js`). Arquivo novo tem teto ZERO em todas, porque não está na `baseline.json`.**

- **Zero dependências npm.** Invariante 1 do `CLAUDE.md`. Nada de `npm install`. `firebase-tools` só existe fora do repositório, na máquina de quem roda a Fase 5 manual.
- **ESM.** `"type": "module"`. `import`/`export`, nunca `require`.
- **`JSON.parse` e `JSON.stringify` só em `lib/io.js`** (regras `jsonParseCru`/`jsonStringifyCru`). Use `io.parseJson(texto, fallback)` e `io.safeStringify(valor, fallback)`. Em teste (pasta `test/`, ignorada pelo gate) `JSON.parse` é permitido.
- **`process.env` só em `lib/env.js` e `lib/paths.js`** (regra `processEnvDireto`). Nenhum módulo de `lib/sync/` lê env. O stub de fetch entra por parâmetro (`fetchImpl`), nunca por env.
- **Literal de tempo em propriedade é proibido** (regra `tempoMagico`): a expressão é `\b(ttl|ttlMs|timeout|timeoutMs|delay|delayMs|maxAge|expiresIn)\s*:\s*\d` (minúscula) e `\b\d+\s*\*\s*60\s*\*\s*1000\b`. Todo tempo nasce em `lib/constants.js`, no objeto `SYNC`, com nome MAIÚSCULO (`LEASE_TTL_MS: 120 * 1000` não casa; `ttlMs: 120000` casa). Nunca escreva `2 * 60 * 1000`; escreva `120 * 1000` ou derive de `HORA_MS`.
- **Máximo 400 linhas úteis por arquivo** (linhas não vazias depois do `strip.js`). O cliente REST está fatiado em `rtdb.js` + `sse.js` por isso.
- **Profundidade de chaves: teto efetivo 4, contado do topo do arquivo** (`profundidadeExcedida`, `maxDepth: 3` mais o corpo). Objeto literal CONTA como nível: `function f() { if (a) { try { const o = { headers: { x: 1 } } } } }` estoura. Regra prática usada em todo código destes planos: função de módulo (1) + um bloco (2) + um bloco (3) + um literal (4) é o máximo; cabeçalhos de fetch nascem em `const` fora da chamada, e laço com `if` dentro de `try` vira função auxiliar.
- **Ternário aninhado é proibido** (dois `?` no mesmo statement, descontados `?.` e `??`).
- **`catch` vazio é proibido**, exceto com comentário de intenção dentro do corpo.
- **`var` é proibido.** **A porta 47170 não pode aparecer literal** fora de `lib/constants.js`.
- **Nenhum número de card literal** (`BT-123`, `BUGS-9`) em código, teste, md ou json fora de `TODO(BT-123)` (`tools/quality/higiene.js`). Em fixtures use `XX-1`, `AB-7`.

**Regras de teste.**

- Runner nativo: `node --test --test-force-exit test/<arquivo>.test.js`. Arquivos em `test/*.test.js`.
- **Isolamento do `FAROL_HOME`** (`test/test-isolation.test.js`): teste que escreve `process.env.FAROL_HOME = ...` NÃO pode importar estaticamente módulo do repo que alcance `lib/paths.js`. Fixe a env no topo e carregue com `await import('...')`. Módulos puros (`lib/sync/keys.js`, `lib/sync/sse.js`, `lib/sync/errors.js`, `lib/sync/config.js`, `lib/sync/consolidated.js`, `ui/pure.js`) não alcançam `paths.js` e podem ser importados estaticamente.
- **Dublês em `test/helpers/`**: `fake-rtdb.js` e `fake-identity.js` são servidores HTTP em processo, sem efeito colateral no import (o `node --test` executa `test/**/*.js` e um arquivo que só exporta funções passa vazio).
- Teste de rede NUNCA toca a internet: `fetchImpl` injetado ou o dublê local.
- `test/facades.test.js` deriva do fonte: fachada nova em `server.js` que repassa `this` precisa ter a mesma aridade da implementação menos um. Fachada de uma linha, no formato `nome(a, b) { return xMod.impl(this, a, b); }`.
- `test/ui-contract.test.js`: toda rota `/api/...` chamada em `ui/app.js` tem que existir como `p === '/api/...'` em `lib/http-server.js`, e todo `data-goto` literal precisa apontar para id/seção que existe.
- `test/settings-fonte-unica.test.js`: chave que a tela salva por `settingsMap` tem que estar em `EDITAVEIS`. A chave `sync` NÃO entra no `settingsMap` (é salva por `saveSync`, como `jiraSites` por `saveJiraSites`), mas entra em `SETTINGS` com `ui: true`.
- `test/log-taxonomy.test.js` trava a lista ORDENADA de classes e a contagem (15 hoje). A classe nova entra ANTES de `rede` e a contagem vira 16.

**Regras de escrita.**

- Fim de linha LF. Texto, comentário e commit em português, **sem travessão** (vírgula, parênteses ou dois pontos).
- Comentário responde "por quê" (restrição de fora, contrato de infra, armadilha medida), nunca narra a sessão de trabalho.
- Nunca imprima e-mail, senha, refresh token, ID token ou URL com `auth=` em log, toast, resposta HTTP ou snapshot. O cliente REST redige a URL antes de compor mensagem de erro.
- Commits em Conventional Commits, sem trailer de co-autoria e sem menção a IA.

**Verificação antes de cada commit:** `npm run check && npm run lint && npm test`. Antes de push: `npm run eng` (8 avaliações escritas por commit) e o hook `tools/hooks/pre-push`.

**Branch e integração:** uma branch curta por plano (`feat/sync-01-fundacao`, `feat/sync-02-coordenacao`, `feat/sync-03-consolidacao`), cada uma nasce da `main` atualizada, vira PR, CI verde (`ci`), merge. Nunca push na `main`, nunca rebase/force-push, nunca bypass. Com `sync.enabled: false` (o padrão), nada do que entra muda o comportamento: é o que torna a integração incremental segura.

**Correções ao spec que este contrato fixa** (auditoria de 10/09/2026 contra o código):

1. §4 e §5 do spec dizem que "os instaladores preservam `node_modules`". Vale para `install.ps1` e `install.sh`; `install-linux.sh` apaga e refaz `npm install`. Nada muda na decisão (REST sem SDK), só a frase.
2. §7.4 diz que `myReviewStates` devolve semântica decisiva. Ela devolve TODOS os estados do head (inclusive COMMENTED/DISMISSED) ou `null`. A semântica decisiva mora em `DECISIVE_REVIEW_STATES` (`lib/engine/decision.js:200`). O preflight deste contrato aplica esse Set sobre o retorno.
3. §11.6 diz que `maxLines`/`maxDepth` estão "no gate". Estão em `tools/quality/rules.js:13`; `gate.js` só compara com a baseline. `maxLines` é violação binária por arquivo.

---

## Decisões fechadas (o que o spec deixava em aberto)

| # | Decisão | Motivo |
|---|---|---|
| D1 | **Autenticação por e-mail e senha do Firebase Auth (Identity Toolkit REST).** O usuário cria o projeto, habilita o provedor "E-mail/senha", cria UM usuário no console e digita e-mail e senha uma vez em cada Farol. O Farol guarda só `uid`, `email` e `refreshToken` em `~/.farol/sync-credentials.json` (0600). A senha nunca é persistida. | Único fluxo headless que funciona igual no Electron e no Termux/proot sem navegador nem registro de app OAuth. O mesmo usuário nos dois aparelhos é o mesmo UID. GitHub como IdP fica como evolução. |
| D2 | **ID token vai em `?auth=<idToken>` na query.** | É a única forma documentada para ID token de usuário no REST do RTDB (`Authorization: Bearer` só é documentado para access token OAuth2 de service account). Consequência: nenhuma URL do cliente pode ir para log, erro ou tela sem `redactUrl`. |
| D3 | **CAS por ETag só em PUT e DELETE** (`X-Firebase-ETag: true` na leitura, `if-match: <etag>` na escrita; 412 devolve o valor atual e o ETag atual; `null_etag` para local vazio). **PATCH nunca leva `if-match`** (o servidor responde 400). | Documentação REST do RTDB. Lease, recibo e reserva de rodada usam PUT/DELETE com `if-match`; presença e outbox usam PATCH (idempotentes por construção). |
| D4 | **Web API key e URL do banco ficam em `config.json` (`config.sync.apiKey`, `config.sync.databaseUrl`, `config.sync.projectId`).** Só o refresh token vai para o arquivo de credenciais. | A doc do Firebase diz que a Web API key "não precisa ser tratada como segredo". O refresh token é credencial e segue o precedente de `lib/jira/credentials.js`. |
| D5 | **Sem `presence/{deviceId}/{connectionId}`.** `devices/{deviceId}/lastSeenAt` (timestamp de servidor, carimbado a cada `syncTick`) é a presença. | Sem `onDisconnect` no REST, "conexão" não existe como conceito; o que existe é "visto pela última vez". |
| D6 | **Chaves derivadas por SHA-256 hex.** `accountHash = sha256('acct:' + login minúsculo)`, `prHash = sha256('pr:' + 'owner/repo#n' com owner/repo minúsculos)`, `operationFingerprint = kind + '_' + sha256(materialVersion).slice(0, 32)`. Texto legível de PR nunca sobe. | §10.3 do spec. Hex e `_` são chaves válidas no RTDB. |
| D7 | **Dia canônico do teto de rodadas: data civil em `America/Sao_Paulo` via `Intl.DateTimeFormat('en-CA', { timeZone })`.** `usage.js`/`review.js` continuam no fuso do processo (só a chave compartilhada muda). | §6.2 do spec. Node inclui ICU completo. |
| D8 | **Dublê de teste é um servidor RTDB falso em processo (`test/helpers/fake-rtdb.js`)**, com ETag, `if-match`, `null_etag`, `.sv timestamp`, `?auth=`, `?shallow`, SSE. **O emulador real só entra na Fase 5, manual, com script documentado.** As regras (`firebase/database.rules.json`) são defesa em profundidade: o cliente está correto sem elas. | O CI não tem Java nem `firebase-tools`, e invariante 1 proíbe adicioná-los ao repo. |
| D9 | **Resultado tipado de coordenação:** `runClaudeStream` resolve `{ blocked: true, coordination: <Admissao>, text: '', sessionId: null }` quando não admite. Cada chamador testa `res.blocked` ANTES de parsear. Nunca lança pelo motivo de coordenação (lançar cairia na taxonomia e estacionaria). | §7.1 do spec: "sem fabricar texto para os parsers de IA". |
| D10 | **Com a coordenação DESLIGADA, `runClaudeStream` é byte a byte o de hoje** (spawn síncrono no mesmo tick). Só com ela ligada o gate assíncrono roda antes do spawn. | Invariante 5 do spec, e os testes existentes capturam `spawn` no mesmo tick (`test/session-checkpoint-capture.test.js`). |
| D11 | **Falha de coordenação nunca estaciona e nunca entra no `retryAfterNet`.** Bloqueio (`recibo`, `alheio`, `esgotado`, `indisponivel`) devolve o PR para a fila visível (`unsee` + `queue.push`) com uma anotação de espera (`engine.sync.espera[key]`), e o filtro `toReview` pula a key enquanto a espera vale. Com a coordenação ligada e o runtime fora de `conectado`, `toReview`, `reReviewTargets` e `retryTargets` não lançam nada (aviso único por janela). | §8.2 e §13 do spec. |
| D12 | **Clique manual:** `launchReview` faz um preflight (`syncPreflightManual`) e devolve `coordenacao: [{ key, reason, detail }]` para os itens bloqueados; a UI confirma e reenvia com `semCoordenacao: true` (só para `indisponivel`) ou `ignorarRecibo: true` (só para `recibo`). `alheio` não tem override (nunca toma execução ativa). O gate no spawn continua rodando e honra as duas flags. | §8.3 e §7.4 do spec. |
| D13 | **Teto diário compartilhado só para o round automático pós-push** (`pr.rodadaAutomatica` carimbado por `launchReReviews`). `MAX_RODADAS_AUTO_DIA` passa a ler `SYNC.DAILY_ROUNDS_MAX` (fonte única). | §6.2 do spec. |
| D14 | **Recibo é escrito pelo chamador, depois de persistir o resultado local**, via `handle.complete(...)`; erro ou cancelamento chamam `handle.abort()` (libera o lease, não escreve recibo). O `finally` do chamador chama `abort()` se `complete()` não rodou. Perda de lease (heartbeat recusado) cancela a sessão e carimba `err.coordenacao = 'perdido'`: não estaciona, não posta. | §7.4 e §7.5 do spec. |
| D15 | **Outbox de consumo é idempotente por PUT/PATCH em `usageEvents/{deviceId}/{eventId}`**; o `eventId` deriva de campos imutáveis (D6 para conta e PR). Correção de desfecho reenvia o mesmo `eventId` com `status` novo. Migração inicial = zerar o cursor e reenfileirar tudo. | §6.3 e §9 do spec. |
| D16 | **UI:** seção nova `sys-sync` em Sistema (nav + painel), toggles salvos por `saveSync` (objeto inteiro em `/api/settings { sync }`), e na aba Consumo um seletor `Este dispositivo`/`Todos os dispositivos` que só aparece com a consolidação ligada. O desenho no Claude Design (Fase 1 do spec) roda ANTES das tarefas de UI e pode mudar hierarquia e microcopy; os invariantes e os ids de elemento deste contrato não mudam. | §11 do spec. |
| D17 | **Retenção:** lease e presença pelo TTL; `dailyRounds` de dias anteriores a 8 dias podados pelo `syncTick`; recibos expiram em 180 dias (`expiresAt`) e recibo de PR fechado é podado quando o PR sai do panorama por dois ciclos (`SYNC_PRUNE_STRIKES`); eventos de consumo não expiram. | §7.4 do spec. |

---

## Árvore remota (final)

```text
users/{uid}/
  devices/{deviceId}/                 # PATCH; presença = lastSeenAt
    name            string (≤ 40)
    platform        'win32' | 'darwin' | 'linux'
    farolVersion    string
    createdAt       number (ms, servidor)     # escrito uma vez (PUT com if-match null_etag)
    lastSeenAt      number (ms, servidor)     # {".sv":"timestamp"} a cada tick

  leases/{accountHash}/{prHash}/       # PUT/DELETE com if-match
    leaseId         string (UUID v4)
    deviceId        string
    operationKind   'review' | 'self' | 'pushback'
    headSha         string ('' permitido)
    acquiredAt      number (ms, relógio do cliente + skew)
    heartbeatAt     number
    expiresAt       number (≤ now + 300000 pelas regras)
    farolVersion    string

  receipts/{accountHash}/{prHash}/{operationFingerprint}/   # PUT com if-match
    operationKind   'review' | 'self' | 'pushback'
    materialVersion string (headSha ou marcador do pushback)
    deviceId        string
    leaseId         string ('' quando reconstruído do GitHub)
    completedAt     number
    lastVerifiedAt  number
    expiresAt       number (completedAt + 180 dias)
    outcome         'completed' | 'external_review'
    publicationState 'pending' | 'failed' | 'published' | 'not_applicable'
    reviewId        string ('' quando não há)
    farolVersion    string

  dailyRounds/{accountHash}/{prHash}/{brasiliaDay}/          # PUT com if-match (nó do dia inteiro)
    dayPolicy       'America/Sao_Paulo'
    updatedAt       number
    reservations/{attemptId}/
      operationFingerprint string
      leaseId       string
      state         'reserved' | 'started'
      reservedAt    number
      startedAt     number | null
      expiresAt     number (reservedAt + LEASE_TTL_MS; só vale em 'reserved')

  usageEvents/{deviceId}/{eventId}/    # PATCH multi-path, idempotente
    at, day, kind, accountHash, refHash, model, profileId,
    inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens,
    costUsd, costSource, status, farolVersion, localId
```

---

## Arquivos (criar / modificar) e responsabilidade única

| Arquivo | Ação | Responsabilidade | Plano |
|---|---|---|---|
| `lib/constants.js` | modificar | objeto `SYNC` (tempos, tetos, URLs, nomes de arquivo, fuso) | 01 |
| `lib/sync/errors.js` | criar | `SYNC_CODES`, `MOTIVOS`, `SyncError`, `codeFromStatus`, `motivoDe`, `codeFromIdentityMessage` | 01 |
| `lib/sync/keys.js` | criar | hashes, fingerprint, `brasiliaDay`, `nextBrasiliaDayStartMs`, `eventIdFor`, `novoId`, `assertRtdbKey` | 01 |
| `lib/sync/config.js` | criar | `syncDefaults`, `parseSyncConfig`, `coordinationActive`, `consolidationActive`, `databaseUrlProblema` | 01 |
| `lib/settings.js` | modificar | entrada `sync` na tabela `SETTINGS` | 01 |
| `lib/sync/credentials.js` | criar | `~/.farol/sync-credentials.json` (0600) | 01 |
| `lib/sync/device.js` | criar | `state/sync-device.json` (`deviceId` persistente) | 01 |
| `lib/sync/auth.js` | criar | `signInWithPassword`, `refreshIdToken`, `createTokenSource` | 01 |
| `lib/sync/sse.js` | criar | `createSseParser` (puro) | 01 |
| `lib/sync/rtdb.js` | criar | `createRtdbClient` (get/put/patch/del/stream), `redactUrl` | 01 |
| `lib/log-taxonomy.js` | modificar | classe `coordenacao-indisponivel` (transitória) antes de `rede` | 01 |
| `lib/engine/sync.js` | criar | composição: runtime, login/logout/test, presença, tick, status para UI, apagar remoto, `admit` (delegando), preflight manual, outbox | 01 (base) + 02 + 03 |
| `server.js` | modificar | `PARSERS.parseSyncConfig`, `this.sync` no construtor, `syncTick` no `check()`, fachadas, `snapshot().sync`, filtro `toReview` | 01 + 02 |
| `lib/http-server.js` | modificar | rotas `/api/sync/*` | 01 + 02 + 03 |
| `test/helpers/fake-rtdb.js` | criar | dublê do RTDB REST | 01 |
| `test/helpers/fake-identity.js` | criar | dublê do Identity Toolkit e do securetoken | 01 |
| `firebase/database.rules.json`, `firebase/firebase.json`, `firebase/README.md` | criar | regras, config do emulador, roteiro de configuração do usuário e da Fase 5 | 01 |
| `ui/index.html`, `ui/app.js`, `ui/pure.js`, `ui/app.css` | modificar | seção `sys-sync`, `renderSync`, helpers puros, estilos `.sync-*` | 01 (seção) + 02 (espera/órfão) + 03 (Consumo) |
| `lib/sync/lease.js` | criar | `leasePath`, `leaseAcquirable`, `buildLease`, `acquireLease`, `renewLease`, `releaseLease` | 02 |
| `lib/sync/receipts.js` | criar | `receiptPath`, `buildReceipt`, `receiptBlocks`, `receiptOrphanState`, `readReceipt`, `writeReceipt`, `invalidateReceipt` | 02 |
| `lib/sync/rounds.js` | criar | `roundsPath`, `countStarted`, `reserveRound`, `startRound`, `pruneRounds` | 02 |
| `lib/sync/coordinator.js` | criar | `admit`, `createHandle`, `noopHandle`, preflight do GitHub | 02 |
| `lib/engine/session.js` | modificar | `OPERACOES`, `admitirOperacao`, `runClaudeStream` vira invólucro de `runProvedor` | 02 |
| `lib/engine/review.js` | modificar | `operationKind`/`coordination` nos opts, tratamento de `res.blocked`, `complete`/`abort`, `rodadaAutomatica`, `MAX_RODADAS_AUTO_DIA` de `SYNC`, `launchReview` com preflight manual | 02 |
| `lib/engine/selfpr.js` | modificar | `operationKind: 'self'`, `coordination`, `res.blocked`, `complete` | 02 |
| `lib/engine/pushback.js` | modificar | `operationKind: 'pushback'`, `coordination`, `{ deduped }`, `complete` | 02 |
| `lib/engine/chat.js`, `lib/engine/tools.js` | modificar | `operationKind: 'chat'` / `'tool'` (bypass declarado) | 02 |
| `lib/sync/outbox.js` | criar | outbox em `state/sync-outbox.json`: enfileirar, reconciliar, enviar em lote | 03 |
| `lib/sync/consolidated.js` | criar | projeção pura dos eventos remotos | 03 |
| `lib/engine/usage.js` | modificar | ganchos `engine.syncEnqueueUsage` em `recordUsage` e `marcarDesfecho` | 03 |

Linhas úteis previstas (teto 400): `rtdb.js` ~220, `coordinator.js` ~260, `lib/engine/sync.js` ~380 (se passar de 380 na Fase 03, extraia `lib/engine/sync-usage.js` com a parte de outbox; a tarefa correspondente já prevê isso).

---

## Constantes (verbatim, entra em `lib/constants.js` depois do objeto `JIRA`)

```js
// Sincronização entre dispositivos (Firebase RTDB por REST). Nomes MAIÚSCULOS de
// propósito: `tempoMagico` casa `ttl:`/`timeout:` minúsculos, e o lar do número é aqui.
// LEASE_TTL_MS < LEASE_TTL_MAX_MS: as regras do banco (firebase/database.rules.json)
// recusam expiresAt acima de now + LEASE_TTL_MAX_MS, então um relógio adiantado no
// cliente não produz lease imortal.
const SYNC = {
  LEASE_TTL_MS: 120 * 1000,          // validade de um lease sem renovação
  LEASE_TTL_MAX_MS: 300 * 1000,      // teto que as regras aceitam para expiresAt - now
  HEARTBEAT_MS: 30 * 1000,           // renovação do lease (bem abaixo do TTL)
  PRESENCE_TICK_MS: HORA_MS / 12,    // carimbo de lastSeenAt no máximo a cada 5 min
  TOKEN_MARGIN_MS: HORA_MS / 12,     // renova o ID token 5 min antes de vencer
  REQUEST_TIMEOUT_MS: 15 * 1000,     // teto de UMA chamada REST
  STREAM_RECONNECT_MS: 5 * 1000,     // espera mínima antes de reabrir o SSE
  STREAM_RECONNECT_MAX_MS: HORA_MS / 60, // teto do backoff do SSE (1 min)
  ESPERA_ALHEIO_MS: 120 * 1000,      // quanto o toReview pula um PR cujo lease é de outro aparelho
  RECEIPT_TTL_MS: 180 * DIA_MS,      // rede de segurança dos recibos
  ROUNDS_TTL_MS: 8 * DIA_MS,         // poda de dailyRounds
  ORPHAN_AFTER_MS: 7 * DIA_MS,       // recibo pending/failed de aparelho sem atividade vira "órfão" na tela
  DAILY_ROUNDS_MAX: 3,               // fonte única do teto de rodadas automáticas por PR/dia (review.js lê daqui)
  OUTBOX_BATCH: 50,                  // eventos por PATCH multi-path
  OUTBOX_MAX_REJEICOES: 5,           // 4xx repetido move o evento para "rejeitado"
  IDENTITY_TOOLKIT_URL: 'https://identitytoolkit.googleapis.com/v1',
  SECURE_TOKEN_URL: 'https://securetoken.googleapis.com/v1/token',
  CREDENTIALS_FILE: 'sync-credentials.json', // em ~/.farol/, FORA do config.json
  DEVICE_FILE: 'sync-device.json',           // em state/
  OUTBOX_FILE: 'sync-outbox.json',           // em state/
  DAY_TZ: 'America/Sao_Paulo',               // dia canônico do teto compartilhado
  PRUNE_STRIKES: 2,                          // ausências seguidas do panorama antes de podar recibo
};
```

`DIA_MS` já existe em `TEMPOS` (`24 * HORA_MS`); `SYNC` deve usar `const DIA_MS = TEMPOS.DIA_MS;` declarado logo antes, ou repetir `24 * HORA_MS` (as duas formas passam no gate). Exportar: `export default { DEFAULT_PORT, TEMPOS, JIRA, SYNC }; export { DEFAULT_PORT, TEMPOS, JIRA, SYNC };`.

---

## Config (verbatim)

Entrada em `lib/settings.js`, logo depois de `jiraSites`:

```js
  // opt-in: nasce desligada e só liga com objeto explícito; o saneador vive em
  // lib/sync/config.js e entra por injeção como os outros parsers
  { key: 'sync', def: { enabled: false, coordination: { enabled: false }, consolidation: { enabled: false }, deviceName: '', apiKey: '', databaseUrl: '', projectId: '' }, ui: true, san: (v, c, f) => f.parseSyncConfig(v, c.sync) },
```

`lib/sync/config.js`:

```js
syncDefaults() -> { enabled:false, coordination:{enabled:false}, consolidation:{enabled:false}, deviceName:'', apiKey:'', databaseUrl:'', projectId:'' }
parseSyncConfig(raw, atual) -> objeto NOVO no formato acima
   // regras: enabled/coordination.enabled/consolidation.enabled só ligam com `=== true`;
   // deviceName: String, trim, até 40 chars; apiKey: casa /^[A-Za-z0-9_-]{10,128}$/ ou '';
   // projectId: casa /^[a-z0-9-]{1,64}$/ ou ''; databaseUrl: se `databaseUrlProblema(v)` devolver
   // texto, mantém `atual.databaseUrl` (ou '' sem atual), senão normaliza sem barra final.
databaseUrlProblema(url) -> '' quando válida; frase quando inválida
   // válida: https com host terminando em '.firebaseio.com' ou '.firebasedatabase.app',
   // OU http com host '127.0.0.1' | 'localhost' (emulador). Sem path, query, usuário ou senha.
coordinationActive(cfg) -> !!(cfg && cfg.enabled === true && cfg.coordination && cfg.coordination.enabled === true)
consolidationActive(cfg) -> !!(cfg && cfg.enabled === true && cfg.consolidation && cfg.consolidation.enabled === true)
```

`server.js`: `PARSERS` ganha `parseSyncConfig` (import de `./lib/sync/config.js`). O construtor já aplica `sanear` para cada chave da tabela? NÃO: o saneamento do boot é feito pela leitura de `config.json` mais `defaults`; a tarefa do plano 01 diz exatamente onde acrescentar `this.config.sync = parseSyncConfig(this.config.sync, syncDefaults())` (logo depois de `this.config` ser montado no construtor, no mesmo lugar em que `sanitizeClaudeModel` é reaplicado no boot).

---

## Erros (`lib/sync/errors.js`, verbatim)

```js
const SYNC_CODES = {
  DESLIGADO: 'desligado',
  SEM_CREDENCIAL: 'sem_credencial',
  CONFIG_INVALIDA: 'config_invalida',
  CREDENCIAL_INVALIDA: 'credencial_invalida',
  MUITAS_TENTATIVAS: 'muitas_tentativas',
  NAO_AUTORIZADO: 'nao_autorizado',
  NAO_ENCONTRADO: 'nao_encontrado',
  CONFLITO: 'conflito',
  TIMEOUT: 'timeout',
  INDISPONIVEL: 'indisponivel',
  RESPOSTA_INVALIDA: 'resposta_invalida',
  FALHA_INTERNA: 'falha_interna',
};
const MOTIVOS = {
  desligado: 'a sincronização entre dispositivos está desligada',
  sem_credencial: 'nenhum login do Firebase foi feito neste aparelho',
  config_invalida: 'a chave web ou a URL do banco estão incompletas ou inválidas',
  credencial_invalida: 'o Firebase recusou o e-mail e a senha, ou o login expirou; entre de novo',
  muitas_tentativas: 'o Firebase bloqueou tentativas de login por excesso; aguarde e tente de novo',
  nao_autorizado: 'o Firebase recusou a operação (token vencido ou regras do banco)',
  nao_encontrado: 'o banco informado não existe',
  conflito: 'outro aparelho alterou o mesmo registro antes desta escrita',
  timeout: 'o Firebase não respondeu no tempo esperado',
  indisponivel: 'o Firebase está indisponível ou sem rede',
  resposta_invalida: 'o Firebase respondeu em formato inesperado',
  falha_interna: 'o Farol falhou ao montar a operação, não foi o Firebase',
};
class SyncError extends Error { constructor(code, message) { super(message); this.name = 'SyncError'; this.code = code; } }
function codeFromStatus(status)      // 401 -> nao_autorizado; 404 -> nao_encontrado; 412 -> conflito; 5xx -> indisponivel; outros -> resposta_invalida
function codeFromIdentityMessage(msg) // 'EMAIL_NOT_FOUND'|'INVALID_PASSWORD'|'INVALID_LOGIN_CREDENTIALS'|'USER_DISABLED'|'USER_NOT_FOUND'|'TOKEN_EXPIRED'|'INVALID_REFRESH_TOKEN' -> credencial_invalida; 'TOO_MANY_ATTEMPTS_TRY_LATER' -> muitas_tentativas; /API key not valid/i -> config_invalida; resto -> resposta_invalida (compara pelo prefixo antes de ' : ')
function motivoDe(code) -> MOTIVOS[code] || 'falha desconhecida ao falar com o Firebase'
export default { SYNC_CODES, SyncError, codeFromStatus, codeFromIdentityMessage, motivoDe }; export { ... };
```

---

## Chaves (`lib/sync/keys.js`, puro)

```js
import { createHash, randomUUID } from 'node:crypto';
sha256Hex(texto) -> string (64 hex)
accountHash(login) -> sha256Hex('acct:' + String(login||'').trim().toLowerCase())
canonicalPrKey(key) -> 'owner/repo#n' com owner/repo em minúsculas e n inteiro; '' quando não casa /^([^/#\s]+)\/([^/#\s]+)#(\d+)$/
prHash(key) -> sha256Hex('pr:' + canonicalPrKey(key)); '' quando canonicalPrKey devolve ''
operationFingerprint(kind, materialVersion) -> `${kind}_${sha256Hex(String(materialVersion)).slice(0, 32)}`; lança SyncError(FALHA_INTERNA) se kind não está em ['review','self','pushback'] ou materialVersion vazio
brasiliaDay(ms, tz = SYNC.DAY_TZ) -> 'YYYY-MM-DD' via Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(ms))
nextBrasiliaDayStartMs(ms, tz = SYNC.DAY_TZ) -> primeiro instante do dia seguinte em tz (procura por passos de 15 min a partir de ms até brasiliaDay mudar, depois refina por minuto; ≤ 96 iterações)
eventIdFor(sessao, deviceId) -> sha256Hex([deviceId, sessao.at, sessao.id||'', sessao.kind, sessao.ref||'', sessao.model||'', sessao.inputTokens|0, sessao.outputTokens|0, sessao.cacheReadTokens|0, sessao.cacheCreationTokens|0, Number(sessao.costUsd)||0].join('|'))
novoId() -> randomUUID()
assertRtdbKey(segmento) -> lança SyncError(FALHA_INTERNA) se vazio, > 768 bytes ou contém . $ # [ ] / ou controle
```

---

## Credenciais (`lib/sync/credentials.js`) e dispositivo (`lib/sync/device.js`)

Espelham `lib/jira/credentials.js` (arquivo em `HOME`, `writeJsonAtomic` + `chmod 0600` em TODA gravação):

```js
credentialsPath() -> path.join(HOME, SYNC.CREDENTIALS_FILE)
readSyncCredential() -> { uid, email, refreshToken, savedAt } | null   (null se faltar uid/refreshToken)
setSyncCredential({ uid, email, refreshToken }) -> boolean
updateRefreshToken(refreshToken) -> boolean   // rotação devolvida pelo securetoken
removeSyncCredential() -> boolean
hasSyncCredential() -> boolean
```

```js
devicePath() -> path.join(STATE_DIR, SYNC.DEVICE_FILE)
ensureDevice() -> { deviceId, createdAt }   // cria com novoId() na primeira chamada, grava atômico
readDevice() -> { deviceId, createdAt } | null
```

---

## Auth (`lib/sync/auth.js`)

```js
signInWithPassword({ apiKey, email, password, fetchImpl = fetch, identityUrl = SYNC.IDENTITY_TOOLKIT_URL, agora = Date.now })
  -> { ok:true, uid, email, idToken, refreshToken, expiresAtMs } | { ok:false, code, motivo }
  // POST `${identityUrl}/accounts:signInWithPassword?key=${apiKey}` JSON { email, password, returnSecureToken: true }
  // 200: idToken, refreshToken, localId (uid), expiresIn (STRING de segundos) -> expiresAtMs = agora() + Number(expiresIn) * 1000
  // erro: corpo { error: { message } } -> codeFromIdentityMessage(message); sem corpo -> codeFromStatus
refreshIdToken({ apiKey, refreshToken, fetchImpl = fetch, tokenUrl = SYNC.SECURE_TOKEN_URL, agora = Date.now })
  -> { ok:true, uid, idToken, refreshToken, expiresAtMs } | { ok:false, code, motivo }
  // POST `${tokenUrl}?key=${apiKey}` com Content-Type application/x-www-form-urlencoded
  // corpo `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  // 200: id_token, refresh_token, user_id, expires_in (STRING)
createTokenSource({ apiKey, refreshToken, fetchImpl, tokenUrl, agora = Date.now, onRefresh })
  -> { getIdToken(): Promise<{ ok:true, idToken } | { ok:false, code, motivo }>, invalidate(): void }
  // cache do idToken até expiresAtMs - SYNC.TOKEN_MARGIN_MS; concorrência: uma renovação por vez
  // (promessa compartilhada); onRefresh({ refreshToken }) quando o refresh token rotacionar
```

Toda chamada usa `AbortController` + `setTimeout(SYNC.REQUEST_TIMEOUT_MS)` como `lib/jira/client.js`; erro de rede vira `indisponivel`, AbortError vira `timeout`. Cabeçalhos em `const` fora da chamada (profundidade).

---

## SSE (`lib/sync/sse.js`, puro)

```js
createSseParser(onEvent) -> { feed(chunk: string): void, end(): void }
// protocolo: linhas terminadas em \n (aceita \r\n); `event: x` define o nome; `data: y` acumula (várias
// linhas viram y1\ny2); linha vazia despacha onEvent({ event: nome || 'message', data: texto }) e
// zera; linhas que começam com ':' são comentário; end() despacha o pendente.
```

---

## Cliente REST (`lib/sync/rtdb.js`)

```js
createRtdbClient({ databaseUrl, projectId = '', getIdToken, fetchImpl = fetch, timeoutMs = SYNC.REQUEST_TIMEOUT_MS })
  -> { get, put, patch, del, stream, urlFor }
urlFor(path, query = {}) -> `${databaseUrl}${path}.json?auth=<token>&...`
  // path começa com '/', sem '.json'; cada segmento passa por assertRtdbKey; `ns=<projectId>` só
  // entra quando databaseUrl começa com 'http://' (emulador) e projectId não é vazio
get(path, { etag = false, shallow = false } = {})
  -> { ok:true, status:200, data, etag }   // etag '' quando não pedido; header `X-Firebase-ETag: true` quando pedido
   | { ok:false, code, status, motivo }
put(path, value, { ifMatch = '', etag = false } = {})
  -> { ok:true, status:200, data, etag }   // data = corpo devolvido (com ".sv" já resolvido)
   | { ok:false, code:'conflito', status:412, data, etag }   // data/etag = valor ATUAL do servidor
   | { ok:false, code, status, motivo }
patch(path, value) -> { ok:true, status:200, data } | { ok:false, code, status, motivo }   // nunca manda if-match
del(path, { ifMatch = '' } = {}) -> { ok:true, status:200 } | { ok:false, code:'conflito', status:412, data, etag } | { ok:false, code, status, motivo }
stream(path, { onEvent, signal })
  -> Promise<{ ok:true } | { ok:false, code, motivo }>   // resolve quando a conexão fecha (fim, abort, erro)
  // GET com `Accept: text/event-stream`, corpo lido por `res.body.getReader()` + TextDecoder,
  // alimentando createSseParser; onEvent({ event, data }) com data já parseado por io.parseJson
  // para put/patch/cancel; 'keep-alive' é engolido; 'auth_revoked' chega ao onEvent (quem chama
  // renova o token e reabre).
redactUrl(url) -> url com o valor de auth= trocado por '***'
```

Regras internas: `getIdToken()` roda antes de toda chamada; `{ ok:false }` dele é devolvido sem tocar a rede. Status HTTP → código por `codeFromStatus`. Corpo de erro: `io.parseJson(texto, null)`; se objeto com `error` string, vai para `motivo` (cortado em 200 chars); senão `motivoDe(code)`. Nunca inclua a URL crua em mensagem: só `redactUrl`.

---

## Taxonomia (`lib/log-taxonomy.js`, verbatim da classe nova; entra IMEDIATAMENTE ANTES de `rede`)

```js
  {
    // Coordenação entre dispositivos (Firebase) fora de alcance: rede, token vencido,
    // banco indisponível. Transitória de propósito: a espera é o comportamento certo, e
    // nunca vira estacionamento (ver lib/sync/coordinator.js). Vem ANTES de 'rede'
    // porque a mensagem carrega o texto do fetch ('fetch failed'), que 'rede' casaria.
    id: 'coordenacao-indisponivel',
    label: 'Coordenação entre dispositivos indisponível',
    grupo: 'rede',
    kind: 'transitorio',
    re: /coordena[cç][aã]o entre dispositivos indispon[ií]vel/i,
  },
```

`test/log-taxonomy.test.js`: a lista ordenada passa a ter `'coordenacao-indisponivel'` entre `'resultado-invalido'` e `'rede'`, a contagem vira 16, e `MSG.coordenacao = 'coordenação entre dispositivos indisponível: fetch failed'` entra em `CASOS` mapeando para a classe nova.

---

## Lease (`lib/sync/lease.js`)

```js
leasePath(uid, accountHash, prHash) -> `/users/${uid}/leases/${accountHash}/${prHash}`
leaseAcquirable(atual, { leaseId, nowMs }) -> 'ausente' | 'meu' | 'expirado' | 'alheio'
  // atual null/undefined -> 'ausente'; atual.leaseId === leaseId -> 'meu';
  // Number(atual.expiresAt) <= nowMs -> 'expirado'; senão 'alheio'. Sem expiresAt numérico -> 'alheio' (falta de dado não libera)
buildLease({ leaseId, deviceId, operationKind, headSha, nowMs, farolVersion })
  -> { leaseId, deviceId, operationKind, headSha: headSha||'', acquiredAt: nowMs, heartbeatAt: nowMs, expiresAt: nowMs + SYNC.LEASE_TTL_MS, farolVersion }
acquireLease(client, { uid, accountHash, prHash }, { leaseId, deviceId, operationKind, headSha, nowMs, farolVersion })
  -> { ok:true, lease, etag } | { ok:false, reason:'alheio', lease } | { ok:false, reason:'indisponivel', code, motivo }
  // 1) get(path, { etag:true }); 2) leaseAcquirable; 'alheio' -> devolve; 'ausente'|'expirado'|'meu' ->
  // put(path, buildLease(...), { ifMatch: etag || 'null_etag', etag:true }); 412 -> relê UMA vez e repete
  // (máximo 3 tentativas no total); 412 na 3a -> 'alheio' com o lease atual; erro de rede -> 'indisponivel'
renewLease(client, ids, { leaseId, nowMs })
  -> { ok:true, etag } | { ok:false, reason:'perdido', lease } | { ok:false, reason:'indisponivel', code, motivo }
  // get com etag; se atual.leaseId !== leaseId ou expirado -> 'perdido'; senão put({...atual, heartbeatAt: nowMs, expiresAt: nowMs + TTL}, { ifMatch: etag }); 412 -> 'perdido'
releaseLease(client, ids, { leaseId })
  -> { ok:true, released:boolean } | { ok:false, reason:'indisponivel', code, motivo }
  // get com etag; se atual.leaseId !== leaseId -> { ok:true, released:false } (nunca apaga o de outro);
  // senão del(path, { ifMatch: etag }); 412 -> { ok:true, released:false }
```

---

## Recibos (`lib/sync/receipts.js`)

```js
receiptPath(uid, accountHash, prHash, fingerprint) -> `/users/${uid}/receipts/${accountHash}/${prHash}/${fingerprint}`
receiptsPath(uid, accountHash, prHash) -> `/users/${uid}/receipts/${accountHash}/${prHash}`
buildReceipt({ operationKind, materialVersion, deviceId, leaseId, nowMs, outcome, publicationState, reviewId, farolVersion })
  -> { operationKind, materialVersion, deviceId, leaseId: leaseId||'', completedAt: nowMs, lastVerifiedAt: nowMs, expiresAt: nowMs + SYNC.RECEIPT_TTL_MS, outcome, publicationState, reviewId: reviewId||'', farolVersion }
receiptBlocks(receipt, nowMs) -> boolean
  // true quando receipt é objeto, outcome em ['completed','external_review'] e Number(expiresAt) > nowMs
receiptOrphanState(receipt, device, nowMs) -> 'ativo' | 'orfao' | 'desconhecido'
  // só para publicationState 'pending'|'failed'; device = nó devices/{deviceId} ou null.
  // 'desconhecido' quando device null, lastSeenAt não numérico, lastSeenAt > nowMs (futuro) ou completedAt não numérico
  // 'orfao' quando (nowMs - lastSeenAt) >= SYNC.ORPHAN_AFTER_MS E (nowMs - completedAt) >= SYNC.ORPHAN_AFTER_MS
  // 'ativo' caso contrário; publicationState fora de pending/failed -> 'ativo'
readReceipt(client, ids, fingerprint) -> { ok:true, receipt: obj|null, etag } | { ok:false, code, motivo }
writeReceipt(client, ids, fingerprint, receipt, { ifMatch }) -> { ok:true } | { ok:false, code:'conflito', atual } | { ok:false, code, motivo }
  // put com ifMatch (etag lido ou 'null_etag'); 412 devolve o recibo atual em `atual`
invalidateReceipt(client, ids, fingerprint, { ifMatch }) -> { ok:true } | { ok:false, code, motivo }   // del com ifMatch
```

---

## Rodadas do dia (`lib/sync/rounds.js`)

```js
roundsPath(uid, accountHash, prHash, day) -> `/users/${uid}/dailyRounds/${accountHash}/${prHash}/${day}`
countStarted(node) -> quantidade de reservations com state 'started'
countReservedVivas(node, nowMs) -> reservations 'reserved' com expiresAt > nowMs
reserveRound(client, ids, day, { attemptId, fingerprint, leaseId, nowMs, max = SYNC.DAILY_ROUNDS_MAX })
  -> { ok:true, etag } | { ok:false, reason:'esgotado', started } | { ok:false, reason:'indisponivel', code, motivo }
  // get(path,{etag}); if countStarted + countReservedVivas >= max -> 'esgotado'; senão put do nó inteiro com a
  // reserva adicionada ({ dayPolicy: SYNC.DAY_TZ, updatedAt: nowMs, reservations: {...antigas, [attemptId]: { operationFingerprint, leaseId, state:'reserved', reservedAt: nowMs, startedAt: null, expiresAt: nowMs + SYNC.LEASE_TTL_MS } } }) com ifMatch; 412 -> relê e repete até 3 vezes
startRound(client, ids, day, { attemptId, leaseId, nowMs }) -> { ok:true } | { ok:false, reason:'perdido'|'indisponivel', ... }
  // get com etag; reserva precisa existir com o mesmo leaseId; put com state:'started', startedAt: nowMs; 412 -> relê e repete até 3 vezes
pruneRounds(client, uid, accountHash, prHash, { nowMs }) -> { ok, removidos }   // apaga dias cuja data < brasiliaDay(nowMs - SYNC.ROUNDS_TTL_MS)
```

---

## Coordenador (`lib/sync/coordinator.js`)

Contexto montado pelo CHAMADOR (review.js, selfpr.js, pushback.js) e passado em `opts.coordination`:

```js
coordination = {
  prKey: 'owner/repo#123',
  account: 'login',                 // conta GitHub dona
  materialVersion: '<headSha>' | '<marcador do pushback>' | '',   // '' = desconhecido
  headSha: '<headSha>' | '',        // metadado do lease
  contaRodada: boolean,             // só o round automático pós-push (pr.rodadaAutomatica)
  manual: boolean,                  // clique explícito (pr.manual)
  semCoordenacao: boolean,          // override confirmado (só manual); pula TUDO e registra INFO no log
  ignorarRecibo: boolean,           // override confirmado (só manual); pula a consulta de recibo
  pr: { key, url, repo, number, author, account },   // para o preflight myReviewStates
}
```

`admit(engine, ctx)` (assíncrono), onde `ctx = { ...coordination, operationKind, opId }` é montado por `session.js`:

```
1. runtime = engine.sync; se !coordinationActive(engine.config.sync) -> { admitted:true, handle: noopHandle() }
2. se ctx.semCoordenacao -> log INFO `${ctx.prKey}: gate de coordenação contornado por decisão manual` -> { admitted:true, handle: noopHandle() }
3. se runtime.status !== 'conectado' -> { admitted:false, reason:'indisponivel', detail:{ motivo: motivoDe(runtime.lastError?.code || 'indisponivel') } }
4. se !ctx.materialVersion -> { admitted:false, reason:'indisponivel', detail:{ motivo:'head do PR desconhecido; a coordenação exige a versão material' } }
5. ids = { uid: runtime.uid, accountHash: accountHash(ctx.account), prHash: prHash(ctx.prKey) }; fingerprint = operationFingerprint(ctx.operationKind, ctx.materialVersion); nowMs = runtime.agora()   // Date.now() + runtime.skewMs
6. se !ctx.ignorarRecibo: r = readReceipt(...); r.ok && receiptBlocks(r.receipt, nowMs) -> registrarRecibo(engine, ctx, r.receipt) e { admitted:false, reason:'recibo', detail:{ receipt, deviceName } }; r.ok === false -> { admitted:false, reason:'indisponivel', detail:{ motivo } }
7. se ctx.operationKind === 'review' && !ctx.ignorarRecibo: states = await engine.myReviewStates(ctx.pr, ctx.headSha); se Array.isArray(states) e algum está em DECISIVE (APPROVED|CHANGES_REQUESTED): escreve recibo external_review/published com ifMatch 'null_etag' (best-effort, ignora 412) e devolve { admitted:false, reason:'recibo', detail:{ externo:true } }. `null` (não deu para consultar) NÃO bloqueia.
8. leaseId = novoId(); a = acquireLease(...); 'alheio' -> { admitted:false, reason:'alheio', detail:{ deviceId: a.lease.deviceId, deviceName: nomeDoDispositivo(runtime, a.lease.deviceId), since: a.lease.acquiredAt } }; 'indisponivel' -> idem
9. relê o recibo sob o lease (repete o passo 6 sem o preflight do GitHub); bloqueia -> releaseLease e { admitted:false, reason:'recibo', ... }
10. se ctx.contaRodada: day = brasiliaDay(nowMs); attemptId = novoId(); rr = reserveRound(...); 'esgotado' -> releaseLease e { admitted:false, reason:'esgotado', detail:{ day, started } }; 'indisponivel' -> releaseLease e { admitted:false, reason:'indisponivel' }; ok -> startRound(...) (perdido/indisponivel -> releaseLease e 'indisponivel')
11. handle = createHandle(engine, { ids, fingerprint, leaseId, attemptId, ctx }); handle inicia o heartbeat (setInterval SYNC.HEARTBEAT_MS, `.unref()`), que chama renewLease; 'perdido' -> handle.lost = true, para o timer, chama cada cb de onLost, e engine.cancelSession(ctx.opId)
12. return { admitted:true, handle }
```

`Handle`:

```js
{
  noop: boolean, leaseId, attemptId, lost: false, done: false,
  onLost(cb): void,
  complete({ outcome = 'completed', publicationState, reviewId = '' }): Promise<{ ok:true } | { ok:false, code, motivo }>
    // se lost -> { ok:false, code:'conflito', motivo:'lease perdido; recibo não gravado' } (e não escreve)
    // writeReceipt(buildReceipt({...}), { ifMatch: 'null_etag' }); 412 -> lê o atual e, se completedAt do atual > nowMs - LEASE_TTL, mantém o do outro (não sobrescreve sucessor); depois releaseLease; para o timer; done = true
  abort(): Promise<void>   // para o timer, releaseLease (best-effort), done = true; sem recibo
}
noopHandle() -> { noop:true, leaseId:'', attemptId:'', lost:false, done:true, onLost(){}, complete: async () => ({ ok:true }), abort: async () => {} }
```

`registrarRecibo(engine, ctx, receipt)` grava em `engine.sync.recibosVistos[ctx.prKey] = { at, deviceId, deviceName, publicationState, operationKind }` (memória, vai para a UI) e, quando `ctx.operationKind === 'review'`, `engine.markSeen(ctx.prKey)`; quando `'pushback'`, nada (o chamador avança o marcador).

`preflightManual(engine, pr)` (usado por `launchReview` com `origem === 'clique'`): repete os passos 3, 6 (sem escrever nada) e uma leitura do lease (sem adquirir) e devolve `{ ok:true }` ou `{ ok:false, reason:'indisponivel'|'recibo'|'alheio', detail }`. Nunca reserva, nunca escreve.

---

## Gate em `lib/engine/session.js` (verbatim das peças novas)

```js
// Tipos de operação que passam por runClaudeStream. Allowlist exaustiva e FECHADA:
// com a coordenação entre dispositivos ligada, tipo ausente ou desconhecido é recusado
// ANTES do spawn (fail-closed). Prefixo do id (a/s/pb/c/f) segue só para diagnóstico.
const OPERACOES = Object.freeze({ review: 'coordena', self: 'coordena', pushback: 'coordena', chat: 'bypass', tool: 'bypass' });

async function admitirOperacao(engine, opts) {
  const kind = String(opts.operationKind || '');
  const modo = OPERACOES[kind];
  if (!modo) throw new Error(`operationKind ausente ou desconhecido (${kind || 'vazio'}): sessão recusada com a coordenação entre dispositivos ativa`);
  if (modo === 'bypass') return null;
  if (!opts.coordination || typeof opts.coordination !== 'object') throw new Error(`coordination ausente para ${kind}: sessão recusada com a coordenação entre dispositivos ativa`);
  return engine.syncAdmit({ ...opts.coordination, operationKind: kind, opId: opts.id || '' });
}

// O corpo de hoje vira runProvedor (renomeação sem mudança). runClaudeStream é o invólucro:
// com a coordenação DESLIGADA chama runProvedor no MESMO tick (contrato dos testes que
// capturam o spawn síncrono); LIGADA, admite antes de qualquer stub/spawn/ramo Codex.
function runClaudeStream(engine, prompt, opts = {}) {
  if (!(engine.syncCoordenacaoAtiva && engine.syncCoordenacaoAtiva())) return runProvedor(engine, prompt, opts);
  return admitirOperacao(engine, opts).then((adm) => {
    if (adm && adm.admitted === false) return { blocked: true, coordination: adm, text: '', sessionId: null };
    const handle = adm ? adm.handle : null;
    return runProvedor(engine, prompt, opts).then(
      (res) => Object.assign(res, { coordination: handle }),
      (err) => { const fim = handle ? handle.abort() : Promise.resolve(); return fim.then(() => { if (handle && handle.lost) err.coordenacao = 'perdido'; throw err; }); }
    );
  });
}
```

Fachadas em `server.js`: `syncCoordenacaoAtiva() { return syncMod.coordenacaoAtiva(this); }` e `syncAdmit(ctx) { return syncMod.admit(this, ctx); }`.

---

## Contratos dos chamadores (plano 02)

- **review.js `runHeadlessReview`**: `streamOpts` ganha `operationKind: 'review'` e `coordination: { prKey: pr.key, account: engine.accountForPr(pr), materialVersion: headShaAtual, headSha: headShaAtual, contaRodada: !!pr.rodadaAutomatica, manual: !!pr.manual, semCoordenacao: !!pr.semCoordenacao, ignorarRecibo: !!pr.ignorarRecibo, pr: { key: pr.key, url: pr.url, repo: pr.repo, number: pr.number, author: pr.author, account: pr.account } }`. Depois de `const res = await rodarSessao(...)`: `if (res.blocked) return tratarBloqueioDeCoordenacao(engine, pr, res.coordination);` (função nova em review.js: `engine.unsee(pr.key)`, `queue.push` se ausente, `engine.syncRegistrarEspera(pr.key, res.coordination)`, toast por motivo, e no caso `recibo` NÃO faz unsee (o coordenador já marcou seen)). `let coord = null;` fora do try; `coord = res.coordination;` logo após; no fim de cada ramo de desfecho, `await coord.complete({ publicationState })` com `'published'` (post ok), `'failed'` (post falhou), `'pending'` (recordDecision pending), `'external_review'`+`'published'` no `already_reviewed`; `catch (err) { throw err; }` não é preciso: o `finally` faz `if (coord && !coord.done) await coord.abort();`.
- **review.js `runOneHeadless`**: no `catch`, ANTES do ramo `err.cancelled`: `if (err.coordenacao) { engine.unsee(pr.key); if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr); engine.log('WARN', `revisao ${pr.key}: lease de coordenação perdido durante a sessão; nada foi postado`); engine.emit('toast', { kind: 'info', text: `${pr.key}: outro aparelho assumiu a coordenação; esta sessão foi encerrada sem postar.` }); }` e sai do catch (sem estacionar, sem retry).
- **review.js `launchReview(engine, urls, mode, origem, extras = {})`**: para `origem === 'clique'`, cada item ganha `manual: true`, `semCoordenacao: !!extras.semCoordenacao`, `ignorarRecibo: !!extras.ignorarRecibo`; se a coordenação está ativa e nenhuma das duas flags veio, roda `await engine.syncPreflightManual(it)` por item; bloqueados saem de `liberados` e entram em `coordenacao: [{ key, reason, detail }]` na resposta. Fachada: `async launchReview(urls, mode = 'auto', origem = 'auto', extras = {}) { return reviewMod.launchReview(this, urls, mode, origem, extras); }`. Rota: `engine.launchReview(urls, modo, 'clique', { semCoordenacao: body.semCoordenacao === true, ignorarRecibo: body.ignorarRecibo === true })`.
- **review.js `launchReReviews`**: o objeto enfileirado ganha `rodadaAutomatica: true`.
- **review.js `MAX_RODADAS_AUTO_DIA`**: `const MAX_RODADAS_AUTO_DIA = SYNC.DAILY_ROUNDS_MAX;` com `SYNC` somado ao import de `../constants.js`.
- **selfpr.js `runSelfAnalysis`**: opts ganham `operationKind: 'self'` e `coordination: { prKey: pr.key, account: accPr, materialVersion: shaAntes, headSha: shaAntes, contaRodada: false, manual: true, semCoordenacao: false, ignorarRecibo: false, pr: {...} }`; após o await: `if (res.blocked) { engine.emit('toast', { kind: 'info', text: textoBloqueio(pr.key, res.coordination) }); return; }`; depois de `engine.saveSelfAnalyses()`: `await res.coordination.complete({ publicationState: 'not_applicable' })`; no ramo `descartada` (head andou): `await res.coordination.abort()`.
- **pushback.js `classifyPushback(engine, pr, marker)`** (ganha o 3o parâmetro, o `det.marker`): opts ganham `operationKind: 'pushback'`, `coordination: { prKey: pr.key, account: acc, materialVersion: String(marker||''), headSha: '', contaRodada:false, manual:false, semCoordenacao:false, ignorarRecibo:false, pr: {...} }`; `if (res.blocked) return res.coordination.reason === 'recibo' ? { deduped: true } : null;`; após parse com sucesso, `await res.coordination.complete({ publicationState: 'not_applicable' })`; em `scanPushbacks`: `const cls = await engine.classifyPushback(pr, det.marker); if (cls && cls.deduped) { engine.pushbackScanned[pr.key] = det.marker; engine.savePushbackScanned(); continue; }`. Fachada `classifyPushback(pr, marker)`.
- **chat.js / tools.js**: `operationKind: 'chat'` / `operationKind: 'tool'` nos opts.
- **server.js `toReview`** (dentro de `_dispararAutomacoes`), logo depois de `if (this.retryAfterNet.has(p.key)) return false;`: `if (this.syncSeguraAutomacao(p.key)) return false;`. `syncSeguraAutomacao(key)` (fachada de `syncMod.seguraAutomacao(this, key)`): true quando coordenação ativa e (`runtime.status !== 'conectado'` OU `espera[key].until > Date.now()`); avisa uma vez por janela (`runtime.avisou`). `reReviewTargets` e `retryTargets` recebem o mesmo filtro (`!engine.syncSeguraAutomacao(pr.key)`).

---

## Runtime e composição (`lib/engine/sync.js`)

```js
engine.sync = {
  status: 'desligado' | 'sem-credencial' | 'conectando' | 'conectado' | 'erro',
  lastError: { code, motivo, at } | null,
  uid: '', email: '', deviceId: '', deviceName: '',
  client: RtdbClient | null, tokenSource | null,
  skewMs: 0,                        // servidor - local, medido no PATCH de presença
  agora: () => Date.now() + skewMs,
  devices: { [deviceId]: { name, platform, farolVersion, lastSeenAt } },   // snapshot lido no tick
  leasesVistos: { [prKey]: { deviceId, deviceName, since, operationKind } },   // do stream ou do tick
  recibosVistos: { [prKey]: { at, deviceId, deviceName, publicationState, operationKind, orfao: 'ativo'|'orfao'|'desconhecido' } },
  espera: { [prKey]: { reason, deviceName, until } },
  avisou: false, lastTickAt: 0, lastPresenceAt: 0,
  outbox: OutboxState | null,       // plano 03
}
```

Funções (todas recebem `engine`):

```js
coordenacaoAtiva(engine) -> coordinationActive(engine.config.sync)
consolidacaoAtiva(engine) -> consolidationActive(engine.config.sync)
bootSync(engine)                 // construtor: monta engine.sync com status 'desligado'; se enabled, lê credencial e dispositivo, status 'sem-credencial' ou 'conectando'; NUNCA toca rede
startSync(engine, fetchImpl)     // cria tokenSource/client, faz touchPresence (mede skew), status 'conectado' ou 'erro'
stopSync(engine)                 // solta client/tokenSource, cancela stream, status 'desligado'/'sem-credencial'
aplicarConfig(engine)            // chamado por updateSettings quando `sync` muda: liga/desliga conforme enabled
syncTick(engine)                 // chamado no check(): se conectado: touchPresence (respeita PRESENCE_TICK_MS), lê devices, poda espera vencida, (plano 03) flush da outbox; falha vira lastError e status 'erro' (transitório: próxima tick tenta de novo)
touchPresence(engine)            // PATCH devices/{deviceId} { name, platform, farolVersion, lastSeenAt: {'.sv':'timestamp'} }; createdAt por PUT com ifMatch 'null_etag' na primeira vez; skewMs = lastSeenAt devolvido - Date.now()
syncLogin(engine, { email, password }, fetchImpl) -> { ok:true, uid, email } | { ok:false, code, motivo }   // signInWithPassword; setSyncCredential; startSync
syncLogout(engine) -> { ok:true }                                  // removeSyncCredential; stopSync
syncTest(engine) -> { ok:true, uid, devices: n } | { ok:false, code, motivo }   // get devices shallow
syncEraseRemote(engine) -> { ok:true } | { ok:false, code, motivo }             // del `/users/${uid}` (sem ifMatch); status volta a 'conectado'
admit(engine, ctx) -> coordinator.admit(engine, ctx)
preflightManual(engine, pr) -> coordinator.preflightManual(engine, pr)
seguraAutomacao(engine, key) -> boolean (ver acima)
registrarEspera(engine, key, admissao) -> grava engine.sync.espera[key] = { reason, deviceName, until }
   // until: alheio -> agora + ESPERA_ALHEIO_MS; esgotado -> nextBrasiliaDayStartMs(agora); indisponivel -> agora + STREAM_RECONNECT_MS; recibo -> não registra (seen já resolve)
redoReceipt(engine, key) -> { ok } | { ok:false, ... }           // invalida o recibo de review do head atual (ifMatch) e chama launchReview([url], 'auto', 'clique', { ignorarRecibo: true })
statusForUi(engine) -> { enabled, coordination, consolidation, status, lastError, uid: uid ? uid.slice(0,6)+'…' : '', email, deviceId, deviceName, devices: [{ deviceId, name, platform, lastSeenAt, euMesmo }], espera: {...}, recibosVistos: {...}, leasesVistos: {...}, outbox: { pendentes, enviados, rejeitados, lastSentAt, paused } | null }
```

`snapshot()` ganha `sync: syncMod.statusForUi(this)`. `check()` chama `await this.syncTick()` logo depois de `refreshMergeStates` (fim do ciclo). `updateSettings`: quando a chave `sync` entra no patch, depois de `this.saveConfig()` chama `this.syncAplicarConfig()`.

Rotas (`lib/http-server.js`, bloco POST): `/api/sync/login` (`body.email`, `body.password`; resposta nunca ecoa a senha), `/api/sync/logout`, `/api/sync/test`, `/api/sync/erase-remote`, `/api/sync/redo` (`body.key`), `/api/sync/consolidate` (plano 03); GET `/api/sync/consolidated?days=` (plano 03).

---

## Outbox e consolidação (plano 03)

```js
// lib/sync/outbox.js
outboxPath() -> path.join(STATE_DIR, SYNC.OUTBOX_FILE)
defaultOutbox() -> { cursorAt: 0, pending: [], enviados: 0, rejeitados: 0, lastSentAt: 0, paused: false }
readOutbox() / saveOutbox(outbox)
payloadFor(sessao, deviceId, farolVersion) -> { at, day, kind, accountHash: accountHash(sessao.account), refHash: prHash(sessao.ref)||'', model, profileId, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, costUsd, costSource, status: sessao.status||'ok', farolVersion, localId: sessao.id||'' }
enqueueSession(outbox, sessao, deviceId, farolVersion) -> boolean   // dedupe por eventId (substitui payload); avança cursorAt = max(cursorAt, sessao.at)
reconcileFromSessions(outbox, sessions, deviceId, farolVersion) -> n enfileirados   // sessões com at > cursorAt
flushOutbox(client, uid, deviceId, outbox, { batch = SYNC.OUTBOX_BATCH }) -> { ok, enviados, restantes, code? }
   // PATCH `/users/${uid}/usageEvents/${deviceId}` com { [eventId]: payload } dos primeiros `batch`;
   // ok -> remove do pending, enviados += n, lastSentAt; 4xx (resposta_invalida) -> tentativas++ em cada; >= OUTBOX_MAX_REJEICOES -> rejeitados++ e sai do pending; indisponivel/timeout/nao_autorizado -> mantém tudo
resetForFullSync(outbox) -> cursorAt = 0 (migração inicial; a próxima reconciliação reenfileira o histórico inteiro)
```

Ganchos em `lib/engine/usage.js`: no fim de `recordUsage`, `if (engine.syncEnqueueUsage) engine.syncEnqueueUsage(registro);` (o objeto que acabou de entrar em `sessions`); em `marcarDesfecho`, depois de `alvo.status = status`, o mesmo gancho com `alvo`. Fachada `syncEnqueueUsage(sessao)`, no-op quando a consolidação está desligada.

```js
// lib/sync/consolidated.js (puro)
consolidatedSummary(usageEvents, devices, { days, agoraMs, euDeviceId })
  -> { devices: [{ deviceId, name, euMesmo, sessions, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, lastAt }], series: [{ day, costUsd, sessions }], totals: { sessions, costUsd, medido, estimado, semBase } }
  // usageEvents = { [deviceId]: { [eventId]: payload } }; days = 0 (tudo) | 7 | 15 | 30 sobre payload.day >= brasiliaDay(agoraMs - days*DIA_MS)
```

UI: seg `#usageDevice` (`Este dispositivo` | `Todos os dispositivos`) acima dos KPIs, visível só com `STATE.sync.consolidation`; ao escolher "Todos", `get('/api/sync/consolidated?days=' + usageState.window)` e render por `usageConsolidatedHtml(resumo)` em `ui/pure.js` (tabela por aparelho + totais); "Este dispositivo" volta ao `renderUsage()` de sempre.

---

## Regras do banco (`firebase/database.rules.json`, verbatim)

```json
{
  "rules": {
    "users": {
      "$uid": {
        ".read": "auth != null && auth.uid == $uid",
        ".write": "auth != null && auth.uid == $uid",
        "leases": {
          "$acct": {
            "$pr": {
              ".validate": "newData.hasChildren(['leaseId', 'deviceId', 'operationKind', 'expiresAt']) && newData.child('expiresAt').isNumber() && newData.child('expiresAt').val() > now && newData.child('expiresAt').val() <= now + 300000 && (!data.exists() || data.child('expiresAt').val() < now || data.child('leaseId').val() == newData.child('leaseId').val())"
            }
          }
        },
        "receipts": {
          "$acct": {
            "$pr": {
              "$fp": {
                ".validate": "newData.hasChildren(['operationKind', 'materialVersion', 'deviceId', 'completedAt', 'outcome', 'publicationState']) && newData.child('completedAt').isNumber()"
              }
            }
          }
        },
        "dailyRounds": {
          "$acct": {
            "$pr": {
              "$day": {
                ".validate": "$day.matches(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) && newData.child('dayPolicy').val() == 'America/Sao_Paulo'"
              }
            }
          }
        },
        "usageEvents": {
          "$device": {
            "$event": {
              ".validate": "newData.hasChildren(['at', 'kind', 'costUsd']) && newData.child('at').isNumber()"
            }
          }
        }
      }
    }
  }
}
```

`300000` nas regras é `SYNC.LEASE_TTL_MAX_MS`; `test/sync-constants.test.js` lê o JSON e afirma que os dois batem e que `SYNC.LEASE_TTL_MS < SYNC.LEASE_TTL_MAX_MS`. Isolamento por UID e validade temporal ficam nas regras; posse na remoção fica no `if-match` (regras não veem o `leaseId` de quem apaga).

`firebase/firebase.json`: `{ "database": { "rules": "database.rules.json" }, "emulators": { "database": { "port": 9000 }, "auth": { "port": 9099 }, "ui": { "enabled": false }, "singleProjectMode": true } }`.

`firebase/README.md`: roteiro do usuário (criar projeto, Realtime Database em modo bloqueado, colar as regras, habilitar Authentication > E-mail/senha, criar o usuário, copiar Web API key e URL do banco para o Farol, fazer login em cada aparelho) e o roteiro da Fase 5 com emulador (`firebase emulators:start --only database,auth --project farol-local`, `FAROL_HOME` separado por instância, `databaseUrl http://127.0.0.1:9000`, `projectId farol-local`, criação do usuário no emulador via REST `signUp`), sem credencial pessoal em lugar nenhum.

---

## Dublês de teste (`test/helpers/`)

```js
// fake-rtdb.js
startFakeRtdb({ token = 'tok-ok', agora = () => Date.now() } = {}) -> Promise<{
  url,                       // 'http://127.0.0.1:<porta>'
  close(): Promise<void>,
  tree(): object,            // cópia profunda da árvore
  setTree(obj): void,
  requests: [],              // { method, path, query, headers, body }
  setNow(ms): void,          // relógio usado em ".sv" timestamp
  streams: number,           // conexões SSE abertas
  fecharStreams(): void,
  emitirAuthRevoked(): void,
}>
// Semântica: GET/PUT/PATCH/DELETE em `<path>.json`; `?auth=` precisa igualar `token` (senão 401
// {"error":"Permission denied"}); ETag = 'null_etag' para null, senão sha1 do JSON canônico;
// `X-Firebase-ETag: true` devolve header ETag em GET/PUT/DELETE; `if-match` em PUT/DELETE compara
// com o ETag atual (412 com corpo = valor atual e header ETag); `if-match` em PATCH ou GET -> 400;
// `{".sv":"timestamp"}` vira agora(); PUT/PATCH devolvem o valor gravado; DELETE devolve null;
// `?shallow=true` em GET; `?print=silent` -> 204; chave com . $ # [ ] / -> 400;
// `Accept: text/event-stream` -> SSE: `event: put` com {path:'/', data:<subárvore>} e, a cada escrita
// sob o caminho, novo `event: put` com o caminho relativo; `keep-alive` a cada 100 ms; `auth_revoked` por emitirAuthRevoked().

// fake-identity.js
startFakeIdentity({ apiKey = 'key-1', users = { 'a@b.com': { password: 'segredo', uid: 'u1' } }, expiresIn = 3600 } = {}) -> Promise<{
  url,                       // base; signIn em `${url}/v1/accounts:signInWithPassword?key=`, refresh em `${url}/v1/token?key=`
  close(),
  requests: [],
  tokens: { idTokens: [], refreshTokens: [] },   // emitidos, para o teste comparar
  revogar(refreshToken): void                     // próximo refresh responde TOKEN_EXPIRED
}>
```

---

## Índice de tarefas (24)

| # | Tarefa | Plano | Depende de |
|---|---|---|---|
| T1 | `SYNC` em constants + `lib/sync/errors.js` + teste | 01 | |
| T2 | `lib/sync/keys.js` + teste (hash, fingerprint, dia de Brasília nas bordas) | 01 | T1 |
| T3 | `lib/sync/config.js` + entrada em `settings.js` + `PARSERS` + saneamento no boot + teste | 01 | T1 |
| T4 | `lib/sync/credentials.js` + `lib/sync/device.js` + testes | 01 | T1, T2 |
| T5 | `test/helpers/fake-identity.js` + `lib/sync/auth.js` + teste | 01 | T1 |
| T6 | `lib/sync/sse.js` + teste | 01 | |
| T7 | `test/helpers/fake-rtdb.js` + `lib/sync/rtdb.js` + teste | 01 | T1, T2, T6 |
| T8 | classe `coordenacao-indisponivel` na taxonomia + teste | 01 | |
| T9 | `lib/engine/sync.js` (runtime, login/logout/test/erase, presença, tick, status) + fachadas + rotas + snapshot + `updateSettings` + teste de boot/invariantes | 01 | T3, T4, T5, T7 |
| T10 | `firebase/` (regras, firebase.json, README) + teste de coerência das regras | 01 | T1 |
| T11 | Desenho no Claude Design (gate do spec, sem código) | 01 | T9 |
| T12 | UI: seção `sys-sync` (nav, painel, `renderSync`, `saveSync`, login, teste, sair, apagar) + pure + css + testes | 01 | T9, T11 |
| T13 | `lib/sync/lease.js` + teste (dois clientes disputam, expirado, renew perdido, release só o meu) | 02 | T7 |
| T14 | `lib/sync/receipts.js` + teste (bloqueio, órfão, CAS) | 02 | T7 |
| T15 | `lib/sync/rounds.js` + teste (teto, dia canônico com dois fusos, CAS) | 02 | T7, T2 |
| T16 | `lib/sync/coordinator.js` + teste (fluxo completo com fake, releitura sob lease, heartbeat perdido, complete/abort, noop) | 02 | T13, T14, T15, T9 |
| T17 | Gate em `session.js` (`OPERACOES`, `admitirOperacao`, invólucro) + teste (antes do stub e do Codex; ausente falha alto; bypass; desligado é síncrono) | 02 | T16 |
| T18 | review.js (opts, bloqueio, complete/abort, `runOneHeadless`, `rodadaAutomatica`, `MAX_RODADAS_AUTO_DIA`) + `toReview`/`reReviewTargets`/`retryTargets` + teste | 02 | T17 |
| T19 | selfpr.js + pushback.js + chat.js + tools.js + testes | 02 | T17 |
| T20 | Clique manual: `launchReview` com preflight/overrides + rota + UI (confirmação) + `redo` de recibo órfão + teste | 02 | T18 |
| T21 | UI de coordenação: anotação de espera no card da fila, recibos/órfãos e leases vistos na seção `sys-sync` + testes | 02 | T18, T12 |
| T22 | `lib/sync/outbox.js` + ganchos em `usage.js` + teste (idempotência, crash entre save e outbox, correção de status) | 03 | T9 |
| T23 | `lib/sync/consolidated.js` + rota GET + `consolidate` + teste | 03 | T22 |
| T24 | UI da aba Consumo (`#usageDevice`, `usageConsolidatedHtml`) + testes | 03 | T23 |

Fase 5 (validação manual com emulador e dois `FAROL_HOME`) está no `firebase/README.md` (T10) e não é tarefa de código.
