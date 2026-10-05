// O laço entre reconciliarVistos e a conferência de "já revisado" (05/10/2026).
//
// Medido em 04/10/2026: um PR revisado por mim FORA do Farol, e que a minha própria conta
// pediu de novo 13 s depois de aprovar, voltava à fila a cada ciclo (90 vezes no dia), com
// duas leituras gh e um toast por volta. Aqui o ciclo é reproduzido de verdade (o
// reconciliarVistos e a boca da fila automática, alternados como no check()), e as
// contraprovas cobrem o que tem de continuar funcionando: head novo e pedido de outra pessoa.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-vistos-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default;
const { reconciliarVistos, jaResolvido, ARQUIVO } = await import('../lib/engine/vistos-reconciliacao.js');
const destrava = await import('../lib/engine/destrava.js');
const { STATE_DIR } = await import('../lib/paths.js');
fs.mkdirSync(STATE_DIR, { recursive: true }); // o prepareHome faz isso no boot

const runReal = io.run;
after(() => { io.run = runReal; fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });

const H1 = 'a'.repeat(40), H2 = 'b'.repeat(40);
const APROVEI = Date.parse('2026-10-03T07:03:55Z');
const PR = (updatedAt = '2026-10-03T07:04:08Z') => ({ key: 'acme/infra#7', repo: 'acme/infra', number: 7, url: 'https://github.com/acme/infra/pull/7', updatedAt });

// o "GitHub": head atual, meus reviews e a timeline de pedidos de revisão
function mundo() {
  const m = { head: H1, reviews: [{ state: 'APPROVED', commit: H1, at: APROVEI }], pedidos: [{ at: '2026-10-03T07:04:08Z', alvo: 'eu', ator: 'eu' }], timelineFalha: false, chamadas: { head: 0, reviews: 0, timeline: 0 } };
  return m;
}

function motor(m) {
  const e = Object.create(Engine.prototype);
  e.seen = new Set();
  e.ignorados = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.activeReviews = new Map();
  e.headlessQueue = [];
  e.autoReviewParked = new Set();
  e.retryAfterNet = new Map();
  e.vistosPorRecibo = new Set();
  e.queue = [];
  e.destravados = {};
  e.revisadosFora = {};
  e.saveSeen = () => { };
  e.saveDestravados = () => { };
  e.accountForPr = () => 'eu';
  e.tokenFor = () => 'tok';
  e.ghEnv = () => ({});
  e.toasts = [];
  e.avisos = [];
  e.emit = (_, t) => e.toasts.push(t.text);
  e.log = (nivel, msg) => e.avisos.push(`${nivel} ${msg}`);
  e.headSha = async () => { m.chamadas.head++; return m.head; };
  e.myReviewsWithTime = async () => { m.chamadas.reviews++; return m.reviews; };
  io.run = async (_cmd, args) => {
    if (String(args.join(' ')).includes('/timeline')) {
      m.chamadas.timeline++;
      if (m.timelineFalha) return { ok: false, code: 1, stdout: '', stderr: 'HTTP 502' };
      return { ok: true, code: 0, stderr: '', stdout: m.pedidos.map((p) => [p.at, p.alvo, p.ator].join('\t')).join('\n') };
    }
    return { ok: false, code: 1, stdout: '', stderr: 'inesperado' };
  };
  return e;
}

// um ciclo do check(): reconciliar e, se o PR voltou à fila, a boca da fila automática
async function ciclo(e, pr) {
  reconciliarVistos(e, [pr]);
  if (!e.seen.has(pr.key)) return jaResolvido(e, pr);
  return null;
}

test('o laço não volta: revisado fora do Farol e pedido pela própria conta fica resolvido, sem gh e sem toast nos ciclos seguintes', async () => {
  const m = mundo();
  const e = motor(m);
  e.seen.add('acme/infra#7');
  for (let i = 0; i < 10; i++) await ciclo(e, PR());
  assert.equal(m.chamadas.head, 1, 'uma conferência só, no primeiro ciclo');
  assert.equal(m.chamadas.timeline, 1);
  assert.equal(e.toasts.length, 1, 'um aviso só');
  assert.equal(e.avisos.filter((l) => l.includes('voltaram à fila')).length, 1, 'a volta acontece uma vez, não uma por ciclo');
  assert.ok(e.seen.has('acme/infra#7'));
  assert.equal(JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'))['acme/infra#7'].head, H1, 'a marca é durável');
});

test('o PR mudou (comentário, label) sem head novo nem pedido de outra pessoa: confere uma vez e continua resolvido, sem toast', async () => {
  const m = mundo();
  const e = motor(m);
  e.seen.add('acme/infra#7');
  await ciclo(e, PR());
  await ciclo(e, PR('2026-10-04T10:00:00Z'));
  await ciclo(e, PR('2026-10-04T10:00:00Z'));
  assert.equal(m.chamadas.head, 2, 'uma conferência por mudança');
  assert.equal(e.toasts.length, 1, 'o mesmo head resolvido não vira notícia de novo');
  assert.ok(e.seen.has('acme/infra#7'));
});

test('contraprova: head novo volta a revisar', async () => {
  const m = mundo();
  const e = motor(m);
  e.seen.add('acme/infra#7');
  await ciclo(e, PR());
  m.head = H2;
  const resolvido = await ciclo(e, PR('2026-10-04T11:00:00Z'));
  assert.equal(resolvido, false, 'a revisão roda');
  assert.equal(e.seen.has('acme/infra#7'), false);
});

test('contraprova: pedido de OUTRA pessoa depois do meu review revisa de novo, e o dedup passa a ignorar o review anterior', async () => {
  const m = mundo();
  const e = motor(m);
  e.seen.add('acme/infra#7');
  await ciclo(e, PR());
  m.pedidos.push({ at: '2026-10-04T12:00:00Z', alvo: 'eu', ator: 'autora' });
  const resolvido = await ciclo(e, PR('2026-10-04T12:00:00Z'));
  assert.equal(resolvido, false);
  assert.deepEqual(e.destravados['acme/infra#7'], { at: Date.parse('2026-10-04T12:00:00Z'), tipo: 'pedido' });
  assert.equal(e.revisadosFora['acme/infra#7'], undefined, 'a marca sai');
  // o myReviewStates real, com a marca de pedido, não conta mais o review anterior
  assert.deepEqual(await e.myReviewStates(PR(), H1), [], 'a revisão nova não termina em already_reviewed');
});

test('falta de dado não vira marca: timeline ilegível mantém o comportamento antigo (sem sessão, sem marca); head ilegível revisa', async () => {
  const m = mundo();
  m.timelineFalha = true;
  const e = motor(m);
  assert.equal(await jaResolvido(e, PR()), true, 'head já revisado não abre sessão, como antes');
  assert.equal(e.revisadosFora['acme/infra#7'], undefined, 'mas não grava marca: o próximo ciclo confere de novo');
  const m2 = mundo();
  m2.head = '';
  const e2 = motor(m2);
  assert.equal(await jaResolvido(e2, PR()), false);
});

test('comentário meu (COMMENTED) não é revisão: segue revisando', async () => {
  const m = mundo();
  m.reviews = [{ state: 'COMMENTED', commit: H1, at: APROVEI }];
  const e = motor(m);
  assert.equal(await jaResolvido(e, PR()), false);
});

test('o destrave também ignora pedido feito pela própria conta; linha antiga sem ator continua valendo', () => {
  const ler = destrava.lerTimeline || null;
  assert.equal(typeof ler, 'function', 'lerTimeline exportada para teste');
  const t = (ev, quando, alvo, sha, ator) => [ev, quando, alvo, sha, ator].filter((x) => x !== undefined).join('\t');
  const desde = Date.parse('2026-10-03T07:00:00Z');
  assert.equal(ler(t('review_requested', '2026-10-03T07:04:08Z', 'eu', '', 'eu'), desde, 'eu'), null, 'pedido próprio não destrava');
  assert.equal(ler(t('review_requested', '2026-10-03T07:04:08Z', 'eu', '', 'autora'), desde, 'eu').tipo, 'pedido');
  assert.equal(ler(t('review_requested', '2026-10-03T07:04:08Z', 'eu', ''), desde, 'eu').tipo, 'pedido', 'formato antigo, sem ator');
});
