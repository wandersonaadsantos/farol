// Label `<conta>:revisando` cuja remoção falhou no fim da revisão (10/10/2026).
//
// Antes: o WARN era tudo, e a label ficava no PR até a próxima revisão dele pela mesma conta
// (24h28 num PR real). Agora a falha fica anotada em disco e o check() tenta de novo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-labels-a-tirar-'));

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { tirarPendentes, ARQUIVO } = await import('../lib/engine/labels-a-tirar.js');
const { removeInProgressLabel } = await import('../lib/engine/review.js');

const runReal = io.run;
after(() => { io.run = runReal; fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });
beforeEach(() => { fs.rmSync(ARQUIVO, { force: true }); });

const PR = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7' };

function motor(extra = {}) {
  const logs = [];
  return {
    logs,
    accountForPr: () => 'eu', tokenFor: () => 'tok', ghEnv: () => ({}),
    activeReviews: new Map(),
    log: (nivel, msg) => logs.push(`${nivel} ${msg}`),
    ...extra,
  };
}

function lerArquivo() { return JSON.parse(fs.readFileSync(ARQUIVO, 'utf8')); }

test('remoção que falha fica anotada em disco, com o WARN dizendo que tenta de novo', async () => {
  io.run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'dial tcp: i/o timeout' });
  const e = motor();
  await removeInProgressLabel(e, PR, 'eu:revisando');
  assert.match(e.logs[0], /não saiu de acme\/app#7: dial tcp: i\/o timeout; tento de novo/);
  assert.equal(lerArquivo()['acme/app#7'].label, 'eu:revisando');
});

test('remoção que dá certo não anota nada', async () => {
  io.run = async () => ({ ok: true, code: 0, stdout: '', stderr: '' });
  await removeInProgressLabel(motor(), PR, 'eu:revisando');
  assert.equal(fs.existsSync(ARQUIVO), false);
});

test('o ciclo seguinte tira a label e limpa a anotação, inclusive depois de reiniciar', async () => {
  io.run = async () => ({ ok: false, code: 1, stdout: '', stderr: 'rede' });
  await removeInProgressLabel(motor(), PR, 'eu:revisando');
  const chamadas = [];
  // motor novo = app reiniciado: a anotação vem do disco
  await tirarPendentes(motor(), async (_c, args) => { chamadas.push(args.join(' ')); return { ok: true, stderr: '' }; });
  assert.deepEqual(chamadas, [`pr edit ${PR.url} --remove-label eu:revisando`]);
  assert.deepEqual(lerArquivo(), {});
});

test('falha de novo mantém a anotação; label que já não está lá encerra', async () => {
  const e = motor();
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: Date.now() } };
  await tirarPendentes(e, async () => ({ ok: false, stderr: 'rede' }));
  assert.ok(e.labelsATirar[PR.key]);
  await tirarPendentes(e, async () => ({ ok: false, stderr: "'eu:revisando' not found" }));
  assert.equal(e.labelsATirar[PR.key], undefined);
});

test('revisão viva deste aparelho no mesmo PR adia: a label é dela', async () => {
  const e = motor();
  e.activeReviews.set('s1', { mode: 'review', keys: [PR.key] });
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: Date.now() } };
  let chamou = false;
  await tirarPendentes(e, async () => { chamou = true; return { ok: true }; });
  assert.equal(chamou, false);
  assert.ok(e.labelsATirar[PR.key]);
});

test('conta sem token não chama o gh e não perde a anotação', async () => {
  const e = motor({ tokenFor: () => '' });
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: Date.now() } };
  let chamou = false;
  await tirarPendentes(e, async () => { chamou = true; return { ok: true }; });
  assert.equal(chamou, false);
  assert.ok(e.labelsATirar[PR.key]);
});

test('depois de 7 dias desiste com um WARN, sem chamar o gh', async () => {
  const e = motor();
  const agora = Date.now();
  e.labelsATirar = { [PR.key]: { url: PR.url, label: 'eu:revisando', desde: agora - 8 * 24 * 3600 * 1000 } };
  let chamou = false;
  await tirarPendentes(e, async () => { chamou = true; return { ok: true }; }, agora);
  assert.equal(chamou, false);
  assert.equal(e.labelsATirar[PR.key], undefined);
  assert.match(e.logs.join('\n'), /parei de tentar/);
});
