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
const { executarMerge } = await import('../lib/engine/self-merge.js');
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

test('tomada de posse antes do merge recusa a escrita mesmo antes do heartbeat', async () => {
  const fake = await startFakeRtdb({ token: 'falso' });
  const client = createRtdbClient({ databaseUrl: fake.url,
    getIdToken: async () => ({ ok: true, idToken: 'falso' }) });
  const local = motor(client, 'local');
  const remoto = motor(client, 'remoto');
  let sucessor;
  let merges = 0;
  io.run = async (cmd, args) => {
    if (args[1] === 'view') return { ok: true, stdout: JSON.stringify({ state: 'OPEN',
      author: { login: 'eu' }, headRefOid: head, headRefName: 'feature/x' }) };
    if (args[1] === 'edit') {
      const tomada = await admit(remoto, { ...contexto, tomar: true, confirmado: true });
      assert.equal(tomada.admitted, true);
      sucessor = tomada.handle;
    }
    if (args[1] === 'merge') merges++;
    return { ok: true, stdout: '', stderr: '' };
  };
  try {
    const result = await local.mergeSelfPR(pr.url);
    assert.equal(result.ok, false);
    assert.match(result.error, /posse/);
    assert.equal(merges, 0);
    assert.ok(local.selfAnalyses[pr.key], 'a recusa preserva a análise anterior');
    assert.equal(await sucessor.geracaoCorrente(), true, 'o dono antigo não libera a posse sucessora');
  } finally { if (sucessor) await sucessor.abort(); await fake.close(); }
});

test('falha ao conferir geração recusa merge e o head fica fixado na escrita permitida', async () => {
  const e = motor(null, 'local');
  let merges = 0;
  io.run = async (cmd, args) => {
    if (args[1] === 'view') return { ok: true, stdout: JSON.stringify({ state: 'OPEN',
      author: { login: 'eu' }, headRefOid: head, headRefName: 'feature/x' }) };
    if (args[1] === 'merge') {
      merges++;
      assert.equal(args[args.indexOf('--match-head-commit') + 1], head);
    }
    return { ok: true, stdout: '', stderr: '' };
  };
  const input = { url: pr.url, key: pr.key, repo: pr.repo, acc: 'eu', me: 'eu',
    env: {}, analysis: { headSha: head }, mode: 'normal' };
  const unavailable = { geracaoCorrente: async () => false, validoPor: () => true };
  assert.equal((await executarMerge(e, input, unavailable)).ok, false);
  assert.equal(merges, 0);
  const valid = { geracaoCorrente: async () => true, validoPor: () => true };
  assert.equal((await executarMerge(e, input, valid)).ok, true);
  assert.equal(merges, 1);
});

test('bloqueio por ruleset registra chave própria sem alterar o protótipo do mapa', async () => {
  const e = motor(null, 'local');
  e.adminBlockedRepos = { 'existing/repo': true };
  const prototype = Object.getPrototypeOf(e.adminBlockedRepos);
  io.run = async (cmd, args) => {
    if (args[1] === 'view') return { ok: true, stdout: JSON.stringify({ state: 'OPEN', author: { login: 'eu' }, headRefOid: head }) };
    if (args[1] === 'merge') return { ok: false, stderr: 'repository rule violations' };
    return { ok: true, stdout: '', stderr: '' };
  };
  const r = await executarMerge(e, { url: pr.url, key: pr.key, repo: '__proto__',
    acc: 'eu', me: 'eu', env: {}, analysis: { headSha: head }, mode: 'admin' }, null);
  assert.equal(r.blocked, 'rule');
  assert.equal(Object.hasOwn(e.adminBlockedRepos, '__proto__'), true);
  assert.equal(e.adminBlockedRepos.__proto__, true);
  assert.equal(e.adminBlockedRepos['existing/repo'], true);
  assert.equal(Object.getPrototypeOf(e.adminBlockedRepos), prototype);
});
