// Arquivo do próprio Farol preso por outro processo (19/10/2026, biblioteca-cnbb-web#109):
// o rm do material da revisão técnica falhou com EPERM no Windows e, como roda no finally,
// substituía o resultado da revisão. O PR estacionava como "falha não classificada".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-arquivo-preso-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { STATE_DIR } = await import('../lib/paths.js');
const { cleanup, limparRestos, remocao, pendentes } = await import('../lib/technical-review/cleanup.js');
const { classify } = await import('../lib/log-taxonomy.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));
const areaTecnica = path.join(STATE_DIR, 'technical-review');
const rmOriginal = remocao.rm;
afterEach(() => { remocao.rm = rmOriginal; pendentes.clear(); });

function material() {
  fs.mkdirSync(areaTecnica, { recursive: true });
  const snapshot = fs.mkdtempSync(path.join(areaTecnica, 'review-'));
  fs.writeFileSync(path.join(snapshot, 'privado.js'), 'material privado');
  fs.writeFileSync(`${snapshot}-request.json`, '{}');
  return snapshot;
}

function travado(code) {
  return Object.assign(new Error(`${code}, Permission denied: \\\\?\\C:\\Users\\eu\\.farol\\workspace\\state\\technical-review\\review-x`), { code });
}

test('a mensagem real do farol.log é transitória, não falha não classificada', () => {
  const real = "revisao autonoma Edicoes-CNBB/biblioteca-cnbb-web#109: EPERM, Permission denied: \\\\?\\C:\\Users\\wanderson\\.farol\\workspace\\state\\technical-review\\review-4j1GTS '\\\\?\\C:\\Users\\wanderson\\.farol\\workspace\\state\\technical-review\\review-4j1GTS'";
  const c = classify(real);
  assert.equal(c.id, 'arquivo-local-preso');
  assert.equal(c.kind, 'transitorio');
  assert.equal(classify("EBUSY: resource busy or locked, rmdir '/home/eu/.farol/workspace/state/technical-review/review-a'").id, 'arquivo-local-preso');
});

test('permissão negada fora do .farol continua não classificada', () => {
  assert.equal(classify('spawn claude EACCES').id, 'desconhecido');
  assert.equal(classify("EPERM: operation not permitted, open 'C:\\repo\\arquivo.js'").id, 'desconhecido');
});

test('trava na limpeza não lança e fica para a limpeza seguinte', () => {
  const preso = material();
  remocao.rm = () => { throw travado('EPERM'); };
  assert.doesNotThrow(() => cleanup({ snapshot: preso }));
  assert.equal(fs.existsSync(preso), true);
  assert.equal(pendentes.has(preso), true);

  remocao.rm = rmOriginal;
  const proximo = material();
  cleanup({ snapshot: proximo });
  assert.equal(fs.existsSync(preso), false, 'a limpeza seguinte leva o material que ficou preso');
  assert.equal(fs.existsSync(`${preso}-request.json`), false);
  assert.equal(fs.existsSync(proximo), false);
  assert.equal(pendentes.size, 0);
});

test('erro que não é trava passageira continua lançando', () => {
  const snapshot = material();
  remocao.rm = () => { throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); };
  assert.throws(() => cleanup({ snapshot }), /disco cheio/);
  remocao.rm = rmOriginal;
  cleanup({ snapshot });
});

test('a varredura leva o resto anterior ao processo e preserva a evidência privada', () => {
  const resto = material();
  fs.writeFileSync(`${resto}-result.json`, '{}');
  const pedidoOrfao = path.join(areaTecnica, 'review-orfao-request.json');
  fs.writeFileSync(pedidoOrfao, '{}');
  const alheio = path.join(areaTecnica, 'outra-coisa');
  fs.mkdirSync(alheio);
  const vivo = material();
  assert.equal(limparRestos(), 0, 'material deste processo pode ser de revisão paralela viva');
  assert.equal(fs.existsSync(resto), true);
  const depoisDeTudo = Date.now() + 60_000;
  assert.equal(limparRestos(depoisDeTudo), 2);
  assert.equal(fs.existsSync(vivo), false);
  assert.equal(fs.existsSync(resto), false);
  assert.equal(fs.existsSync(`${resto}-request.json`), false);
  assert.equal(fs.existsSync(pedidoOrfao), false);
  assert.equal(fs.existsSync(`${vivo}-request.json`), false);
  assert.equal(fs.existsSync(`${resto}-result.json`), true, 'o -result.json é evidência que a decisão aponta');
  assert.equal(fs.existsSync(alheio), true, 'só o que começa com review- é tocado');
});
