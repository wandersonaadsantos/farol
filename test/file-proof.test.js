// Prova por arquivo (blob SHA): as funções puras que decidem herança de leitura
// entre rounds e o pulo de push trivial. A régua de tudo aqui é a mesma do resto
// do engine: falta de dado NUNCA vira herança, e a degradação é sempre pra
// revisão cheia (que é segura), nunca pra leitura inventada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-file-proof-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const {
  parseFilesStdout, blobMapFrom, sameEffectiveDiff, splitByProof,
  reconcileInheritedCoverage, fileProofBlock, saveFileProof, readFileProof,
  fileProofPath, pruneFileProofs,
} = await import('../lib/engine/file-proof.js');
const { relevantEntries, summarizeCheckpoint } = await import('../lib/engine/verification-checkpoint.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const A = { path: 'src/a.ts', sha: 'blob-a', status: 'modified', lines: 10 };
const B = { path: 'src/b.ts', sha: 'blob-b', status: 'added', lines: 5 };

/* ---------- parseFilesStdout: o --paginate emite um JSON por página ---------- */

test('parseFilesStdout: junta as páginas e normaliza os campos', () => {
  const stdout = JSON.stringify([{ path: 'a', sha: 's1', status: 'modified', lines: 3 }]) + '\n' +
    JSON.stringify([{ path: 'b', sha: 's2', status: 'added', lines: '7' }]);
  const out = parseFilesStdout(stdout);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { path: 'a', sha: 's1', status: 'modified', lines: 3 });
  assert.equal(out[1].lines, 7, 'lines vira número');
});

test('parseFilesStdout: linha inválida invalida o lote inteiro (mapa parcial mentiria)', () => {
  assert.equal(parseFilesStdout('[{"path":"a","sha":"s"}]\nnão é json'), null);
  assert.equal(parseFilesStdout('{"não":"é array"}'), null);
  assert.equal(parseFilesStdout('[{"sha":"sem path"}]'), null);
  assert.equal(parseFilesStdout(''), null);
  assert.equal(parseFilesStdout('[]'), null, 'PR sem arquivo não gera prova');
});

/* ---------- sameEffectiveDiff: o gate do pulo de push trivial ---------- */

test('sameEffectiveDiff: idêntico em caminho, blob e status = trivial', () => {
  assert.equal(sameEffectiveDiff([A, B], [{ ...B }, { ...A }]), true, 'ordem não importa');
});

test('sameEffectiveDiff: qualquer diferença real derruba', () => {
  assert.equal(sameEffectiveDiff([{ ...A, sha: 'blob-a2' }, B], [A, B]), false, 'blob mudou');
  assert.equal(sameEffectiveDiff([{ ...A, status: 'removed' }, B], [A, B]), false, 'status mudou');
  assert.equal(sameEffectiveDiff([A], [A, B]), false, 'arquivo saiu do diff');
  assert.equal(sameEffectiveDiff([A, B, { path: 'c', sha: 'x', status: 'added' }], [A, B]), false, 'arquivo entrou');
});

test('sameEffectiveDiff: incerteza nunca é trivial', () => {
  assert.equal(sameEffectiveDiff([{ ...A, sha: '' }], [{ ...A, sha: '' }]), false, 'sha vazio não prova nada');
  assert.equal(sameEffectiveDiff([], []), false, 'lista vazia não prova nada');
  assert.equal(sameEffectiveDiff(null, [A]), false);
  assert.equal(sameEffectiveDiff([A], null), false);
});

/* ---------- splitByProof: quem herda leitura e quem tem que ser lido ---------- */

test('splitByProof: herda só com blob igual, status igual E leitura declarada', () => {
  const prova = { head: 'h1', files: [A, B], reviewed: ['src/a.ts'] };
  const atual = [{ ...A }, { ...B, sha: 'blob-b2' }];
  const r = splitByProof(atual, prova);
  assert.equal(r.ativa, true);
  assert.deepEqual(r.unchanged, ['src/a.ts']);
  assert.deepEqual(r.changed, ['src/b.ts']);
});

test('splitByProof: arquivo inalterado que a revisão anterior NÃO leu vai pra leitura', () => {
  const prova = { head: 'h1', files: [A, B], reviewed: ['src/a.ts'] };
  const r = splitByProof([{ ...A }, { ...B }], prova);
  assert.deepEqual(r.unchanged, ['src/a.ts']);
  assert.deepEqual(r.changed, ['src/b.ts'], 'blob igual sem leitura declarada não herda nada');
});

test('splitByProof: arquivo novo no diff sempre é leitura', () => {
  const prova = { head: 'h1', files: [A], reviewed: ['src/a.ts'] };
  const r = splitByProof([{ ...A }, { path: 'src/novo.ts', sha: 'n1', status: 'added', lines: 2 }], prova);
  assert.deepEqual(r.changed, ['src/novo.ts']);
});

test('splitByProof: sem prova ou sem diff atual, nada é herdado', () => {
  assert.equal(splitByProof(null, { files: [A], reviewed: [] }).ativa, false);
  assert.equal(splitByProof([], { files: [A], reviewed: [] }).ativa, false);
  const semProva = splitByProof([A, B], null);
  assert.equal(semProva.ativa, false);
  assert.deepEqual(semProva.changed, ['src/a.ts', 'src/b.ts'], 'tudo vira leitura obrigatória');
});

/* ---------- reconcileInheritedCoverage: o gate de cobertura enxerga a herança ---------- */

test('reconcileInheritedCoverage: inalterado sai de missing, entra em reviewed e fica rastreado', () => {
  const cov = { total: 3, reviewed: ['src/b.ts'], missing: ['src/a.ts', 'src/c.ts'] };
  const r = reconcileInheritedCoverage(cov, ['src/a.ts']);
  assert.deepEqual(r.reviewed.sort(), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(r.missing, ['src/c.ts'], 'lacuna real continua lacuna');
  assert.deepEqual(r.inherited, ['src/a.ts'], 'a origem da cobertura fica separada');
});

test('reconcileInheritedCoverage: cobre a rede de segurança do coverageGap (total > reviewed sem missing)', () => {
  // a sessão contou o inalterado no total mas não o listou em missing: a prova
  // herdada vale do mesmo jeito, senão o gate seguraria um round já comprovado
  const cov = { total: 2, reviewed: ['src/b.ts'], missing: [] };
  const r = reconcileInheritedCoverage(cov, ['src/a.ts']);
  assert.deepEqual(r.reviewed.sort(), ['src/a.ts', 'src/b.ts']);
  assert.deepEqual(r.inherited, ['src/a.ts']);
});

test('reconcileInheritedCoverage: não duplica o que a sessão releu por conta própria', () => {
  const cov = { total: 1, reviewed: ['src/a.ts'], missing: [] };
  const r = reconcileInheritedCoverage(cov, ['src/a.ts']);
  assert.deepEqual(r.reviewed, ['src/a.ts']);
  assert.deepEqual(r.inherited, [], 'releitura desta sessão não é herança');
});

test('reconcileInheritedCoverage: envelope sem coverage passa intocado', () => {
  assert.equal(reconcileInheritedCoverage(null, ['a']), null);
  assert.equal(reconcileInheritedCoverage(undefined, ['a']), undefined);
});

/* ---------- fileProofBlock: o instrutivo do round incremental ---------- */

test('fileProofBlock: lista os dois grupos e manda declarar só a leitura real', () => {
  const bloco = fileProofBlock({ ativa: true, unchanged: ['src/a.ts'], changed: ['src/b.ts'] }, 'abcdef1234567890');
  assert.match(bloco, /Revisão incremental \(prova por arquivo\)/);
  assert.match(bloco, /abcdef1/, 'head anterior encurtado aparece');
  assert.match(bloco, /ALTERADOS desde a leitura anterior \(1\)/);
  assert.match(bloco, /- src\/b\.ts/);
  assert.match(bloco, /INALTERADOS com leitura já comprovada \(1\)/);
  assert.match(bloco, /- src\/a\.ts/);
  assert.match(bloco, /SOMENTE o que você leu NESTA sessão/);
  assert.doesNotMatch(bloco, /—/, 'sem travessão (invariante 6)');
});

/* ---------- persistência: roundtrip, forma blindada e poda ---------- */

test('save/readFileProof: roundtrip preserva head, files e reviewed', () => {
  saveFileProof('org/repo#1', { head: 'h1', at: 123, files: [A, B], reviewed: ['src/a.ts'] });
  const lida = readFileProof('org/repo#1');
  assert.equal(lida.head, 'h1');
  assert.equal(lida.files.length, 2);
  assert.deepEqual(lida.reviewed, ['src/a.ts']);
});

test('readFileProof: ausente, torto ou vazio devolve null (nunca prova)', () => {
  assert.equal(readFileProof('org/repo#nunca-gravado'), null);
  fs.writeFileSync(fileProofPath('org/repo#torto'), '{"files": {}}');
  assert.equal(readFileProof('org/repo#torto'), null);
  fs.writeFileSync(fileProofPath('org/repo#vazio'), '{"files": []}');
  assert.equal(readFileProof('org/repo#vazio'), null);
});

test('fileProofPath: keys distintas nunca colidem (mesma lição do checkpoint)', () => {
  assert.notEqual(fileProofPath('a__b/c#1'), fileProofPath('a/b__c#1'));
});

test('pruneFileProofs: apaga prova velha e preserva a recente', () => {
  saveFileProof('org/repo#velho', { head: 'h', files: [A], reviewed: [] });
  saveFileProof('org/repo#novo', { head: 'h', files: [A], reviewed: [] });
  const velho = fileProofPath('org/repo#velho');
  const quandoVelho = Date.now() - 40 * 24 * 60 * 60 * 1000;
  fs.utimesSync(velho, new Date(quandoVelho), new Date(quandoVelho));
  pruneFileProofs();
  assert.equal(fs.existsSync(velho), false);
  assert.equal(fs.existsSync(fileProofPath('org/repo#novo')), true);
});

/* ---------- blobMapFrom + checkpoint: entrada sobrevive ao push se o arquivo não mudou ---------- */

test('blobMapFrom: mapa path->sha, ignorando entrada sem sha; vazio vira null', () => {
  assert.deepEqual(blobMapFrom([A, { path: 'x', sha: '', status: 'removed', lines: 1 }]), { 'src/a.ts': 'blob-a' });
  assert.equal(blobMapFrom([]), null);
  assert.equal(blobMapFrom(null), null);
});

test('relevantEntries: blob idêntico mantém a entrada relevante num head novo', () => {
  const entradas = [
    { claim: 'a', file: 'src/a.ts', line: 1, verdict: 'confirmado', headSha: 'sha-velho', blobSha: 'blob-a' },
    { claim: 'b', file: 'src/b.ts', line: 2, verdict: 'confirmado', headSha: 'sha-velho', blobSha: 'blob-b-velho' },
  ];
  const blobs = { 'src/a.ts': 'blob-a', 'src/b.ts': 'blob-b-novo' };
  const r = relevantEntries(entradas, 'sha-novo', blobs);
  assert.equal(r.length, 1);
  assert.equal(r[0].file, 'src/a.ts', 'só a claim do arquivo que não mudou sobrevive');
});

test('relevantEntries: sem mapa de blobs, vale a regra de sempre (só o mesmo head)', () => {
  const entradas = [{ claim: 'a', file: 'src/a.ts', line: 1, verdict: 'confirmado', headSha: 'sha-velho', blobSha: 'blob-a' }];
  assert.equal(relevantEntries(entradas, 'sha-novo', null).length, 0);
  assert.equal(relevantEntries(entradas, 'sha-velho', null).length, 1);
});

test('summarizeCheckpoint: aceita o mapa de blobs e conta a entrada herdada', () => {
  const entradas = [{ claim: 'a', file: 'src/a.ts', line: 1, verdict: 'confirmado', headSha: 'sha-velho', blobSha: 'blob-a' }];
  const sem = summarizeCheckpoint(entradas, 'sha-novo');
  assert.equal(sem.total, 0, 'sem blobs, head novo descarta (compatível com o de antes)');
  const com = summarizeCheckpoint(entradas, 'sha-novo', { 'src/a.ts': 'blob-a' });
  assert.equal(com.total, 1);
  assert.equal(com.confirmedCount, 1);
});
