// O alcance da revisão: onde o código alterado é usado FORA do diff, declarado pela sessão e
// conferido pelo engine no head (lib/engine/alcance.js, 27/09/2026).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-alcance-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// o gh é a fronteira de rede: cada teste escolhe o que "está no head"
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let noHead = {};
let lidos = [];
io.run = function runDuble(cmd, args) {
  const sub = (args || []).join(' ');
  const m = sub.match(/repos\/[^/]+\/[^/]+\/contents\/(.+)\?ref=(\S+)/);
  if (m) {
    lidos.push({ arquivo: decodeURI(m[1]), ref: m[2] });
    const texto = noHead[decodeURI(m[1])];
    return Promise.resolve(texto == null ? { ok: false, stdout: '', stderr: 'Not Found' } : { ok: true, stdout: texto, stderr: '' });
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
  return Promise.resolve({ ok: true, stdout: '', stderr: '' });
};

const { ehCodigoDeProducao, conferirChamador, alcanceGap, verificarAlcance, TETO_DE_ARQUIVOS } = await import('../lib/engine/alcance.js');
const { coverageGap } = await import('../lib/engine/file-proof.js');
const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const CHAMADOR = 'import { montar } from "./veredito";\n\nexport function rota() {\n  return montar(1);\n}\n';

test('só código de produção exige declaração: teste, documentação, configuração e lock ficam fora', () => {
  for (const p of ['src/a.ts', 'apps/x/y.tsx', 'lib/z.js', 'app/m.py', 'svc/main.go']) assert.equal(ehCodigoDeProducao(p), true, p);
  for (const p of ['src/a.test.ts', 'src/a.spec.tsx', 'test/x.js', 'src/__tests__/y.ts', 'README.md', 'package-lock.json', 'k8s/a.yaml', 'src/tipos.d.ts', 'src/Botao.stories.tsx']) {
    assert.equal(ehCodigoDeProducao(p), false, p);
  }
});

test('conferirChamador: o símbolo precisa aparecer perto da linha declarada', () => {
  assert.equal(conferirChamador(CHAMADOR, 4, 'montar'), true);
  assert.equal(conferirChamador(CHAMADOR, 6, 'montar'), true, 'até 3 linhas de folga');
  assert.equal(conferirChamador(CHAMADOR, 40, 'montar'), false, 'longe da linha declarada não vale');
  assert.equal(conferirChamador(CHAMADOR, 4, 'outraCoisa'), false);
  assert.equal(conferirChamador(CHAMADOR, 4, 'm'), false, 'símbolo de um caractere não prova nada');
  assert.equal(conferirChamador(CHAMADOR, 0, 'montar'), false);
});

const DIFF = ['src/veredito.ts', 'README.md'];
const COB = { total: 2, reviewed: DIFF, missing: [] };

test('sem declaração de alcance, arquivo de código do diff é lacuna', () => {
  assert.deepEqual(alcanceGap({ diffMedido: DIFF, coverage: COB }), ['a revisão não declarou onde o código alterado é usado fora do diff']);
  assert.deepEqual(alcanceGap({ diffMedido: ['README.md'], coverage: COB }), [], 'PR sem código de produção não exige alcance');
});

test('arquivo de código sem entrada, ou sem chamador e sem motivo, é lacuna', () => {
  assert.deepEqual(alcanceGap({ diffMedido: DIFF, alcance: [] }), ['src/veredito.ts: uso fora do diff não declarado']);
  assert.deepEqual(alcanceGap({ diffMedido: DIFF, alcance: [{ alterado: 'src/veredito.ts', chamadores: [] }] }), ['src/veredito.ts: sem uso fora do diff e sem o motivo']);
  assert.deepEqual(alcanceGap({ diffMedido: DIFF, alcance: [{ alterado: 'src/veredito.ts', chamadores: [], semChamador: 'arquivo novo, ninguém importa ainda' }] }), []);
});

test('chamador DENTRO do diff não conta como uso fora do diff', () => {
  const r = { diffMedido: ['src/veredito.ts', 'src/rota.ts'], alcance: [
    { alterado: 'src/veredito.ts', chamadores: [{ arquivo: 'src/rota.ts', linha: 4, simbolo: 'montar' }] },
    { alterado: 'src/rota.ts', chamadores: [], semChamador: 'entrypoint registrado pelo framework' },
  ] };
  assert.deepEqual(alcanceGap(r), ['src/veredito.ts: sem uso fora do diff e sem o motivo']);
});

test('uso declarado mas não conferido no head é lacuna; conferido com sucesso fecha; conferido falso aponta a linha', () => {
  const base = { diffMedido: DIFF, alcance: [{ alterado: 'src/veredito.ts', chamadores: [{ arquivo: 'src/rota.ts', linha: 4, simbolo: 'montar' }] }] };
  assert.deepEqual(alcanceGap(base), ['o uso fora do diff declarado não foi conferido no head']);
  assert.deepEqual(alcanceGap({ ...base, alcanceVerificado: [{ arquivo: 'src/rota.ts', linha: 4, ok: true }] }), []);
  assert.deepEqual(alcanceGap({ ...base, alcanceVerificado: [{ arquivo: 'src/rota.ts', linha: 4, ok: false, motivo: 'não cita montar no head' }] }),
    ['src/rota.ts:4 não cita montar no head']);
});

test('a lacuna de alcance entra no coverageGap, que segura a postagem automática', () => {
  assert.deepEqual(coverageGap({ diffMedido: DIFF, coverage: COB }), ['a revisão não declarou onde o código alterado é usado fora do diff']);
});

const PR = { key: 'acme/app#7', repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/pull/7', author: 'dev', requested: true };
const engineLeve = () => ({ accountForPr: () => 'eu', ghEnv: () => ({}) });

test('verificarAlcance lê cada arquivo citado NO HEAD revisado e grava o resultado', async () => {
  noHead = { 'src/rota.ts': CHAMADOR }; lidos = [];
  const r = { diffMedido: DIFF, alcance: [{ alterado: 'src/veredito.ts', chamadores: [
    { arquivo: 'src/rota.ts', linha: 4, simbolo: 'montar' },
    { arquivo: 'src/inventado.ts', linha: 1, simbolo: 'montar' },
  ] }] };
  await verificarAlcance(engineLeve(), PR, 'abc123', r);
  assert.deepEqual(lidos.map((l) => l.ref), ['abc123', 'abc123'], 'lê no head revisado, não na branch');
  assert.deepEqual(r.alcanceVerificado.map((x) => x.ok), [true, false]);
  assert.match(r.alcanceVerificado[1].motivo, /não foi possível ler o arquivo no head/);
  assert.deepEqual(alcanceGap(r), ['src/inventado.ts:1 não foi possível ler o arquivo no head']);
});

test('verificarAlcance: acima do teto, o que não foi lido conta como não conferido', async () => {
  noHead = {}; lidos = [];
  const chamadores = Array.from({ length: TETO_DE_ARQUIVOS + 2 }, (_, i) => ({ arquivo: `src/c${i}.ts`, linha: 1, simbolo: 'montar' }));
  for (const c of chamadores) noHead[c.arquivo] = 'montar()';
  const r = { diffMedido: DIFF, alcance: [{ alterado: 'src/veredito.ts', chamadores }] };
  await verificarAlcance(engineLeve(), PR, 'abc123', r);
  assert.equal(lidos.length, TETO_DE_ARQUIVOS);
  assert.equal(r.alcanceVerificado.filter((x) => !x.ok).length, 2);
  assert.match(alcanceGap(r)[0], /acima do teto/);
});

/* ---------- fiação: a revisão de verdade confere e segura ---------- */

function motor(alcance) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.autoApproveAll = true;
  e.approvePolicyFor = (_conta, limpo) => (limpo ? 'approve' : 'wait');
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.fetchPrFiles = async () => [{ path: 'src/veredito.ts', sha: 'b1', status: 'modified', lines: 10 }];
  e.headSha = async () => 'abc1234';
  e.postados = [];
  e.postReview = async (_pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: { total: 1, reviewed: ['src/veredito.ts'], missing: [] }, alcance,
      payloads: { approve: { event: 'APPROVE', body: 'Li o diff e o comportamento fecha com o card.' } }, reportMarkdown: '# ok',
    }),
    sessionId: '12345678-abcd-1234-abcd-123456789012',
  });
  return e;
}
const motivos = (e) => [...e.decisions.pending, ...e.decisions.resolved].find((d) => d.key === PR.key).reasons
  .map((r) => (typeof r === 'string' ? r : r.text)).join(' | ');

// 30/09/2026: a lacuna de alcance é ressalva. Aqui a conta espera nas ressalvas (o motor
// acima), então nada é postado, e o motivo é a política com a lacuna visível ao lado.
test('revisão real: chamador inventado é ressalva, a conta que espera nas ressalvas não posta e o card cita o arquivo', async () => {
  noHead = { 'src/rota.ts': CHAMADOR };
  const e = motor([{ alterado: 'src/veredito.ts', chamadores: [{ arquivo: 'src/rota.ts', linha: 4, simbolo: 'naoExiste' }] }]);
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.postados.length, 0, 'nada foi postado');
  assert.match(motivos(e), /aprovável com ressalvas/);
  assert.match(motivos(e), /cobertura da leitura/);
  assert.match(motivos(e), /src\/rota\.ts:4 não cita naoExiste no head/);
});

test('revisão real: chamador que confere no head deixa o gate de cobertura passar', async () => {
  noHead = { 'src/rota.ts': CHAMADOR };
  const e = motor([{ alterado: 'src/veredito.ts', chamadores: [{ arquivo: 'src/rota.ts', linha: 4, simbolo: 'montar' }] }]);
  await e.runHeadlessReview({ ...PR });
  assert.doesNotMatch(motivos(e), /cobertura da leitura/);
});
