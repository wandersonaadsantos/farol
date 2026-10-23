import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-self-redo-'));
process.env.FAROL_HOME = home;
const io = (await import('../lib/io.js')).default;
const originalRun = io.run;
const { Engine } = await import('../server.js');
const { saveSelfAnalyses, qualityOf, projectSelfAnalyses } = await import('../lib/engine/selfpr.js');
const { startFakeRtdb } = await import('./helpers/fake-rtdb.js');
const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { admit } = await import('../lib/sync/coordinator.js');
const pr = { key: 'acme/app#42', repo: 'acme/app', number: 42,
  url: 'https://github.com/acme/app/pull/42', title: 'Meu PR', headSha: 'a'.repeat(40) };
const result = JSON.stringify({ verdict: 'needs_work', summary: 'novo', blockers: [],
  tips: [], coverageLimitations: [], reportMarkdown: '# novo' });

io.run = async (cmd, args) => ({ ok: true,
  stdout: args.includes('headRefOid') ? pr.headSha : '', stderr: '' });
after(() => {
  io.run = originalRun;
  fs.rmSync(home, { recursive: true, force: true });
});
function motor() {
  const e = new Engine();
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.myPRs = [pr];
  e.selfAnalyses = {};
  e.pushState = () => {};
  e.processHeadless = () => {};
  e.log = () => {};
  return e;
}

test('Reanalisar repete o mesmo head sob lease e preserva os relatórios no disco', async () => {
  const fake = await startFakeRtdb({ token: 'token-falso' });
  const e = motor();
  e.config.sync = { enabled: true, coordination: { enabled: true } };
  e.sync = { status: 'conectado', uid: 'u1', deviceId: 'd1', devices: {},
    agora: () => Date.now(),
    client: createRtdbClient({ databaseUrl: fake.url,
      getIdToken: async () => ({ ok: true, idToken: 'token-falso' }) }) };
  const antigo = { key: pr.key, at: 1, headSha: pr.headSha, reportMarkdown: '# anterior' };
  e.selfAnalyses[pr.key] = antigo;
  let sessions = 0;
  e.runClaudeStream = async (prompt, opts) => {
    const ctx = { ...opts.coordination, operationKind: 'self', opId: opts.id };
    const admitted = await admit(e, ctx);
    assert.equal(admitted.admitted, true, 'recibo anterior não impede clique novo');
    const concorrente = await admit(e, ctx);
    assert.equal(concorrente.admitted, false, 'o lease continua impedindo sobreposição');
    const blocked = await admit(e, { ...ctx, ignorarRecibo: false });
    assert.equal(blocked.admitted, false);
    sessions++;
    await admitted.handle.complete({ publicationState: 'not_applicable' });
    return { text: result, sessionId: `s${sessions}` };
  };
  try {
    for (let i = 0; i < 2; i++) {
      assert.equal((await e.launchSelfAnalysis(pr.url)).ok, true);
      assert.equal((await e.launchSelfAnalysis(pr.url)).ok, false, 'não duplica item na fila');
      await e.runSelfAnalysis(e.headlessQueue.shift());
    }
    assert.equal(sessions, 2, 'duas sessões efetivas no mesmo commit');
    const atual = e.selfAnalyses[pr.key];
    assert.equal(atual.history.length, 2);
    assert.deepEqual(atual.history[0], antigo);
    assert.equal(atual.history[1].reportMarkdown, '# novo');
    assert.equal(atual.history[1].history, undefined, 'histórico plano');
    const snapshot = projectSelfAnalyses(e.selfAnalyses)[pr.key];
    assert.equal(snapshot.history, undefined, 'relatórios antigos não viajam no estado da tela');
    assert.equal(snapshot.reportMarkdown, atual.reportMarkdown);
    saveSelfAnalyses(e);
    const restaurado = new Engine().selfAnalyses[pr.key];
    assert.deepEqual(restaurado, atual, 'histórico e relatório sobrevivem ao reinício');
    assert.notEqual(qualityOf(atual).status, 'eligible', 'reexecução não dispensa provas');
    e.runClaudeStream = async () => { throw new Error('provedor indisponível'); };
    await assert.rejects(e.runSelfAnalysis({ ...pr, reanalisar: true }), /provedor indisponível/);
    assert.deepEqual(e.selfAnalyses[pr.key], atual, 'falha não apaga relatório nem histórico');
  } finally { await fake.close(); }
});
