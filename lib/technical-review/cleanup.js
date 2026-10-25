// Fachada do ciclo de vida. Resultados duráveis nunca são descartados com a árvore.
import fs from 'node:fs';
import path from 'node:path';
import { privateChild } from './material-paths.js';
import { createRecord, readRecord, release, ready, prepareRecord, retain, known } from './material-record.js';
import { tecnicaRoot, enqueue, maintainMaterials, iniciarManutencaoMaterial, pararManutencaoMaterial,
  afterRemoval, diagnosticoLegados, remocao, pendentes } from './material-maintenance.js';

// O instalador é executado em processo próprio e mantém a fachada síncrona anterior.
function removePrivateDirectory(directory, root, prefix) {
  fs.rmSync(privateChild(directory, root, prefix), { recursive: true, force: true });
}
function criarMaterial(root, metadata = {}) {
  fs.mkdirSync(root, { recursive: true });
  privateChild(path.join(root, 'review-validacao'), root, 'review-');
  if (metadata.sessionId) {
    const existing = [...known].find(([target, r]) => path.dirname(target) === path.resolve(root)
      && r.owner.sessionId === metadata.sessionId && ['preparing', 'in-use'].includes(r.state));
    if (existing) {
      for (const key of ['repo', 'prKey', 'account', 'head', 'base']) {
        if (metadata[key] !== undefined && metadata[key] !== existing[1].context[key]) throw new Error('identidade do material mudou na sessão');
      }
      return existing[0];
    }
  }
  const snapshot = fs.mkdtempSync(path.join(root, 'review-'));
  createRecord(snapshot, metadata);
  return snapshot;
}
function cleanup(context) {
  if (!context?.snapshot) return Promise.resolve(false);
  const target = privateChild(context.snapshot, tecnicaRoot(), 'review-');
  const record = readRecord(target);
  if (!record) return Promise.resolve(false); // Legado ou registro ilegível exige diagnóstico, nunca presunção.
  if (record.state === 'removed') return Promise.resolve(true);
  release(target, 'session'); enqueue(target);
  return maintainMaterials({ root: tecnicaRoot() });
}
function limparRestos() { return maintainMaterials({ root: tecnicaRoot() }); }

export { cleanup, criarMaterial, privateChild, removePrivateDirectory, limparRestos, remocao, pendentes,
  prepareRecord, ready, retain, afterRemoval, maintainMaterials, iniciarManutencaoMaterial,
  pararManutencaoMaterial, diagnosticoLegados };
