// lib/sync/credentials.js: o único lugar que lê ou grava o login do Firebase deste
// aparelho. Mora fora do config.json (que trafega inteiro para a UI) e a senha nunca
// entra: só uid, e-mail e o refresh token.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const HOME = path.join(os.tmpdir(), 'farol-test-sync-cred-' + process.pid);
process.env.FAROL_HOME = HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const cred = await import('../lib/sync/credentials.js');
const { IS_WIN } = await import('../lib/paths.js');
const {
  credentialsPath, readSyncCredential, setSyncCredential, updateRefreshToken, removeSyncCredential, hasSyncCredential,
} = cred;

after(() => { try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });
beforeEach(() => { try { fs.rmSync(credentialsPath(), { force: true }); } catch { /* best-effort */ } });

const LOGIN = { uid: 'u1', email: 'a@b.com', refreshToken: 'rt-1' };

test('credentialsPath: arquivo próprio em ~/.farol, fora do config.json', () => {
  assert.equal(credentialsPath(), path.join(HOME, 'sync-credentials.json'));
});

test('sem arquivo: nada lido, nada cadastrado', () => {
  assert.equal(readSyncCredential(), null);
  assert.equal(hasSyncCredential(), false);
});

test('setSyncCredential grava uid, e-mail e refresh token, com savedAt', () => {
  const antes = Date.now();
  assert.equal(setSyncCredential(LOGIN), true);
  const lido = readSyncCredential();
  assert.equal(lido.uid, 'u1');
  assert.equal(lido.email, 'a@b.com');
  assert.equal(lido.refreshToken, 'rt-1');
  assert.ok(lido.savedAt >= antes);
  assert.equal(hasSyncCredential(), true);
});

test('setSyncCredential nunca grava a senha, mesmo que ela venha junto', () => {
  setSyncCredential({ ...LOGIN, password: 'segredo-que-nao-sobe' });
  const cru = fs.readFileSync(credentialsPath(), 'utf8');
  assert.doesNotMatch(cru, /segredo-que-nao-sobe/);
  assert.deepEqual(Object.keys(JSON.parse(cru)).sort(), ['email', 'refreshToken', 'savedAt', 'uid']);
});

test('setSyncCredential recusa login incompleto', () => {
  assert.equal(setSyncCredential({ uid: 'u1', email: 'a@b.com' }), false);
  assert.equal(setSyncCredential({ refreshToken: 'rt' }), false);
  assert.equal(setSyncCredential(null), false);
  assert.equal(setSyncCredential({ uid: '  ', refreshToken: '  ' }), false);
  assert.equal(fs.existsSync(credentialsPath()), false);
});

test('readSyncCredential: arquivo sem uid ou sem refresh token vale como ausente', () => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.writeFileSync(credentialsPath(), JSON.stringify({ uid: 'u1', email: 'a@b.com' }));
  assert.equal(readSyncCredential(), null);
  fs.writeFileSync(credentialsPath(), '[1,2]');
  assert.equal(readSyncCredential(), null);
  fs.writeFileSync(credentialsPath(), '{ quebrado');
  assert.equal(readSyncCredential(), null);
  assert.equal(hasSyncCredential(), false);
});

test('updateRefreshToken troca só o refresh token (rotação do securetoken)', () => {
  setSyncCredential(LOGIN);
  assert.equal(updateRefreshToken('rt-2'), true);
  const lido = readSyncCredential();
  assert.equal(lido.refreshToken, 'rt-2');
  assert.equal(lido.uid, 'u1');
  assert.equal(lido.email, 'a@b.com');
});

test('updateRefreshToken sem login cadastrado ou com token vazio não cria nada', () => {
  assert.equal(updateRefreshToken('rt-2'), false);
  assert.equal(fs.existsSync(credentialsPath()), false);
  setSyncCredential(LOGIN);
  assert.equal(updateRefreshToken(''), false);
  assert.equal(readSyncCredential().refreshToken, 'rt-1');
});

test('removeSyncCredential apaga o arquivo e devolve se havia o que apagar', () => {
  setSyncCredential(LOGIN);
  assert.equal(removeSyncCredential(), true);
  assert.equal(fs.existsSync(credentialsPath()), false);
  assert.equal(hasSyncCredential(), false);
  assert.equal(removeSyncCredential(), false);
});

test('toda gravação deixa o arquivo legível só pelo dono (0600)', { skip: IS_WIN }, () => {
  setSyncCredential(LOGIN);
  assert.equal(fs.statSync(credentialsPath()).mode & 0o777, 0o600);
  updateRefreshToken('rt-3');
  assert.equal(fs.statSync(credentialsPath()).mode & 0o777, 0o600, 'a rotação regrava e precisa restringir de novo');
});
