// Outra pessoa revisando: o aviso na fila e a chave de revisar junto (02/10/2026).
//
// Pedido do dono: "Se caso tiver alguém já com a label de revisando no GitHub, precisamos
// indicar pra quem vê a fila que já tem alguém revisando", mais uma chave para o automático
// revisar mesmo assim. Decisões: a chave nasce DESLIGADA (vale o "um Farol por PR" de
// sempre) e, ligada, não há saída de cena e por isso nem co-assinatura.
//
// No mesmo dia apareceu o segundo silêncio da fila: a assinatura do Claude no limite do
// plano segurava a revisão automática até o reset, e o card não dizia nada. O motor passou
// a entregar as duas coisas para a tela; o desenho do card vem do Claude Design.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-revisar-junto-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const skip = await import('../lib/engine/skip-review.js');
const { SETTINGS, EDITAVEIS, sanear } = await import('../lib/settings.js');
const { Engine } = await import('../server.js');
const contasGh = (await import('../lib/engine/contas-gh.js')).default;

after(() => {
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

function motor(config = {}) {
  const e = new Engine();
  e.config = { ...e.config, ...config };
  e.outrosRevisando = () => ['ana'];
  e.skipComentado = {};
  return e;
}

test('a chave nasce desligada, e só o booleano verdadeiro liga', () => {
  assert.equal(SETTINGS.find((x) => x.key === 'revisarComOutrosRevisando').def, false);
  assert.ok(EDITAVEIS.has('revisarComOutrosRevisando'));
  assert.equal(sanear('revisarComOutrosRevisando', true), true);
  for (const v of [false, 'true', 1, null, undefined]) assert.equal(sanear('revisarComOutrosRevisando', v), false, String(v));
  for (const c of [{}, { revisarComOutrosRevisando: 'true' }, { revisarComOutrosRevisando: 1 }]) {
    assert.equal(skip.revisaJunto({ config: c }), false, JSON.stringify(c));
  }
  assert.equal(skip.revisaJunto(null), false);
});

test('desligada: quem está revisando segura o automático, como sempre', () => {
  const e = motor();
  assert.deepEqual(skip.outrosQueSeguram(e, { key: 'o/r#1' }), ['ana']);
  const pulados = [];
  assert.equal(e._registraPulo({ key: 'o/r#1' }, pulados), true);
  assert.deepEqual(pulados.map((p) => p.outros), [['ana']]);
});

test('ligada: ninguém segura, e nenhuma saída de cena nova nasce', () => {
  const e = motor({ revisarComOutrosRevisando: true });
  assert.deepEqual(skip.outrosQueSeguram(e, { key: 'o/r#1' }), []);
  const pulados = [];
  assert.equal(e._registraPulo({ key: 'o/r#1' }, pulados), false);
  assert.deepEqual(pulados, []);
  assert.deepEqual(e.outrosRevisando({ key: 'o/r#1' }), ['ana'], 'quem está revisando continua sabido, para a tela');
});

test('ligada depois de sair de cena: a âncora antiga cai, a co-assinada fica', () => {
  const e = motor({ revisarComOutrosRevisando: true });
  e.skipComentado = { 'o/r#1': { quem: ['ana'], head: 'a' }, 'o/r#2': { quem: ['bia'], head: 'b', coAssinado: true } };
  assert.equal(skip.largarSaidasDeCena(e), 1);
  assert.deepEqual(Object.keys(e.skipComentado), ['o/r#2']);
  assert.equal(skip.largarSaidasDeCena(e), 0, 'idempotente');
});

test('desligada: a saída de cena gravada não é tocada', () => {
  const e = motor();
  e.skipComentado = { 'o/r#1': { quem: ['ana'] } };
  assert.equal(skip.largarSaidasDeCena(e), 0);
  assert.deepEqual(Object.keys(e.skipComentado), ['o/r#1']);
});

test('a trava do round automático e a do comando remoto leem a mesma chave', async () => {
  const fila = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'sync-comandos-fila.js'), 'utf8');
  const review = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  assert.match(fila, /outrosQueSeguram\(engine, pr\)/);
  assert.match(review, /outrosQueSeguram\(engine, pr\)/);
});

test('cada PR leva a lista de quem mais está revisando, com a chave ligada ou não', () => {
  for (const config of [{}, { revisarComOutrosRevisando: true }]) {
    const e = motor(config);
    e.outrosRevisando = (pr) => (pr.key === 'o/r#1' ? ['ana', 'bia'] : []);
    const um = { key: 'o/r#1' };
    const dois = { key: 'o/r#2' };
    e.skipComentado = { 'o/r#2': { quem: ['carla'], at: 5, head: 'abc', autoridade: true } };
    skip.anotarOutrosRevisando(e, [um, dois, um, null]);
    assert.deepEqual(um.outrosRevisando, ['ana', 'bia']);
    assert.equal(um.foraDeCena, null);
    assert.deepEqual(dois.outrosRevisando, []);
    assert.deepEqual(dois.foraDeCena, { quem: ['carla'], desde: 5, coAssinado: false }, 'só o que a tela usa: nem head nem autoridade');
  }
});

test('cada conta que a tela recebe diz até quando a assinatura dela está no limite do plano', () => {
  const e = motor();
  e.accountList = () => [{ user: 'eu', owners: [] }, { user: 'outra', owners: [] }];
  e.limiteDoPlanoAte = (conta) => (conta === 'eu' ? 1790985600000 : 0);
  const contas = contasGh.projecaoDasContas(e);
  assert.deepEqual(contas.map((a) => [a.user, a.limitePlanoAte]), [['eu', 1790985600000], ['outra', 0]]);
  assert.deepEqual(e.snapshot().accounts.map((a) => a.limitePlanoAte), [1790985600000, 0], 'e é isso que o snapshot leva');
});
