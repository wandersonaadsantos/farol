// Firebase configurado mas fora do ar (v2.62.1). Medido na matriz de modos de 18/09/2026:
// com a coordenação ligada e sem conexão, NADA postava. A revisão automática esperava (certo),
// mas o clique em Aprovar era recusado e a revisão disparada com "sem coordenação" rodava,
// gastava a sessão de IA e morria na postagem. Agora o ato EXPLÍCITO (clique, sessão de
// terminal, revisão manual sem coordenação) posta pelo caminho sem Firebase, com a conferência
// no GitHub antes; o que é automático continua esperando o Firebase voltar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-firebase-fora-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = path.join(BASE, 'casa');
process.env.USERPROFILE = process.env.HOME;
fs.mkdirSync(process.env.HOME, { recursive: true });

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const arbitragem = (await import('../lib/engine/postagem-arbitragem.js')).default;

const HEAD = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
const runOriginal = io.run;
const postagens = [];
let reviewsNoGithub = '[]';
io.run = async (cmd, args) => {
  const a = (args || []).map(String);
  if (a.includes('--input')) { postagens.push(a.join(' ')); return { ok: true, code: 0, stdout: JSON.stringify({ id: 7, commit_id: HEAD }), stderr: '' }; }
  if (a[0] === 'api' && a.some((x) => /\/reviews$/.test(x))) return { ok: true, code: 0, stdout: reviewsNoGithub, stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};
after(() => {
  io.run = runOriginal;
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

// coordenação ligada na configuração, e nenhuma credencial: é o "fora do ar" medido
async function motorForaDoAr() {
  const e = new Engine();
  e.log = () => { };
  e.pushState = () => { };
  e.updateSettings({
    accounts: [{ user: 'eu', owners: ['org'] }], autoReview: false,
    sync: { enabled: true, coordination: { enabled: true }, shared: { enabled: true }, apiKey: 'k', databaseUrl: 'https://x.firebaseio.com', projectId: 'p' },
  });
  if (e.sync.iniciando) await e.sync.iniciando;
  e.tokenFor = () => 't';
  e.token = 't';
  e.headSha = async () => HEAD;
  return e;
}

const PR = (n) => ({ key: `org/app#${n}`, repo: 'org/app', number: n, account: 'eu' });
const APPROVE = { event: 'APPROVE', body: 'Leitura atenta, tudo certo por aqui.', commit_id: HEAD };
const NOOP = { noop: true, valido: () => true, validoPor: () => true, lost: false };

test('a premissa: coordenação ligada e sem conexão', async () => {
  const e = await motorForaDoAr();
  assert.equal(e.syncCoordenacaoAtiva(), true);
  assert.notEqual(e.sync.status, 'conectado');
});

for (const [via, handle] of [['clique', undefined], ['sessao', undefined], ['revisao', NOOP]]) {
  test(`ato explícito (${via}${handle ? ' sem coordenação' : ''}) posta com o Firebase fora do ar`, async () => {
    const e = await motorForaDoAr();
    postagens.length = 0;
    reviewsNoGithub = '[]';
    const r = await e.postReview(PR(1), APPROVE, { via, handle });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(postagens.length, 1);
  });
}

test('o automático continua esperando o Firebase: reenvio e revisão com lease não postam', async () => {
  const e = await motorForaDoAr();
  postagens.length = 0;
  const reenvio = await e.postReview(PR(2), APPROVE, { via: 'reenvio' });
  assert.equal(reenvio.ok, false);
  assert.equal(reenvio.motivo, 'coordenacao-indisponivel');
  const lease = { noop: false, valido: () => true, validoPor: () => true, lost: false };
  const revisao = await e.postReview(PR(3), APPROVE, { via: 'revisao', handle: lease });
  assert.equal(revisao.ok, false);
  assert.equal(postagens.length, 0);
});

test('o GitHub é a conferência: veredito já postado naquele commit não posta de novo', async () => {
  const e = await motorForaDoAr();
  postagens.length = 0;
  reviewsNoGithub = JSON.stringify([{ state: 'APPROVED', submitted_at: '2026-09-18T20:00:00Z', commit_id: HEAD }]);
  e.myReviewsWithTime = async () => [{ state: 'APPROVED', at: Date.now(), commit: HEAD }];
  const r = await e.postReview(PR(4), APPROVE, { via: 'clique' });
  assert.equal(r.ok, true);
  assert.equal(r.deduped, true);
  assert.equal(postagens.length, 0);
});

test('sem conseguir conferir no GitHub, não posta às cegas', async () => {
  const e = await motorForaDoAr();
  postagens.length = 0;
  e.myReviewsWithTime = async () => null;
  const r = await e.postReview(PR(5), APPROVE, { via: 'clique' });
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'estado-desconhecido');
  assert.equal(postagens.length, 0);
});

test('contornoComFirebaseFora: conectado nunca contorna', () => {
  const conectado = { sync: { status: 'conectado', client: {} } };
  assert.equal(arbitragem.contornoComFirebaseFora(conectado, { via: 'clique' }), false);
  const fora = { sync: { status: 'sem-credencial' } };
  assert.equal(arbitragem.contornoComFirebaseFora(fora, { via: 'clique' }), true);
  assert.equal(arbitragem.contornoComFirebaseFora(fora, { via: 'coassinatura' }), false);
  assert.equal(arbitragem.contornoComFirebaseFora(fora, { via: 'revisao' }), false, 'revisão sem o handle do contorno manual é automática');
});

test('o reenvio dos ciclos espera a conexão, sem gastar chamada no GitHub', async () => {
  const e = await motorForaDoAr();
  let chamadas = 0;
  e.headSha = async () => { chamadas++; return HEAD; };
  e.myReviewsWithTime = async () => { chamadas++; return []; };
  e.decisions.pending = [{ id: 'd1', key: 'org/app#6', pr: PR(6), headSha: HEAD, postRetry: { event: 'approve', attempts: 0 }, payloads: { approve: APPROVE } }];
  postagens.length = 0;
  const resolvidas = await e.retryFailedPosts();
  assert.equal(resolvidas, 0);
  assert.equal(chamadas, 0);
  assert.equal(postagens.length, 0);
  assert.equal(e.decisions.pending.length, 1, 'a pendência fica, e o reenvio volta quando a conexão voltar');
});
