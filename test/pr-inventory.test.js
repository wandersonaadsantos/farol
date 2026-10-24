import { test } from 'node:test';
import assert from 'node:assert/strict';
import io from '../lib/io.js';
import { fetchPrInventory, inventoryMetrics, coverageBlock, coveragePaths } from '../lib/engine/pr-inventory.js';

const PR = { repo: 'o/r', number: 1 };
const HEAD = 'a'.repeat(40);
const META = { headSha: HEAD, baseSha: 'b'.repeat(40), changedFiles: 132 };
const FILES = Array.from({ length: 132 }, (_, i) => ({ path: `src/f${i}.ts`, sha: `s${i}`, status: 'modified', lines: 2 }));
const engine = { accountForPr: () => 'eu', tokenFor: () => 'fixture', ghEnv: () => ({}) };

async function medir(t, { before = META, after = before, files = FILES, fail = 0 } = {}) {
  const calls = [];
  const original = io.run;
  t.after(() => { io.run = original; });
  io.run = async (_cmd, args) => {
    calls.push(args);
    if (calls.length === fail) return { ok: false, stdout: '', stderr: 'sem rede' };
    let value = after;
    if (calls.length === 1) value = before;
    if (args.includes('--paginate')) value = files;
    return { ok: true, stdout: typeof value === 'string' ? value : JSON.stringify(value) };
  };
  return { inventory: await fetchPrInventory(engine, PR, HEAD), calls };
}

test('inventário completo: pagina uma vez e fornece os mesmos 132 arquivos para lotes e cobertura', async t => {
  const { inventory, calls } = await medir(t);
  assert.equal(inventory.status, 'complete');
  assert.equal(calls.filter(args => args.includes('--paginate')).length, 1);
  assert.deepEqual(inventory.files, FILES);
  const metrics = inventoryMetrics(inventory);
  assert.equal(metrics.changedFiles, 132);
  assert.equal(metrics.lines, 264);
  assert.deepEqual(metrics.files.map(f => f.path), FILES.map(f => f.path));
});

test('inventário parcial não vira métrica nem lista completa para o prompt', async t => {
  const { inventory } = await medir(t, { files: FILES.slice(0, 100) });
  assert.equal(inventory.status, 'incomplete');
  assert.match(inventory.reason, /100.*132/);
  assert.equal(inventoryMetrics(inventory), null);
  assert.equal(coverageBlock(inventoryMetrics(inventory)), '');
});

for (const field of ['headSha', 'baseSha', 'changedFiles']) {
  test(`mudança de ${field} durante a coleta invalida o inventário`, async t => {
    const after = { ...META, [field]: field === 'changedFiles' ? 133 : 'c'.repeat(40) };
    const { inventory } = await medir(t, { after });
    assert.equal(inventory.status, 'incomplete');
    assert.equal(inventoryMetrics(inventory), null);
  });
}

test('head já diferente do esperado não recebe a medição de outro commit', async t => {
  const { inventory, calls } = await medir(t, { before: { ...META, headSha: 'c'.repeat(40) } });
  assert.equal(inventory.status, 'incomplete');
  assert.equal(calls.length, 1);
});

for (const fail of [1, 2, 3]) {
  test(`falha na consulta ${fail} permanece explicitamente indisponível`, async t => {
    const { inventory } = await medir(t, { fail });
    assert.equal(inventory.status, 'unavailable');
    assert.ok(inventory.reason);
    assert.equal(inventoryMetrics(inventory), null);
  });
}

test('caminhos duplicados não comprovam contagem completa', async t => {
  const { inventory } = await medir(t, { files: [...FILES.slice(0, 131), FILES[0]] });
  assert.equal(inventory.status, 'incomplete');
});

test('resposta malformada não produz inventário', async t => {
  const { inventory } = await medir(t, { files: 'não é JSON' });
  assert.equal(inventory.status, 'unavailable');
});

test('inventário no limite da API não promete completude', async t => {
  const files = Array.from({ length: 3000 }, (_, i) => ({ ...FILES[0], path: `f${i}` }));
  const { inventory } = await medir(t, { before: { ...META, changedFiles: 3001 }, files });
  assert.equal(inventory.status, 'incomplete');
});

test('prompt de passe único identifica caminhos como dados e não omite os de número maior que 200', () => {
  const files = Array.from({ length: 201 }, (_, i) => ({ path: `src/f${i}.ts`, lines: 1 }));
  const block = coverageBlock({ files });
  assert.match(block, /Arquivos do diff \(201\)/);
  assert.match(block, /src\/f200\.ts/);
  assert.match(block, /coverage\.reviewed/);
  assert.match(block, /dados/);
});

test('normalização preserva caminhos exatos e recusa atalhos ambíguos', () => {
  const diff = ['a.ts', './a.ts', ' a.ts', 'A.ts'];
  assert.deepEqual(coveragePaths(['a.ts', './a.ts', ' a.ts', 'A.ts'], diff), diff);
  assert.deepEqual(coveragePaths([' /a.ts '], ['a.ts']), ['a.ts']);
  assert.deepEqual(coveragePaths([' a.ts '], ['a.ts', ' a.ts']), [' a.ts ']);
});
