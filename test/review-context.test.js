import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as modules from 'node:module';
import { buildMap, impactPaths } from '../lib/review-context/map.js';
import { selectContext, contextBlock } from '../lib/review-context/select.js';
import { parseSources } from '../lib/review-context/parser.js';

const digest = text => crypto.createHash('sha1').update(text).digest('hex');
function sources(head, previous = head, account = 'alice') {
  return { manifest: { scope: { host: 'github.com', account, repo: 'org/project' }, H: 'a'.repeat(40), M: 'b'.repeat(40) },
    reader: {
      async tree(side) { const files = side === 'head' ? head : previous; return { complete: true, entries: Object.entries(files).map(([path, text]) => ({ path, blob: digest(text), type: 'blob', size: Buffer.byteLength(text) })) }; },
      async read(path, side) { const text = (side === 'head' ? head : previous)[path]; return text === undefined ? { status: 'unavailable' }
        : { status: 'available', text, blob: digest(text), path, commit: side === 'head' ? 'a'.repeat(40) : 'b'.repeat(40) }; },
    } };
}
const fixture = {
  'src/api.js': 'export function price(total) { return { amount: total }; }',
  'src/page.js': "import { price } from './api.js';\nexport const show = () => price(1).toFixed(2);",
  'test/page.test.js': "import { show } from '../src/page.js';\nexport const exercise = () => show();",
};

test('parser V8 reconhece imports sintáticos sem executar código nem importar dependências', async () => {
  const [file] = (await parseSources([{ path: 'a.js', blob: digest('parser-fixture'), text: "import x from './safe.js';\nthrow new Error('NAO EXECUTAR');\n// import z from './fake.js'" }], { account: 'a', repo: 'x/y' })).analyses;
  assert.equal(file.backend, 'v8-module');
  assert.deepEqual(file.imports.map(i => i.specifier), ['./safe.js']);
  assert.equal(file.imports[0].origin, 'parser');
});

test('descobre consumidor fora do diff e teste por relações, sem afirmar decisão de review', async () => {
  const source = sources(fixture), map = await buildMap(source);
  const files = [{ path: 'src/api.js', patch: '@@ -1 +1 @@' }];
  const impact = impactPaths(map, files);
  assert.ok(impact.affected.includes('src/page.js'));
  assert.ok(impact.affected.includes('test/page.test.js'));
  const selection = await selectContext(source, map, files);
  assert.ok(selection.snippets.some(s => s.path === 'src/page.js' && s.blob && s.commit));
  assert.ok(selection.references.every(r => r.origin && r.confidence));
  assert.equal(selection.verdict, undefined);
  assert.match(contextBlock(selection), /não comprova ausência de impacto/);
});

test('usa relações antigas para consumidor de arquivo renomeado/removido', async () => {
  const old = { 'old.js': 'export const value=1;', 'consumer.js': "import { value } from './old.js'; export const x=value;" };
  const head = { 'new.js': old['old.js'], 'consumer.js': old['consumer.js'] };
  const map = await buildMap(sources(head, old));
  assert.ok(impactPaths(map, [{ path: 'new.js', previousPath: 'old.js' }]).affected.includes('consumer.js'));
  assert.ok(map.head.unresolved.length > 0);
});

test('mudança de alias invalida relações e alcança arquivo de blob inalterado', async () => {
  const config = paths => JSON.stringify({ compilerOptions: { paths } });
  const head = { 'tsconfig.json': config({ '@api': ['./new.js'] }), 'old.js': 'export const x=1;', 'new.js': 'export const x=2;', 'consumer.js': "import {x} from '@api'; export const y=x;" };
  const previous = { ...head, 'tsconfig.json': config({ '@api': ['./old.js'] }) };
  const map = await buildMap(sources(head, previous));
  assert.equal(map.head.relations[0].to, 'new.js');
  assert.equal(map.previous.relations[0].to, 'old.js');
  assert.ok(impactPaths(map, [{ path: 'tsconfig.json' }]).affected.includes('consumer.js'));
});

test('cache quente evita parses e não reaproveita análise entre contas', async () => {
  const source = sources({ 'unique.js': "export const uniqueCacheFixture='only';" }, undefined, 'cache-a');
  const cold = await buildMap(source), warm = await buildMap(source);
  assert.equal(cold.head.metrics.parses, 1);
  assert.equal(warm.head.metrics.parses, 0);
  assert.equal(warm.head.metrics.parserHits, 1);
  const other = await buildMap(sources({ 'unique.js': "export const uniqueCacheFixture='only';" }, undefined, 'cache-b'));
  assert.equal(other.head.metrics.parses, 1);
});

test('índice incompleto e limites não viram mapa completo ou evidência favorável', async () => {
  const map = await buildMap(sources(fixture), { limits: { files: 1 } });
  assert.equal(map.complete, false);
  assert.ok(map.head.metrics.omitted > 0);
  assert.ok(map.limitations.some(l => l.includes('fora do levantamento')));
  assert.equal(map.approvable, undefined);
});

test('parser TS depende do runtime e a degradação é explícita', async () => {
  const text = "import {x} from './x.js'; export const y: number=x;";
  const file = (await parseSources([{ path: 'typed.ts', blob: digest(text), text }], { account: 'a', repo: 'ts/repo' })).analyses[0];
  assert.equal(file.backend, typeof modules.stripTypeScriptTypes === 'function' ? 'amaro-v8' : 'textual');
  if (file.backend === 'textual') assert.ok(file.limitations.length);
});

test('cancelamento libera a fila de parser para a próxima operação', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(buildMap(sources(fixture), { signal }), /cancelado/);
  assert.ok((await buildMap(sources(fixture))).head.files.length);
});

test('orçamento estima o bloco inteiro e informa referências omitidas', async () => {
  const source = sources(fixture), map = await buildMap(source);
  const selection = await selectContext(source, map, [{ path: 'src/api.js' }], { budgetTokens: 512 });
  const block = contextBlock(selection);
  assert.ok(block.length <= 512 * 4 + 16);
  assert.match(block, /omittedReferences/);
});

test('declarações em strings e comentários não viram símbolos candidatos', async () => {
  const text = "const real = 'function fake() {}'; // class Phantom {}\nexport function visible(){}";
  const file = (await parseSources([{ path: 'declarations.js', blob: digest(text), text }], { account: 'a', repo: 'declarations/repo' })).analyses[0];
  assert.deepEqual(file.symbols.map(s => s.name), ['real', 'visible']);
  assert.equal(file.symbols[1].line, 2);
});

test('CommonJS e imports dinâmicos declaram limite, sem concluir ausência de impacto', async () => {
  const map = await buildMap(sources({ 'dynamic.js': "export const load=() => import('./runtime.js');", 'runtime.js': 'export const value=1;' }));
  assert.equal(map.complete, false);
  assert.ok(map.limitations.some(l => l.includes('dinâmico')));
});
