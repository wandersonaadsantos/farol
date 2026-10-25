import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-ci-inicio-'));
const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default;
const run = io.run;
io.run = async () => ({ ok: true, stdout: '[]', stderr: '' });
after(() => { io.run = run; fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });
const PR = { key: 'acme/app#7', repo: 'acme/app', url: 'https://github.com/acme/app/pull/7', account: 'eu', author: 'dev' };

function motor() {
  const e = new Engine();
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.aguardarCiParaRevisar = true;
  e.prState = async () => 'OPEN';
  e.budgetBlockedFor = () => null;
  e.writeInflight = e.pushState = e.processHeadless = e.saveDecisions = e.log = () => {};
  e.queue = [];
  e.decisions = { pending: [], resolved: [] };
  e.bloqueadoPorChecks = async () => ({ bloqueado: true, faltando: [{ nome: 'ci', estado: 'vermelho' }] });
  e.executadas = 0;
  e.runHeadlessReview = async () => { e.executadas++; };
  return e;
}

test('CI que ficou vermelho antes da execução impede a sessão e libera a vaga sem perder retomada', async () => {
  const e = motor();
  const pr = { ...PR, resumeSessionId: 'sessao-preservada', technicalRecheck: true };
  e.headlessBusyAccounts.set('eu', 1);
  e.decisions.pending = [{ key: PR.key, pr: PR, esperaProva: { tentativas: 1 } }];
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.executadas, 0);
  assert.equal(e.headlessBusyAccounts.size, 0);
  assert.equal(e.queue[0].resumeSessionId, 'sessao-preservada');
  const marca = e.decisions.pending[0].esperaProva;
  assert.equal(marca.tentativas, 0);
  assert.equal(marca.aguardandoCi, true);
  await e.runOneHeadless(pr, 'eu');
  assert.equal(marca.tentativas, 0, 'esperar novamente não desconta outra rodada');
  e.bloqueadoPorChecks = async () => ({ bloqueado: false, faltando: [] });
  await e.runOneHeadless(pr, 'eu');
  assert.equal(e.executadas, 1);
  assert.equal(marca.tentativas, 1);
  assert.equal(marca.aguardandoCi, undefined);
});

test('preferência desligada e clique manual mantêm a entrada existente sem consultar CI', async () => {
  for (const manual of [false, true]) {
    const e = motor();
    e.config.aguardarCiParaRevisar = manual;
    e.bloqueadoPorChecks = async () => { throw Error('consulta indevida'); };
    await e.runOneHeadless({ ...PR, manual }, 'eu');
    assert.equal(e.executadas, 1);
  }
});

for (const origem of [{}, { viaDistribuicao: true }, { technicalRecheck: true }]) {
  test(`nenhum executor abre com CI obrigatório vermelho: ${JSON.stringify(origem)}`, async () => {
    const e = motor();
    await e.runOneHeadless({ ...PR, ...origem }, 'eu');
    assert.equal(e.executadas, 0);
    assert.equal(e.queue[0].key, PR.key);
  });
}
