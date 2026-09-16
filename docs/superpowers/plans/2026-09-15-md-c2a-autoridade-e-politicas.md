# C2a Autoridade do admin, consentimento local e políticas remotas: plano de implementação

> **Ajustes de execução (15/09/2026):** worktree `C:\Users\wanderson\Documents\farol-md-exec`; branch `md/c2a` cortada da ponta de `md/integracao` (com C1a, C0, A5, A1, A4, C0b e C1). Sem `git fetch`/`merge origin/main`. Evidência em `docs/superpowers/handoff/2026-09-15-operacao-multidispositivo/evidencias-execucao/c2a.md`.

> **Para quem executa:** use superpowers:executing-plans, tarefa por tarefa.

> **Densidade deste plano, declarada.** As Tarefas 1 e 2 trazem o teste literal; das Tarefas 3 a 8 o plano traz a **lista de casos obrigatórios** e as interfaces exatas, não o código de teste linha a linha. É uma escolha, não esquecimento: na C1 boa parte do código literal do plano precisou ser corrigida na execução (assinatura errada de `saveConfig`, corpo do dublê lido como objeto, contraprovas que não falhavam), e o que sobreviveu intacto foram as **interfaces** e a **lista de garantias**. Quem executar precisa escrever o teste de cada caso listado e, se um caso não puder ser provado como descrito, registrar isso na evidência em vez de apagar o caso.

**Por que este plano é metade da 7.C2.** A entrega 7.C2 da spec cobre quatro assuntos independentes: autoridade do admin com políticas, grupo de consumo, gestão de aparelho e limpeza protegida. Cada um produz software testável sozinho, e juntos dariam um plano grande demais para revisar. Este é o **C2a**: autoridade, consentimento e políticas. O **C2b** (grupo de consumo configurado, gestão de aparelho, limpeza protegida e revogação) vem depois e depende da assinatura e da autoridade que nascem aqui.

**Objetivo:** tornar este aparelho admin por reautenticação com a senha real do Firebase, publicar autoridade assinada com frescor por sequência, e deixar o consumidor aceitar políticas remotas que só RESTRINGEM o que a config local já permite, com opt-in local explícito.

**Arquitetura:** três folhas novas em `lib/sync/` (`admin-chave.js`, `assinatura.js`, `autoridade.js`), uma pura em `lib/engine/` (`politica-efetiva.js`) e um módulo de fiação (`lib/engine/sync-admin.js`), pelo mesmo motivo do `sync-chave.js` da C1: `lib/engine/sync.js` vive no teto de 400 linhas úteis do ratchet.

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`, seções 5 (CT-ADM-POL) e 7.C2. Detalhe normativo no anexo C1, seções "Admin e auth_time" e "Nós do banco", respeitando os blocos de trechos superados.

> **Regra de execução aprendida na C2a:** o script de contraprova **muta o arquivo no disco**. Nunca rode `npm test` (nem outro `node --test`) em paralelo com ele: a suíte carrega o módulo mutado e reprova por um motivo que não existe. Rodar contraprova e suíte é sempre em série.

## Constraints globais

- **Zero dependências novas.** Só `node:crypto`. Texto e comentários em português, sem travessão.
- **`K_adm`:** par Ed25519 (`crypto.generateKeyPairSync('ed25519')`) que **nasce e mora só no aparelho admin**, em `~/.farol/sync-admin.json`, modo 0600 em toda gravação, com `{ uid, destino, generation, jwk }`. Apagado quando a geração muda.
- **Assinatura:** Ed25519 sobre `'farol|sig|1|<uid>|<caminho>|<generation>|' + sha256hex(valor canônico)`, resultado em base64url com **86 caracteres**.
- **A assinatura não é controle de acesso.** Ela vale contra cliente honesto com defeito e contra versão divergente; o banco não verifica criptografia. Isso fica escrito na tela técnica **e num teste**.
- **Tornar-se admin:** `signInWithPassword` com a senha real primeiro; só então gera o par, lê `live/control/admin` com ETag e grava `{ deviceId, generation: anterior + 1, publicKey, setAt }` com `if-match`. A senha nunca é gravada nem sincronizada.
- **Frescor (CT-ADM-POL), valendo para autoridade e prontidão:** cada publicação carrega **sequência monotônica** dentro da geração; valor do snapshot inicial, reentrega sem mudança e keep-alive **não provam frescor**; frescor exige observar, depois do início da conexão atual, uma mudança para sequência **maior** que a última vista, pelo relógio local; a maior sequência vista é **persistida**; vencimento sem mudança por **três intervalos** de publicação; até o primeiro valor fresco o sinal é **desconhecido**, e vale a regra mais restritiva.
- **Aceitar política exige, todos juntos:** `config.sync.aceitarAdmin` ligado localmente (só `true` explícito, pela tela do próprio aparelho; nenhum payload remoto contém a chave), assinatura válida da geração vigente, autoridade fresca, chaves dentro da allowlist e o mesmo saneador e clamp do consumidor.
- **Remoto só restringe:** pausa = pausado se qualquer um pausar; teto de paralelismo = o **menor**; contas elegíveis e tipos de operação = **interseção**. A queda do admin **nunca** remove pausa nem amplia limite.
- **Política nunca toca** gate de postagem, `config.json` nem credencial. O valor efetivo fica em memória; o cache da última política aceita fica em `~/.farol/sync-policy.json`, modo 0600, fora do `config.json` e de `state/`.
- **Sair de uma restrição remota** só por: política nova válida; o dono desligando `aceitarAdmin` naquele aparelho (descarta o cache, volta à config local inteira, com aviso); ou o dono desligando a sincronização ali.
- **O ratchet não pode subir.** `lib/engine/sync.js` está no teto: toda lógica nova nasce em módulo próprio.
- **Nenhum teste existente é enfraquecido.** Ajuste ligado à forma antiga é permitido preservando a garantia, e precisa ser declarado na evidência.
- **Nada toca `~/.farol` real, GitHub real ou Firebase real.** Nenhuma regra é publicada.

---

## Mapa de arquivos

| Ação | Caminho |
|---|---|
| criar | `lib/sync/admin-chave.js`, `lib/sync/assinatura.js`, `lib/sync/autoridade.js` |
| criar | `lib/engine/politica-efetiva.js`, `lib/engine/sync-admin.js` |
| criar | `test/sync-admin-desligado.test.js`, `test/sync-admin-chave.test.js`, `test/sync-assinatura.test.js`, `test/sync-autoridade.test.js`, `test/sync-tornar-admin.test.js`, `test/sync-politica-efetiva.test.js`, `test/sync-politicas.test.js` |
| editar | `lib/sync/config.js` (`aceitarAdmin`), `lib/constants.js` (`SYNC`: batimento e arquivos) |
| editar | `lib/engine/sync.js` (fiação mínima), `server.js`, `lib/http-server.js`, `lib/local-auth/inventario.js` |
| editar | `firebase/database.rules.template.json` e o gerado |
| editar | `CLAUDE.md`, `firebase/README.md` |

---

## Tarefa 0: preparação e gate de partida

- [ ] **Passo 1:** `git checkout md/integracao && git checkout -b md/c2a`; `git status --short` vazio.
- [ ] **Passo 2:** `npm run check && npm run lint && npm test` verdes; anote os números.
- [ ] **Passo 3:** confirme as peças da C1 que esta entrega consome:

```bash
grep -n "function sondarRegras" lib/sync/sonda-regras.js
grep -n "function tag64" lib/sync/tags.js
grep -n "sharedActive" lib/sync/config.js
grep -n "estadoDaChave" lib/engine/sync-chave.js
```

---

## Tarefa 1: caracterização do admin desligado

**Arquivos:** criar `test/sync-admin-desligado.test.js`.

Nasce VERDE contra o código de hoje e continua verde depois de todas as tarefas: sem `aceitarAdmin` e sem admin publicado, nada muda.

- [ ] **Passo 1:** criar o teste.

```js
// Admin e políticas DESLIGADOS: o Farol se comporta como hoje. Este arquivo nasce antes da
// mudança e continua verde depois (CT-COMPAT e CT-ADM-POL, "sem cache vale a config local").
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-desligado-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const cfgMod = (await import('../lib/sync/config.js')).default;
const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('o padrão não aceita admin: aceitarAdmin nasce desligado', () => {
  assert.equal(cfgMod.syncDefaults().aceitarAdmin, false);
  for (const v of [undefined, null, 'true', 1, {}]) {
    assert.equal(cfgMod.parseSyncConfig({ aceitarAdmin: v }).aceitarAdmin, false, JSON.stringify(v));
  }
  assert.equal(cfgMod.parseSyncConfig({ aceitarAdmin: true }).aceitarAdmin, true);
});

test('nenhum payload remoto liga o consentimento: a chave não vem do banco', () => {
  const salvo = cfgMod.parseSyncConfig({ aceitarAdmin: true, politica: { aceitarAdmin: true } });
  assert.equal(salvo.aceitarAdmin, true, 'só a tela local liga');
  assert.equal(salvo.politica, undefined, 'política não entra no config');
});

test('sem admin e sem política, o status não promete autoridade nenhuma', () => {
  const e = new Engine();
  const s = syncMod.statusForUi(e);
  assert.equal(s.admin, undefined);
  assert.equal(s.autoridade, undefined);
});

test('arquivo de política e de chave de admin não existem sem ninguém pedir', () => {
  const e = new Engine();
  assert.ok(e);
  assert.equal(fs.existsSync(path.join(CASA, '.farol', 'sync-policy.json')), false);
  assert.equal(fs.existsSync(path.join(CASA, '.farol', 'sync-admin.json')), false);
});
```

- [ ] **Passo 2:** `node --test test/sync-admin-desligado.test.js`. Os dois primeiros casos reprovam (a chave ainda não existe) e os dois últimos passam. Implemente a Tarefa 6 (o interruptor) antes de fechar esta tarefa, ou aceite a ordem: escreva o teste, veja reprovar, e ele fica verde ao fim da Tarefa 6.

- [ ] **Passo 3:** commit junto com a Tarefa 6.

---

## Tarefa 2: chave do admin (Ed25519)

**Arquivos:** criar `lib/sync/admin-chave.js` e `test/sync-admin-chave.test.js`.

**Interfaces:** `gerarParDeAdmin()` → `{ publicKey, jwk }`; `lerChaveDeAdmin()`; `gravarChaveDeAdmin({ uid, destino, generation, jwk })` com 0600; `apagarChaveDeAdmin()`; `chaveServe(chave, { uid, destino, generation })`.

- [ ] **Passo 1:** escrever o teste que falha.

```js
// A chave privada do admin NASCE e MORA só no aparelho admin (CT-ENV). Ela é apagada
// quando a geração muda: uma geração nova significa outro admin, e guardar a chave velha
// só cria caminho para assinar com autoridade que não existe mais.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-adminkey-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ak = await import('../lib/sync/admin-chave.js');
const { IS_WIN } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { ak.apagarChaveDeAdmin(); });

const DESTINO = 'u1|https://x.firebaseio.com';

test('par novo: a pública tem 43 caracteres base64url e a privada é jwk', () => {
  const par = ak.gerarParDeAdmin();
  assert.equal(par.publicKey.length, 43);
  assert.match(par.publicKey, /^[A-Za-z0-9_-]+$/);
  assert.equal(par.jwk.kty, 'OKP');
  assert.equal(par.jwk.crv, 'Ed25519');
  assert.notEqual(ak.gerarParDeAdmin().publicKey, par.publicKey);
});

test('gravar e ler devolve a mesma chave, e o arquivo mora em ~/.farol', () => {
  const par = ak.gerarParDeAdmin();
  assert.equal(ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 2, jwk: par.jwk }), true);
  const lida = ak.lerChaveDeAdmin();
  assert.equal(lida.generation, 2);
  assert.deepEqual(lida.jwk, par.jwk);
  assert.equal(path.basename(ak.caminhoDaChaveDeAdmin()), 'sync-admin.json');
});

test('chaveServe: uid, destino ou geração diferentes não servem', () => {
  const par = ak.gerarParDeAdmin();
  const c = { uid: 'u1', destino: DESTINO, generation: 2, jwk: par.jwk };
  assert.equal(ak.chaveServe(c, { uid: 'u1', destino: DESTINO, generation: 2 }), true);
  assert.equal(ak.chaveServe(c, { uid: 'u2', destino: DESTINO, generation: 2 }), false);
  assert.equal(ak.chaveServe(c, { uid: 'u1', destino: 'outro', generation: 2 }), false);
  assert.equal(ak.chaveServe(c, { uid: 'u1', destino: DESTINO, generation: 3 }), false, 'geração nova é outro admin');
  assert.equal(ak.chaveServe(null, { uid: 'u1', destino: DESTINO, generation: 2 }), false);
});

test('arquivo corrompido não lança e não serve', () => {
  fs.mkdirSync(path.dirname(ak.caminhoDaChaveDeAdmin()), { recursive: true });
  fs.writeFileSync(ak.caminhoDaChaveDeAdmin(), 'nao e json');
  assert.equal(ak.lerChaveDeAdmin(), null);
});

test('modo 0600 depois de CADA gravação (posix)', { skip: IS_WIN ? 'chmod não vale em NTFS' : false }, () => {
  const par = ak.gerarParDeAdmin();
  ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 1, jwk: par.jwk });
  assert.equal(fs.statSync(ak.caminhoDaChaveDeAdmin()).mode & 0o777, 0o600);
  ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 2, jwk: par.jwk });
  assert.equal(fs.statSync(ak.caminhoDaChaveDeAdmin()).mode & 0o777, 0o600);
});
```

- [ ] **Passo 2:** rodar; esperado `Cannot find module`.

- [ ] **Passo 3:** criar `lib/sync/admin-chave.js`, no mesmo molde do `cache-chave.js` da C1 (allowlist de campos, `io.writeJsonAtomic`, `chmod 0600` em toda gravação, leitura tolerante que devolve `null`). A pública sai de `publicKey.export({ format: 'jwk' }).x` (43 caracteres base64url); a privada é guardada como JWK.

- [ ] **Passo 4:** rodar o arquivo; verde.

- [ ] **Passo 5 (contraprova):** (a) apague o `restringir(...)` da gravação: reprova o caso 0600 no POSIX; (b) em `chaveServe`, tire a comparação de `generation`: reprova `geração nova é outro admin`.

- [ ] **Passo 6:** commit.

---

## Tarefa 3: assinatura Ed25519

**Arquivos:** criar `lib/sync/assinatura.js` e `test/sync-assinatura.test.js`.

**Interfaces:** `preImagemDaAssinatura({ uid, caminho, generation, valor })`; `assinar(jwk, ctx)` → 86 caracteres base64url; `verificar(publicKey, sig, ctx)` → booleano, **sem lançar**.

- [ ] **Passo 1:** escrever o teste que falha, cobrindo: assinatura de 86 caracteres; ida e volta; falha ao mudar uid, caminho, geração ou valor; falha com chave pública de outro par; assinatura malformada devolve `false` em vez de lançar; e o caso que a spec manda ter, **"a assinatura não é controle de acesso"**, afirmando explicitamente que o banco não a verifica (comentário + asserção de que `verificar` é chamado pelo CLIENTE, lendo o fonte de quem consome).

- [ ] **Passo 2:** rodar; `Cannot find module`.

- [ ] **Passo 3:** criar o módulo, com `createSign`/`createVerify` de Ed25519 (`crypto.sign(null, dados, chave)`), pré-imagem `'farol|sig|1|<uid>|<caminho>|<generation>|' + sha256hex(valor canônico)` e `safeStringify` de `lib/io.js` para o valor canônico.

- [ ] **Passo 4:** rodar; verde.

- [ ] **Passo 5 (contraprova):** (a) tire o `caminho` da pré-imagem: reprova o caso de mover a assinatura de nó; (b) tire a `generation`: reprova o caso da geração antiga.

- [ ] **Passo 6:** commit.

---

## Tarefa 4: tornar ESTE aparelho admin

**Arquivos:** criar `lib/engine/sync-admin.js` e `test/sync-tornar-admin.test.js`; fiação em `sync.js`, `server.js`, `lib/http-server.js` e no inventário de rotas.

**Interfaces:** `syncTornarAdmin(engine, cfg, fetchImpl, { password })` → `{ ok: true, generation }` ou `{ ok: false, code, motivo }`. A rota é `POST /api/sync/admin`, classe `recebe-segredo`.

Ordem obrigatória, da spec: **senha primeiro**. `signInWithPassword` com a senha real; só então gera o par, lê `live/control/admin` com ETag e grava com `if-match` e `generation: anterior + 1`.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - senha certa: grava `{ deviceId, generation: 1, publicKey, setAt }`, guarda a privada localmente e devolve `generation: 1`;
  - **senha errada não troca admin**: nada no banco, nada no disco;
  - já existe admin na geração 2: a nova gravação vai com `generation: 3`;
  - conflito de ETag (outro aparelho virou admin no meio) devolve recusa e **não** sobrescreve;
  - a senha não aparece em config, snapshot, log nem no arquivo da chave;
  - com o compartilhamento desligado, a rota recusa sem tocar rede.

- [ ] **Passo 2:** rodar; reprova.

- [ ] **Passo 3:** implementar em `lib/engine/sync-admin.js`, reusando `signInWithPassword` com `fetchDe(rt)` e `authUrlsFor(cfg.databaseUrl)`, como o `syncUnlock` da C1 faz. Fiação de uma linha em `sync.js`.

- [ ] **Passo 4:** rodar o arquivo mais `test/sync-engine.test.js`, `test/http.test.js`, `test/facades.test.js` e `test/local-auth-inventario.test.js` (a rota nova precisa de classe, e a contagem sobe).

- [ ] **Passo 5 (contraprova):** (a) mova o `signInWithPassword` para depois da gravação: reprova `senha errada não troca admin`; (b) troque `generation: anterior + 1` por `generation: anterior`: reprova o caso da geração.

- [ ] **Passo 6:** commit.

---

## Tarefa 5: batimento de autoridade e frescor por sequência

**Arquivos:** criar `lib/sync/autoridade.js` e `test/sync-autoridade.test.js`.

**Interfaces (todas PURAS menos `publicarAutoridade`):**
- `novoEstadoDeAutoridade()` → `{ sequenciaVista: 0, fresca: false, ultimaMudancaEm: 0 }`;
- `observarAutoridade(estado, sinal, { agora, conexaoIniciadaEm, intervaloMs })` → estado novo, aplicando a regra de CT-ADM-POL;
- `autoridadeFresca(estado, { agora, intervaloMs })` → booleano;
- `publicarAutoridade(client, uid, { jwk, deviceId, generation, sequencia })`.

Regra, literal da spec: valor do snapshot inicial **não** prova frescor; reentrega sem mudança **não** prova; frescor exige mudança para sequência **maior** que a última vista, observada **depois** do início da conexão atual, pelo relógio local; a maior sequência vista é **persistida**; vence sem mudança por **três intervalos**; até o primeiro valor fresco o sinal é **desconhecido**.

- [ ] **Passo 1:** escrever o teste que falha, com um caso para cada frase acima, mais: sequência menor depois de reinício nunca é aceita como nova; assinatura inválida não atualiza nada; e o vencimento em três intervalos.

- [ ] **Passo 2:** rodar; `Cannot find module`.

- [ ] **Passo 3:** implementar. A sequência vista mora em `state/sync-autoridade.json` (é dado de coordenação, não segredo, então fica em `state/`, ao lado do `sync-outbox.json`).

- [ ] **Passo 4:** rodar; verde.

- [ ] **Passo 5 (contraprova):** (a) aceite o valor do snapshot inicial como fresco: reprova; (b) troque `maior que` por `maior ou igual`: reprova a reentrega; (c) tire a persistência: reprova o caso do reinício.

- [ ] **Passo 6:** commit.

---

## Tarefa 6: consentimento local `aceitarAdmin`

**Arquivos:** editar `lib/sync/config.js`, `lib/settings.js` (a tabela guarda uma CÓPIA dos defaults: a C1 já pagou esse pedágio) e os fixtures de forma de `test/sync-config.test.js`.

- [ ] **Passo 1:** `aceitarAdmin: r.aceitarAdmin === true` no saneador e `aceitarAdmin: false` no default, nos dois lugares.
- [ ] **Passo 2:** rodar `test/sync-admin-desligado.test.js`, `test/sync-config.test.js`, `test/settings.test.js`: verdes.
- [ ] **Passo 3 (contraprova):** `r.aceitarAdmin !== undefined`: reprova `só true explícito liga`.
- [ ] **Passo 4:** commit, junto com a Tarefa 1.

---

## Tarefa 7: publicar e aceitar políticas

**Arquivos:** criar o cache `~/.farol/sync-policy.json` (0600) e as funções de publicar (admin) e aceitar (consumidor), em `lib/engine/sync-admin.js`; `test/sync-politicas.test.js`.

**Allowlist da política:** `pausado` (booleano), `tetoParalelismo` (1 a 4, clamp), `contasElegiveis` (lista de tags), `tiposDeOperacao` (subconjunto de `review`, `self`, `pushback`, `chat`, `tool`). Chave fora da allowlist é **descartada**, não recusa o pacote.

- [ ] **Passo 1:** escrever o teste que falha, com os casos:
  - política assinada e válida, com `aceitarAdmin` ligado e autoridade fresca, entra no cache;
  - **`aceitarAdmin` desligado: a política não muda nada**, nem o cache;
  - assinatura inválida, geração antiga ou chave pública diferente são recusadas **antes de decifrar**;
  - autoridade não fresca: a política nova não é aceita, e a anterior continua valendo;
  - chave fora da allowlist é descartada, e o resto da política vale;
  - `tetoParalelismo` fora de 1 a 4 é clampado, não recusado;
  - o cache tem modo 0600 e não contém segredo.

- [ ] **Passo 2:** rodar; reprova.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) aceite política com `aceitarAdmin` desligado: reprova; (b) verifique a assinatura DEPOIS de aplicar: reprova o caso da assinatura inválida.
- [ ] **Passo 6:** commit.

---

## Tarefa 8: valor efetivo (remoto só restringe)

**Arquivos:** criar `lib/engine/politica-efetiva.js` (PURA) e `test/sync-politica-efetiva.test.js`.

**Interface:** `politicaEfetiva(local, remota, { autoridade })` → `{ pausado, tetoParalelismo, contasElegiveis, tiposDeOperacao, origem }`, onde `origem` diz, campo a campo, se o valor veio de `local`, de `remoto` ou de `restricao-mantida` (autoridade indisponível com cache).

- [ ] **Passo 1:** escrever o teste que falha, com um caso por regra:
  - pausa: pausado se **qualquer** um dos dois pausar;
  - teto: o **menor** dos dois;
  - contas e tipos: **interseção**;
  - sem cache: vale a config local inteira;
  - autoridade indisponível **com** cache: a combinação continua, e **a queda não remove pausa nem amplia teto**;
  - `origem` marca `restricao-mantida` nesse caso;
  - remoto mais permissivo que o local **nunca** amplia.

- [ ] **Passo 2:** rodar; `Cannot find module`.
- [ ] **Passo 3:** implementar, sem ternário aninhado (o gate conta dois `?` no mesmo statement).
- [ ] **Passo 4:** rodar; verde.
- [ ] **Passo 5 (contraprova):** (a) troque o menor por `remota.tetoParalelismo`: reprova; (b) faça a queda de autoridade voltar à config local: reprova `a queda não remove pausa`.
- [ ] **Passo 6:** commit.

---

## Tarefa 9: regras v2 para os nós novos

**Arquivos:** editar `firebase/database.rules.template.json`, regerar o `.json`, editar `test/sync-rules-contrato.test.js`.

Nós, com as regras do anexo C1 ("Nós do banco"):
- `live/control/admin`: `@U@ && @REC@ && @H(['deviceId','generation','publicKey','setAt'])@ && newData.child('publicKey').isString() && ((!data.exists() && newData.child('generation').val() == 1) || newData.child('generation').val() == data.child('generation').val() + 1)`;
- `live/control/beat`: `@U@ && @H(['dev','generation','beatAt','sig'])@ && @GEN@ && newData.child('dev').val() == @C@.child('admin').child('deviceId').val() && newData.child('beatAt').isNumber() && newData.child('beatAt').val() + 60000 > now && newData.child('beatAt').val() < now + 60000`;
- `live/devicePolicies/$dev`: `@U@ && @H(['enc','generation','sequencia','sig'])@ && @GEN@ && @ENC(2048)@`.

- [ ] **Passo 1:** acrescente os nós ao template e rode `npm run sync:rules`.
- [ ] **Passo 2:** acrescente ao `test/sync-rules-contrato.test.js` um caso por nó novo, e **atualize a lista de nós com concessão** (o caso "só os nós listados têm concessão" é o que pega nó novo entrando sem revisão).
- [ ] **Passo 3:** rodar `test/sync-rules-contrato.test.js` e `test/sync-escritas-v1.test.js`; verdes.
- [ ] **Passo 4 (contraprova):** com **regeneração**, tire o `+ 1` da geração do admin e rode: reprova o caso do admin. Restaure, regere, verde.
- [ ] **Passo 5:** commit.

---

## Tarefa 10: documentação, gate e evidência

- [ ] **Passo 1:** `CLAUDE.md`: uma linha por módulo novo, dizendo o que decide e o que nunca faz.
- [ ] **Passo 2:** `firebase/README.md`: acrescentar ao roteiro manual os casos de `live/control/admin` (geração +1 e REC) e de `live/control/beat` (janela de 60 s), e registrar que **a assinatura não é verificada pelo banco**.
- [ ] **Passo 3:** `npm run check && npm run lint && npm test`; `node tools/sync-rules.js --check`.
- [ ] **Passo 4:** conferir `git diff --name-status md/integracao...HEAD -- test/`: só `A`, fora os ajustes declarados.
- [ ] **Passo 5:** escrever `evidencias-execucao/c2a.md` e atualizar o `EXECUCAO.md`.
- [ ] **Passo 6:** commit e merge em `md/integracao`, com o gate verde nos dois lados.

---

## Critérios de aceite da spec x testes

| Critério (7.C2 e CT-ADM-POL) | Teste |
|---|---|
| Senha inválida não troca admin | `sync-tornar-admin`: "senha errada não troca admin" |
| Geração +1 a cada troca de admin | `sync-tornar-admin` e `sync-rules-contrato` |
| Assinatura Ed25519 válida da geração vigente | `sync-assinatura` e `sync-politicas` |
| Opt-in local: política com `aceitarAdmin` falso não muda nada | `sync-politicas`, `sync-admin-desligado` |
| Remoto só restringe; a queda nunca amplia | `sync-politica-efetiva` (um caso por regra) |
| Frescor por sequência, com snapshot inicial não contando | `sync-autoridade` (um caso por frase da spec) |
| A assinatura não é controle de acesso | `sync-assinatura`: caso explícito, e a nota no `firebase/README.md` |
| Desligado: nada muda | `sync-admin-desligado` |

## Limites declarados

- **A distribuição não nasce aqui.** Autoridade é da C2a; prontidão do distribuidor é da C5 (CT-PRONT). Antes da C5 as políticas valem pela autoridade, e não existe distribuição.
- **Designação remota de admin é da C6.** Aqui só existe "tornar ESTE aparelho admin", com a senha.
- **O banco não verifica assinatura.** Ela protege contra cliente honesto com defeito e versão divergente, e isso está na tela e num teste.
- **`REC` depende do emulador e do projeto real.** Se `auth_time` não for conferível pelo servidor, a tela não pode dizer que o servidor confere a senha, e `keyring` e `admin` ficam protegidos só por `rev`/`generation`, ETag e assinatura.
- **Grupo de consumo, gestão de aparelho, limpeza protegida e revogação ficam na C2b.**
