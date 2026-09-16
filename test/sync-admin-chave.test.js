// A chave privada do admin NASCE e MORA só no aparelho admin (CT-ENV). Ela é apagada
// quando a geração muda: uma geração nova significa outro admin, e guardar a chave velha
// só cria caminho para assinar com autoridade que não existe mais.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-adminkey-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const ak = await import('../lib/sync/admin-chave.js');
const { IS_WIN } = await import('../lib/paths.js');
const { credentialsPath } = await import('../lib/sync/credentials.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });
beforeEach(() => { ak.apagarChaveDeAdmin(); });

const DESTINO = 'u1|https://x.firebaseio.com';

test('par novo: a pública tem 43 caracteres base64url e a privada é jwk', () => {
  const par = ak.gerarParDeAdmin();
  assert.equal(par.publicKey.length, 43);
  assert.match(par.publicKey, /^[A-Za-z0-9_-]+$/);
  assert.equal(par.jwk.kty, 'OKP');
  assert.equal(par.jwk.crv, 'Ed25519');
  assert.notEqual(ak.gerarParDeAdmin().publicKey, par.publicKey);
});

test('gravar e ler devolve a mesma chave, ao lado da credencial e fora de state/', () => {
  const par = ak.gerarParDeAdmin();
  assert.equal(ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 2, jwk: par.jwk }), true);
  const lida = ak.lerChaveDeAdmin();
  assert.equal(lida.generation, 2);
  assert.deepEqual(lida.jwk, par.jwk);
  assert.equal(path.basename(ak.caminhoDaChaveDeAdmin()), 'sync-admin.json');
  assert.equal(path.dirname(ak.caminhoDaChaveDeAdmin()), path.dirname(credentialsPath()));
  assert.equal(ak.caminhoDaChaveDeAdmin().includes(`${path.sep}state${path.sep}`), false);
});

test('chaveServe: uid, destino ou geração diferentes não servem', () => {
  const par = ak.gerarParDeAdmin();
  const c = { uid: 'u1', destino: DESTINO, generation: 2, jwk: par.jwk };
  assert.equal(ak.chaveServe(c, { uid: 'u1', destino: DESTINO, generation: 2 }), true);
  assert.equal(ak.chaveServe(c, { uid: 'u2', destino: DESTINO, generation: 2 }), false);
  assert.equal(ak.chaveServe(c, { uid: 'u1', destino: 'outro', generation: 2 }), false);
  assert.equal(ak.chaveServe(c, { uid: 'u1', destino: DESTINO, generation: 3 }), false, 'geração nova é outro admin');
  assert.equal(ak.chaveServe(null, { uid: 'u1', destino: DESTINO, generation: 2 }), false);
});

test('arquivo ausente ou corrompido devolve null, sem lançar', () => {
  assert.equal(ak.lerChaveDeAdmin(), null);
  fs.mkdirSync(path.dirname(ak.caminhoDaChaveDeAdmin()), { recursive: true });
  fs.writeFileSync(ak.caminhoDaChaveDeAdmin(), 'nao e json');
  assert.equal(ak.lerChaveDeAdmin(), null);
  fs.writeFileSync(ak.caminhoDaChaveDeAdmin(), '{"uid":"u1"}');
  assert.equal(ak.lerChaveDeAdmin(), null, 'sem jwk não serve de chave');
});

test('apagar é idempotente e some com o arquivo', () => {
  const par = ak.gerarParDeAdmin();
  ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 1, jwk: par.jwk });
  assert.equal(ak.apagarChaveDeAdmin(), true);
  assert.equal(fs.existsSync(ak.caminhoDaChaveDeAdmin()), false);
  assert.equal(ak.apagarChaveDeAdmin(), false);
});

test('modo 0600 depois de CADA gravação (posix)', { skip: IS_WIN ? 'chmod não vale em NTFS' : false }, () => {
  const par = ak.gerarParDeAdmin();
  ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 1, jwk: par.jwk });
  assert.equal(fs.statSync(ak.caminhoDaChaveDeAdmin()).mode & 0o777, 0o600);
  ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 2, jwk: par.jwk });
  assert.equal(fs.statSync(ak.caminhoDaChaveDeAdmin()).mode & 0o777, 0o600);
});

test('a chave privada nunca sai em texto de status: o módulo não expõe o jwk por acidente', () => {
  const par = ak.gerarParDeAdmin();
  ak.gravarChaveDeAdmin({ uid: 'u1', destino: DESTINO, generation: 1, jwk: par.jwk });
  // o `d` é a parte privada do JWK Ed25519: ele existe no arquivo e não pode vazar em
  // nenhuma projeção que o resto do app monte a partir do que é lido aqui
  const lida = ak.lerChaveDeAdmin();
  assert.ok(lida.jwk.d, 'a privada está no arquivo, como precisa estar');
  assert.equal(JSON.stringify(ak.resumoDaChaveDeAdmin(lida)).includes(lida.jwk.d), false, 'o resumo para a tela não leva a privada');
});
