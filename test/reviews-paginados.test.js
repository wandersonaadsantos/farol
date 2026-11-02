import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-review-pages-'));
const { Engine } = await import('../server.js');
const io = (await import('../lib/io.js')).default;
const original = io.run;
after(() => { io.run = original; fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); });
const HEAD = 'a'.repeat(40);
const pr = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1' };

test('decisão apenas na página seguinte impede sessão automática com a fonte canônica real', async () => {
  const e = new Engine();
  e.log = () => {}; e.pushState = () => {};
  e.accountForPr = () => 'eu'; e.tokenFor = () => 'synthetic'; e.ghEnv = () => ({});
  e.prState = async () => 'OPEN'; e.headSha = async () => HEAD;
  e.bloqueadoPorHistorico = async () => ({ bloqueado: false, quem: [], decisivos: [] });
  let sessions = 0;
  e.runHeadlessReview = async () => { sessions++; };
  const first = Array.from({ length: 30 }, () => ({ state: 'COMMENTED', commit_id: 'b'.repeat(40), submitted_at: '2026-10-28T10:00:00Z' }));
  for (const state of ['APPROVED', 'CHANGES_REQUESTED']) {
    io.run = async (_command, args) => {
      if (!args.includes('--paginate')) return { ok: true, stdout: JSON.stringify(first) };
      const second = [{ state, commit_id: HEAD, submitted_at: '2026-10-29T10:00:00Z' }];
      return { ok: true, stdout: JSON.stringify(first) + '\n' + JSON.stringify(second) };
    };
    await e.runOneHeadless({ ...pr }, 'eu');
    assert.equal(sessions, 0);
  }
});

test('erro numa página não transforma resposta parcial em histórico completo', async () => {
  io.run = async () => ({ ok: false, stdout: '[{"state":"APPROVED"}]', stderr: 'HTTP 502' });
  const e = new Engine(); e.accountForPr = () => 'eu'; e.tokenFor = () => 'synthetic'; e.ghEnv = () => ({});
  assert.equal(await e.myReviewsWithTime(pr), null);
});

test('página malformada não autoriza usar somente a página anterior', async () => {
  io.run = async () => ({ ok: true, stdout: '[{"state":"APPROVED"}]\n[{"state":' });
  const e = new Engine(); e.accountForPr = () => 'eu'; e.tokenFor = () => 'synthetic'; e.ghEnv = () => ({});
  assert.equal(await e.myReviewsWithTime(pr), null);
});
