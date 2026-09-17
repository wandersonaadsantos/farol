// Envelope cifrado (CT-ENV): 'e1.<kid>.<iv>.<ct>.<tag>', AAD amarrando uid, caminho, campo,
// geração e esquema, preenchimento até múltiplo de 256 e leitura que falha fechada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-envelope-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const env = await import('../lib/sync/envelope.js');
const kek = await import('../lib/sync/kek.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const MATERIAL = kek.novoMaterial();
const UID = 'u1';
const BASE = { material: MATERIAL, cur: 'g1', uid: UID, caminho: 'catalog/aaa', campo: 'enc', esquema: 'pr1', r: 1 };
const DADOS = { key: 'org/repo#7', title: 'Corrige o redirect', author: 'dev' };

function cifrado(extra = {}) {
  const r = env.cifrar({ ...BASE, dados: DADOS, ...extra });
  assert.equal(r.ok, true, r.motivo);
  return r.enc;
}

function trocarUmBit(enc, indice) {
  const partes = enc.split('.');
  const b = Buffer.from(partes[indice], 'base64url');
  b[0] ^= 1;
  partes[indice] = b.toString('base64url');
  return partes.join('.');
}

test('formato: e1.<kid>.<iv>.<ct>.<tag> em base64url sem preenchimento', () => {
  const enc = cifrado();
  assert.match(enc, /^e1\.g[0-9]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const [, kid, iv, , tag] = enc.split('.');
  assert.equal(kid, 'g1');
  assert.equal(Buffer.from(iv, 'base64url').length, 12);
  assert.equal(Buffer.from(tag, 'base64url').length, 16);
});

test('ida e volta: o valor volta igual, com r e kid', () => {
  const lido = env.decifrar({ ...BASE, enc: cifrado() });
  assert.equal(lido.ok, true);
  assert.deepEqual(lido.valor, DADOS);
  assert.equal(lido.r, 1);
  assert.equal(lido.kid, 'g1');
});

test('IV nunca reusado: 1000 envelopes da mesma mensagem têm IVs distintos', () => {
  const vistos = new Set();
  for (let i = 0; i < 1000; i++) vistos.add(cifrado().split('.')[2]);
  assert.equal(vistos.size, 1000);
});

test('trocar um bit do ct ou da tag falha', () => {
  for (const i of [3, 4]) {
    const lido = env.decifrar({ ...BASE, enc: trocarUmBit(cifrado(), i) });
    assert.equal(lido.ok, false);
    assert.equal(lido.motivo, 'gcm');
  }
});

test('AAD sem o caminho não existe: mover o envelope de catalog/A para catalog/B falha', () => {
  const enc = env.cifrar({ ...BASE, caminho: 'catalog/A', dados: DADOS }).enc;
  const lido = env.decifrar({ ...BASE, caminho: 'catalog/B', enc });
  assert.equal(lido.ok, false);
  assert.equal(lido.motivo, 'gcm');
});

test('AAD amarra uid, campo, esquema e os extras do nó', () => {
  const enc = env.cifrar({ ...BASE, extras: ['x1', 'dA', '7'], dados: DADOS }).enc;
  assert.equal(env.decifrar({ ...BASE, extras: ['x1', 'dA', '7'], enc }).ok, true);
  assert.equal(env.decifrar({ ...BASE, extras: ['x2', 'dA', '7'], enc }).motivo, 'gcm', 'x novo invalida o envelope antigo');
  assert.equal(env.decifrar({ ...BASE, uid: 'outro', extras: ['x1', 'dA', '7'], enc }).motivo, 'gcm');
  assert.equal(env.decifrar({ ...BASE, campo: 'outro', extras: ['x1', 'dA', '7'], enc }).motivo, 'gcm');
});

test('esquema diferente do esperado descarta o item, mesmo com a cifra íntegra', () => {
  const lido = env.decifrar({ ...BASE, esquema: 'op1', enc: cifrado() });
  assert.equal(lido.ok, false);
  assert.equal(lido.motivo, 'gcm', 'o esquema está na AAD, então nem chega a abrir');
});

test('revisão regressiva é descartada (CT-FIO): item antigo não sobrescreve o novo', () => {
  const enc = env.cifrar({ ...BASE, r: 5, dados: DADOS }).enc;
  assert.equal(env.decifrar({ ...BASE, r: 5, enc, rMinimo: 5 }).ok, true);
  const lido = env.decifrar({ ...BASE, r: 5, enc, rMinimo: 6 });
  assert.equal(lido.ok, false);
  assert.equal(lido.motivo, 'revisao');
});

test('leitura falha fechada em cada pedaço malformado, sem texto parcial', () => {
  const casos = [
    ['', 'prefixo'], ['x1.g1.a.b.c', 'prefixo'], ['e1.g9.a.b.c', 'kid'],
    [`e1.g1.${Buffer.alloc(8).toString('base64url')}.YQ.${Buffer.alloc(16).toString('base64url')}`, 'iv'],
    [`e1.g1.${Buffer.alloc(12).toString('base64url')}.YQ.${Buffer.alloc(4).toString('base64url')}`, 'tag'],
  ];
  for (const [enc, motivo] of casos) {
    const lido = env.decifrar({ ...BASE, enc });
    assert.equal(lido.ok, false, enc);
    assert.equal(lido.motivo, motivo, enc);
    assert.equal(lido.valor, undefined, 'nunca devolve valor parcial');
  }
});

test('preenchimento: o texto claro é múltiplo de 256 bytes, e o tamanho não segue o conteúdo', () => {
  const curto = cifrado({ dados: { key: 'a' } });
  const medio = cifrado({ dados: { key: 'a'.repeat(50) } });
  assert.equal(env.tamanhoDoClaro({ ...BASE, dados: { key: 'a' } }) % 256, 0);
  assert.equal(env.tamanhoDoClaro({ ...BASE, dados: { key: 'a'.repeat(50) } }) % 256, 0);
  assert.equal(curto.length, medio.length, 'mensagens pequenas diferentes caem no mesmo degrau');
});

test('tetos por nó: o que não cabe é recusado antes de subir', () => {
  assert.equal(env.TETOS.recentReviews, 1024);
  assert.equal(env.TETOS.reviewBodies, 48000);
  const grande = env.cifrar({ ...BASE, caminho: 'recentReviews/x', no: 'recentReviews', dados: { texto: 'x'.repeat(4000) } });
  assert.equal(grande.ok, false);
  assert.equal(grande.motivo, 'teto');
});

test('nenhum módulo de lib/sync importa node:zlib (sem compressão, decisão 9)', () => {
  const dir = path.join(import.meta.dirname, '..', 'lib', 'sync');
  for (const nome of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const fonte = fs.readFileSync(path.join(dir, nome), 'utf8');
    assert.equal(/require\(['"]node:zlib|from ['"]node:zlib/.test(fonte), false, nome);
  }
});
