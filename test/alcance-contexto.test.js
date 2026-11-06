import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-alcance-contexto-'));
process.env.FAROL_HOME = temporario;
const { contextoExternoDoAlcance, revalidarAusenciaHerdada } = await import('../lib/engine/alcance-contexto.js');
const { alcanceConferido, alcanceGap, verificarAlcance } = await import('../lib/engine/alcance.js');
const fileProof = await import('../lib/engine/file-proof.js');
const analysis = await import('../lib/engine/analysis-source.js');
const runtimeOriginal = { ...analysis.sourceRuntime };
afterEach(() => Object.assign(analysis.sourceRuntime, runtimeOriginal));
after(() => fs.rmSync(temporario, { recursive: true, force: true }));

const A = 'a'.repeat(40), B = 'b'.repeat(40), C = 'c'.repeat(40);
const FILE = { path: 'src/preco.js', sha: '1'.repeat(40), status: 'modified', patchStatus: 'available',
  patch: '@@ -1 +1 @@\n-export const preco = 1;\n+export const preco = 2;' };
const OUTRO = { path: 'src/outro.js', blob: '2'.repeat(40), type: 'blob', mode: '100644' };
const DECLARADO = { alterado: FILE.path, chamadores: [], semChamador: 'módulo ainda sem uso fora dos arquivos deste PR' };
const entradas = () => [{ path: FILE.path, blob: FILE.sha, mode: '100644', type: 'blob' }, OUTRO];
function fonte(entries = entradas(), extras = {}) {
  const manifest = { scope: { host: 'github.com', account: 'eu', repo: 'org/app', repositoryId: 1 }, H: A, B, M: C,
    files: [FILE], limitations: [], ...extras };
  return { status: 'complete', manifest,
    inventory: { status: 'complete', headSha: manifest.H, baseSha: manifest.B, files: manifest.files, changedFiles: manifest.files.length },
    reader: { async tree() { return { complete: true, commit: manifest.H, entries }; },
      async read() { throw new Error('A validade do contexto não exige leitura de conteúdo.'); } }, release: async () => {} };
}
function herdado(contexto) {
  return { ativa: true, unchanged: [FILE.path], changed: [], alcance: {
    [FILE.path]: { sha: FILE.sha, entrada: DECLARADO, origem: { head: A }, ...(contexto ? { contextoExterno: contexto.digest } : {}) },
  } };
}

test('novo commit com a mesma árvore preserva ausência herdada; não baixa nem interpreta conteúdos', async () => {
  const primeiro = await contextoExternoDoAlcance(fonte(), [FILE]);
  const mudado = entradas();
  mudado.push({ path: 'src', blob: '4'.repeat(40), type: 'tree', mode: '040000' });
  const atual = await contextoExternoDoAlcance(fonte(mudado, { H: C }), [FILE]);
  assert.equal(primeiro.digest, atual.digest, 'a identidade usa caminhos, blobs e modos; não depende do SHA do commit');
  const resultado = revalidarAusenciaHerdada(herdado(primeiro), atual, [FILE]);
  assert.deepEqual(Object.keys(resultado.alcance), [FILE.path]);
  assert.deepEqual(resultado.unchanged, [FILE.path]);
});

const MUDANCAS_EXTERNAS = [
  ['novo consumidor', () => [...entradas(), { ...OUTRO, path: 'src/novo-consumidor.js' }]],
  ['consumidor removido', () => entradas().filter((e) => e.path !== OUTRO.path)],
  ['consumidor renomeado com o mesmo blob', () => entradas().map((e) => e.path === OUTRO.path ? { ...e, path: 'src/novo-nome.js' } : e)],
  ['conteúdo externo mudou', () => entradas().map((e) => e.path === OUTRO.path ? { ...e, blob: '9'.repeat(40) } : e)],
  ['modo mudou para executável', () => entradas().map((e) => e.path === OUTRO.path ? { ...e, mode: '100755' } : e)],
  ['configuração de alias entrou', () => [...entradas(), { ...OUTRO, path: 'tsconfig.json' }]],
  ['link simbólico mudou', () => [...entradas(), { ...OUTRO, path: 'src/link.js', mode: '120000' }]],
];
for (const [nome, mudar] of MUDANCAS_EXTERNAS) {
  test(`${nome}: perde apenas alcance, mantendo leitura já comprovada do blob`, async () => {
    const anterior = await contextoExternoDoAlcance(fonte(), [FILE]);
    const atual = await contextoExternoDoAlcance(fonte(mudar(), { H: C }), [FILE]);
    const resultado = revalidarAusenciaHerdada(herdado(anterior), atual, [FILE]);
    assert.deepEqual(resultado.alcance, {});
    assert.deepEqual(resultado.alcanceReavaliar, [FILE.path]);
    assert.deepEqual(resultado.unchanged, [FILE.path]);
    assert.equal(resultado.ativa, true);
  });
}

test('mudança da base ou da conta impede reutilizar a declaração de outro contexto', async () => {
  const anterior = await contextoExternoDoAlcance(fonte(), [FILE]);
  for (const atual of [fonte(entradas(), { B: C }), fonte(entradas(), { scope: { host: 'github.com', account: 'outra', repo: 'org/app', repositoryId: 1 } })]) {
    const contexto = await contextoExternoDoAlcance(atual, [FILE]);
    assert.deepEqual(revalidarAusenciaHerdada(herdado(anterior), contexto, [FILE]).alcance, {});
  }
});

test('árvore parcial, ilegível ou de outro head nunca comprova contexto inalterado', async () => {
  const anterior = await contextoExternoDoAlcance(fonte(), [FILE]);
  for (const tree of [async () => ({ complete: false, commit: A, entries: entradas() }),
    async () => ({ complete: true, commit: C, entries: entradas() }),
    async () => ({ complete: true, commit: A, entries: [{ path: 'src/outro.js', type: 'blob' }] }),
    async () => { throw new Error('HTTP 503'); }]) {
    const atual = fonte(); atual.reader.tree = tree;
    const contexto = await contextoExternoDoAlcance(atual, [FILE]);
    assert.equal(contexto, null);
    assert.deepEqual(revalidarAusenciaHerdada(herdado(anterior), contexto, [FILE]).alcance, {});
  }
});

test('prova antiga sem identidade externa não herda ausência; declaração de chamador segue conferida no head', async () => {
  const contexto = await contextoExternoDoAlcance(fonte(), [FILE]);
  assert.deepEqual(revalidarAusenciaHerdada(herdado(), contexto, [FILE]).alcance, {});
  const comUso = herdado();
  comUso.alcance[FILE.path].entrada = { alterado: FILE.path, chamadores: [{ arquivo: OUTRO.path, linha: 2, simbolo: 'preco' }] };
  assert.deepEqual(Object.keys(revalidarAusenciaHerdada(comUso, null, [FILE]).alcance), [FILE.path]);
  const corrompida = herdado(contexto);
  corrompida.alcance[FILE.path].entrada = { ...DECLARADO, chamadores: {} };
  assert.deepEqual(revalidarAusenciaHerdada(corrompida, contexto, [FILE]).alcance, {}, 'corrupção perde só a herança, sem derrubar a revisão');
});

test('import exato observado no mapa contradiz ausência, inclusive na primeira rodada', async () => {
  const mapa = { head: { relations: [{ from: OUTRO.path, to: FILE.path, line: 2, origin: 'parser', confidence: 'syntax-path' }] } };
  const contexto = await contextoExternoDoAlcance(fonte(), [FILE], mapa);
  const result = { diffMedido: [FILE.path], coverage: { reviewed: [FILE.path] }, alcance: [DECLARADO] };
  await verificarAlcance({}, { repo: 'org/app' }, A, result, contexto);
  assert.match(alcanceGap(result).join(' '), /src\/outro\.js:2.*declaração de ausência/);
  assert.deepEqual(alcanceConferido(result), {}, 'a contradição não vira prova para outra rodada');
  assert.deepEqual(revalidarAusenciaHerdada(herdado(contexto), contexto, [FILE]).alcance, {});
  const candidato = await contextoExternoDoAlcance(fonte(), [FILE], { head: { relations: [{ ...mapa.head.relations[0], confidence: 'candidate' }] } });
  assert.deepEqual(candidato.consumidores, [], 'pista parcial do mapa não vira contradição certa');
});

function motor() {
  return { config: { reviewContextMode: 'off' }, activeReviews: new Map([['s1', { mode: 'auto', cancellable: true }]]),
    running: new Map(), decisions: { pending: [], resolved: [] }, log() {}, pushState() {}, killTree() { throw new Error('Não há processo nesta prova.'); } };
}

test('preparação perde a ausência antes do prompt e pede alcance na sessão já prevista', async () => {
  const pr = { key: 'org/app#91', repo: 'org/app', number: 91 };
  const anterior = fonte();
  const contexto = await contextoExternoDoAlcance(anterior, [FILE]);
  fileProof.salvarProvaDaSessao(pr, A, [FILE], { diffMedido: [FILE.path], coverage: { reviewed: [FILE.path] }, alcance: [DECLARADO] }, contexto);
  assert.equal(fileProof.readFileProof(pr.key).alcance[FILE.path].contextoExterno, contexto.digest);
  analysis.sourceRuntime.prepareSources = async () => fonte([...entradas(), { ...OUTRO, path: 'src/novo-consumidor.js' }], { H: C });
  const leitura = await analysis.prepareReviewReading(motor(), pr, 's1', C);
  assert.deepEqual(leitura.inheritance.unchanged, [FILE.path]);
  assert.deepEqual(leitura.inheritance.alcance, {});
  assert.match(fileProof.fileProofBlock(leitura.inheritance, A), /SEM alcance conferido; declare o `alcance` deles nesta sessão/);
  await analysis.releaseAnalysisSource(leitura.prepared, motor());
});

test('alias alterado no diff invalida ausência com mapa desligado e consumidor externo intacto', async () => {
  const pr = { key: 'org/app#93', repo: 'org/app', number: 93 };
  const config = { ...FILE, path: 'tsconfig.json', sha: '5'.repeat(40) };
  const files = [FILE, config];
  const arvore = [...entradas(), { path: config.path, blob: config.sha, type: 'blob', mode: '100644' }];
  const anterior = fonte(arvore, { files });
  const contexto = await contextoExternoDoAlcance(anterior, files);
  fileProof.salvarProvaDaSessao(pr, A, files, { diffMedido: files.map(f => f.path),
    coverage: { reviewed: [FILE.path] }, alcance: [DECLARADO] }, contexto);
  const configAtual = { ...config, sha: '6'.repeat(40) };
  const atual = fonte(arvore.map(e => e.path === config.path ? { ...e, blob: configAtual.sha } : e),
    { H: C, files: [FILE, configAtual] });
  const novoContexto = await contextoExternoDoAlcance(atual, [FILE, configAtual]);
  assert.notEqual(contexto.digest, novoContexto.digest, 'o alias pode fazer um import externo já existente resolver para o alvo');
  assert.deepEqual(novoContexto.consumidores, [], 'a correção independe da análise do mapa');
  analysis.sourceRuntime.prepareSources = async () => atual;
  const leitura = await analysis.prepareReviewReading(motor(), pr, 's1', C);
  assert.deepEqual(leitura.inheritance.unchanged, [FILE.path]);
  assert.deepEqual(leitura.inheritance.changed, [config.path]);
  assert.deepEqual(leitura.inheritance.alcance, {});
  assert.match(fileProof.fileProofBlock(leitura.inheritance, A), /SEM alcance conferido/);
  await analysis.releaseAnalysisSource(leitura.prepared, motor());
});

test('consumidor comum que já pertence ao diff também participa da identidade do alcance', async () => {
  const files = [FILE, { ...FILE, path: OUTRO.path, sha: OUTRO.blob }];
  const anterior = await contextoExternoDoAlcance(fonte(), files);
  const arvore = entradas().map(e => e.path === OUTRO.path ? { ...e, blob: '7'.repeat(40) } : e);
  const atual = await contextoExternoDoAlcance(fonte(arvore, { H: C }), files);
  assert.notEqual(anterior.digest, atual.digest);
  const resultado = revalidarAusenciaHerdada(herdado(anterior), atual, files);
  assert.deepEqual(resultado.alcance, {});
  assert.deepEqual(resultado.unchanged, [FILE.path]);
});

test('identidade enviada pelo modelo ou referente a outro head não entra na prova', async () => {
  const pr = { key: 'org/app#92' };
  const result = { diffMedido: [FILE.path], coverage: { reviewed: [FILE.path] }, alcance: [DECLARADO],
    contextoAlcance: { head: A, digest: 'inventada' } };
  fileProof.salvarProvaDaSessao(pr, A, [FILE], result, { head: C, digest: 'outro-head' });
  assert.equal(fileProof.readFileProof(pr.key).alcance[FILE.path].contextoExterno, undefined);
});
