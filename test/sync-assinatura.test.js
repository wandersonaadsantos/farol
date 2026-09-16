// Assinatura Ed25519 dos sinais do admin (CT-ENV, "Envelope cifrado", bloco ASSINATURA).
//
// Ela vale contra cliente honesto com defeito e contra versão divergente. NÃO é controle
// de acesso: o banco não verifica criptografia, e quem confere é sempre o cliente que lê.
// Isso está escrito aqui porque um dia alguém vai olhar a assinatura e achar que ela
// impede escrita de terceiro. Não impede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-c2a-sig-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const sig = await import('../lib/sync/assinatura.js');
const ak = await import('../lib/sync/admin-chave.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

const PAR = ak.gerarParDeAdmin();
const OUTRO = ak.gerarParDeAdmin();
const CTX = { uid: 'u1', caminho: 'live/control/beat', generation: 2, valor: { dev: 'dA', beatAt: 1 } };

test('a assinatura tem 86 caracteres base64url', () => {
  const s = sig.assinar(PAR.jwk, CTX);
  assert.equal(s.length, 86);
  assert.match(s, /^[A-Za-z0-9_-]+$/);
});

test('ida e volta: a pública do mesmo par verifica', () => {
  assert.equal(sig.verificar(PAR.publicKey, sig.assinar(PAR.jwk, CTX), CTX), true);
});

test('mudar uid, caminho, geração ou valor invalida', () => {
  const s = sig.assinar(PAR.jwk, CTX);
  assert.equal(sig.verificar(PAR.publicKey, s, { ...CTX, uid: 'u2' }), false, 'uid');
  assert.equal(sig.verificar(PAR.publicKey, s, { ...CTX, caminho: 'live/control/admin' }), false, 'caminho');
  assert.equal(sig.verificar(PAR.publicKey, s, { ...CTX, generation: 3 }), false, 'geração');
  assert.equal(sig.verificar(PAR.publicKey, s, { ...CTX, valor: { dev: 'dB', beatAt: 1 } }), false, 'valor');
});

test('chave pública de outro par não verifica', () => {
  assert.equal(sig.verificar(OUTRO.publicKey, sig.assinar(PAR.jwk, CTX), CTX), false);
});

test('assinatura malformada devolve false, nunca lança', () => {
  for (const s of ['', 'x', 'a'.repeat(86), null, undefined, 123]) {
    assert.equal(sig.verificar(PAR.publicKey, s, CTX), false, String(s));
  }
  assert.equal(sig.verificar('chave-torta', sig.assinar(PAR.jwk, CTX), CTX), false);
});

test('a pré-imagem é estável e carrega os quatro amarres', () => {
  const p = sig.preImagemDaAssinatura(CTX);
  assert.ok(p.startsWith('farol|sig|1|u1|live/control/beat|2|'));
  assert.equal(p, sig.preImagemDaAssinatura(CTX), 'determinística');
  assert.notEqual(p, sig.preImagemDaAssinatura({ ...CTX, valor: { dev: 'dB', beatAt: 1 } }));
});

test('a assinatura NÃO é controle de acesso: quem confere é o cliente que lê', () => {
  // as regras publicadas não mencionam assinatura em lugar nenhum: elas conferem forma,
  // dono e frescor de login, e nada mais. Se um dia alguém escrever "o banco valida a
  // assinatura" numa tela, este caso reprova.
  const regras = fs.readFileSync(path.join(import.meta.dirname, '..', 'firebase', 'database.rules.json'), 'utf8');
  // exigir que o campo EXISTA (dentro de hasChildren) é legítimo; o que não existe é
  // conferir o conteúdo dele, porque a regra do RTDB não tem primitiva de criptografia
  const semListaDeCampos = regras.replace(/hasChildren\(\[[^\]]*\]\)/g, '');
  assert.equal(/child\('sig'\)|ed25519/i.test(semListaDeCampos), false, 'nenhuma regra confere a assinatura');
});
