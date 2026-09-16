// Embrulho do material pela senha do Firebase (CT-ENV). O scrypt roda assíncrono: o
// engine não pode travar o event loop por ~90 ms a cada login, e travaria com scryptSync.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-kek-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const kek = await import('../lib/sync/kek.js');
const { SYNC } = await import('../lib/constants.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const UID = 'u1';
const SENHA = 'senha longa de teste';

function trocarUmBit(blob, indice) {
  const partes = blob.split('.');
  const b = Buffer.from(partes[indice], 'base64url');
  b[0] ^= 1;
  partes[indice] = b.toString('base64url');
  return partes.join('.');
}

test('parâmetros: os da tabela OWASP, com sal novo a cada chamada', () => {
  const a = kek.parametrosPadrao();
  const b = kek.parametrosPadrao();
  assert.equal(a.alg, 'scrypt');
  assert.equal(a.N, SYNC.KEK_N);
  assert.equal(a.r, SYNC.KEK_R);
  assert.equal(a.p, SYNC.KEK_P);
  assert.equal(Buffer.from(a.salt, 'base64url').length, 16);
  assert.notEqual(a.salt, b.salt, 'sal por embrulho, nunca fixo');
});

test('material novo: 32 bytes por chave, e K_enc não deriva de K_id', () => {
  const m = kek.novoMaterial();
  assert.equal(m.v, 1);
  assert.equal(Buffer.from(m.id, 'base64url').length, 32);
  assert.equal(Buffer.from(m.enc.g1, 'base64url').length, 32);
  assert.notEqual(m.id, m.enc.g1);
  assert.notEqual(kek.novoMaterial().id, m.id);
});

test('embrulhar e abrir: a mesma senha devolve o material igual', async () => {
  const m = kek.novoMaterial();
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(m, SENHA, { uid: UID, rev: 1, kdf });
  assert.match(blob, /^w1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await kek.abrir(blob, SENHA, kdf, { uid: UID, rev: 1 }), m);
});

test('senha errada devolve null, não exceção: tag GCM inválida é resposta, não queda', async () => {
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 1, kdf });
  assert.equal(await kek.abrir(blob, 'outra senha', kdf, { uid: UID, rev: 1 }), null);
});

test('a AAD amarra uid, rev e os parâmetros: mexer em qualquer um invalida o embrulho', async () => {
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 3, kdf });
  assert.equal(await kek.abrir(blob, SENHA, kdf, { uid: 'outro', rev: 3 }), null, 'uid diferente');
  assert.equal(await kek.abrir(blob, SENHA, kdf, { uid: UID, rev: 4 }), null, 'rev diferente');
  assert.equal(await kek.abrir(blob, SENHA, { ...kdf, N: kdf.N / 2 }, { uid: UID, rev: 3 }), null, 'custo diferente');
  assert.equal(await kek.abrir(blob, SENHA, { ...kdf, salt: kek.parametrosPadrao().salt }, { uid: UID, rev: 3 }), null, 'sal diferente');
});

test('blob corrompido em qualquer pedaço devolve null', async () => {
  const kdf = kek.parametrosPadrao();
  const { blob } = await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 1, kdf });
  for (const i of [1, 2, 3]) {
    assert.equal(await kek.abrir(trocarUmBit(blob, i), SENHA, kdf, { uid: UID, rev: 1 }), null, `pedaço ${i}`);
  }
  assert.equal(await kek.abrir('x1.a.b.c', SENHA, kdf, { uid: UID, rev: 1 }), null, 'prefixo errado');
  assert.equal(await kek.abrir('', SENHA, kdf, { uid: UID, rev: 1 }), null, 'vazio');
});

test('kcv: 16 hex, estável por chave e diferente entre chaves', () => {
  const m = kek.novoMaterial();
  assert.match(kek.kcvDe(m.enc.g1), /^[0-9a-f]{16}$/);
  assert.equal(kek.kcvDe(m.enc.g1), kek.kcvDe(m.enc.g1));
  assert.notEqual(kek.kcvDe(m.enc.g1), kek.kcvDe(kek.novoMaterial().enc.g1));
  assert.equal(kek.kcvDe('chave-curta'), '', 'chave malformada não vira kcv');
});

test('o scrypt não bloqueia o event loop enquanto deriva', async () => {
  const kdf = kek.parametrosPadrao();
  let bateu = 0;
  const timer = setInterval(() => { bateu++; }, 5);
  await kek.embrulhar(kek.novoMaterial(), SENHA, { uid: UID, rev: 1, kdf });
  clearInterval(timer);
  assert.ok(bateu > 0, 'o laço de eventos continuou girando durante a derivação');
});
