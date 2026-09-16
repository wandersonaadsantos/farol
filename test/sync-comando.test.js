// Comando remoto (7.C6), a parte pura.
//
// Os dois casos que carregam o contrato: a ORDEM das recusas (quem não consente nem chega
// a olhar o conteúdo) e a proibição de CT-FIO (comando nunca vira clique manual nem
// revisão pedida a mim).
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = process.env.FAROL_HOME || path.join(os.tmpdir(), 'farol-test-comando-' + process.pid);

import { test } from 'node:test';
import assert from 'node:assert/strict';

const comando = (await import('../lib/sync/comando.js')).default;
const adminChave = (await import('../lib/sync/admin-chave.js')).default;
const assinatura = (await import('../lib/sync/assinatura.js')).default;

const UID = 'u1';
const DEV = 'dB';
const GEN = 3;
const T = 1_800_000_000_000;
const PR = 'a'.repeat(32);
const MAT = 'b'.repeat(32);
const ITEM = 'c'.repeat(32);
const PAR = adminChave.gerarParDeAdmin();

function no(extra = {}, cmdId = 'd'.repeat(32)) {
  const base = { v: 1, generation: GEN, alvo: DEV, ttl: T + 60000, enc: 'e1.g1.iv.ct.tag', ...extra };
  const sig = assinatura.assinar(PAR.jwk, { uid: UID, caminho: `live/commands/${cmdId}`, generation: Number(base.generation), valor: comando.valorAssinado(base) });
  return { ...base, sig, ...(extra.sig ? { sig: extra.sig } : {}) };
}

function ctx(extra = {}) {
  return { cmdId: 'd'.repeat(32), uid: UID, dev: DEV, aceitarAdmin: true, publicKey: PAR.publicKey, generationVigente: GEN, fresca: true, agora: T, ...extra };
}

test('o comando é saneado por tipo, com allowlist de argumentos', () => {
  assert.deepEqual(comando.sanearComando({ tipo: 'cancelar', args: { prTag: PR, extra: 'x' } }), { tipo: 'cancelar', args: { prTag: PR } });
  assert.deepEqual(comando.sanearComando({ tipo: 'repetir', args: { prTag: PR, matTag: MAT } }), { tipo: 'repetir', args: { prTag: PR, matTag: MAT } });
  assert.deepEqual(comando.sanearComando({ tipo: 'decidir', args: { itemId: ITEM, acao: 'approve' } }), { tipo: 'decidir', args: { itemId: ITEM, acao: 'approve' } });
  assert.deepEqual(comando.sanearComando({ tipo: 'designar-admin', args: { seja: 'agora' } }), { tipo: 'designar-admin', args: {} });
});

test('comando pela metade, de tipo desconhecido ou com ação inválida não existe', () => {
  assert.equal(comando.sanearComando({ tipo: 'repetir', args: { prTag: PR } }), null, 'repetir sem head não é comando');
  assert.equal(comando.sanearComando({ tipo: 'decidir', args: { itemId: ITEM, acao: 'merge' } }), null);
  assert.equal(comando.sanearComando({ tipo: 'iniciar', args: { prTag: PR } }), null, 'iniciar sem head não é comando');
  assert.deepEqual(comando.sanearComando({ tipo: 'iniciar', args: { prTag: PR, matTag: MAT } }), { tipo: 'iniciar', args: { prTag: PR, matTag: MAT } });
  assert.equal(comando.sanearComando({ tipo: 'apagar-tudo', args: {} }), null);
  assert.equal(comando.sanearComando({ tipo: 'cancelar', args: { prTag: 'nao-e-tag' } }), null);
  assert.equal(comando.sanearComando(null), null);
});

test('a ordem das recusas: consentimento, alvo, forma, geração, assinatura, autoridade, prazo', () => {
  assert.equal(comando.podeAplicar(no(), ctx({ aceitarAdmin: false })).code, 'nao-aceita-admin');
  assert.equal(comando.podeAplicar(no({ alvo: 'dOutro' }), ctx()).code, 'nao-e-meu');
  assert.equal(comando.podeAplicar(no({ enc: '' }), ctx()).code, 'forma');
  assert.equal(comando.podeAplicar(no(), ctx({ generationVigente: GEN + 1 })).code, 'geracao');
  assert.equal(comando.podeAplicar(no({ sig: 'nao-confere' }), ctx()).code, 'assinatura');
  assert.equal(comando.podeAplicar(no(), ctx({ fresca: false })).code, 'autoridade');
  assert.equal(comando.podeAplicar(no(), ctx({ agora: T + 60001 })).code, 'vencido');
  assert.deepEqual(comando.podeAplicar(no(), ctx()), { ok: true, code: '' });
});

test('conteúdo adulterado não passa: o alvo e o prazo entram na assinatura', () => {
  const bom = no();
  assert.equal(comando.podeAplicar({ ...bom, ttl: bom.ttl + 999999 }, ctx()).code, 'assinatura');
  assert.equal(comando.podeAplicar({ ...bom, enc: 'e1.g1.outro.ct.tag' }, ctx()).code, 'assinatura');
});

test('o mesmo comando não vale noutro identificador: o caminho entra na assinatura', () => {
  const bom = no({}, 'd'.repeat(32));
  assert.equal(comando.podeAplicar(bom, ctx({ cmdId: 'e'.repeat(32) })).code, 'assinatura');
});

// CT-FIO, o caso que guarda quatro gates de uma vez.
test('o PR que sai de um comando nunca é manual nem pedido a mim', () => {
  const pr = comando.prDoComando({ key: 'dono/repo#1', manual: true, requested: true, headSha: 'sha1' });
  assert.equal('manual' in pr, false);
  assert.equal('requested' in pr, false);
  assert.equal(pr.viaComando, true);
  assert.equal(pr.key, 'dono/repo#1');
});

test('o fonte do comando não escreve manual nem requested', async () => {
  const fs = await import('node:fs');
  const fonte = fs.readFileSync(new URL('../lib/sync/comando.js', import.meta.url), 'utf8');
  const codigo = fonte.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  for (const proibido of ['manual: true', 'manual = true', 'requested: true', 'requested = true']) {
    assert.equal(codigo.includes(proibido), false, proibido);
  }
});

test('o recibo carrega quem respondeu, o desfecho e o porquê', () => {
  assert.deepEqual(comando.recibo({ dev: DEV, estado: 'recusado', code: 'head_mudou', agora: T }), { dev: DEV, estado: 'recusado', code: 'head_mudou', at: T });
});
