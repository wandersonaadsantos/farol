// Instalação cuja atualização é administrada por fora (17/10/2026): a Hostinger troca a
// versão por uma tarefa própria (cron) que preserva o transporte privado e confere a
// recuperação. Com `FAROL_UPDATE_MANAGER=external` o engine nunca se atualiza sozinho nem
// pelo botão, senão disputaria a pasta do app com a tarefa. Antes isso era uma adaptação
// local no servidor, e cada release entrava em conflito com ela.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-update-externo-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const update = (await import('../lib/engine/update.js')).default;
const { atualizacaoExterna } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('só o valor literal external liga a administração por fora', () => {
  assert.equal(atualizacaoExterna({ FAROL_UPDATE_MANAGER: 'external' }), true);
  for (const v of [undefined, '', 'EXTERNAL', 'sim', '1']) assert.equal(atualizacaoExterna({ FAROL_UPDATE_MANAGER: v }), false);
  assert.equal(atualizacaoExterna({}), false);
});

function engineFalso() {
  const emitidos = [];
  return {
    emitidos,
    config: { autoUpdate: true },
    update: { current: '1.0.0', channel: 'remote', available: true, sourceVersion: '1.0.1' },
    activeReviews: new Map(), headlessBusyAccounts: new Map(), running: new Map(), headlessQueue: [],
    emit: (ev, d) => emitidos.push([ev, d]), pushState() {}, log() {},
  };
}

test('administrada por fora: o automático pula sem baixar nada e o botão explica quem atualiza', async () => {
  const engine = engineFalso();
  let baixou = 0;
  const deps = { externa: true, checkUpdate: async () => {}, downloadRemoteUpdate: async () => { baixou += 1; return '/nada'; } };
  const auto = await update.maybeAutoUpdate(engine, deps);
  assert.deepEqual(auto, { ok: false, skipped: 'administrado-por-fora' });
  const clique = await update.applyUpdate(engine, deps);
  assert.equal(clique.ok, false);
  assert.match(clique.error, /administrada por uma tarefa externa/);
  assert.equal(baixou, 0);
});

test('sem a variável o caminho de sempre continua (aqui, nada a atualizar)', async () => {
  const engine = engineFalso();
  engine.update.available = false;
  const deps = { externa: false, checkUpdate: async () => {} };
  assert.deepEqual(await update.maybeAutoUpdate(engine, deps), { ok: false, skipped: 'nada' });
});
