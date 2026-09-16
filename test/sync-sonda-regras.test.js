// Sonda de regras (anexo C1, "Estratégia de regras", princípio 8): antes de escrever
// qualquer nó do contrato v2, o cliente prova que o banco está com as regras v2. Com
// regra velha, a raiz ainda concede escrita por herança, e publicar conteúdo cifrado ali
// seria confiar numa proteção que não está publicada.
//
// A sonda NUNCA apaga dado de verdade: ela distingue as versões por uma escrita num
// caminho que as regras v2 negam, não pelo DELETE da raiz (que, com regra velha, passaria
// e apagaria a árvore inteira do usuário).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c1-sonda-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startFakeRtdb } from './helpers/fake-rtdb.js';

const { createRtdbClient } = await import('../lib/sync/rtdb.js');
const { sondarRegras } = await import('../lib/sync/sonda-regras.js');

const TOKEN = 'tok-ok';
let fake;

before(async () => { fake = await startFakeRtdb({ token: TOKEN }); });
after(async () => {
  await fake.close();
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => { fake.setTree(null); fake.requests.length = 0; });

// O dublê não avalia regra (decisão 8 da spec), então quem simula as duas versões é este
// embrulho: com as regras v2, escrever em rulesProbe/v1 (caminho sem concessão) responde
// 401; com as velhas, a herança da raiz deixa passar.
function cliente({ regrasV2 }) {
  const real = createRtdbClient({ databaseUrl: fake.url, projectId: 'farol-local', getIdToken: async () => ({ ok: true, idToken: TOKEN }) });
  return {
    get: (p, o) => real.get(p, o),
    del: (p, o) => real.del(p, o),
    put: async (p, v, o) => (regrasV2 && p.includes('/rulesProbe/v1/') ? { ok: false, code: 'permissao', status: 401 } : real.put(p, v, o)),
  };
}

test('regras v2: o caminho sem concessão é negado, e a sonda aprova', async () => {
  const r = await sondarRegras(cliente({ regrasV2: true }), 'u1', 'dA');
  assert.deepEqual(r, { ok: true, versao: 2 });
});

test('regra velha: a herança da raiz deixa gravar onde a v2 negaria, e a sonda reprova', async () => {
  const r = await sondarRegras(cliente({ regrasV2: false }), 'u1', 'dA');
  assert.deepEqual(r, { ok: false, motivo: 'regra-velha' });
});

test('a sonda nunca apaga dado de verdade: nenhum DELETE fora dos próprios nós', async () => {
  await sondarRegras(cliente({ regrasV2: false }), 'u1', 'dA');
  const apagados = fake.requests.filter((x) => x.method === 'DELETE').map((x) => x.path);
  assert.ok(apagados.length > 0, 'a sonda limpa o que escreveu');
  for (const p of apagados) assert.match(p, /\/rulesProbe\/v[12]\/dA\.json$/, p);
});

test('a sonda não deixa lixo: os dois nós de teste saem da árvore', async () => {
  await sondarRegras(cliente({ regrasV2: false }), 'u1', 'dA');
  const t = fake.tree();
  const probe = t && t.users && t.users.u1 ? t.users.u1.rulesProbe : null;
  assert.equal(probe, null, 'nada da sonda fica para trás');
});

test('banco fora do ar: indisponível, sem concluir nada sobre a versão da regra', async () => {
  const quebrado = { get: async () => ({ ok: false }), put: async () => ({ ok: false }), del: async () => ({ ok: false }) };
  assert.deepEqual(await sondarRegras(quebrado, 'u1', 'dA'), { ok: false, motivo: 'indisponivel' });
});

test('sem cliente, uid ou aparelho: indisponível, sem tocar a rede', async () => {
  assert.deepEqual(await sondarRegras(null, 'u1', 'dA'), { ok: false, motivo: 'indisponivel' });
  assert.deepEqual(await sondarRegras(cliente({ regrasV2: true }), '', 'dA'), { ok: false, motivo: 'indisponivel' });
  assert.deepEqual(await sondarRegras(cliente({ regrasV2: true }), 'u1', ''), { ok: false, motivo: 'indisponivel' });
  assert.deepEqual(fake.requests, []);
});
