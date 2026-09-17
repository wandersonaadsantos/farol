// Chaveiro remoto (CT-ENV): nó único, criado só depois de o login por senha dar certo,
// com CAS por ETag. Corrida de criação termina com um chaveiro só, e chaveiro que some
// depois de visto nunca é recriado sozinho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-chaveiro-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const chaveiro = await import('../lib/sync/chaveiro.js');
const kek = await import('../lib/sync/kek.js');

const TOKEN = 'tok-ok';
const UID = 'u1';
const SENHA = 'senha de teste';
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

function cliente(token = TOKEN) {
  return createRtdbClient({ databaseUrl: fake.url, projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: token }) });
}

function noBanco() {
  const t = fake.tree();
  return t && t.users && t.users[UID] ? t.users[UID].keyring : null;
}

test('criação: rev 1, cur g1, kcv conferível e blob que abre com a senha', async () => {
  const r = await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  assert.equal(r.ok, true);
  const no = noBanco();
  assert.equal(no.v, 1);
  assert.equal(no.rev, 1);
  assert.equal(no.cur, 'g1');
  assert.equal(no.kcv.g1, kek.kcvDe(r.material.enc.g1));
  assert.equal(no.slots.pw.by, 'dA');
  assert.deepEqual(await chaveiro.abrirChaveiro(no, SENHA, UID), r.material);
});

test('o material nunca sobe em claro: o nó não carrega K_id nem K_enc', async () => {
  const r = await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  const texto = JSON.stringify(noBanco());
  assert.equal(texto.includes(r.material.id), false);
  assert.equal(texto.includes(r.material.enc.g1), false);
  assert.equal(texto.includes(SENHA), false);
});

test('corrida na criação: dois aparelhos terminam com um chaveiro só e a mesma K_id', async () => {
  const [a, b] = await Promise.all([
    chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA'),
    chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dB'),
  ]);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(a.material.id, b.material.id, 'quem perdeu a corrida adota o material do vencedor');
  assert.equal(noBanco().rev, 1, 'a corrida não sobe o rev');
});

test('abrir com a senha errada devolve null, e o nó fica intacto', async () => {
  await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  const antes = JSON.stringify(noBanco());
  assert.equal(await chaveiro.abrirChaveiro(noBanco(), 'outra', UID), null);
  assert.equal(JSON.stringify(noBanco()), antes);
});

test('chaveiro visto e depois ausente: chave-perdida, sem recriar nada', async () => {
  await chaveiro.criarChaveiro(cliente(), UID, SENHA, 'dA');
  fake.setTree(null);
  fake.requests.length = 0;
  const r = await chaveiro.garantirChaveiro(cliente(), UID, SENHA, { deviceId: 'dA', jaVisto: true });
  assert.deepEqual(r, { ok: false, motivo: 'chave-perdida' });
  assert.deepEqual(fake.requests.filter((x) => x.method === 'PUT'), [], 'nenhum PUT depois de ver o sumiço');
});

test('reembrulho: rev sobe um, sal novo, e a senha nova abre o material antigo', async () => {
  const c = cliente();
  const criado = await chaveiro.criarChaveiro(c, UID, SENHA, 'dA');
  const lido = await chaveiro.lerChaveiro(c, UID);
  const salAntigo = lido.chaveiro.slots.pw.kdf.salt;
  const r = await chaveiro.reembrulhar(c, UID, criado.material, 'senha nova', { chaveiro: lido.chaveiro, etag: lido.etag, deviceId: 'dA' });
  assert.equal(r.ok, true);
  assert.equal(noBanco().rev, 2);
  assert.notEqual(noBanco().slots.pw.kdf.salt, salAntigo);
  assert.deepEqual(await chaveiro.abrirChaveiro(noBanco(), 'senha nova', UID), criado.material);
  assert.equal(await chaveiro.abrirChaveiro(noBanco(), SENHA, UID), null, 'a senha antiga não abre mais');
});

test('rotação: geração nova, cur trocado, gerações antigas preservadas', async () => {
  const c = cliente();
  const criado = await chaveiro.criarChaveiro(c, UID, SENHA, 'dA');
  const lido = await chaveiro.lerChaveiro(c, UID);
  const r = await chaveiro.rotacionar(c, UID, criado.material, SENHA, { chaveiro: lido.chaveiro, etag: lido.etag, deviceId: 'dA' });
  assert.equal(r.ok, true);
  assert.equal(noBanco().cur, 'g2');
  assert.equal(noBanco().rev, 2);
  assert.equal(r.material.id, criado.material.id, 'K_id não gira numa rotação comum');
  assert.equal(r.material.enc.g1, criado.material.enc.g1, 'a geração antiga fica, para ler o histórico');
  assert.notEqual(r.material.enc.g2, r.material.enc.g1);
  assert.equal(noBanco().kcv.g2, kek.kcvDe(r.material.enc.g2));
});

test('chaveiroValido: forma errada é recusada antes de qualquer decifragem', () => {
  assert.equal(chaveiro.chaveiroValido(null), false);
  assert.equal(chaveiro.chaveiroValido({ v: 1, rev: 1, cur: 'g1' }), false);
  assert.equal(chaveiro.chaveiroValido({ v: 1, rev: 0, cur: 'g1', kids: {}, kcv: {}, slots: { pw: {} }, updatedAt: 1, epochSince: 1 }), false);
});
