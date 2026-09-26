// Coordenação entre aparelhos DESLIGADA: as chamadas ao gh das vias de postagem ficam
// exatamente como eram antes da arbitragem de postagem (CT-POST, "Com a coordenação
// desligada: comportamento de hoje", e CT-COMPAT). Este arquivo nasce ANTES da mudança,
// verde contra o código de então, e continua verde depois: é a prova byte a byte.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-postagem-desligada-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const skip = await import('../lib/engine/skip-review.js');

const runReal = io.run;
let chamadas = [];
let respostas = [];
io.run = async (cmd, args) => {
  const a = [...(args || [])];
  const i = a.indexOf('--input');
  const conteudo = i >= 0 ? fs.readFileSync(a[i + 1], 'utf8') : null;
  if (i >= 0) a[i + 1] = '<arquivo>';
  chamadas.push({ cmd, args: a, conteudo });
  return respostas.length ? respostas.shift() : { ok: true, code: 0, stdout: '[]', stderr: '' };
};
after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { chamadas = []; respostas = []; });

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', author: 'dev', account: 'eu' };
const CORPO = 'Leitura atenta, tudo certo por aqui.';
const POST = ['api', 'repos/o/r/pulls/1/reviews', '--input', '<arquivo>'];
const MEUS = ['api', 'repos/o/r/pulls/1/reviews', '--jq', '[.[] | select((.user.login | ascii_downcase) == "eu") | {state, submitted_at, commit_id}]'];
const OUTROS = ['api', 'repos/o/r/pulls/1/reviews', '--jq', '[.[] | select((.user.login | ascii_downcase) != "eu") | {quem: .user.login, tipo: .user.type, state, commit_id}]'];
const VAZIO = { ok: true, code: 0, stdout: '[]', stderr: '' };
const OK_POST = { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
const RECUSA = { ok: false, code: 1, stdout: '{"message":"Unprocessable Entity","errors":["commit_id inválido"]}', stderr: 'gh: Unprocessable Entity (HTTP 422)' };

function arquivo(valor) { return JSON.stringify(valor, null, 2); }

function motor() {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'eu';
  e.tokenFor = () => 'tok-eu';
  e.token = 'tok-eu';
  e.refreshTokens = async () => { };
  e.ghEnv = () => ({});
  e.headSha = async () => HEAD;
  e.prState = async () => 'OPEN';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.writeMemory = () => { };
  e.skipComentado = {};
  e.postagensArquivo = path.join(FAROL_HOME, `postagens-${Math.random().toString(16).slice(2)}.json`);
  return e;
}

function pendencia(extra = {}) {
  return {
    id: 'd1', key: PR.key, createdAt: 1, status: 'pending', verdict: 'approve',
    pr: { repo: 'o/r', number: 1, url: PR.url, author: 'dev', account: 'eu' }, headSha: HEAD, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: CORPO, comments: [] } }, ...extra,
  };
}

test('pré-condição: engine de teste nasce com a coordenação desligada', () => {
  assert.equal(motor().syncCoordenacaoAtiva(), false);
});

test('postReview: APPROVE ancorado sai numa chamada só, com o payload normalizado, sem registro de postagem', async () => {
  const e = motor();
  respostas = [OK_POST];
  const r = await e.postReview(PR, { event: 'APPROVE', body: `  ${CORPO}  `, comments: [], commit_id: HEAD });
  assert.equal(r.ok, true);
  assert.deepEqual(chamadas, [{ cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) }]);
  assert.equal(fs.existsSync(e.postagensArquivo), false);
});

test('postReview: 422 sem inline recua a âncora numa segunda chamada', async () => {
  const e = motor();
  respostas = [RECUSA, OK_POST];
  await e.postReview(PR, { event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD });
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [] }) },
  ]);
});

test('postReview: 422 com inline recua os pontos para o corpo', async () => {
  const e = motor();
  const inline = { path: 'a.js', line: 3, side: 'RIGHT', body: 'texto do ponto' };
  respostas = [RECUSA, OK_POST];
  await e.postReview(PR, { event: 'REQUEST_CHANGES', body: CORPO, comments: [inline], commit_id: HEAD });
  const recuado = `${CORPO}\n\nOs comentários abaixo não puderam ser ancorados nas linhas do diff:\n- \`a.js:3\`: texto do ponto`;
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'REQUEST_CHANGES', body: CORPO, comments: [inline], commit_id: HEAD }) },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'REQUEST_CHANGES', body: recuado, comments: [] }) },
  ]);
});

test('decide: dedup no GitHub e POST ancorado no head lido', async () => {
  const e = motor();
  e.decisions.pending = [pendencia()];
  respostas = [VAZIO, OK_POST];
  assert.equal((await e.decide('d1', 'approve')).ok, true);
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: MEUS, conteudo: null },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) },
  ]);
});

test('retryFailedPosts: dedup no GitHub e POST ancorado', async () => {
  const e = motor();
  e.decisions.pending = [pendencia({ postRetry: { event: 'approve', attempts: 0 } })];
  respostas = [VAZIO, OK_POST];
  assert.equal(await e.retryFailedPosts(), 1);
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: MEUS, conteudo: null },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [], commit_id: HEAD }) },
  ]);
});

test('postReviewFromSession: POST direto, sem consulta ao GitHub antes', async () => {
  const e = motor();
  const cap = e.createReviewPostCapability([PR.key], 'eu', 'chat', '');
  respostas = [OK_POST];
  const r = await e.postReviewFromSession({ key: PR.key, payload: { event: 'APPROVE', body: CORPO, comments: [] } }, cap);
  assert.equal(r.ok, true);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(chamadas, [{ cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: CORPO, comments: [] }) }]);
});

// Desde 26/09/2026 a co-assinatura sem coordenação usa a régua do modo coordenado: relê o
// endosso NO MESMO SHA e posta ancorada nele. Antes o POST saía sem commit_id, e um commit
// novo entre a checagem e o POST saía aprovado em meu nome sem ninguém ter lido.
test('coAssinar: relê o endosso no mesmo sha, dedup, e POST ancorado no head', async () => {
  const e = motor();
  e.skipComentado[PR.key] = { head: HEAD, quem: ['ana'] };
  respostas = [{ ok: true, code: 0, stdout: `[{"quem":"ana","tipo":"User","state":"APPROVED","commit_id":"${HEAD}"}]`, stderr: '' }, VAZIO, OK_POST];
  assert.equal(await skip.coAssinar(e, PR, 'ana', HEAD), true);
  assert.deepEqual(chamadas, [
    { cmd: 'gh', args: OUTROS, conteudo: null },
    { cmd: 'gh', args: MEUS, conteudo: null },
    { cmd: 'gh', args: POST, conteudo: arquivo({ event: 'APPROVE', body: skip.textoDaCoassinatura('ana').trim(), comments: [], commit_id: HEAD }) },
  ]);
});

test('coAssinar: aprovação de quem pegou em OUTRO sha não endossa o head atual', async () => {
  const e = motor();
  respostas = [{ ok: true, code: 0, stdout: '[{"quem":"ana","tipo":"User","state":"APPROVED","commit_id":"0000000000000000000000000000000000000000"}]', stderr: '' }];
  assert.equal(await skip.coAssinar(e, PR, 'ana', HEAD), false);
  assert.deepEqual(chamadas.map((c) => c.args), [OUTROS], 'nada foi postado');
});

test('seguirForaDeCena com head vazio: sem head não há o que endossar, então não co-assina', async () => {
  const e = motor();
  e.config.coAssinarReview = true;
  respostas = [{ ok: true, code: 0, stdout: '[{"quem":"ana","tipo":"User","state":"APPROVED"}]', stderr: '' }, VAZIO, OK_POST];
  assert.equal(await skip.seguirForaDeCena(e, { ...PR, labels: [] }, { head: '', quem: ['ana'] }, ''), true, 'continua fora de cena');
  assert.deepEqual(chamadas.map((c) => c.args), [OUTROS], 'leu os reviews e não postou nada');
});
