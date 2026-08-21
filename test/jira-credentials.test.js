// A credencial mora FORA do config.json de propósito: o config inteiro trafega
// pra UI, e o que entra nele circula. Aqui o segredo tem arquivo próprio, e o
// resto do app só pergunta se existe.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-jira-cred-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const cred = await import('../lib/jira/credentials.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('credencial ausente devolve null e hasCredential false', () => {
  assert.equal(cred.credentialFor('s1'), null);
  assert.equal(cred.hasCredential('s1'), false);
});

test('grava, lê e apaga por site', () => {
  assert.equal(cred.setCredential('s1', { email: ' a@b.com ', token: ' tok ' }), true);
  assert.deepEqual(cred.credentialFor('s1'), { email: 'a@b.com', token: 'tok' });
  assert.equal(cred.hasCredential('s1'), true);
  assert.equal(cred.hasCredential('s2'), false, 'um site não pode enxergar a credencial do outro');
  assert.equal(cred.removeCredential('s1'), true);
  assert.equal(cred.credentialFor('s1'), null);
});

test('recusa credencial incompleta em vez de gravar pela metade', () => {
  assert.equal(cred.setCredential('s3', { email: '', token: 'tok' }), false);
  assert.equal(cred.setCredential('s3', { email: 'a@b.com', token: '' }), false);
  assert.equal(cred.credentialFor('s3'), null);
});

test('o arquivo mora fora do config.json', () => {
  assert.ok(cred.credentialsPath().endsWith('jira-credentials.json'));
  assert.ok(!cred.credentialsPath().endsWith('config.json'));
});

// O writeJsonAtomic escreve num .tmp com o modo default e o rename entrega ESSE
// modo ao arquivo final. Restringir uma vez só no cadastro não sobrevive à escrita
// seguinte, e o removeCredential reabriria os tokens dos OUTROS sites.
test('o arquivo de credencial nunca fica legível por outros', { skip: process.platform === 'win32' }, () => {
  cred.setCredential('s9', { email: 'a@b.com', token: 'tok' });
  assert.equal(fs.statSync(cred.credentialsPath()).mode & 0o077, 0);
  cred.setCredential('s8', { email: 'a@b.com', token: 'tok' });
  cred.removeCredential('s8');
  assert.equal(fs.statSync(cred.credentialsPath()).mode & 0o077, 0, 'remover um site não pode reabrir o arquivo');
});
