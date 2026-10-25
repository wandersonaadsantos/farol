// Expectativas prévias e limites: docs/CONTEXTO-FRONTEND.md. Só fontes sintéticas.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, impactPaths } from '../lib/review-context/map.js';
import { selectContext } from '../lib/review-context/select.js';
import { inheritanceForContext } from '../lib/engine/analysis-source.js';
const digest = text => createHash('sha1').update(text).digest('hex');
function source(head, previous = head) {
  Object.freeze(head); Object.freeze(previous);
  return { manifest: { scope: { host: 'github.com', account: 'frontend-fixture', repo: 'org/frontend', repositoryId: 1 },
    H: 'a'.repeat(40), B: 'b'.repeat(40), M: 'c'.repeat(40) }, reader: {
    tree: async side => ({ complete: true, entries: Object.entries(side === 'head' ? head : previous)
      .map(([path, text]) => ({ path, blob: digest(text), type: 'blob', size: Buffer.byteLength(text) })) }),
    read: async (path, side) => {
      const text = (side === 'head' ? head : previous)[path];
      return typeof text === 'string' ? { status: 'available', text, path, blob: digest(text), commit: side === 'head' ? 'a'.repeat(40) : 'c'.repeat(40) }
        : { status: 'unavailable' };
    } } };
}
const edge = (map, from, to, side = 'head') => map[side].relations.find(item => item.from === from && item.to === to);
test('JSX componente: mudança de props recupera consumidor, sem afirmar compatibilidade', async () => {
  const previous = { 'Button.jsx': 'export const Button = ({label}) => <button>{label}</button>;',
    'Page.js': "import {Button} from './Button.jsx'; export const Page=()=> <Button label='Enviar'/>;" };
  const input = source({ ...previous, 'Button.jsx': 'export const Button = ({caption}) => <button>{caption}</button>;' }, previous);
  const map = await buildMap(input), relation = edge(map, 'Page.js', 'Button.jsx');
  assert.equal(relation.confidence, 'syntax-path'); assert.equal(relation.form, 'ImportDeclaration');
  assert.ok(impactPaths(map, [{ path: 'Button.jsx' }]).affected.includes('Page.js'));
  const selection = await selectContext(input, map, [{ path: 'Button.jsx' }]);
  assert.ok(selection.snippets.some(s => s.path === 'Page.js' && s.text.includes("label='Enviar'")));
  assert.equal(selection.propsCompatible, undefined);
});
test('TS/TSX hooks e contratos: inclui consumidor transitivo e imports somente de tipos', async () => {
  const map = await buildMap(source({
    'contract.ts': 'export interface Result { total: number }',
    'useTotal.ts': "import type {Result} from './contract.ts'; export function useTotal(): Result { return {total:1}; }",
    'View.tsx': "import {useTotal} from './useTotal.ts'; export function View(){ const result=useTotal(); return <div>{result.total}</div>; }",
  }));
  assert.equal(map.complete, true); assert.equal(edge(map, 'useTotal.ts', 'contract.ts').kind, 'type');
  assert.ok(impactPaths(map, [{ path: 'contract.ts' }]).affected.includes('View.tsx'));
  assert.ok(map.head.files.every(file => file.backend === 'babel-parser-7.28.5'));
});
test('import com tipos inline diferencia contrato misto de import apenas de runtime', async () => {
  const map = await buildMap(source({ 'mixed.ts': "import { type Model, value } from './api.ts'; export const x: Model=value;",
    'api.ts': 'export interface Model { id:number } export const value={id:1};' }));
  assert.equal(edge(map, 'mixed.ts', 'api.ts').kind, 'mixed');
});
test('dependência não resolvida amplia candidatos e impede herdar consumidor inalterado em assist', async () => {
  for (const specifier of ['./api.js', '@unknown/api', 'unresolved-package']) {
    const previous = { 'api.ts': 'export const value=1;',
      'View.tsx': `import {value} from '${specifier}'; export const View=()=> <div>{value}</div>;` };
    const input = source({ ...previous, 'api.ts': 'export const value="changed";' }, previous);
    const map = await buildMap(input);
    assert.ok(map.head.unresolved.some(item => item.from === 'View.tsx' && item.specifier === specifier));
    assert.equal(map.complete, false, `Não comprovar resolução de ${specifier} não comprova ausência de impacto.`);
    const selection = await selectContext(input, map, [{ path: 'api.ts' }]);
    assert.ok(selection.references.some(item => item.path === 'View.tsx' && item.reason.includes('incompleto')));
    assert.ok(selection.snippets.some(item => item.path === 'View.tsx'));
    assert.ok(selection.limitations.some(item => item.includes('não resolvida')));
    const inherited = { ativa: true, unchanged: ['View.tsx'], changed: ['api.ts'] };
    const result = inheritanceForContext(inherited, { mode: 'assist', map, selection });
    assert.equal(result.ativa, false);
    assert.deepEqual(result.unchanged, []);
    assert.deepEqual(result.contextRevisit, ['View.tsx']);
    assert.deepEqual(new Set(result.changed), new Set(['api.ts', 'View.tsx']));
    assert.equal(inheritanceForContext(inherited, { mode: 'observe', map, selection }), inherited);
  }
});
test('alias preserva procedência de configuração e permanece candidato', async () => {
  const map = await buildMap(source({ 'tsconfig.json': '{"compilerOptions":{"baseUrl":"src","paths":{"@/*":["*"]}}}',
    'src/model.ts': 'export type Model = string;', 'src/View.tsx': "import type {Model} from '@/model'; export const View=(p:{name:Model})=><div>{p.name}</div>;" }));
  const relation = edge(map, 'src/View.tsx', 'src/model.ts');
  assert.equal(relation.confidence, 'candidate'); assert.equal(relation.config, 'tsconfig.json'); assert.equal(relation.kind, 'type');
});
test('barrel com export nomeado, export type e export estrela conserva relações transitivas', async () => {
  const map = await buildMap(source({ 'model.ts': 'export interface Model { id:number }',
    'useModel.ts': 'export const useModel=()=>({id:1});',
    'index.ts': "export type {Model} from './model.ts'; export {useModel} from './useModel.ts'; export * from './extras.ts';",
    'extras.ts': 'export const x=1;', 'View.tsx': "import {useModel} from './index.ts'; export const View=()=> <div>{useModel().id}</div>;" }));
  assert.equal(edge(map, 'index.ts', 'model.ts').kind, 'type');
  assert.equal(edge(map, 'index.ts', 'extras.ts').form, 'ExportAllDeclaration');
  assert.ok(impactPaths(map, [{ path: 'extras.ts' }]).affected.includes('View.tsx'));
});
test('CommonJS misto mantém require literal como candidato e resolução calculada como desconhecida', async () => {
  const map = await buildMap(source({ 'legacy.cjs': 'module.exports = {x:1};', 'modern.mjs': 'export const value=1;',
    'mixed.cts': "import {value} from './modern.mjs'; const legacy=require('./legacy.cjs'); const extra=require(process.env.NAME); export const x=legacy.x+value;" }));
  assert.equal(edge(map, 'mixed.cts', 'legacy.cjs').confidence, 'candidate');
  assert.equal(edge(map, 'mixed.cts', 'modern.mjs').confidence, 'syntax-path');
  assert.ok(map.head.unresolved.some(item => item.reason === 'require não literal')); assert.equal(map.complete, false);
});
test('rename e delete usam relações do M e não confundem ausência no H com ausência de impacto', async () => {
  const previous = { 'Old.tsx': 'export const Old=()=> <div/>;', 'Page.tsx': "import {Old} from './Old.tsx'; export const Page=()=> <Old/>;" };
  const renamed = await buildMap(source({ 'New.tsx': 'export const New=()=> <div/>;', 'Page.tsx': previous['Page.tsx'] }, previous));
  assert.ok(impactPaths(renamed, [{ path: 'New.tsx', previousPath: 'Old.tsx' }]).affected.includes('Page.tsx'));
  const removed = await buildMap(source({ 'Page.tsx': previous['Page.tsx'] }, previous));
  assert.ok(impactPaths(removed, [{ path: 'Old.tsx', status: 'removed' }]).affected.includes('Page.tsx'));
  assert.ok(removed.head.unresolved.some(item => item.specifier === './Old.tsx'));
});
test('configuração alterada reabre investigação de blobs inalterados e config inválida degrada', async () => {
  const previous = { 'tsconfig.json': '{"compilerOptions":{"paths":{"@model":["./old.ts"]}}}', 'old.ts': 'export const x=1;',
    'new.ts': 'export const x=2;', 'View.tsx': "import {x} from '@model'; export const View=()=> <div>{x}</div>;" };
  const map = await buildMap(source({ ...previous, 'tsconfig.json': '{"compilerOptions":{"paths":{"@model":["./new.ts"]}}}' }, previous));
  assert.equal(edge(map, 'View.tsx', 'new.ts').config, 'tsconfig.json');
  assert.equal(edge(map, 'View.tsx', 'old.ts', 'previous').config, 'tsconfig.json');
  assert.ok(impactPaths(map, [{ path: 'tsconfig.json' }]).affected.includes('View.tsx'));
  const invalid = await buildMap(source({ ...previous, 'tsconfig.json': '{ // JSONC não interpretado\n }' }));
  assert.equal(invalid.complete, false); assert.ok(invalid.limitations.some(item => item.includes('JSON não interpretada')));
});
test('import dinâmico literal é candidato; expressão calculada continua não resolvida', async () => {
  const map = await buildMap(source({ 'loader.ts': "export const load=()=>import('./View.tsx'); export const other=(name:string)=>import(name);",
    'View.tsx': 'export const View=()=> <div/>;' }));
  assert.equal(edge(map, 'loader.ts', 'View.tsx').confidence, 'candidate');
  assert.ok(map.head.unresolved.some(item => item.reason === 'dependência dinâmica calculada'));
  assert.equal(map.complete, false); assert.ok(map.limitations.some(item => item.includes('dinâmico')));
});
test('degradação conserva arquivo e candidatos textuais, amplia investigação e não prova ausência', async () => {
  const input = source({ 'broken.tsx': "import {x} from './api.ts'; export const broken = ;", 'api.ts': 'export const x=1;',
    'unrelated.tsx': 'export const View=()=> <div/>;' });
  const map = await buildMap(input), file = map.head.files.find(item => item.path === 'broken.tsx');
  assert.equal(file.backend, 'textual'); assert.equal(map.complete, false);
  assert.equal(edge(map, 'broken.tsx', 'api.ts').origin, 'textual');
  assert.equal(edge(map, 'broken.tsx', 'api.ts').confidence, 'candidate');
  const selection = await selectContext(input, map, [{ path: 'api.ts' }]);
  assert.ok(selection.references.some(item => item.path === 'unrelated.tsx' && item.reason.includes('incompleto')));
  assert.ok(selection.limitations.some(item => item.includes('não prova ausência')));
});
test('fontes com efeitos de topo e imports com efeito são analisadas sem criar marcador externo', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-context-noexecute-'));
  const marker = path.join(temp, 'must-not-exist');
  try {
    const input = source({ 'evil.js': `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)},'executed'); throw new Error('NEVER EXECUTE');`,
      'evil.tsx': `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); export const View=()=> <div/>;` });
    const map = await buildMap(input); await selectContext(input, map, [{ path: 'evil.js' }]);
    assert.equal(fs.existsSync(marker), false); assert.equal(map.head.files.length, 2);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
