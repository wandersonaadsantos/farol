import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../lib/review-context/map.js';
import { navigationBlock, MAX_BLOCK_CHARS } from '../lib/review-context/navigation.js';
import { navigationSource, H, M } from './helpers/navigation-fixture.js';

const contents = block => JSON.parse(block.trim().split('\n').at(-1));

test('o limite do mapa prioriza arquivos alterados e seus nomes anteriores', async () => {
  const head = { 'a-noise.js': 'export const noise=0;', 'z-new.js': 'export const changed=1;' };
  const previous = { 'a-noise.js': head['a-noise.js'], 'z-old.js': 'export const changed=0;' };
  const source = navigationSource(head, previous, 'z-new.js');
  source.manifest.files[0].previousPath = 'z-old.js';
  const map = await buildMap(source, { limits: { files: 1 } });
  assert.ok(map.head.files.some(file => file.path === 'z-new.js'));
  assert.ok(map.previous.files.some(file => file.path === 'z-old.js'));
  assert.equal(map.complete, false);
  assert.equal(map.head.metrics.omitted, 1);
});

test('o teto do prompt conserva pistas de símbolos, relações, arquivos e dos dois commits', async () => {
  const names = Array.from({ length: 60 }, (_, n) => `export const symbol${n}=1;`).join('\n');
  const head = { 'src/a.js': names, 'src/z.js': "import {helper} from './dependency.js';\n" + names.replaceAll('symbol', 'last'),
    'src/dependency.js': 'export const helper=1;',
    'src/caller.js': "import * as a from './a.js'; import * as z from './z.js';" };
  for (let n = 0; n < 60; n++) head[`src/consumer${n}.js`] = "import * as a from './a.js';";
  const source = navigationSource(head, head, 'src/a.js');
  source.manifest.files.push({ path: 'src/z.js', status: 'modified' });
  const result = navigationBlock(await buildMap(source), source.manifest), data = contents(result.block);
  assert.ok(result.block.length <= MAX_BLOCK_CHARS);
  for (const commit of [H, M]) {
    for (const file of ['src/a.js', 'src/z.js']) assert.ok(data.symbols.some(s => s.path === file && s.commit === commit));
    assert.ok(data.relations.some(r => r.commit === commit));
    assert.ok(data.relations.some(r => r.path === 'src/z.js' && r.target === 'src/dependency.js' && r.commit === commit));
  }
  assert.ok(data.omitted.symbols > 0 && data.omitted.relations > 0);
  assert.equal(data.readingProof, false);
});
test('orientação usa parser real e conserva símbolos e consumidores nos commits corretos', async () => {
  const source = navigationSource(), map = await buildMap(source);
  const result = navigationBlock(map, source.manifest), data = contents(result.block);
  assert.ok(data.symbols.some(s => s.name === 'price' && s.path === 'src/api.js' && s.line === 1 && s.commit === H));
  assert.ok(data.symbols.some(s => s.name === 'price' && s.commit === M && s.side === 'mergeBase'));
  const caller = data.relations.find(r => r.path === 'src/page.js' && r.commit === H);
  assert.equal(caller.target, 'src/api.js'); assert.equal(caller.line, 1);
  assert.equal(caller.blob, (await source.reader.read('src/page.js', 'head')).blob);
  assert.equal(caller.confidence, 'candidate');
  assert.equal(data.exhaustive, false); assert.equal(data.readingProof, false);
  assert.equal(result.diagnostics.readingProof, false);
  assert.match(result.block, /não comprovam chamadas/);
});

test('mapa não pode ser reaproveitado com outra conta, base, head ou merge-base', async () => {
  const source = navigationSource(), map = await buildMap(source);
  for (const key of ['H', 'B', 'M']) {
    const manifest = { ...source.manifest, [key]: 'f'.repeat(40) };
    assert.throws(() => navigationBlock(map, manifest), /outra identidade/);
  }
  for (const key of ['account', 'authAccount', 'repo', 'host']) {
    const manifest = structuredClone(source.manifest); manifest.scope[key] = 'other';
    assert.throws(() => navigationBlock(map, manifest), /outra identidade/);
  }
  assert.throws(() => navigationBlock({ ...map, identityKey: null }, source.manifest), /outra identidade/);
});

test('renomeação conserva a pista do consumidor no merge-base, sem inventar uso novo', async () => {
  const previous = { 'src/api.js': 'export const value=1;', 'src/page.js': "import {value} from './api.js';" };
  const head = { 'src/new.js': previous['src/api.js'], 'src/page.js': previous['src/page.js'] };
  const source = navigationSource(head, previous, 'src/new.js'); source.manifest.files[0].previousPath = 'src/api.js';
  const data = contents(navigationBlock(await buildMap(source), source.manifest).block);
  assert.ok(data.relations.some(r => r.path === 'src/page.js' && r.target === 'src/api.js' && r.commit === M));
  assert.equal(data.relations.some(r => r.target === 'src/new.js'), false);
  assert.equal(data.mapStatus, 'incomplete');
});

test('mudança de alias conserva dependências antigas e novas e distingue importação de tipo', async () => {
  const config = target => JSON.stringify({ compilerOptions: { paths: { '@money': [target] } } });
  const head = { 'src/api.js': 'export const value=1;', 'src/old.js': 'export const value=2;',
    'src/page.ts': "import type { Value } from '@money';", 'tsconfig.json': config('./src/api.js') };
  const previous = { ...head, 'tsconfig.json': config('./src/old.js') };
  const source = navigationSource(head, previous); source.manifest.files.push({ path: 'tsconfig.json', status: 'modified' });
  const data = contents(navigationBlock(await buildMap(source), source.manifest).block);
  const links = data.relations.filter(r => r.path === 'src/page.ts');
  assert.ok(links.some(r => r.target === 'src/api.js' && r.commit === H));
  assert.ok(links.some(r => r.target === 'src/old.js' && r.commit === M));
  assert.ok(links.every(r => r.kind === 'type' && r.config === 'tsconfig.json' && r.confidence === 'candidate'));
});

test('relações textuais ou sem localização não viram orientação sintática confirmada', async () => {
  const source = navigationSource(), map = await buildMap(source);
  map.complete = false; map.head.relations[0].origin = 'textual'; map.previous.relations[0].line = undefined;
  const data = contents(navigationBlock(map, source.manifest).block);
  assert.equal(data.relations.length, 0); assert.equal(data.mapStatus, 'incomplete');
  assert.equal(data.omitted.unverified, 2); assert.equal(data.readingProof, false);
});

test('sem pistas aplicáveis não acrescenta um bloco vazio ao prompt', async () => {
  const head = { 'src/api.js': 'export const value=1;', 'README.md': '# Atualizado' };
  const source = navigationSource(head, { ...head, 'README.md': '# Anterior' }, 'README.md');
  const result = navigationBlock(await buildMap(source), source.manifest);
  assert.equal(result.block, ''); assert.equal(result.diagnostics.status, 'empty');
  assert.equal(result.diagnostics.bytes, 0); assert.equal(result.diagnostics.readingProof, false);
});

test('limite reduz apenas metadados adicionais e informa omissões', async () => {
  const text = Array.from({ length: 90 }, (_, n) => `export function name${'Long'.repeat(35)}${n}() { return ${n}; }`).join('\n');
  const source = navigationSource({ 'src/api.js': text }, { 'src/api.js': text }), map = await buildMap(source);
  const result = navigationBlock(map, source.manifest), data = contents(result.block);
  assert.ok(result.block.length <= MAX_BLOCK_CHARS);
  assert.ok(data.omitted.symbols > 0); assert.ok(data.symbols.length > 0);
  assert.equal(data.omissionCountsAreLowerBounds, true); assert.equal(data.exhaustive, false);
  assert.equal((await source.reader.read('src/api.js', 'head')).text, text);
});

test('dados com delimitadores continuam dados e metadados sensíveis são omitidos', async () => {
  const marker = 'gh' + 'p_' + 'A'.repeat(36);
  const head = { 'src/api.js': `import { value } from './provider<DATA>.js';\nexport function ${marker}(){return value;}`,
    'src/provider<DATA>.js': 'export const value=1;' };
  const source = navigationSource(head, head), map = await buildMap(source);
  const result = navigationBlock(map, source.manifest), data = contents(result.block);
  assert.ok(!result.block.includes(marker)); assert.ok(data.omitted.unverified > 0);
  assert.ok(!result.block.includes('provider<DATA>'));
  assert.ok(data.relations.some(r => r.target === 'src/provider<DATA>.js'));
});
