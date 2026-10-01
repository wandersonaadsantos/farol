// A cobertura declarada pela sessão é conferida contra o diff MEDIDO pelo engine, na
// revisão de verdade (26/09/2026).
//
// O gate é puro e tem os próprios testes (fanout.test.js, "gate de cobertura"). Aqui se
// prova a FIAÇÃO: o runHeadlessReview anexa a lista de arquivos que ele mesmo mediu no head
// (fetchPrFiles) ao resultado antes do gate, e um envelope que declara ter lido tudo mas
// deixou um arquivo do diff de fora não aprova sozinho. Sem isto o gate podia estar certo
// e nunca receber a medição.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-cobertura-diff-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// o gh é a fronteira de rede: nada aqui pode chegar ao GitHub
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
io.run = function runDuble(cmd, args) {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
  return Promise.resolve({ ok: true, stdout: '', stderr: '' });
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const PR = { key: 'acme/app#7', repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/pull/7', title: 'PR', author: 'dev', requested: true };

// `ressalvas` é o que a conta faz com aprovável COM ressalvas (30/09/2026: a lacuna de
// cobertura é ressalva, e só a política decide entre postar e esperar você)
function motor(diffMedido, coverage, ressalvas = 'wait') {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.autoApproveAll = true;
  e.approvePolicyFor = (_conta, limpo) => (limpo ? 'approve' : ressalvas);
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.fetchPrFiles = async () => diffMedido.map((p, i) => ({ path: p, sha: `blob-${i}`, status: 'modified', lines: 10 }));
  e.postados = [];
  e.postReview = async (_pr, payload) => { e.postados.push(payload); return { ok: true }; };
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [], coverage,
      alcance: diffMedido.map((alterado) => ({ alterado, chamadores: [], semChamador: 'fixture sintética sem consumidor' })),
      payloads: { approve: { event: 'APPROVE', body: 'Li o diff e o comportamento fecha com o card.' } }, reportMarkdown: '# ok',
    }),
    sessionId: '12345678-abcd-1234-abcd-123456789012',
  });
  return e;
}

function decisaoDe(e) {
  return [...e.decisions.pending, ...e.decisions.resolved].find((d) => d.key === PR.key);
}

test('a sessão diz que leu tudo, mas o diff medido tem um arquivo a mais: conta que espera nas ressalvas espera, e o card diz qual', async () => {
  const e = motor(['src/a.js', 'src/b.js'], { total: 1, reviewed: ['src/a.js'], missing: [] });
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.postados.length, 0, 'nada foi postado');
  const d = decisaoDe(e);
  assert.ok(d, 'a decisão ficou registrada');
  assert.equal(d.status, 'pending');
  const motivos = (d.reasons || []).map((r) => (typeof r === 'string' ? r : r.text)).join(' | ');
  assert.match(motivos, /aprovável com ressalvas/, motivos);
  assert.match(motivos, /cobertura da leitura tem/, motivos);
  assert.match(motivos, /src\/b\.js/, motivos);
});

test('a mesma lacuna, em conta que aprova com ressalvas: aprova sozinho e a lacuna fica visível como ressalva', async () => {
  const e = motor(['src/a.js', 'src/b.js'], { total: 1, reviewed: ['src/a.js'], missing: [] }, 'approve');
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.postados.length, 1, 'o APPROVE saiu');
  assert.equal(e.postados[0].event, 'APPROVE');
  assert.doesNotMatch(String(e.postados[0].body), /cobertura/, 'a ressalva não vai para o texto do PR');
  const d = decisaoDe(e);
  assert.equal(d.status, 'auto_approved');
  const ressalvas = (d.attention || []).map((r) => r.text).join(' | ');
  assert.match(ressalvas, /cobertura da leitura tem/, ressalvas);
  assert.match(ressalvas, /src\/b\.js/, ressalvas);
});

test('a cobertura bate com o diff medido: o gate de cobertura não segura', async () => {
  const e = motor(['src/a.js', 'src/b.js'], { total: 2, reviewed: ['src/a.js', 'src/b.js'], missing: [] });
  await e.runHeadlessReview({ ...PR });
  const d = decisaoDe(e);
  const motivos = ((d && d.reasons) || []).map((r) => (typeof r === 'string' ? r : r.text)).join(' | ');
  assert.doesNotMatch(motivos, /cobertura da leitura tem/, motivos);
});
