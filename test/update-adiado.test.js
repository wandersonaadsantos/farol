// O update que espera diz por quê (25/09/2026).
//
// A v2.62.14 foi detectada às 11:07 e só aplicada às 11:14: numa checagem do meio o
// auto-update achou o Farol ocupado e adiou, sem deixar rastro em lugar nenhum. Quando
// alguém foi olhar, a sessão que segurava já tinha acabado, e a pergunta "o update
// automático está com defeito?" não tinha resposta. O adiamento vira estado visível no
// Sistema > Visão geral: o que está segurando e desde quando. Não vai para o farol.log,
// que é só de falhas; esperar uma revisão terminar é o comportamento certo, não uma falha.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-update-adiado-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const update = (await import('../lib/engine/update.js')).default;
const { Engine } = await import('../server.js');
const P = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

function engineComUpdate() {
  const engine = new Engine();
  engine.update = { current: '0.0.1', channel: 'remote', repo: 'x/y', source: null, sourceVersion: '9.9.9', available: true, checkedAt: Date.now() };
  engine.pushState = () => { engine.empurrou = (engine.empurrou || 0) + 1; };
  return engine;
}

const NUNCA = { applyUpdate: async () => { throw new Error('não podia aplicar ocupado'); } };

/* ---------- o que segura, em palavras ---------- */

test('ocioso não tem motivo, e cada coisa que segura o update tem o seu', () => {
  const e = engineComUpdate();
  assert.equal(update.motivoOcupado(e), null);
  e.headlessBusyAccounts.set('conta', 2);
  assert.equal(update.motivoOcupado(e), '2 revisões em andamento');
  e.headlessBusyAccounts.clear();
  e.headlessQueue.push({ key: 'a/b#1' });
  assert.equal(update.motivoOcupado(e), '1 PR na fila de revisão');
  e.headlessQueue.length = 0;
  e.running.set('s1', {});
  assert.equal(update.motivoOcupado(e), '1 sessão de IA em andamento (chat, autoanálise ou ferramenta)');
  e.running.clear();
  e.activeReviews.set('t1', { mode: 'terminal', startedAt: Date.now() });
  assert.equal(update.motivoOcupado(e), 'sessão de terminal aberta');
});

test('revisão conta como revisão, não duas vezes como sessão de IA', () => {
  const e = engineComUpdate();
  e.headlessBusyAccounts.set('conta', 1);
  e.running.set('rev', {});
  assert.equal(update.motivoOcupado(e), '1 revisão em andamento');
  e.running.set('chat', {});
  assert.equal(update.motivoOcupado(e), '1 revisão em andamento, 1 sessão de IA em andamento (chat, autoanálise ou ferramenta)');
});

test('sessionsBusy continua dizendo exatamente o que dizia', () => {
  const e = engineComUpdate();
  assert.equal(update.sessionsBusy(e), false);
  e.running.set('s1', {});
  assert.equal(update.sessionsBusy(e), true);
  e.running.clear();
  e.activeReviews.set('t1', { mode: 'terminal', startedAt: Date.now() - 13 * 3600 * 1000 });
  assert.equal(update.sessionsBusy(e), false, 'terminal fantasma de mais de 12h não segura, como antes');
});

/* ---------- o adiamento vira estado visível ---------- */

test('adiado por estar ocupado: o motivo e a hora ficam no status do update, e a tela é avisada', async () => {
  const e = engineComUpdate();
  e.headlessBusyAccounts.set('conta', 1);
  const r = await update.maybeAutoUpdate(e, NUNCA);
  assert.equal(r.skipped, 'ocupado');
  assert.equal(e.update.adiado.motivo, '1 revisão em andamento');
  assert.ok(e.update.adiado.desde > 0);
  assert.ok(e.empurrou >= 1, 'sem pushState a tela só saberia no próximo ciclo');
});

test('o "desde" é de quando começou a esperar, e sobrevive à checagem que recria o status', async () => {
  const e = engineComUpdate();
  e.headlessBusyAccounts.set('conta', 1);
  await update.maybeAutoUpdate(e, NUNCA);
  const primeiro = e.update.adiado.desde;
  // o checkUpdate do ciclo seguinte troca o objeto engine.update inteiro
  e.update = { ...e.update, adiado: undefined };
  await new Promise((r) => setTimeout(r, 5));
  await update.maybeAutoUpdate(e, NUNCA);
  assert.equal(e.update.adiado.desde, primeiro);
});

test('quando fica livre e aplica, o adiamento some', async () => {
  const e = engineComUpdate();
  e.headlessBusyAccounts.set('conta', 1);
  await update.maybeAutoUpdate(e, NUNCA);
  e.headlessBusyAccounts.clear();
  const r = await update.maybeAutoUpdate(e, { applyUpdate: async () => ({ ok: true, from: '0.0.1', to: '9.9.9' }) });
  assert.equal(r.ok, true);
  assert.equal(e.update.adiado, undefined);
  assert.equal(e.updateAdiadoDesde, 0);
});

test('tentativa que falhou também explica a espera, com a hora da próxima', async () => {
  const e = engineComUpdate();
  e.autoUpdateFailedAt = Date.now();
  const r = await update.maybeAutoUpdate(e, NUNCA);
  assert.equal(r.skipped, 'backoff');
  assert.match(e.update.adiado.motivo, /última tentativa falhou/);
});

test('com o auto-update desligado não há espera nenhuma para explicar', async () => {
  const e = engineComUpdate();
  e.config.autoUpdate = false;
  e.headlessBusyAccounts.set('conta', 1);
  await update.maybeAutoUpdate(e, NUNCA);
  assert.equal(e.update.adiado, undefined);
});

/* ---------- a tela ---------- */

test('a linha da tela diz o que segura e desde quando, escapada', () => {
  const html = P.updateAdiadoHtml({ adiado: { motivo: '1 revisão <em> andamento', desde: new Date(2026, 8, 25, 11, 10).getTime() } });
  assert.match(html, /Esperando/);
  assert.match(html, /1 revisão &lt;em&gt; andamento/);
  assert.match(html, /desde 11:10/);
  assert.equal(P.updateAdiadoHtml({}), '');
  assert.equal(P.updateAdiadoHtml(null), '');
});
