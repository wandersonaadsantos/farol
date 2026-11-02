// Fallback textual com identidades verificadas; nunca chama um par M/H de diff.
import { SHA, check, isSourceTemplate } from '../review-source/contract.js';
import { materialPath } from './restricted-source-contract.js';

async function verifyTextSides(source, file) {
  for (const [side, name, absent] of [
    ['head', file.path, file.status === 'removed'],
    ['mergeBase', file.previousPath || file.path, file.status === 'added']
  ]) {
    const tree = await source.reader.tree(side);
    check(tree.complete, 'Árvore incompleta; representação recusada.');
    const entry = tree.entries.find(value => value.path === name);
    check(absent ? !entry : entry && ['100644', '100755'].includes(entry.mode),
      'Fonte alterada não é arquivo regular na versão fixada; representação recusada.');
  }
}

async function fixedSide(source, path, side, absent, projection, template) {
  materialPath(path);
  const expected = side === 'head' ? source.manifest.H : source.manifest.M;
  check(SHA.test(expected || ''), 'Versão da representação não confirmada.');
  const content = await source.reader.read(path, side);
  check(content.commit === expected, 'Leitura fora da versão fixada; representação recusada.');
  if (absent) {
    check(content.status === 'missing', 'Ausência da fonte não confirmada pela árvore.');
    return { text: '', redactions: [], reference: { path, commit: expected, status: 'missing', blob: null } };
  }
  check(content.status === 'available' && typeof content.text === 'string' && SHA.test(content.blob || '')
    && ['100644', '100755'].includes(content.mode),
    'Versão textual indisponível; representação recusada.');
  const view = template ? projection.projectTemplate(content.text) : projection.project(content.text);
  return { text: view.text, redactions: [...(content.representation?.redactions || []), ...view.redactions].map(range => ({ ...range, side, path })),
    reference: { path, commit: expected, status: 'available', blob: content.blob, mode: content.mode,
      representationKind: view.kind || 'source-text' } };
}

async function selfSourceView(source, file, projection) {
  materialPath(file.path);
  if (file.previousPath) materialPath(file.previousPath);
  await verifyTextSides(source, file);
  const template = isSourceTemplate(file.path) || (file.previousPath ? isSourceTemplate(file.previousPath) : false);
  if (!template && file.patchStatus === 'available' && typeof file.patch === 'string') {
    return { text: file.patch, kind: 'github-patch', references: file.references,
      redactions: file.representation?.redactions || [] };
  }
  check(file.status !== 'renamed' || file.previousPath, 'Caminho anterior da renomeação indisponível.');
  const previous = file.previousPath || file.path;
  const [before, after] = await Promise.all([
    fixedSide(source, previous, 'mergeBase', file.status === 'added', projection, template),
    fixedSide(source, file.path, 'head', file.status === 'removed', projection, template)
  ]);
  const text = `# REPRESENTAÇÃO: projeções de versões verificadas, não um diff GitHub\n`
    + `# status=${file.status}; patch GitHub=${file.patchOrigin?.status || file.patchStatus}; política=${file.patchOrigin?.policy || 'nenhuma'}\n`
    + `--- MERGE_BASE ${previous} @ ${source.manifest.M} (${before.reference.status})\n${before.text}\n`
    + `+++ HEAD ${file.path} @ ${source.manifest.H} (${after.reference.status})\n${after.text}\n`;
  return { text, kind: 'fixed-versions', references: { mergeBase: before.reference, head: after.reference },
    redactions: [...before.redactions, ...after.redactions] };
}

export { selfSourceView };
