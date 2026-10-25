import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-audit-lock-'));
process.env.FAROL_HOME = home;
const { acquire } = await import('../lib/review-audit/lock.js');
after(() => {
  assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(home, { recursive: true, force: true });
});
async function claimant(root, context) {
  const child = fork(new URL('./helpers/audit-lock-owner.js', import.meta.url), [root], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  context.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Dono do lock não respondeu.')), 15000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(Error('Dono encerrou antes de responder.')); });
  });
  return { child, ...result };
}
async function release(child) {
  const exited = once(child, 'exit'); child.send('release'); await exited;
}
test('escritor vivo não é roubado; liberar o dono não remove outro lock', () => {
  const root = path.join(home, 'live'), unlock = acquire(root, 'run');
  assert.throws(() => acquire(root, 'run'), /ocupada/);
  const write = acquire(root, 'write');
  unlock(); const next = acquire(root, 'run');
  unlock(); assert.throws(() => acquire(root, 'run'), /ocupada/);
  next(); write();
});
test('matar o processo dono permite recuperar a auditoria sem apagar estado manualmente', async context => {
  const root = path.join(home, 'crash'), owner = await claimant(root, context);
  assert.equal(owner.locked, true);
  assert.throws(() => acquire(root, 'run'), /ocupada/);
  const exited = once(owner.child, 'exit'); owner.child.kill('SIGKILL'); await exited;
  const unlock = acquire(root, 'run'); unlock();
  assert.deepEqual(fs.readdirSync(path.join(root, '.locks', 'run')), []);
});
test('processos concorrentes nunca entram juntos na seção protegida', async context => {
  const root = path.join(home, 'race'); let observedOwner = false;
  for (let wave = 0; wave < 3; wave++) {
    const values = await Promise.all(Array.from({ length: 3 }, () => claimant(root, context)));
    const winners = values.filter(v => v.locked);
    assert.ok(winners.length <= 1, 'no máximo um processo pode possuir o lock');
    if (winners.length) { observedOwner = true; assert.throws(() => acquire(root, 'run'), /ocupada/); }
    await Promise.all(values.map(v => release(v.child)));
  }
  assert.equal(observedOwner, true, 'a prova inclui uma aquisição real sob concorrência');
});
test('identidade corrompida ou lock legado não são apagados nem presumidos livres', () => {
  const root = path.join(home, 'corrupt'), dir = path.join(root, '.locks', 'run');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, randomUUID() + '.json'); fs.writeFileSync(file, '{broken');
  assert.throws(() => acquire(root, 'run'), /não verificável/);
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  const legacy = path.join(home, 'legacy'); fs.mkdirSync(legacy);
  fs.writeFileSync(path.join(legacy, 'run.lock'), '');
  assert.throws(() => acquire(legacy, 'run'), /antigo/);
  assert.equal(fs.existsSync(path.join(legacy, 'run.lock')), true);
});
