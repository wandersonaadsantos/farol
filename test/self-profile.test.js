import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'farol-self-profile-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { requestedSelfProfile, sessionSelfProfile } = await import('../lib/engine/self-profile.js');
const { prepareSelfIsolation } = await import('../lib/engine/self-isolation.js');
const { prepareAccount } = await import('../lib/capacity/admission.js');
const io = (await import('../lib/io.js')).default;
const admission = (await import('../lib/engine/admissao.js')).default;
after(async () => { assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep)); await fs.rm(home, { recursive: true, force: true }); });

function fixture() {
  const engine = new Engine();
  engine.config.accounts = [{ user: 'dev', claudeProfileId: 'claude' }];
  engine.config.claudeProfiles = [{ id: 'claude', kind: 'dir', dir: '/configured-profile' }, { id: 'codex', kind: 'codex' }];
  engine.log = engine.pushState = () => {};
  return engine;
}
async function snapshot() {
  return prepareSelfIsolation({ source: { status: 'complete', manifest: { H: 'a'.repeat(40), B: 'b'.repeat(40), M: 'c'.repeat(40),
    files: [{ path: 'a.js', patch: '+const a = 1;', patchStatus: 'available' }] }, reader: {
    tree: async () => ({ complete: true, entries: [{ path: 'a.js', readable: true, mode: '100644' }] }),
    read: async () => ({ status: 'available', text: 'const a = 1;' }),
  } } }, { base: path.join(home, 'snapshots') });
}

test('seleção exige id Codex existente e modo restrito, sem alterar o perfil da conta', () => {
  const engine = fixture(), before = structuredClone(engine.config);
  assert.equal(requestedSelfProfile(engine), null);
  assert.deepEqual(requestedSelfProfile(engine, { isolation: 'restricted-read', codexProfileId: 'codex' }), { kind: 'codex', id: 'codex' });
  for (const id of [null, false, 1, {}, '', 'missing', 'claude']) {
    assert.throws(() => requestedSelfProfile(engine, { isolation: 'restricted-read', codexProfileId: id }));
  }
  assert.throws(() => requestedSelfProfile(engine, { codexProfileId: 'codex' }), /restrita/);
  assert.deepEqual(engine.config, before);
  assert.equal(engine.resolveClaudeAuth('dev').id, 'claude');
});

test('executor exige snapshot próprio e recusa perfil removido ou alterado durante a espera', async () => {
  const engine = fixture(), selfIsolation = await snapshot();
  const opts = { operationKind: 'self', selfIsolation, selfCodexProfileId: 'codex' };
  assert.deepEqual(sessionSelfProfile(engine, opts), { kind: 'codex', id: 'codex' });
  assert.throws(() => sessionSelfProfile(engine, { ...opts, operationKind: 'review' }), /autoanálise/);
  assert.throws(() => sessionSelfProfile(engine, { ...opts, selfIsolation: { ...selfIsolation } }), /propriedade/);
  engine.config.claudeProfiles[1].kind = 'dir';
  assert.throws(() => sessionSelfProfile(engine, opts), /nenhum fallback/);
  engine.config.claudeProfiles.pop();
  assert.throws(() => sessionSelfProfile(engine, opts), /nenhum fallback/);
});

test('duas sessões da mesma conta escolhem executores distintos sem trocar a associação', async () => {
  const engine = fixture(), before = structuredClone(engine.config), original = io.run;
  const selected = await snapshot(), associated = await snapshot();
  engine.ghEnv = () => ({ ...process.env });
  // Só a negociação de capacidades é substituída; o roteamento real deve chegar ao launcher correto.
  io.run = async () => ({ ok: true, stdout: '--sandbox' });
  try {
    const results = await Promise.allSettled([
      engine.runClaudeStream('fixture', { id: 'selected', account: 'dev', operationKind: 'self', selfIsolation: selected, selfCodexProfileId: 'codex' }),
      engine.runClaudeStream('fixture', { id: 'associated', account: 'dev', operationKind: 'self', selfIsolation: associated }),
    ]);
    assert.match(results[0].reason?.message || '', /Codex sem contrato/);
    assert.match(results[1].reason?.message || '', /Claude sem contrato/);
    assert.deepEqual(engine.config, before);
    assert.equal(engine.resolveClaudeAuth('dev').id, 'claude');
  } finally { io.run = original; }
});

test('seleção explícita não atravessa o lease de coordenação', async () => {
  const engine = fixture();
  engine.syncCoordenacaoAtiva = () => true;
  let admitted = 0;
  engine.syncAdmit = async () => { admitted++; return { admitted: false, reason: 'ocupado' }; };
  const result = await engine.runClaudeStream('fixture', { id: 'blocked', account: 'dev', operationKind: 'self',
    selfIsolation: await snapshot(), selfCodexProfileId: 'codex', coordination: { prKey: 'fixture/repo#1', materialVersion: 'a'.repeat(40) } });
  assert.equal(admitted, 1);
  assert.equal(result.blocked, true);
  assert.equal(engine.running.size, 0);
});

test('reserva desconhecida e orçamento do Codex escolhido continuam recusando execução', async () => {
  const engine = fixture(), auth = { kind: 'codex', id: 'codex' };
  engine.config.quotaReservations = { codex: { mode: 'enforce', maxUsedPercent: 70 } };
  await assert.rejects(prepareAccount(engine, 'dev', auth), /Reserva de cota/);
  engine.config.quotaReservations.codex.mode = 'observe';
  engine.profileBudgetStatus = profile => ({ blocked: profile.id === 'codex' });
  await assert.rejects(prepareAccount(engine, 'dev', auth), /Orçamento/);
  engine.profileBudgetStatus = () => ({ blocked: false });
  engine.budgetBlockedFor = engine.grupoSegura = () => { throw new Error('Não consultar o perfil associado no lugar do escolhido'); };
  await prepareAccount(engine, 'dev', auth);
  assert.equal(engine.resolveClaudeAuth('dev').id, 'claude');
});

test('fila não prende nem reserva Codex no grupo monetário do perfil associado', () => {
  const engine = fixture(), original = admission.reservar, reservations = [], launched = [];
  engine.config.parallelReviews = 2;
  engine.config.sync.enabled = true; engine.config.sync.shared.enabled = true;
  engine.accountForPr = () => 'dev';
  engine.grupoSegura = () => 'retrato-velho'; engine.grupoDaConta = () => 'claude-money-group';
  engine.runOneHeadless = pr => launched.push(pr.key);
  const associated = { key: 'fixture/repo#1', repo: 'fixture/repo', kind: 'self' };
  const selected = { key: 'fixture/repo#2', repo: 'fixture/repo', kind: 'self', isolation: 'restricted-read', codexProfileId: 'codex' };
  engine.headlessQueue = [associated, selected];
  admission.reservar = (_engine, request) => { reservations.push(request); return { ok: true, id: 'owned-fixture' }; };
  try {
    engine.processHeadless();
    assert.deepEqual(launched, [selected.key]);
    assert.deepEqual(engine.headlessQueue, [associated]);
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].grupo, '');
    assert.equal(engine.headlessWaitReasons.get(associated.key).motivo, 'grupo-nao-verificavel');
    assert.equal(engine.headlessWaitReasons.has(selected.key), false);
    assert.equal(engine.resolveClaudeAuth('dev').id, 'claude');
  } finally { admission.reservar = original; }
});

test('perfil removido na fila é recusado antes da reserva sem prender o próximo item', () => {
  const engine = fixture(), original = admission.reservar, reservations = [], launched = [], errors = [];
  engine.headlessBusyAccounts.set('other-account', 1);
  engine.config.sync.enabled = true; engine.config.sync.shared.enabled = true;
  engine.accountForPr = () => 'dev'; engine.grupoSegura = () => 'retrato-velho';
  engine.log = (_level, message) => errors.push(message);
  engine.runOneHeadless = pr => launched.push(pr.key);
  const selected = { repo: 'fixture/repo', kind: 'self', isolation: 'restricted-read', codexProfileId: 'codex' };
  engine.headlessQueue = [{ ...selected, key: 'fixture/repo#1', codexProfileId: 'removed' }, { ...selected, key: 'fixture/repo#2' }];
  admission.reservar = (_engine, request) => { reservations.push(request); return { ok: true, id: 'owned-fixture' }; };
  try {
    engine.processHeadless();
    assert.equal(engine.headlessQueue.length, 0);
    assert.deepEqual(launched, ['fixture/repo#2']);
    assert.equal(reservations.length, 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /nenhum fallback/);
    assert.equal(engine.headlessBusyAccounts.get('dev'), 1);
    assert.equal(engine.headlessBusyAccounts.get('other-account'), 1);
  } finally { admission.reservar = original; }
});
