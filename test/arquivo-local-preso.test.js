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
const { cleanup, criarMaterial, limparRestos, remocao, pendentes, maintainMaterials, diagnosticoLegados } = await import('../lib/technical-review/cleanup.js');
const { readRecord, release } = await import('../lib/technical-review/material-record.js');
const { classify } = await import('../lib/log-taxonomy.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));
const areaTecnica = path.join(STATE_DIR, 'technical-review');
const rmOriginal = remocao.rm;
afterEach(async () => { remocao.rm = rmOriginal; await maintainMaterials({ now: Number.MAX_SAFE_INTEGER }); pendentes.clear(); });

// material deste processo: nasce pelo criarMaterial, como no snapshotFor
function material() {
  fs.mkdirSync(areaTecnica, { recursive: true });
  return preencher(criarMaterial(areaTecnica));
}

// resto de um processo anterior: criado por fora do registro deste processo
function restoAnterior() {
  fs.mkdirSync(areaTecnica, { recursive: true });
  return preencher(fs.mkdtempSync(path.join(areaTecnica, 'review-')));
}

function preencher(snapshot) {
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

test('FAROL_HOME com outro nome também é caminho do Farol', () => {
  assert.equal(classify('EPERM, Permission denied: \\\\?\\D:\\dados\\farol-hostinger\\workspace\\state\\technical-review\\review-a').id, 'arquivo-local-preso');
  assert.equal(classify("EBUSY: resource busy or locked, rmdir '/home/u/.farol-hostinger-test/workspace/state/technical-review/review-a'").id, 'arquivo-local-preso');
});

test('permissão negada fora do .farol continua não classificada', () => {
  assert.equal(classify('spawn claude EACCES').id, 'desconhecido');
  assert.equal(classify("EPERM: operation not permitted, open 'C:\\repo\\arquivo.js'").id, 'desconhecido');
});

test('trava na limpeza não lança e fica para a manutenção seguinte', async () => {
  const preso = material();
  remocao.rm = () => { throw travado('EPERM'); };
  await assert.doesNotReject(cleanup({ snapshot: preso }));
  assert.equal(fs.existsSync(preso), true);
  assert.equal(pendentes.has(preso), true);

  remocao.rm = rmOriginal;
  const proximo = material();
  await cleanup({ snapshot: proximo });
  await maintainMaterials({ now: readRecord(preso).retryAt + 1 });
  assert.equal(fs.existsSync(preso), false, 'a limpeza seguinte leva o material que ficou preso');
  assert.equal(fs.existsSync(`${preso}-request.json`), false);
  assert.equal(fs.existsSync(proximo), false);
  assert.equal(pendentes.size, 0);
});

test('erro de disco é diagnosticado sem substituir resultado da revisão', async () => {
  const snapshot = material();
  remocao.rm = () => { throw Object.assign(new Error('disco cheio'), { code: 'ENOSPC' }); };
  await assert.doesNotReject(cleanup({ snapshot }));
  assert.equal(readRecord(snapshot).lastFailure.code, 'ENOSPC');
  assert.equal(fs.existsSync(snapshot), true);
  remocao.rm = rmOriginal;
  await maintainMaterials({ now: readRecord(snapshot).retryAt + 1 });
  assert.equal(fs.existsSync(snapshot), false);
});

test('a varredura preserva legado sem prova e material vivo, mesmo com relógio que volta', async () => {
  const resto = restoAnterior();
  fs.writeFileSync(`${resto}-result.json`, '{}');
  const pedidoOrfao = path.join(areaTecnica, 'review-orfao-request.json');
  fs.writeFileSync(pedidoOrfao, '{}');
  const alheio = path.join(areaTecnica, 'outra-coisa');
  fs.mkdirSync(alheio);
  const vivo = material();
  // carimbo no passado distante: o mtime não decide mais nada
  fs.utimesSync(vivo, new Date(0), new Date(0));
  assert.equal(await limparRestos(), 0);
  assert.equal(fs.existsSync(vivo), true, 'material deste processo é de revisão viva');
  assert.equal(fs.existsSync(`${vivo}-request.json`), true);
  assert.equal(fs.existsSync(resto), true);
  assert.equal(fs.existsSync(`${resto}-request.json`), true);
  assert.equal(fs.existsSync(pedidoOrfao), true);
  const diagnostic = await diagnosticoLegados();
  assert.equal(diagnostic.items.find(i => i.id === path.basename(resto)).eligible, false);
  assert.equal(fs.existsSync(`${resto}-result.json`), true, 'o -result.json é evidência que a decisão aponta');
  assert.equal(fs.existsSync(alheio), true, 'só o que começa com review- é tocado');
  await cleanup({ snapshot: vivo });
});

test('a varredura tem teto por limpeza para materiais com liberação comprovada', async () => {
  const restos = [material(), material(), material()];
  for (const snapshot of restos) release(snapshot);
  assert.equal(await limparRestos(), 2);
  assert.equal(restos.filter(r => fs.existsSync(r)).length, 1, 'só dois por vez');
  assert.equal(await limparRestos(), 1);
  assert.equal(restos.filter(r => fs.existsSync(r)).length, 0);
  assert.equal(await limparRestos(), 0);
});
