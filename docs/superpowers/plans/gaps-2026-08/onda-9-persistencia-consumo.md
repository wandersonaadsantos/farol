# Rascunho de plano, Onda 9

> Base: relatório `C:\Users\wanderson\Documents\biud\analise-farol-gaps-logicos\relatorio.md` (commit `4d39d8f`, v2.30.1).
> Todos os comportamentos citados (bug atual e fix proposto) foram REPRODUZIDOS por execução real antes deste rascunho: `md('`f(*args, **kwargs)`')` devolve `<code>f(<i>args, </i>*kwargs)</code>` hoje, `fmtCompact(999600)` devolve `1000k`, `modelLabel('claude-sonnet-4-20250514')` devolve `Sonnet 4.20250514`, `String(Date.now()).slice(0,10)` devolve `1785640521`, e o helper atômico com `renameSync` por cima de arquivo existente funciona no Windows (validado neste computador, NTFS).

## Onda 9: Persistência, consumo e cosméticos

**Achados cobertos:** M23, M17, B12, B18, B19, B20, B21

**Dificuldades antecipadas da onda** (a parte MAIS importante do plano; o objetivo do usuário é ter a solução pronta antes do impedimento aparecer):

- **D1. Testes existentes travam o comportamento ERRADO e vão quebrar no meio da onda.** `test/ui-pure.test.js:192-202` afirma que `usageDayKeysBack` corta o dia em UTC (o teste da virada de mês usa `2026-03-01T00:00:00Z`, que em São Paulo ainda é 28/02 às 21h, então o resultado local correto é `['2026-02-27','2026-02-28']`, não `['2026-02-28','2026-03-01']`); e `test/usage.test.js:58` calcula `today` com `toISOString().slice(0,10)`, que diverge do dia local entre 21h e 24h de Brasília. → Solução preparada: a Tarefa 9.3 atualiza esses testes NO MESMO commit da implementação (os diffs exatos estão na tarefa); rodar `node --test test/ui-pure.test.js test/usage.test.js` antes do commit pra confirmar que nada mais depende do corte UTC.
- **D2. Fuso horário em teste no Windows.** Os testes novos de dia local dependem de `process.env.TZ = 'America/Sao_Paulo'` setado ANTES do `require`. → Solução preparada: o precedente já existe e está verde no Windows deste projeto (`test/ui-pure.test.js:15` fixa TZ e o teste de `fmtClock` na linha 171 depende dele, suite 335 verde), então é seguro repetir o padrão em `test/usage.test.js`; além disso os casos de teste usam offset explícito (`-03:00`) onde a intenção é "meia-noite local", pra ficarem legíveis e não dependerem só do TZ.
- **D3. Server e UI cortam o dia em lugares diferentes e precisam mudar JUNTOS.** `drawUsageTimeline` (ui/app.js:2015) cruza as chaves de `usageDayKeysBack` (UI) com `summary.series` (chaves gravadas pelo server): se um lado virar local e o outro ficar UTC, o card e o gráfico "Hoje" desalinham entre 21h e 24h. → Solução preparada: a Tarefa 9.3 altera `lib/engine/usage.js` e `ui/pure.js` no mesmo commit, com teste dos dois lados; não dividir em dois commits.
- **D4. Buckets históricos gravados em dia UTC (estado persistido legado).** `usage.json` real já tem dias UTC; depois do fix, uma sessão das 22h de 01/08 vai pro bucket `2026-08-01` enquanto a sessão das 22h de ontem ficou gravada em `2026-08-02` (dia UTC). → Solução preparada: decisão explícita de NÃO migrar (o registro de consumo é permanente por decisão do projeto, e reatribuir dia a posteriori seria inventar dado): só o registro novo corta no dia local, o comentário no código documenta isso, e o efeito visível é no máximo um dia de transição com sessões da noite anterior aparecendo deslocadas na série. O mesmo vale pro `byModel` na Tarefa 9.7: chaves antigas tipo `Sonnet 4.20250514` ficam no arquivo e as novas agregam em `Sonnet 4` (duas linhas na tela Consumo até a história envelhecer, sem migração).
- **D5. ui/app.js não tem NENHUM teste (débito conhecido da Onda 4).** As correções B12 e B21 tocam o app.js. → Solução preparada: seguir o idioma que o projeto já adotou pra isso (funções puras saem pro `ui/pure.js`, que o node testa por `require` e o navegador carrega por `<script src>` antes do app.js): `aprovadosHoje()` e `delivCappedMsg()` nascem no pure.js COM teste, e o app.js fica com uma linha de chamada cada, verificada por `npm run check` (node --check) e smoke manual com `FAROL_HOME` temporário.
- **D6. O rodapé CommonJS do ui/pure.js é um ponto cego clássico.** Função nova declarada no topo funciona no NAVEGADOR mesmo sem export (vira global), mas o `node --test` falha com `P.localDayKey is not a function`. → Solução preparada: cada tarefa que cria função no pure.js (9.3, 9.4, 9.8) tem no diff a linha exata do `module.exports` (ui/pure.js:228-235) com a função acrescentada; o teste TDD pega o esquecimento de qualquer forma (é exatamente o erro esperado no passo "ver falhar").
- **D7. Mudança de assinatura do readJson com 10 chamadores.** Acrescentar parâmetro em função usada em todo boot arrisca quebrar chamador esquecido. → Solução preparada: o 3º parâmetro é OPCIONAL (sem ele o comportamento externo é o de hoje, fallback sem log), então nenhum chamador quebra por definição; o grep de chamadores já foi feito (todos em server.js: linhas 124, 151, 162, 163, 166, 167, 181, 187, 206 e 897) e a tarefa lista quais recebem o logger (os 9 de estado) e qual fica como está (o 897, artefato de workspace regenerável escrito pelo Claude).
- **D8. Rename atômico no Windows tem duas pegadinhas.** (a) Renomear por cima de arquivo existente: o `fs.renameSync` do Node usa MoveFileEx com replace e FUNCIONA no Windows (validado por execução neste computador); (b) EPERM transitório quando antivírus/indexador segura o arquivo destino. → Solução preparada: o helper cai em `copyFileSync + unlinkSync` no catch do rename, que não é atômico mas nunca é PIOR que o `writeFileSync` direto de hoje; o caminho de fallback não tem teste automatizado portável (não dá pra simular EPERM de antivírus de forma determinística), então ele fica documentado no comentário e o teste cobre o caminho principal, incluindo o caso "destino já existe".
- **D9. Concorrência de ondas no mesmo arquivo.** Outras ondas do plano mexem pesado em ui/app.js (M18 a M22, B11 a B17). → Solução preparada: esta onda toca o app.js em só DOIS pontos de uma linha (1618 e 1240), o que torna qualquer conflito trivial; integrar as ondas em sequência via merge (preferência do projeto: merge, não rebase).
- **D10. Fechamento da onda.** Tudo aqui é correção, então o bump no release é PATCH (v2.30.2), com entrada no `CHANGELOG.md` e no `RELEASE_NOTES` do ui/app.js seguindo o checklist do CLAUDE.md; isso é passo de release, fora das tarefas abaixo, e só acontece com a onda 100% verde (`npm run check && npm test`).

### Ordem de execução

9.1 (readJson taxonomia) → 9.2 (gravação atômica) → 9.3 (dia local no consumo, server+UI juntos) → 9.4 (B12 usa o dia local) → 9.5 (md código) → 9.6 (fmtCompact) → 9.7 (modelLabel) → 9.8 (teto das Entregas). As duas primeiras são a fundação de persistência (M23); a 9.4 depende do `localDayKey` criado na 9.3; as quatro últimas são independentes entre si.

---

### Tarefa 9.1: readJson distingue ENOENT de corrupção, loga e preserva .bad (achados: M23, parte leitura)

**Arquivos:** Modify: `lib/io.js:13-15` e `server.js:124,151,162,163,166,167,181,187,206` | Test: `test/io-taxonomy.test.js`

**Interfaces:** Produz: `readJson(file, fallback, log)` com `log` OPCIONAL `(msg: string) => void`; sem o 3º argumento o contrato externo de hoje se mantém (fallback, sem exceção). Consome: `Engine.log('WARN', msg)` via arrow nos chamadores de estado.

**Dificuldades antecipadas:**
- O teste existente `readJson devolve o fallback quando o JSON está corrompido` (io-taxonomy.test.js:41) continua verde (não passa logger), mas agora deixa um `torto.json.bad` no TMP → o `after()` do arquivo já remove o TMP inteiro, nada a fazer.
- No construtor da Engine, `this.log` é método de protótipo, disponível antes do fim do construtor; e se `STATE_DIR` ainda não existe no primeiro boot, o `appendFileSync` de dentro do `log` lança e é engolido pelo try/catch do próprio `log` → nenhum ajuste necessário, mas fica registrado o porquê de ser seguro.
- Invariante 3 do projeto (log só de falhas): corrupção É falha, ENOENT NÃO é (primeiro boot limpo não pode virar ruído) → o teste do ENOENT afirma `logs.length === 0` de propósito.
- `fs.constants.COPYFILE_EXCL` faz o `.bad` preservar a PRIMEIRA evidência (segunda corrupção não sobrescreve a perícia da primeira) → comportamento validado por execução antes deste rascunho.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar em `test/io-taxonomy.test.js`, depois do teste da linha 47):

```js
test('readJson: corrupção LOGA e preserva a evidência em .bad', () => {
  // queda de energia trunca o config.json; hoje isso vira reset silencioso a
  // DEFAULTS (multi-conta desfeita, política de auto-approve de volta ao default)
  ensureDir(TMP);
  const arq = path.join(TMP, 'corrompido.json');
  fs.writeFileSync(arq, '{ "a": 1,');
  const logs = [];
  assert.deepEqual(readJson(arq, { ok: false }, m => logs.push(m)), { ok: false });
  assert.equal(logs.length, 1, 'corrupção tem que ser logada');
  assert.match(logs[0], /corrompido/);
  assert.equal(fs.readFileSync(arq + '.bad', 'utf8'), '{ "a": 1,', 'o conteúdo corrompido vira .bad pra perícia');
  assert.equal(fs.readFileSync(arq, 'utf8'), '{ "a": 1,', 'a leitura não toca o original');
});

test('readJson: .bad existente NÃO é sobrescrito (a primeira evidência vence)', () => {
  ensureDir(TMP);
  const arq = path.join(TMP, 'corrompido2.json');
  fs.writeFileSync(arq, '{ "a": 1,');
  readJson(arq, null, () => {});
  fs.writeFileSync(arq, '{ "b": 2,');
  readJson(arq, null, () => {});
  assert.equal(fs.readFileSync(arq + '.bad', 'utf8'), '{ "a": 1,');
});

test('readJson: arquivo ausente segue SILENCIOSO (primeiro boot não é falha)', () => {
  const logs = [];
  assert.equal(readJson(path.join(TMP, 'nao-existe-2.json'), 'fb', m => logs.push(m)), 'fb');
  assert.equal(logs.length, 0, 'ENOENT não pode virar ruído no farol.log');
  assert.equal(fs.existsSync(path.join(TMP, 'nao-existe-2.json.bad')), false);
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/io-taxonomy.test.js`. Esperado: os 3 testes novos falham (o primeiro com `logs.length` 0 em vez de 1 e `.bad` inexistente, porque o readJson atual engole tudo num catch só); os testes antigos seguem verdes.

- [ ] **Passo 3: implementação mínima** (`lib/io.js`, substituindo as linhas 13-15):

```js
// Fallback SÓ é silencioso quando o arquivo não existe (primeiro boot). Corrupção
// (JSON truncado por queda de energia, por exemplo) loga via `log` (opcional) e
// preserva o conteúdo em <arquivo>.bad pra perícia, sem sobrescrever um .bad
// anterior (COPYFILE_EXCL: a primeira evidência vence). Assim corrupção nunca
// vira reset silencioso a DEFAULTS.
function readJson(file, fallback, log) {
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err.code !== 'ENOENT' && log) log(`ler ${path.basename(file)}: ${err.message}`);
    return fallback;
  }
  try { return JSON.parse(raw); }
  catch (err) {
    try { fs.copyFileSync(file, file + '.bad', fs.constants.COPYFILE_EXCL); } catch { /* .bad anterior preservado */ }
    if (log) log(`${path.basename(file)} corrompido (${err.message}); usei o padrão e preservei ${path.basename(file)}.bad`);
    return fallback;
  }
}
```

E em `server.js`, no construtor, os chamadores de ESTADO passam o logger (linha 124 e vizinhas; o `readJson` da linha 897 fica como está, é artefato de workspace escrito pelo Claude e regenerável):

```js
    const warn = (m) => this.log('WARN', m); // corrupção de estado precisa aparecer no farol.log
    this.config = { ...DEFAULTS, ...readJson(CONFIG_FILE, {}, warn) };
```

```js
    this.selfAnalyses = readJson(SELF_FILE, {}, warn); // key do PR -> resultado da autoanalise
```

```js
    this.decisions = readJson(path.join(STATE_DIR, 'decisions.json'), { pending: [], resolved: [] }, warn);
    this.pushbacks = readJson(path.join(STATE_DIR, 'pushbacks.json'), {}, warn); // { key do PR: { author, outcome, note, at, source, status, confidence } }
```

```js
    this.pushbackScanned = readJson(path.join(STATE_DIR, 'pushback-scanned.json'), {}, warn); // { key: marcador da última atividade do autor já avaliada }
    this.toolRuns = readJson(path.join(STATE_DIR, 'tool-results.json'), {}, warn);
```

```js
    this.chats = readJson(CHATS_FILE, {}, warn);
```

```js
    this.usage = { ...usageMod.defaultUsage(), ...readJson(usageMod.USAGE_FILE, {}, warn) };
```

E em `recoverInflight` (server.js:206):

```js
    const inflight = readJson(INFLIGHT_FILE, [], (m) => this.log('WARN', m));
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test` (esperado: 335 + 3 verdes).

- [ ] **Passo 5: commit**: `fix(io): readJson distingue ENOENT de corrupcao, loga e preserva .bad`

---

### Tarefa 9.2: gravação atômica dos JSON de estado (tmp + rename) (achados: M23, parte escrita)

**Arquivos:** Modify: `lib/io.js:62` (novo helper + export), `server.js:209,219,299`, `lib/engine/chat.js:9`, `lib/engine/decision.js:65`, `lib/engine/pushback.js:50,56`, `lib/engine/selfpr.js:103`, `lib/engine/tools.js:60`, `lib/engine/usage.js:89` | Test: `test/io-taxonomy.test.js`

**Interfaces:** Produz: `writeJsonAtomic(file, data)` em `lib/io.js` (lança em falha, como o `writeFileSync` de hoje; os chamadores já têm try/catch com log). Consome: nada novo.

**Dificuldades antecipadas:**
- Windows: rename por cima de destino existente funciona (validado por execução), mas EPERM transitório de antivírus existe → fallback `copyFileSync + unlinkSync` dentro do catch, documentado; sem teste portável pro fallback (impossível simular EPERM determinístico), o teste cobre criação, SOBRESCRITA (o caso Windows relevante) e ausência de `.tmp` órfão.
- `writeInflight` (server.js:219) gravava JSON compacto e o helper grava com indentação → diferença cosmética de arquivo interno, nenhum leitor depende do formato (readJson aceita os dois); ok.
- Módulos sem import de `../io` hoje (`chat.js`, `tools.js`, `usage.js`) precisam da linha de require nova; `decision.js` e `pushback.js` já importam `{ run }` de `../io`, é só acrescentar na desestruturação; esquecer um require estoura `writeJsonAtomic is not defined` no primeiro save do boot smoke (`test/boot.test.js` pega).
- Fora do escopo, DE PROPÓSITO (documentar, não converter): `SEEN_FILE` e `BASELINE_FILE` (formato texto linha a linha, não JSON), `farol.log` (append), `~/.claude.json` em `ensureWorkspaceTrusted` (arquivo do Claude CLI, já tem backup `.farol-bak` próprio) e as escritas de artefato de workspace em `decision.js:189,201,237` (payloads/destaques que o Claude regenera a cada revisão, não são estado do app).
- `test/boot.test.js` passa pelo caminho novo (prepareHome grava config quando falta) → se algo do helper estiver errado por SO, o smoke acusa antes de qualquer estado real ser tocado.

- [ ] **Passo 1: escrever o teste que falha** (acrescentar em `test/io-taxonomy.test.js`, importando `writeJsonAtomic` na desestruturação da linha 17):

```js
test('writeJsonAtomic grava, sobrescreve destino existente e não deixa .tmp', () => {
  // tmp + rename no MESMO diretório: queda de energia deixa o arquivo antigo OU o
  // novo, nunca um truncado. Sobrescrever destino existente é o caso Windows crítico.
  ensureDir(TMP);
  const arq = path.join(TMP, 'atomico.json');
  writeJsonAtomic(arq, { a: 1 });
  assert.deepEqual(readJson(arq, null), { a: 1 });
  writeJsonAtomic(arq, { a: 2 });
  assert.deepEqual(readJson(arq, null), { a: 2 }, 'rename por cima de existente tem que valer nos dois SOs');
  assert.equal(fs.existsSync(arq + '.tmp'), false, 'o .tmp não pode sobrar');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/io-taxonomy.test.js`. Esperado: falha na desestruturação/uso (`writeJsonAtomic is not a function`), os demais verdes.

- [ ] **Passo 3: implementação mínima**. Em `lib/io.js`, depois do `readJson`:

```js
// Grava JSON de forma atômica: escreve num .tmp ao lado e renomeia por cima do
// destino. rename no MESMO diretório troca o arquivo de uma vez (queda de energia
// deixa o antigo OU o novo, nunca truncado). No Windows o renameSync substitui
// destino existente (MoveFileEx com replace), mas pode dar EPERM transitório com
// antivírus/indexador segurando o arquivo: cai no copy+unlink, que não é atômico
// mas nunca é pior que o writeFileSync direto que existia antes.
function writeJsonAtomic(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  try { fs.renameSync(tmp, file); }
  catch {
    fs.copyFileSync(tmp, file);
    try { fs.unlinkSync(tmp); } catch { /* sobrar .tmp é melhor que perder o estado */ }
  }
}
```

E no export (`lib/io.js:62`):

```js
module.exports = { ensureDir, readJson, writeJsonAtomic, copyRecursive, detectGitBash, run, runShell };
```

Trocas, uma por uma (imports: acrescentar `writeJsonAtomic` na desestruturação de `require('./lib/io')` no server.js:28 e de `require('../io')` em decision.js:9 e pushback.js:10; linha nova `const { writeJsonAtomic } = require('../io');` em chat.js, tools.js e usage.js; em selfpr.js acrescentar na desestruturação da linha 8):

`server.js:209` (recoverInflight):

```js
    try { writeJsonAtomic(INFLIGHT_FILE, []); } catch { }
```

`server.js:219` (writeInflight):

```js
      writeJsonAtomic(INFLIGHT_FILE, list);
```

`server.js:297-300` (saveConfig):

```js
  saveConfig() {
    ensureDir(HOME);
    writeJsonAtomic(CONFIG_FILE, this.config);
  }
```

`lib/engine/chat.js:9`:

```js
  try { writeJsonAtomic(CHATS_FILE, engine.chats); }
```

`lib/engine/decision.js:65`:

```js
  try { writeJsonAtomic(path.join(STATE_DIR, 'decisions.json'), engine.decisions); }
```

`lib/engine/pushback.js:50`:

```js
  try { writeJsonAtomic(path.join(STATE_DIR, 'pushbacks.json'), engine.pushbacks); }
```

`lib/engine/pushback.js:56`:

```js
  try { writeJsonAtomic(path.join(STATE_DIR, 'pushback-scanned.json'), engine.pushbackScanned); }
```

`lib/engine/selfpr.js:103`:

```js
  try { writeJsonAtomic(SELF_FILE, engine.selfAnalyses); }
```

`lib/engine/tools.js:60`:

```js
  try { writeJsonAtomic(path.join(STATE_DIR, 'tool-results.json'), engine.toolRuns); }
```

`lib/engine/usage.js:89`:

```js
  try { writeJsonAtomic(USAGE_FILE, engine.usage); }
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test` (o boot smoke exercita saveConfig pelo caminho novo).

- [ ] **Passo 5: commit**: `fix(io): gravacao atomica dos JSON de estado (tmp + rename)`

---

### Tarefa 9.3: bucket diário do consumo no dia LOCAL, server e UI juntos (achados: M17)

**Arquivos:** Modify: `lib/engine/usage.js:99,113-117,124,144-147` e `ui/pure.js:116-121,228-235` | Test: `test/usage.test.js` e `test/ui-pure.test.js`

**Interfaces:** Produz: `localDay(d = new Date())` exportada de `lib/engine/usage.js` (consumida por recordUsage/daysAgo/usageSummary e pelos testes); `localDayKey(ts)` em `ui/pure.js` (consumida por `usageDayKeysBack` aqui e por `aprovadosHoje` na Tarefa 9.4).

**Dificuldades antecipadas:**
- Os DOIS lados no mesmo commit (ver D3 da onda): `drawUsageTimeline` cruza chave da UI com chave do server.
- Testes existentes que afirmam UTC quebram (ver D1): `ui-pure.test.js:199-202` (virada de mês com `Z`) e `usage.test.js:57-80` (`today` via toISOString); os dois são atualizados aqui, com os diffs abaixo.
- Buckets legados em dia UTC: SEM migração (ver D4), decisão documentada no comentário do `localDay`.
- `sumDaysSince` compara string `d >= from`: chaves legadas UTC e novas locais têm o mesmo formato YYYY-MM-DD, a comparação lexicográfica segue válida, nada a mudar.
- UI remota em outro fuso (abrir a UI de outra máquina): a chave do gráfico é calculada no navegador e o bucket no server; o app é local por desenho (localhost), então o caso não existe na prática, e o comentário do `localDayKey` registra que o espelho é com o fuso DO PROCESSO do server.

- [ ] **Passo 1: escrever o teste que falha**. Em `test/usage.test.js`, fixar o fuso no topo (entre as linhas 5 e 6, ANTES de qualquer require de módulo do projeto):

```js
// o corte de dia é LOCAL (regra do projeto: horário de Brasília, nunca UTC cru);
// sem fixar o fuso o teste passaria numa máquina e falharia noutra
process.env.TZ = 'America/Sao_Paulo';
```

Novo teste (depois do teste de `extractUsage`):

```js
test('localDay corta no dia LOCAL, não no UTC (às 21h de Brasília o dia NÃO vira)', () => {
  // 01:00Z de 02/08 é 22:00 de 01/08 em São Paulo: o bucket é o dia 01
  assert.equal(usage.localDay(new Date(Date.parse('2026-08-02T01:00:00Z'))), '2026-08-01');
  assert.equal(usage.localDay(new Date(Date.parse('2026-08-01T15:00:00Z'))), '2026-08-01');
});
```

E atualizar a linha 58 do teste `usageSummary devolve totais, hoje, 7 dias e quebras ordenadas`:

```js
  const today = usage.localDay(); // o "hoje" do resumo é o dia LOCAL, igual ao gravado
```

Em `test/ui-pure.test.js`, substituir os dois testes das linhas 192-202:

```js
test('usageDayKeysBack devolve n dias LOCAIS, do mais antigo pro mais novo', () => {
  // 23:30Z de 01/08 é 20:30 em São Paulo: hoje local ainda é 01/08
  const agora = Date.parse('2026-08-01T23:30:00Z');
  const k = P.usageDayKeysBack(3, agora);
  assert.deepEqual(k, ['2026-07-30', '2026-07-31', '2026-08-01']);
  assert.equal(P.usageDayKeysBack(30, agora).length, 30);
});

test('usageDayKeysBack atravessa virada de mês e de ano no fuso LOCAL', () => {
  assert.deepEqual(P.usageDayKeysBack(2, Date.parse('2026-03-01T00:00:00-03:00')), ['2026-02-28', '2026-03-01']);
  assert.deepEqual(P.usageDayKeysBack(2, Date.parse('2026-01-01T00:00:00-03:00')), ['2025-12-31', '2026-01-01']);
  // meia-noite UTC ainda é véspera no local: o corte tem que ser o local
  assert.deepEqual(P.usageDayKeysBack(2, Date.parse('2026-03-01T00:00:00Z')), ['2026-02-27', '2026-02-28']);
});

test('localDayKey aceita epoch ms e ISO; entrada inválida devolve vazio', () => {
  assert.equal(P.localDayKey(Date.parse('2026-08-02T01:00:00Z')), '2026-08-01');
  assert.equal(P.localDayKey('2026-08-01T12:00:00Z'), '2026-08-01');
  assert.equal(P.localDayKey(''), '');
  assert.equal(P.localDayKey(null), '');
  assert.equal(P.localDayKey('lixo'), '');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/usage.test.js test/ui-pure.test.js`. Esperado: `usage.localDay is not a function`, `P.localDayKey is not a function`, e o teste da virada UTC falhando com `['2026-02-28','2026-03-01']` em vez de `['2026-02-27','2026-02-28']`.

- [ ] **Passo 3: implementação mínima**. Em `lib/engine/usage.js`, acima de `recordUsage`:

```js
// Dia LOCAL do processo (YYYY-MM-DD). Regra do projeto: horário de Brasília na
// tela, nunca UTC cru; com o corte UTC, às 21h locais o dia virava e o card
// "Hoje" zerava. Buckets antigos gravados em dia UTC ficam COMO ESTÃO (decisão:
// sem migração, o registro é permanente); só o registro novo corta no local, e a
// transição pode deslocar na série as sessões da noite anterior por um dia.
function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
```

Na linha 99 (recordUsage):

```js
  const day = localDay();
```

Nas linhas 113-117 (daysAgo):

```js
function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDay(d);
}
```

Na linha 124 (usageSummary):

```js
  const today = localDay();
```

No export (linhas 144-147):

```js
module.exports = {
  USAGE_FILE, defaultUsage, kindFromId, extractUsage, applyUsage,
  recordUsage, usageSummary, localDay,
};
```

Em `ui/pure.js`, substituindo as linhas 116-121 (a nova folha entra junto):

```js
// chave de dia LOCAL (YYYY-MM-DD) de um timestamp/ISO; '' quando não há data
// válida. Espelha o corte de dia do server (localDay em lib/engine/usage.js, no
// fuso do processo): nunca UTC cru, que zerava o "Hoje" às 21h de Brasília.
function localDayKey(ts) {
  if (ts == null || ts === '') return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// chaves de dia LOCAIS (batendo com o corte do server) dos últimos n dias, incluindo hoje
function usageDayKeysBack(n, agora = Date.now()) {
  const out = [], d = new Date(agora);
  for (let i = n - 1; i >= 0; i--) out.push(localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i)));
  return out;
}
```

E no rodapé CommonJS (ui/pure.js:228-235), acrescentar `localDayKey`:

```js
  module.exports = {
    esc, fmtClock, fmtTok, fmtCompact, sysNorm, ownerFromUrl, repoShort, stripFence, hexToRgba,
    sameSet, diffVs, lastMerge, groupBy, usageMetricVal, accountSaveArray, delivGroupCard, fmtRel,
    usageDayKeysBack, localDayKey, avatar, md, feedLine, delivPrRow, delivPrRowInRepo, delivRepoSubgroups,
    deliveriesByRepo, deliveriesByAuthor
  };
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.

- [ ] **Passo 5: commit**: `fix(usage): bucket diario de consumo no dia local do processo, nao em UTC`

---

### Tarefa 9.4: contador "aprovados hoje" do vazio-bom volta a viver (achados: B12)

**Arquivos:** Modify: `ui/pure.js` (nova função + rodapé 228-235) e `ui/app.js:1615-1619` | Test: `test/ui-pure.test.js`

**Interfaces:** Consome: `localDayKey` (Tarefa 9.3). Produz: `aprovadosHoje(resolved, agora = Date.now())` chamada em `renderQueue` (app.js).

**Dificuldades antecipadas:**
- `r.resolvedAt` é epoch em MS (`Date.now()` em lib/engine/decision.js:34), não ISO; o bug era exatamente comparar `String(epoch).slice(0,10)` (dá `1785640521`) com `YYYY-MM-DD`. O teste fixa entradas em epoch ms de propósito.
- Semântica preservada: o filtro continua `action === 'approve'` (auto_approved carrega `action: 'approve'`, ver lib/engine/review.js:332, então auto e manual contam juntos, como o código morto pretendia); não estou "melhorando" o critério, só consertando a comparação de dia.
- Dia LOCAL e não UTC na comparação: usar `toISOString` aqui recriaria o M17 em miniatura (entre 21h e 24h o contador zeraria); por isso a dependência da 9.3.
- Rodapé CommonJS: acrescentar `aprovadosHoje` ou o node quebra (ver D6).
- app.js sem teste: a mudança no app.js é UMA linha de chamada; validação por `npm run check` e smoke manual (`FAROL_HOME=/tmp/farol-teste node server.js`, fila vazia com um resolved de hoje no decisions.json mostra "O Farol aprovou 1 PR sozinho hoje").

- [ ] **Passo 1: escrever o teste que falha** (em `test/ui-pure.test.js`, seção consumo):

```js
test('aprovadosHoje conta só APPROVE do dia LOCAL (resolvedAt em epoch ms)', () => {
  const agora = Date.parse('2026-08-01T22:00:00-03:00');
  const resolved = [
    { action: 'approve', resolvedAt: agora - 60 * 60 * 1000 },             // 21:00 local de hoje
    { action: 'approve', resolvedAt: Date.parse('2026-08-02T01:00:00Z') }, // 22:00 local de hoje (dia UTC já virou)
    { action: 'approve', resolvedAt: agora - 26 * 60 * 60 * 1000 },        // ontem
    { action: 'request_changes', resolvedAt: agora },                      // não é approve
    { action: 'approve' },                                                 // sem resolvedAt: fora
  ];
  assert.equal(P.aprovadosHoje(resolved, agora), 2);
  assert.equal(P.aprovadosHoje([], agora), 0);
  assert.equal(P.aprovadosHoje(undefined, agora), 0);
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/ui-pure.test.js`. Esperado: `P.aprovadosHoje is not a function`.

- [ ] **Passo 3: implementação mínima**. Em `ui/pure.js` (depois de `usageDayKeysBack`):

```js
// conta os resolvidos de HOJE (dia local) que terminaram em APPROVE: alimenta o
// "vazio bom" do Radar. resolvedAt é epoch em ms (Date.now() do engine); a versão
// antiga fatiava String(epoch) contra data ISO e nunca batia (ramo morto da v2.30.0).
function aprovadosHoje(resolved, agora = Date.now()) {
  const hoje = localDayKey(agora);
  return (resolved || []).filter(r => r && r.action === 'approve' && localDayKey(r.resolvedAt) === hoje).length;
}
```

Acrescentar `aprovadosHoje` no rodapé CommonJS (mesma lista da Tarefa 9.3). Em `ui/app.js`, substituindo as linhas 1615-1619:

```js
  if (!q.length) {
    // Vazio bom merece CONFIRMAR o que o app fez, não só dizer que não tem nada.
    // resolvedAt é epoch em ms; a comparação de dia é LOCAL e vive no pure.js (testada lá).
    const aprovados = aprovadosHoje(STATE.decisions?.resolved);
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.

- [ ] **Passo 5: commit**: `fix(ui): contador de aprovados hoje compara dia local, nao epoch com ISO`

---

### Tarefa 9.5: md() protege o conteúdo de código dos outros inlines (achados: B18)

**Arquivos:** Modify: `ui/pure.js:138-143` (o `inline` dentro de `md`) | Test: `test/ui-pure.test.js`

**Interfaces:** nenhuma assinatura muda (`md(src)` continua igual; `inline` é closure interna).

**Dificuldades antecipadas:**
- A correção precisa manter TODOS os testes atuais de md (linhas 69-127) verdes: os blocos (h, hr, blockquote, tabela, li, checkbox) chamam `inline` por linha e a proteção é interna à closure, então nada muda pra eles (verificado por execução do protótipo antes deste rascunho).
- Sentinela de placeholder: usar dígito puro como marcador quebraria texto normal com números; a sentinela é par de Private Use Area (`\uE000` índice `\uE001`), que não colide com texto de review nem sobrevive por acidente (validado com dígitos soltos no texto: `tem 12 itens e ...` sai intacto).
- Itálico com regex `(^|[^*])\*([^*]+)\*` pode envolver um placeholder no meio; a restauração é por regex global no fim e funciona mesmo com o placeholder dentro de `<i>` (caso testado: dois spans de código com asterisco nas bordas e itálico real no meio).
- Link DENTRO de código deve ficar literal (`` `[a](url)` `` não vira âncora); o teste cobre.

- [ ] **Passo 1: escrever o teste que falha** (em `test/ui-pure.test.js`, depois do teste da linha 89):

```js
test('md NÃO aplica bold/itálico/link dentro de código', () => {
  // relatório de review adora assinatura Python: f(*args, **kwargs) virava markup corrompido
  const out = P.md('`f(*args, **kwargs)`');
  assert.match(out, /<code>f\(\*args, \*\*kwargs\)<\/code>/);
  assert.doesNotMatch(out, /<i>|<b>/);
  const link = P.md('`[a](https://x.com)`');
  assert.match(link, /<code>\[a\]\(https:\/\/x\.com\)<\/code>/);
  assert.doesNotMatch(link, /<a /);
});

test('md segue formatando NORMALMENTE fora do código', () => {
  const out = P.md('use `a_b` com *ênfase* e **força**');
  assert.match(out, /<code>a_b<\/code>/);
  assert.match(out, /<i>ênfase<\/i>/);
  assert.match(out, /<b>força<\/b>/);
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/ui-pure.test.js`. Esperado: o primeiro falha com `<code>f(<i>args, </i>*kwargs)</code>` (saída atual, confirmada por execução).

- [ ] **Passo 3: implementação mínima** (`ui/pure.js`, substituindo a closure `inline` das linhas 138-143):

```js
  const inline = (s) => {
    // código sai primeiro e PROTEGIDO: o conteúdo de `...` vai pra uma lista e só
    // volta no fim, senão bold/itálico/link reformatam DENTRO do <code> já emitido
    // (f(*args, **kwargs) virava markup corrompido). Sentinela em Private Use Area:
    // não colide com texto de review nem com dígitos soltos.
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(`<code>${c}</code>`); return `\uE000${codes.length - 1}\uE001`; });
    s = s
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/^\[!(NOTE|WARNING|IMPORTANT)\]\s*/i, '');
    return s.replace(/\uE000(\d+)\uE001/g, (m, i) => codes[i]);
  };
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.

- [ ] **Passo 5: commit**: `fix(ui): md() nao formata bold/italico/link dentro de codigo`

---

### Tarefa 9.6: fmtCompact para de mostrar 1000k na fronteira do milhão (achados: B19)

**Arquivos:** Modify: `ui/pure.js:27-32` | Test: `test/ui-pure.test.js`

**Interfaces:** nenhuma muda (`fmtCompact(n)`).

**Dificuldades antecipadas:**
- O teste existente da linha 152 trava `1000 -> '1k'`, `1.5e6 -> '1,5M'`, `1.5e7 -> '15M'`: a mudança de fronteira não pode tocar nesses (verificado por execução do protótipo: todos preservados).
- Existe fronteira análoga em 9.950.000-9.999.999 (`10,0M` em vez de `10M`): fica FORA de propósito (não é o achado, o valor não mente a ordem de grandeza, só carrega uma casa decimal a mais); registrar aqui pra ninguém "consertar de brinde" e inchar o diff.

- [ ] **Passo 1: escrever o teste que falha** (em `test/ui-pure.test.js`, depois do teste da linha 161):

```js
test('fmtCompact: fronteira do milhão não vira 1000k', () => {
  // Math.round(999500/1000) = 1000, e "1000k" mente a unidade: promove pra M
  assert.equal(P.fmtCompact(999499), '999k');
  assert.equal(P.fmtCompact(999500), '1,0M');
  assert.equal(P.fmtCompact(999999), '1,0M');
  assert.equal(P.fmtCompact(1000000), '1,0M');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/ui-pure.test.js`. Esperado: `999500` e `999999` devolvem `1000k` (confirmado por execução).

- [ ] **Passo 3: implementação mínima** (`ui/pure.js:27-32`):

```js
function fmtCompact(n) {
  n = Number(n) || 0;
  // a fronteira do M acompanha o ARREDONDAMENTO do k: de 999500 pra cima o k
  // viraria "1000k", então já promove pra "1,0M"
  if (n >= 999500) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.

- [ ] **Passo 5: commit**: `fix(ui): fmtCompact promove pra M na fronteira do milhao`

---

### Tarefa 9.7: modelLabel ignora a data de snapshot em id de major único (achados: B20)

**Arquivos:** Modify: `lib/format.js:11-17` | Test: `test/pure.test.js`

**Interfaces:** nenhuma muda (`modelLabel(id)`; re-exportada pelo server.js, o import do teste já existe na linha 13).

**Dificuldades antecipadas:**
- A regex nova precisa preservar a precedência documentada: em `claude-haiku-4-5-20251001` a forma de duas partes pega `4-5` ANTES da data (o lookahead `(?=-|$)` garante, e o caso está no teste); e `\d{1,2}` no minor é o que impede a data de 8 dígitos de casar (validado por execução com toda a família: `4-8`, `4-5`, `3-5`, `5`, `haiku`, `gpt-4o`).
- Estado persistido legado: `usage.json` real pode ter `byModel['Sonnet 4.20250514']` gravado; SEM migração (mesma decisão do M17, o registro é permanente): novas sessões agregam em `Sonnet 4` e a chave velha convive na tela Consumo até envelhecer. Registrado, não é bug do fix.
- O comentário das linhas 11-14 explica a regex antiga; atualizar junto pra não virar documentação mentirosa.

- [ ] **Passo 1: escrever o teste que falha** (em `test/pure.test.js`, depois do teste da linha 20):

```js
test('modelLabel: major único + data de snapshot não vira versão gigante', () => {
  // a regex antiga casava "4-20250514" e rotulava "Sonnet 4.20250514"
  assert.equal(modelLabel('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.equal(modelLabel('claude-opus-4-20250514'), 'Opus 4');
  assert.equal(modelLabel('claude-haiku-4-5-20251001'), 'Haiku 4.5');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/pure.test.js`. Esperado: `'Sonnet 4.20250514'` em vez de `'Sonnet 4'` (confirmado por execução).

- [ ] **Passo 3: implementação mínima** (`lib/format.js`, substituindo as linhas 11-16, comentário incluso):

```js
  // versao em DUAS partes tem precedencia (4-8 = 4.8), com minor de ate 2 digitos
  // e fronteira (?=-|$): assim a data de snapshot (8 digitos) nunca e lida como
  // minor. Em claude-haiku-4-5-20251001 pega 4-5; em claude-sonnet-4-20250514 a
  // primeira forma NAO casa e a segunda pega so o major (Sonnet 4).
  const dois = (raw.match(/(\d+)-(\d{1,2})(?=-|$)/) || [])[0];
  const um = dois ? '' : (raw.match(/-(\d+)(?:-|$)/) || [])[1];
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test` (usage.test.js também usa modelLabel via byModel: `Opus 4.8` e `Sonnet 4.5` seguem iguais).

- [ ] **Passo 5: commit**: `fix(format): modelLabel ignora data de snapshot em id de major unico`

---

### Tarefa 9.8: aviso de teto das Entregas fala o limite real (achados: B21)

**Arquivos:** Modify: `lib/engine/gh-queries.js:119`, `ui/pure.js` (nova função + rodapé) e `ui/app.js:1240` | Test: `test/ui-pure.test.js`

**Interfaces:** Produz: campo `limit` no payload de `/api/deliveries` (gh-queries) e `delivCappedMsg(limit)` no pure.js, consumida em `renderDeliveries` (app.js). O server vira a fonte única do número: se `DELIVERIES_LIMIT` mudar, a mensagem acompanha sem novo drift.

**Dificuldades antecipadas:**
- `deliveriesCache` (TTL de 5 min) pode servir payload SEM o campo `limit` logo após o update, e o snapshot de uma UI aberta contra um engine antigo também → `delivCappedMsg` tem fallback interno pro valor real atual (1000), então a mensagem nunca regride pro 100.
- "1000" contém "100" como substring: o teste que garante que o 100 antigo sumiu usa `\b100\b` (fronteira de palavra não casa dentro de 1000, verificado).
- Não há teste de integração de `fetchDeliveries` (depende de `gh` real): o campo novo no payload é uma chave a mais num objeto literal, sem lógica; o contrato testável (a mensagem) vive no pure.js, seguindo o idioma do projeto (D5).

- [ ] **Passo 1: escrever o teste que falha** (em `test/ui-pure.test.js`):

```js
test('delivCappedMsg fala o limite REAL vindo do server, nunca o 100 antigo', () => {
  // DELIVERIES_LIMIT = 1000 (lib/paths.js); a mensagem afirmava 100, fator de 10
  assert.match(P.delivCappedMsg(1000), /mais de 1000 entregas/);
  assert.match(P.delivCappedMsg(1000), /1000 mais recentes/);
  assert.doesNotMatch(P.delivCappedMsg(1000), /\b100\b/);
  assert.match(P.delivCappedMsg(undefined), /1000/, 'payload em cache sem limit cai no valor real atual');
});
```

- [ ] **Passo 2: rodar e ver falhar**: `node --test test/ui-pure.test.js`. Esperado: `P.delivCappedMsg is not a function`.

- [ ] **Passo 3: implementação mínima**. Em `ui/pure.js` (perto de `delivGroupCard`):

```js
// aviso de teto da aba Entregas: o gh search corta em DELIVERIES_LIMIT por org e o
// server manda o limite no payload (fonte única do número; a mensagem antiga
// afirmava 100 com o teto real em 1000). Fallback 1000 cobre payload em cache
// gravado antes do campo existir.
function delivCappedMsg(limit) {
  const n = Number(limit) || 1000;
  return `Alguma organização tem mais de ${n} entregas no período; mostrando as ${n} mais recentes.`;
}
```

Acrescentar `delivCappedMsg` no rodapé CommonJS. Em `lib/engine/gh-queries.js:119`:

```js
  const data = { since, days, owner: scoped || 'all', items, capped, partial, limit: DELIVERIES_LIMIT };
```

Em `ui/app.js:1240`:

```js
  if (data.capped) msgs.push(delivCappedMsg(data.limit));
```

- [ ] **Passo 4: rodar a suite inteira**: `npm run check && npm test`.

- [ ] **Passo 5: commit**: `fix(ui): aviso de teto das Entregas fala o limite real (1000)`

---

## Fechamento da onda

- `npm run check && npm test` verde com os 8 commits aplicados.
- Smoke manual com instância isolada (`FAROL_HOME` temporário): tela Consumo (card Hoje e gráfico alinhados), Radar vazio com resolved de hoje (contador vivo), um relatório de review com código e asterisco renderizado no chat.
- Release (fora das tarefas): bump PATCH pra v2.30.2, seção no CHANGELOG.md e entrada no RELEASE_NOTES do ui/app.js, checklist do CLAUDE.md (conta do gh pessoal pra publicar).
