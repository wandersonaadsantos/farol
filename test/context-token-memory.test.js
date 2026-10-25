import test from 'node:test';
import assert from 'node:assert/strict';
import { applicableEntries, compactEvidence } from '../lib/specialists/selection.js';
import { roundMemoryBlock } from '../lib/engine/review-findings.js';

test('curadoria global/legada é preservada; modular só sai com contexto conhecido', () => {
  const entries = [{ id: 'global', scope: 'global', sources: [{ path: 'src/global.js' }] },
    { id: 'legacy', sources: [{ path: 'other/file.js' }] },
    { id: 'module-a', scope: 'module', sources: [{ path: 'src/a/file.js' }] },
    { id: 'module-b', scope: 'module', sources: [{ path: 'src/b/file.js' }] }];
  assert.deepEqual(applicableEntries(entries, ['src/a/caller.js']).map(e => e.id), ['global', 'legacy', 'module-a']);
  assert.deepEqual(applicableEntries(entries), entries, 'mapa ausente não retira conhecimento');
});

test('deduplica evidência sem perder conclusão global nem procedência', () => {
  const source = { path: 'src/a.js', blob: 'a'.repeat(40), start: 1, end: 2, excerpt: 'evidência íntegra' };
  const output = compactEvidence([{ id: 'a', text: 'restrição A', sources: [source] }, { id: 'b', text: 'restrição B', sources: [{ ...source }] }]);
  assert.equal(output[0].sources[0].excerpt, source.excerpt);
  assert.equal(output[1].sources[0].excerptRef, output[0].sources[0].excerptId);
  assert.equal(output[1].sources[0].blob, source.blob);
  assert.equal(output[1].text, 'restrição B');
});

test('memória tem uma evidência por id e referências estáveis para todos blockers', () => {
  const finding = { id: 'round:f1', severity: 'blocking', title: 'contrato', summary: 'restrição', evidence: 'src/a.js:1' };
  const block = roundMemoryBlock({ status: 'ready', parents: [{ id: 'round', headSha: 'a', baseSha: 'b', findings: [finding], unresolved: [finding] }] });
  const data = JSON.parse(block.trim().split('\n').at(-1));
  assert.deepEqual(data.blockerRefs, ['round:f1']);
  assert.deepEqual(data.previousFindings, [finding]);
});
