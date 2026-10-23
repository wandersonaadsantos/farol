import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-self-merge-'));
process.env.FAROL_HOME = home;
const io = (await import('../lib/io.js')).default;
const originalRun = io.run;
const { Engine } = await import('../server.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const head = 'a'.repeat(40);
const pr = { key: 'acme/app#42', repo: 'acme/app', number: 42,
  url: 'https://github.com/acme/app/pull/42', author: 'eu', account: 'eu' };
const contexto = { prKey: pr.key, account: 'eu', headSha: head, materialVersion: head,
  operationKind: 'self', manual: true, ignorarRecibo: true };
after(() => { io.run = originalRun; fs.rmSync(home, { recursive: true, force: true }); });

function motor(client, deviceId) {
  const e = new Engine();
  e.token = 'falso'; e.tokens = { eu: 'falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.sync = { enabled: true, coordination: { enabled: true } };
  e.sync = { status: 'conectado', uid: 'u1', deviceId, client, devices: {}, agora: () => Date.now() };
  e.myPRs = [pr];
  e.selfAnalyses = { [pr.key]: { headSha: head, verdict: 'approvable', blockers: [], tips: [],
    coverageLimitations: [], observed: { headSha: head, sessionOutcome: 'complete',
      scope: { total: ['a'], reviewed: ['a'], missing: [] },
      verification: { status: 'satisfied' }, card: { requirement: 'not_required' } } } };
  e.log = () => {}; e.pushState = () => {}; e.saveSelfAnalyses = () => {};
  return e;
}

test('merge recusa análise remota e impede nova análise durante a escrita no GitHub', async () => {
  const fake = await startFakeRtdb({ token: 'falso' });
  const client = createRtdbClient({ databaseUrl: fake.url,
    getIdToken: async () => ({ ok: true, idToken: 'falso' }) });
  const local = motor(client, 'local');
  const remoto = motor(client, 'remoto');
  let lease;
  let ghCalls = 0;
  io.run = async () => { ghCalls++; throw new Error('não deveria chamar gh'); };
  try {
    lease = (await admit(remoto, contexto)).handle;
    const blocked = await local.mergeSelfPR(pr.url);
    assert.equal(blocked.ok, false);
    assert.match(blocked.error, /coordenação/);
    assert.equal(ghCalls, 0, 'análise antiga elegível não autoriza durante reanálise remota');
    await lease.abort();
    io.run = async (cmd, args) => {
      if (args[1] === 'view') return { ok: true, stdout: JSON.stringify({ state: 'OPEN',
        author: { login: 'eu' }, headRefOid: head, headRefName: 'feature/x' }) };
      if (args[1] === 'merge') {
        ghCalls++;
        const concorrente = await admit(remoto, contexto);
        assert.equal(concorrente.admitted, false, 'merge segura o mesmo lease até o GitHub responder');
        assert.equal(concorrente.reason, 'alheio');
      }
      return { ok: true, stdout: '', stderr: '' };
    };
    assert.equal((await local.mergeSelfPR(pr.url)).ok, true);
    assert.equal(ghCalls, 1);
    const depois = await admit(remoto, contexto);
    assert.equal(depois.admitted, true, 'merge libera a posse sem recibo de revisão');
    lease = depois.handle;
  } finally { if (lease) await lease.abort(); await fake.close(); }
});

test('coordenação indisponível ou análise local pendente não libera merge', async () => {
  const e = motor(null, 'local');
  let calls = 0;
  io.run = async () => { calls++; throw new Error('não deveria chamar gh'); };
  e.sync.status = 'erro';
  assert.equal((await e.mergeSelfPR(pr.url)).ok, false);
  e.config.sync.enabled = false;
  e.headlessQueue = [{ ...pr, kind: 'self' }];
  assert.equal((await e.mergeSelfPR(pr.url)).ok, false);
  e.headlessQueue = [];
  e.activeReviews.set('s1', { mode: 'self', keys: [pr.key] });
  assert.equal((await e.mergeSelfPR(pr.url)).ok, false);
  assert.equal(calls, 0);
});
