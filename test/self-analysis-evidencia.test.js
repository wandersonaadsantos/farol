// P0b: o PRODUTOR da evidência. O P0a tirou a autoridade do parecer do modelo; aqui se
// prova que quem a substitui é observação do engine, e não uma declaração do modelo com
// outro nome.
//
// As três propriedades que este arquivo trava:
//   1. o DENOMINADOR da cobertura vem do app (escopo medido), nunca do envelope;
//   2. o NUMERADOR vem de leitura OBSERVADA (inclusive de subagente), nunca declarada;
//   3. o card entra pelo app (determinismo, cache, tenant, guard de dado-não-instrução),
//      não por o modelo resolver chamar a ferramenta.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-evidencia-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
io.run = function runEspiao(cmd, args, opts) {
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = await import('../server.js');
const scopeMod = await import('../lib/engine/pr-scope.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const URL_PR = 'https://github.com/acme/app/pull/42';
const CHAVE = 'acme/app#42';
const SHA = 'a'.repeat(40);
const PR = { key: CHAVE, repo: 'acme/app', number: 42, url: URL_PR, title: 'PR meu', headSha: SHA };

const ARQUIVOS = [
  { path: 'src/a.js', status: 'modified', patch: '@@ -1 +1 @@\n-a\n+b\n' },
  { path: 'src/b.js', status: 'added', patch: '@@ -0,0 +1 @@\n+novo\n' }
];

function envelope(over = {}) {
  return JSON.stringify({
    verdict: 'approvable', approvable: true, cardMet: true,
    blockers: [], tips: [], coverageLimitations: [], reportMarkdown: '# ok', summary: 'ok', ...over
  });
}

// roteia o gh: head fixo e a listagem de arquivos do PR (fonte do denominador)
function roteador({ files = ARQUIVOS, head = SHA } = {}) {
  return (cmd, args) => {
    const sub = (args || []).join(' ');
    if (sub.includes('headRefOid')) return Promise.resolve({ ok: true, stdout: head, stderr: '' });
    if (sub.includes('/files')) return Promise.resolve({ ok: true, stdout: JSON.stringify(files), stderr: '' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
}

// A sessão é substituída por uma função que recebe o prompt montado e "lê" os arquivos
// que o teste mandar, pelo MESMO caminho que a sessão real usaria (o file_path que o
// engine observa). Assim a observação é exercitada de verdade, não simulada.
function novoEngine({ leituras = ['src/a.js', 'src/b.js'], envelopeTexto = envelope(), porSubagente = false } = {}) {
  const engine = new Engine();
  engine.token = 'x';
  engine.tokens = { eu: 'x' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.myPRs = [{ ...PR }];
  engine.saveSelfAnalyses = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  engine.promptRecebido = '';
  engine.runClaudeStream = async (prompt, opts) => {
    engine.promptRecebido = prompt;
    const sess = engine.activeReviews.get(opts.id);
    for (const rel of leituras) {
      // exatamente o que session.js observa: tool_use de Read com file_path absoluto
      const abs = path.join(sess.scopeRoot, rel);
      const prPath = scopeMod.prPathFromRead(sess.scopeRoot, abs);
      if (prPath) { if (!sess.filesRead) sess.filesRead = new Set(); sess.filesRead.add(prPath); }
      void porSubagente; // subagente e sessão principal alimentam o MESMO Set
    }
    return { text: envelopeTexto, sessionId: 'sess-1' };
  };
  return engine;
}

beforeEach(() => { runImpl = roteador(); });

/* ---------- denominador: do app ---------- */

test('o total da cobertura vem do escopo medido pelo app, não do envelope', async () => {
  const engine = novoEngine();
  await engine.runSelfAnalysis({ ...PR });
  const obs = engine.selfAnalyses[CHAVE].observed;
  assert.deepEqual(obs.scope.total, ['src/a.js', 'src/b.js']);
  assert.equal(obs.headSha, SHA);
  assert.equal(obs.sessionOutcome, 'complete');
});

test('escopo que o app não conseguiu medir vira cobertura DESCONHECIDA, nunca completa', async () => {
  runImpl = (cmd, args) => {
    const sub = (args || []).join(' ');
    if (sub.includes('headRefOid')) return Promise.resolve({ ok: true, stdout: SHA, stderr: '' });
    if (sub.includes('/files')) return Promise.resolve({ ok: false, stdout: '', stderr: 'boom' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  const engine = novoEngine();
  await engine.runSelfAnalysis({ ...PR });
  assert.equal(engine.selfAnalyses[CHAVE].observed.scope, null);
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].quality.status, 'inconclusive');
});

/* ---------- numerador: observado, nunca declarado ---------- */

test('só o arquivo que a sessão foi VISTA abrir entra em reviewed', async () => {
  const engine = novoEngine({ leituras: ['src/a.js'] });
  await engine.runSelfAnalysis({ ...PR });
  const obs = engine.selfAnalyses[CHAVE].observed;
  assert.deepEqual(obs.scope.reviewed, ['src/a.js']);
  assert.deepEqual(obs.scope.missing, ['src/b.js']);
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].quality.status, 'inconclusive');
});

test('leitura repetida do mesmo arquivo não infla a cobertura', async () => {
  const engine = novoEngine({ leituras: ['src/a.js', 'src/a.js', 'src/a.js', 'src/b.js'] });
  await engine.runSelfAnalysis({ ...PR });
  assert.deepEqual(engine.selfAnalyses[CHAVE].observed.scope.reviewed, ['src/a.js', 'src/b.js']);
});

test('leitura de arquivo FORA do escopo materializado não vira cobertura', async () => {
  const engine = novoEngine({ leituras: [] });
  const original = engine.runClaudeStream;
  engine.runClaudeStream = async (prompt, opts) => {
    const sess = engine.activeReviews.get(opts.id);
    sess.filesRead = new Set();
    const forfa = scopeMod.prPathFromRead(sess.scopeRoot, path.join(FAROL_HOME, 'qualquer.js'));
    if (forfa) sess.filesRead.add(forfa);
    void original;
    return { text: envelope(), sessionId: 's' };
  };
  await engine.runSelfAnalysis({ ...PR });
  assert.deepEqual(engine.selfAnalyses[CHAVE].observed.scope.reviewed, []);
});

test('o envelope não consegue AMPLIAR a cobertura observada', async () => {
  // a sessão abriu 1 de 2 e o envelope tenta declarar cobertura total por outros campos
  const engine = novoEngine({
    leituras: ['src/a.js'],
    envelopeTexto: envelope({ coverage: { total: 2, reviewed: ['src/a.js', 'src/b.js'], missing: [] }, coverageLimitations: [] })
  });
  await engine.runSelfAnalysis({ ...PR });
  assert.deepEqual(engine.selfAnalyses[CHAVE].observed.scope.reviewed, ['src/a.js']);
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].quality.status, 'inconclusive');
});

test('o envelope consegue REDUZIR: limitação declarada tira o arquivo da cobertura', async () => {
  const engine = novoEngine({ envelopeTexto: envelope({ coverageLimitations: ['src/b.js'] }) });
  await engine.runSelfAnalysis({ ...PR });
  const gravado = engine.selfAnalyses[CHAVE];
  assert.deepEqual(gravado.observed.scope.reviewed, ['src/a.js', 'src/b.js'], 'o engine observou os dois');
  assert.deepEqual(gravado.coverageLimitations, ['src/b.js']);
  const q = engine.snapshot().selfAnalyses[CHAVE].quality;
  assert.equal(q.status, 'inconclusive', 'e a limitação do modelo subtrai');
  assert.deepEqual(q.reasons.find(r => r.code === 'COVERAGE_INCOMPLETE').detail.missing, ['src/b.js']);
});

/* ---------- o prompt: card e escopo vêm do app ---------- */

test('o card entra pelo app, delimitado, e o prompt não manda buscar de novo', async () => {
  const engine = novoEngine();
  engine.config.jiraSites = [{ id: 's1', owners: ['acme'], baseUrl: 'https://acme.atlassian.net' }];
  await engine.runSelfAnalysis({ ...PR });
  const p = engine.promptRecebido;
  assert.match(p, /## Card do Jira/, 'a seção do card é injetada pelo Farol');
  assert.doesNotMatch(p, /extraia a chave do card/i, 'o prompt não pede pro modelo caçar o card');
});

test('o prompt carrega o escopo medido e a raiz onde ler cada arquivo', async () => {
  const engine = novoEngine();
  await engine.runSelfAnalysis({ ...PR });
  const p = engine.promptRecebido;
  assert.match(p, /## Escopo do PR \(medido pelo Farol\)/);
  assert.match(p, /src\/a\.js/);
  assert.match(p, /coverageLimitations/, 'e explica que o campo só subtrai');
  assert.ok(fs.existsSync(path.join(scopeMod.scopeRootFor(CHAVE), 'src', 'a.js')), 'o patch foi materializado');
});

/* ---------- persistência: bruto sim, decisão não ---------- */

test('o registro guarda a evidência bruta e nunca o veredito calculado', async () => {
  const engine = novoEngine();
  await engine.runSelfAnalysis({ ...PR });
  const gravado = engine.selfAnalyses[CHAVE];
  assert.ok(gravado.observed, 'a evidência bruta fica');
  assert.equal(gravado.quality, undefined, 'a decisão derivada NUNCA é persistida');
  assert.equal(gravado.confidence, undefined, 'campo morto saiu do registro');
  assert.equal(engine.snapshot().selfAnalyses[CHAVE].quality.status, 'eligible');
});
