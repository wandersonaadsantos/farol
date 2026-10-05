// Quantas chamadas gh o ciclo faz com PRs que NÃO mudaram (05/10/2026).
//
// Medido no spawns.log de 05/10/2026: 19.832 chamadas gh num dia, a maior parte leitura
// repetida a cada ciclo (180 s) de PR parado: os ramos dos meus PRs (4.202), o head e os meus
// reviews para o "commit depois do meu review" (cerca de 7 mil), os comentários do autor para
// o pushback (1.166 de cada tipo) e a release do update (300). Aqui as funções reais rodam dez
// ciclos com o gh contado por tipo: PR parado custa a leitura do primeiro ciclo e nada mais;
// PR que mudou (updatedAt novo) custa uma leitura de novo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-chamadas-'));

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { Engine } = await import('../server.js');
const selfpr = await import('../lib/engine/selfpr.js');
const pushback = await import('../lib/engine/pushback.js');
const update = await import('../lib/engine/update.js');

const runReal = io.run;
let chamadas;
function tipo(args) {
  const a = args.join(' ');
  if (a.startsWith('pr view') && a.includes('headRefName,baseRefName,headRefOid')) return 'ramos';
  if (a.startsWith('pr view') && a.includes('--json headRefOid')) return 'head';
  if (/pulls\/\d+\/reviews/.test(a)) return 'reviews';
  if (/issues\/\d+\/comments|pulls\/\d+\/comments/.test(a)) return 'comentarios';
  if (a.startsWith('release view')) return 'release';
  return 'outro';
}
io.run = async (_cmd, args) => {
  const t = tipo(args || []);
  chamadas[t] = (chamadas[t] || 0) + 1;
  if (t === 'ramos') return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ headRefName: 'feat', baseRefName: 'main', headRefOid: 'h1' }) };
  if (t === 'head') return { ok: true, code: 0, stderr: '', stdout: 'h2\n' };
  if (t === 'reviews' && args.join(' ').includes('submitted_at] | sort')) return { ok: true, code: 0, stderr: '', stdout: '2026-10-01T10:00:00Z\n' };
  if (t === 'reviews') return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'APPROVED', commit: 'h1' }) };
  if (t === 'comentarios') return { ok: true, code: 0, stderr: '', stdout: '[]' };
  if (t === 'release') return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ tagName: 'v0.0.1', assets: [] }) };
  return { ok: false, code: 1, stdout: '', stderr: 'inesperado' };
};
after(() => { io.run = runReal; fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });
beforeEach(() => { chamadas = {}; });

const PRS = (updatedAt) => Array.from({ length: 5 }, (_, i) => ({
  key: `acme/app#${i + 1}`, repo: 'acme/app', number: i + 1, url: `https://github.com/acme/app/pull/${i + 1}`, author: 'autora', updatedAt,
}));

function motor() {
  const e = Object.create(Engine.prototype);
  e.config = { updateRepo: 'acme/farol', autoPushback: true };
  e.accountForPr = () => 'eu';
  e.tokenFor = () => 'tok';
  e.ghEnv = () => ({});
  e.activeReviews = new Map();
  e.selfAnalyses = {};
  e.headQuietoDesde = {};
  e.skipComentado = {};
  e.pushbackScanned = {};
  e.pushbacks = {};
  e.isMuted = () => false;
  e.budgetBlockedFor = () => false;
  e.reviewActions = () => Object.fromEntries(PRS('').map((p) => [p.key, { kind: 'request_changes' }]));
  e.log = () => { };
  e.pushState = () => { };
  e.savePushbackScanned = () => { };
  e.saveSelfAnalyses = () => { };
  return e;
}

async function ciclo(e, prs) {
  e.myPRs = prs.map((p) => ({ ...p }));
  e.panorama = prs.map((p) => ({ ...p, reviewedByMe: true }));
  await selfpr.enrichMyPRBranches(e);
  await selfpr.refreshStaleStates(e);
  for (const pr of pushback.pushbackTargets(e, e.reviewActions())) {
    const det = await e.detectAuthorPushback(pr, e.pushbackScanned[pr.key] || '');
    if (det && !det.hadActivity) {
      e.pushbackLidoEm = e.pushbackLidoEm || {};
      e.pushbackLidoEm[pr.key] = String(pr.updatedAt || '');
      e.pushbackScanned[pr.key] = det.marker;
    }
  }
  await update.checkUpdate(e);
}

test('dez ciclos com os cinco PRs parados: cada leitura acontece no primeiro ciclo e não se repete', async () => {
  const e = motor();
  for (let i = 0; i < 10; i++) await ciclo(e, PRS('2026-10-05T10:00:00Z'));
  assert.equal(chamadas.ramos, 5, 'um pr view por PR meu, não um por ciclo (antes: 50)');
  assert.equal(chamadas.head, 5, 'um head por PR revisado (antes: 50)');
  assert.equal(chamadas.release, 1, 'a release, uma vez no intervalo de checagem (antes: 10)');
  assert.equal(chamadas.comentarios, 10, 'os dois tipos de comentário, uma vez por PR (antes: 100)');
  assert.ok(chamadas.reviews <= 15, `reviews: ${chamadas.reviews} (antes: 150)`);
});

test('PR que mudou volta a ser lido, uma vez, e só ele', async () => {
  const e = motor();
  await ciclo(e, PRS('2026-10-05T10:00:00Z'));
  const antes = { ...chamadas };
  const prs = PRS('2026-10-05T10:00:00Z');
  prs[2].updatedAt = '2026-10-05T11:00:00Z';
  await ciclo(e, prs);
  await ciclo(e, prs);
  assert.equal(chamadas.ramos - antes.ramos, 1);
  assert.equal(chamadas.head - antes.head, 1);
});

test('falha de leitura não fica guardada: o ciclo seguinte tenta de novo', async () => {
  const e = motor();
  const original = io.run;
  let falhar = true;
  io.run = async (cmd, args) => {
    if (falhar && tipo(args) === 'ramos') { chamadas.ramos = (chamadas.ramos || 0) + 1; return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' }; }
    return original(cmd, args);
  };
  try {
    await ciclo(e, PRS('2026-10-05T10:00:00Z'));
    falhar = false;
    await ciclo(e, PRS('2026-10-05T10:00:00Z'));
  } finally { io.run = original; }
  assert.equal(chamadas.ramos, 10, 'o ciclo depois da falha relê os cinco');
  assert.equal(e.myPRs[0].headSha, 'h1');
});
