// Cache local da chave (CT-ENV): mora em ~/.farol, fora do config.json e fora de state/,
// que é o cwd das sessões. O boot só LÊ; quem deriva chave é o login.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-cache-'));
const CASA = path.join(BASE, 'casa');
fs.mkdirSync(CASA, { recursive: true });
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.HOME = CASA;
process.env.USERPROFILE = CASA;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const cache = await import('../lib/sync/cache-chave.js');
const kek = await import('../lib/sync/kek.js');
const { IS_WIN } = await import('../lib/paths.js');
const { credentialsPath } = await import('../lib/sync/credentials.js');

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });
beforeEach(() => { cache.apagarCache(); });

const MATERIAL = kek.novoMaterial();
const DESTINO = 'u1|https://x.firebaseio.com';

function valor(extra = {}) {
  return { uid: 'u1', destino: DESTINO, keyringRev: 1, cur: 'g1', id: MATERIAL.id, enc: MATERIAL.enc, ...extra };
}

test('o cache mora na pasta de dados do Farol, ao lado da credencial e fora de state/', () => {
  const p = cache.caminhoDoCache();
  // a mesma pasta do sync-credentials.json (em produção, ~/.farol): fora do config.json,
  // que trafega inteiro para a UI, e fora de state/, que é o cwd das sessões
  assert.equal(path.dirname(p), path.dirname(credentialsPath()));
  assert.equal(path.basename(p), 'sync-key.json');
  assert.equal(p.includes(`${path.sep}state${path.sep}`), false);
});

test('gravar e ler devolve o mesmo material, com carimbo de gravação', () => {
  assert.equal(cache.gravarCache(valor()), true);
  const lido = cache.lerCache();
  assert.equal(lido.uid, 'u1');
  assert.equal(lido.id, MATERIAL.id);
  assert.deepEqual(lido.enc, MATERIAL.enc);
  assert.ok(lido.savedAt > 0);
});

test('arquivo ausente, vazio ou corrompido devolve null, sem lançar', () => {
  assert.equal(cache.lerCache(), null);
  fs.mkdirSync(path.dirname(cache.caminhoDoCache()), { recursive: true });
  fs.writeFileSync(cache.caminhoDoCache(), 'nao e json');
  assert.equal(cache.lerCache(), null);
  fs.writeFileSync(cache.caminhoDoCache(), '{"uid":"u1"}');
  assert.equal(cache.lerCache(), null, 'sem material não serve de cache');
});

test('cacheServe: uid ou destino diferentes descartam o cache', () => {
  const c = valor();
  assert.equal(cache.cacheServe(c, { uid: 'u1', destino: DESTINO }), true);
  assert.equal(cache.cacheServe(c, { uid: 'u2', destino: DESTINO }), false);
  assert.equal(cache.cacheServe(c, { uid: 'u1', destino: 'outro' }), false);
  assert.equal(cache.cacheServe(null, { uid: 'u1', destino: DESTINO }), false);
});

test('cacheConfere: kcv divergente reprova, e geração corrente ausente também', () => {
  const chaveiro = { cur: 'g1', kcv: { g1: kek.kcvDe(MATERIAL.enc.g1) } };
  assert.equal(cache.cacheConfere(valor(), chaveiro), true);
  assert.equal(cache.cacheConfere(valor(), { cur: 'g1', kcv: { g1: 'f'.repeat(16) } }), false);
  assert.equal(cache.cacheConfere(valor(), { cur: 'g2', kcv: { g1: kek.kcvDe(MATERIAL.enc.g1), g2: 'a'.repeat(16) } }), false, 'geração corrente ausente no cache');
  assert.equal(cache.cacheConfere(valor(), null), false);
});

test('apagarCache remove o arquivo e é idempotente', () => {
  cache.gravarCache(valor());
  assert.equal(cache.apagarCache(), true);
  assert.equal(fs.existsSync(cache.caminhoDoCache()), false);
  assert.equal(cache.apagarCache(), false);
});

test('modo 0600 depois de CADA gravação (posix)', { skip: IS_WIN ? 'chmod não vale em NTFS' : false }, () => {
  cache.gravarCache(valor());
  assert.equal(fs.statSync(cache.caminhoDoCache()).mode & 0o777, 0o600);
  cache.gravarCache(valor({ keyringRev: 2 }));
  assert.equal(fs.statSync(cache.caminhoDoCache()).mode & 0o777, 0o600, 'a regravação não devolve o arquivo para 0644');
});

test('a senha nunca entra no cache', () => {
  cache.gravarCache({ ...valor(), senha: 'segredo-que-nao-pode-ficar' });
  assert.equal(fs.readFileSync(cache.caminhoDoCache(), 'utf8').includes('segredo-que-nao-pode-ficar'), false);
});
