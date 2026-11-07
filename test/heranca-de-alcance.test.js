import { criteriaFixture } from './helpers/criteria-fixture.js';
// Herança do ALCANCE (uso fora do diff) de arquivo inalterado na re-revisão (05/11/2026).
//
// Medido no estado real: numa re-revisão, a sessão lê só o que mudou, a cobertura do
// inalterado era herdada pela prova por arquivo (blob idêntico), mas o alcance não: o
// arquivo de código que não mudou voltava como "sem uso fora do diff e sem o motivo"
// (biud-frontend#1826, renovacaoDaZona.ts: conferido em ccbcf9b, pendência em cc101dd sem
// mudar uma linha). E a rodada complementar da busca da prova, no MESMO head, não herdava
// nem a cobertura (biud-esg#522, 91a151c: duas specs lidas às 19:38 viraram pendência às
// 19:46). Herança só com prova de verdade: blob idêntico, arquivo lido e declaração já
// conferida; o chamador herdado é conferido de novo no head atual.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-heranca-alcance-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let noHead = {};
let lidos = [];
io.run = function runDuble(cmd, args) {
  const sub = (args || []).join(' ');
  const m = sub.match(/repos\/[^/]+\/[^/]+\/contents\/(.+)\?ref=(\S+)/);
  if (m) {
    lidos.push({ arquivo: decodeURI(m[1]), ref: m[2] });
    const texto = noHead[decodeURI(m[1])];
    return Promise.resolve(texto == null ? { ok: false, stdout: '', stderr: 'Not Found' } : { ok: true, stdout: texto, stderr: '' });
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return Promise.resolve({ ok: true, stdout: '[]', stderr: '' });
  return Promise.resolve({ ok: true, stdout: '', stderr: '' });
};

const { alcanceGap } = await import('../lib/engine/alcance.js');
const fileProof = await import('../lib/engine/file-proof.js');
const analysis = await import('../lib/engine/analysis-source.js');
const { Engine } = await import('../server.js');

const runtimeOriginal = { ...analysis.sourceRuntime };
afterEach(() => Object.assign(analysis.sourceRuntime, runtimeOriginal));
after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});

const CHAMADOR = 'import { montar } from "./veredito";\n\nexport function rota() {\n  return montar(1);\n}\n';
const VEREDITO = { path: 'src/veredito.ts', sha: 'blob-veredito', status: 'modified', lines: 10 };
const OUTRO = { path: 'src/outro.ts', sha: 'blob-outro', status: 'modified', lines: 4 };
const DECLARACAO = { alterado: 'src/veredito.ts', chamadores: [{ arquivo: 'src/rota.ts', linha: 4, simbolo: 'montar' }] };

/* ---------- a rodada nova herda o alcance conferido do arquivo que não mudou ---------- */

function motor(pr, rodadas) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.autoApproveAll = true;
  e.approvePolicyFor = () => 'wait';
  e.saveDecisions = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.log = () => { };
  e.on('toast', () => { });
  e.fetchPrInventory = async (_pr, headSha) => {
    const files = rodadas.atual.files;
    return { status: 'complete', reason: '', headSha, baseSha: 'base', changedFiles: files.length, files };
  };
  e.headSha = async () => rodadas.atual.head;
  e.postReview = async () => ({ ok: true });
  e.runClaudeStream = async () => ({
    text: JSON.stringify({
      ...criteriaFixture('approve'), analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
      coverage: rodadas.atual.coverage, alcance: rodadas.atual.alcance,
      payloads: { approve: { event: 'APPROVE', body: 'Li o diff e o comportamento fecha com o card.' } }, reportMarkdown: '# ok',
    }),
    sessionId: '12345678-abcd-1234-abcd-123456789012',
  });
  return e;
}
// a decisão de cada rodada, pelo head que ela leu
const daRodada = (e, pr, head) => [...e.decisions.pending, ...e.decisions.resolved].find((d) => d.key === pr.key && d.headSha === head);
const motivos = (d) => (d.reasons || []).map((r) => (typeof r === 'string' ? r : r.text)).join(' | ');

test('re-revisão: arquivo inalterado com alcance conferido na rodada anterior herda a declaração, com a origem', async () => {
  const pr = { key: 'acme/app#31', repo: 'acme/app', number: 31, url: 'https://github.com/acme/app/pull/31', author: 'dev', requested: true };
  const novo = { path: 'src/novo.ts', sha: 'blob-novo', status: 'added', lines: 3 };
  const rodadas = { atual: {
    head: 'aaaaaaa1', files: [VEREDITO, OUTRO],
    coverage: { total: 2, reviewed: [VEREDITO.path, OUTRO.path], missing: [] },
    alcance: [DECLARACAO],
  } };
  noHead = { 'src/rota.ts': CHAMADOR };
  const e = motor(pr, rodadas);
  await e.runHeadlessReview({ ...pr });
  const primeira = daRodada(e, pr, 'aaaaaaa1');
  assert.match(motivos(primeira), /src\/outro\.ts: uso fora do diff não declarado/, 'a primeira rodada não declarou o outro');

  // commit novo: só src/novo.ts entra; os dois de antes ficam com o mesmo blob, e a sessão
  // lê e declara só o que mudou
  rodadas.atual = {
    head: 'bbbbbbb2', files: [VEREDITO, OUTRO, novo],
    coverage: { total: 3, reviewed: [novo.path], missing: [VEREDITO.path, OUTRO.path] },
    alcance: [{ alterado: novo.path, semChamador: 'arquivo novo, ainda sem nenhum uso no repositório' }],
  };
  lidos = [];
  await e.runHeadlessReview({ ...pr });
  const segunda = daRodada(e, pr, 'bbbbbbb2');
  assert.doesNotMatch(motivos(segunda), /src\/veredito\.ts/, 'o alcance conferido do inalterado foi herdado');
  assert.match(motivos(segunda), /src\/outro\.ts: uso fora do diff não declarado/,
    'sem declaração conferida antes, o inalterado continua pendência: nada é dispensado sem prova');
  assert.equal(segunda.provas.alcance.herdados, 1, 'a origem da herança fica registrada nas provas');
  assert.ok(lidos.some((l) => l.arquivo === 'src/rota.ts' && l.ref === 'bbbbbbb2'), 'o chamador herdado é conferido de novo no head atual');
  const prova = fileProof.readFileProof(pr.key);
  assert.equal(prova.alcance['src/veredito.ts'].origem.head, 'aaaaaaa1', 'a prova guarda de que rodada veio a declaração');
  assert.equal(prova.alcance['src/outro.ts'], undefined);
});

test('re-revisão: o chamador herdado que deixou de citar o símbolo no head atual volta a ser pendência', async () => {
  const pr = { key: 'acme/app#32', repo: 'acme/app', number: 32, url: 'https://github.com/acme/app/pull/32', author: 'dev', requested: true };
  const rodadas = { atual: {
    head: 'ccccccc1', files: [VEREDITO],
    coverage: { total: 1, reviewed: [VEREDITO.path], missing: [] }, alcance: [DECLARACAO],
  } };
  noHead = { 'src/rota.ts': CHAMADOR };
  const e = motor(pr, rodadas);
  await e.runHeadlessReview({ ...pr });
  assert.doesNotMatch(motivos(daRodada(e, pr, 'ccccccc1')), /cobertura da leitura/);

  rodadas.atual = { head: 'ddddddd2', files: [VEREDITO], coverage: { total: 1, reviewed: [], missing: [VEREDITO.path] }, alcance: [] };
  noHead = { 'src/rota.ts': 'export function rota() {\n  return 1;\n}\n' };
  await e.runHeadlessReview({ ...pr });
  assert.match(motivos(daRodada(e, pr, 'ddddddd2')), /src\/rota\.ts:4 não cita montar no head/);
});

/* ---------- as peças puras ---------- */

test('a prova só guarda alcance conferido: chamador que confere no head ou motivo de não haver uso', () => {
  const result = {
    diffMedido: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
    coverage: { reviewed: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'] },
    alcance: [
      { alterado: 'src/a.ts', chamadores: [{ arquivo: 'src/x.ts', linha: 2, simbolo: 'a' }] },
      { alterado: 'src/b.ts', chamadores: [{ arquivo: 'src/y.ts', linha: 9, simbolo: 'b' }] },
      { alterado: 'src/c.ts', semChamador: 'rota nova, registrada só pelo roteador do framework' },
      { alterado: 'src/d.ts', semChamador: 'curto' },
    ],
    alcanceVerificado: [
      { arquivo: 'src/x.ts', linha: 2, simbolo: 'a', ok: true, motivo: '' },
      { arquivo: 'src/y.ts', linha: 9, simbolo: 'b', ok: false, motivo: 'não cita b no head' },
    ],
    sessionId: 's1',
  };
  const arquivos = result.diffMedido.map((p) => ({ path: p, sha: `blob-${p}`, status: 'modified' }));
  fileProof.salvarProvaDaSessao({ key: 'acme/app#40' }, 'h1', arquivos, result);
  const prova = fileProof.readFileProof('acme/app#40');
  assert.deepEqual(Object.keys(prova.alcance).sort(), ['src/a.ts', 'src/c.ts']);
  assert.equal(prova.alcance['src/a.ts'].sha, 'blob-src/a.ts');
  assert.deepEqual(prova.alcance['src/c.ts'].origem, { head: 'h1', sessionId: 's1' });
});

test('declaração atual sem uso fora do diff e sem motivo cede para a conferida antes; a com chamador fica', () => {
  const herdada = { sha: 'blob-a', entrada: { alterado: 'src/a.ts', chamadores: [], semChamador: 'só o worker agendado importa este módulo' }, origem: { head: 'h1', sessionId: 's1' } };
  const herdadaB = { sha: 'blob-b', entrada: { alterado: 'src/b.ts', chamadores: [], semChamador: 'nenhum import fora do próprio módulo' }, origem: { head: 'h1', sessionId: 's1' } };
  const result = {
    coverage: { total: 3, reviewed: ['src/a.ts', 'src/b.ts', 'src/c.ts'], missing: [] },
    alcance: [
      { alterado: 'src/a.ts', chamadores: [{ arquivo: 'src/c.ts', linha: 1, simbolo: 'a' }] },
      { alterado: 'src/b.ts', chamadores: [{ arquivo: 'src/z.ts', linha: 3, simbolo: 'b' }] },
      { alterado: 'src/c.ts', semChamador: 'arquivo de entrada da aplicação, sem importador' },
    ],
  };
  const arquivos = [{ path: 'src/a.ts', sha: 'blob-a' }, { path: 'src/b.ts', sha: 'blob-b' }, { path: 'src/c.ts', sha: 'blob-c' }];
  const heranca = { ativa: true, unchanged: ['src/a.ts', 'src/b.ts'], changed: ['src/c.ts'], alcance: { 'src/a.ts': herdada, 'src/b.ts': herdadaB } };
  fileProof.prepararCoberturaParaOGate(result, arquivos, heranca);
  assert.deepEqual(result.alcanceHerdado, ['src/a.ts'], 'só o que pendia herda; quem declarou chamador fora do diff fica com a declaração nova');
  assert.equal(result.alcance.find((x) => x.alterado === 'src/a.ts').semChamador, herdada.entrada.semChamador);
  assert.equal(result.alcance.find((x) => x.alterado === 'src/b.ts').chamadores[0].arquivo, 'src/z.ts');
  assert.deepEqual(alcanceGap(result), ['o uso fora do diff declarado não foi conferido no head']);
});

test('sem blob idêntico, sem prova ou com a medição falhando, nada é herdado', () => {
  const registro = { sha: 'blob-a', entrada: { alterado: 'src/a.ts', semChamador: 'só o worker agendado importa este módulo' }, origem: { head: 'h1' } };
  const base = () => ({ coverage: { total: 1, reviewed: ['src/a.ts'], missing: [] }, alcance: [], alcanceHerdado: ['src/a.ts'] });
  const heranca = { ativa: true, unchanged: ['src/a.ts'], changed: [], alcance: { 'src/a.ts': registro } };
  const mudou = base();
  fileProof.prepararCoberturaParaOGate(mudou, [{ path: 'src/a.ts', sha: 'blob-a2' }], heranca);
  assert.equal(mudou.alcanceHerdado, undefined, 'blob diferente não herda, e a marca vinda do modelo some');
  const semMedicao = base();
  fileProof.prepararCoberturaParaOGate(semMedicao, null, heranca);
  assert.equal(semMedicao.alcanceHerdado, undefined);
  const foraDaHeranca = base();
  fileProof.prepararCoberturaParaOGate(foraDaHeranca, [{ path: 'src/a.ts', sha: 'blob-a' }], { ...heranca, unchanged: [] });
  assert.equal(foraDaHeranca.alcanceHerdado, undefined, 'arquivo que voltou a ser lido (alterado ou impactado) não herda');
});

/* ---------- a rodada complementar no mesmo head herda a leitura ---------- */

const H = 'a'.repeat(40);
function fonte() {
  const files = [{ path: 'src/a.js', sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y', patchStatus: 'available' },
    { path: 'test/a.spec.js', sha: 'e'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-x\n+y', patchStatus: 'available' }];
  return { status: 'complete', manifest: { H, B: 'b'.repeat(40), M: 'c'.repeat(40), files, limitations: [] },
    inventory: { status: 'complete', headSha: H, baseSha: 'b'.repeat(40), files, changedFiles: files.length }, reader: {},
    release: async () => { } };
}
function engineDaLeitura(pending) {
  return { config: { reviewContextMode: 'off' }, activeReviews: new Map([['s1', { mode: 'auto', cancellable: true }]]),
    running: new Map(), decisions: { pending, resolved: [] }, log() { }, pushState() { },
    killTree() { throw new Error('Não deve encerrar processos nesta fixture.'); } };
}

test('rodada complementar da busca da prova no MESMO head herda a leitura já provada; clique no mesmo head não', async () => {
  const pr = { key: 'org/repo#9', repo: 'org/repo', number: 9 };
  const arquivos = fonte().inventory.files.map(({ path: p, sha, status }) => ({ path: p, sha, status }));
  fileProof.saveFileProof(pr.key, { head: H, at: Date.now(), files: arquivos, reviewed: arquivos.map((f) => f.path) });
  analysis.sourceRuntime.prepareSources = async () => fonte();
  const complementar = await analysis.prepareReviewReading(
    engineDaLeitura([{ key: pr.key, headSha: H, esperaProva: { alvo: H, tentativas: 1 } }]), pr, 's1', H);
  await analysis.releaseAnalysisSource(complementar.prepared, engineDaLeitura([]));
  assert.equal(complementar.inheritance.ativa, true);
  assert.deepEqual(complementar.inheritance.unchanged, ['src/a.js', 'test/a.spec.js']);

  const semEspera = await analysis.prepareReviewReading(engineDaLeitura([]), pr, 's1', H);
  await analysis.releaseAnalysisSource(semEspera.prepared, engineDaLeitura([]));
  assert.equal(semEspera.inheritance.ativa, false, 'revisão no mesmo head fora da busca da prova continua cheia');

  const espera = [{ key: pr.key, headSha: H, esperaProva: { alvo: H, tentativas: 1 } }];
  const clique = await analysis.prepareReviewReading(engineDaLeitura(espera), { ...pr, manual: true }, 's1', H);
  await analysis.releaseAnalysisSource(clique.prepared, engineDaLeitura([]));
  assert.equal(clique.inheritance.ativa, false, 'clique no mesmo head revisa cheio, mesmo com a busca da prova armada');
});

test('o bloco incremental diz de quais inalterados o alcance é herdado e de quais de código falta a declaração', () => {
  const registro = { sha: 'blob-a', entrada: { alterado: 'src/a.ts', semChamador: 'só o worker agendado importa este módulo' } };
  const bloco = fileProof.fileProofBlock({ ativa: true, unchanged: ['src/a.ts', 'src/b.ts', 'docs/x.md'], changed: ['src/c.ts'],
    alcance: { 'src/a.ts': registro } }, 'abcdef1234567890');
  assert.match(bloco, /alcance \(uso fora do diff\) já conferido, herdado pelo app \(1\):\n- src\/a\.ts\n/);
  assert.match(bloco, /SEM alcance conferido; declare o `alcance` deles nesta sessão \(1\):\n- src\/b\.ts\n/);
  assert.doesNotMatch(bloco, /- docs\/x\.md\n$/, 'documentação não exige alcance');
});

/* ---------- a fiação do runHeadlessReview: identidade e mapa do alcance chegam à conferência e à prova ---------- */

function fonteDoHead(head, arquivo, entradas) {
  const manifest = { scope: { host: 'github.com', account: 'eu', repo: 'acme/app', repositoryId: 1 }, H: head, B: 'b'.repeat(40), M: 'c'.repeat(40),
    files: [arquivo], limitations: [] };
  return { status: 'complete', manifest,
    inventory: { status: 'complete', headSha: head, baseSha: manifest.B, files: [arquivo], changedFiles: 1 },
    reader: { async tree() { return { complete: true, commit: head, entries: entradas }; },
      async read() { throw new Error('A identidade do alcance não lê conteúdo.'); } }, release: async () => { } };
}

test('runHeadlessReview grava a identidade do contexto na prova e confere a ausência contra o mapa do head', async () => {
  const head = 'f'.repeat(40);
  const arquivo = { path: 'src/preco.js', sha: '1'.repeat(40), status: 'modified', lines: 2, patchStatus: 'available', patch: '@@ -1 +1 @@\n-a\n+b' };
  const entradas = [{ path: arquivo.path, blob: arquivo.sha, mode: '100644', type: 'blob' }, { path: 'src/loja.js', blob: '2'.repeat(40), mode: '100644', type: 'blob' }];
  analysis.sourceRuntime.prepareSources = async () => fonteDoHead(head, arquivo, entradas);
  let relacoes = [];
  analysis.sourceRuntime.buildMap = async () => ({ complete: true, head: { relations: relacoes, metrics: {} }, previous: { metrics: {} }, limitations: [] });
  const rodadas = { atual: { head, files: [arquivo], coverage: { total: 1, reviewed: [arquivo.path], missing: [] },
    alcance: [{ alterado: arquivo.path, chamadores: [], semChamador: 'módulo ainda sem uso fora dos arquivos deste PR' }] } };

  const livre = { key: 'acme/app#41', repo: 'acme/app', number: 41, url: 'https://github.com/acme/app/pull/41', author: 'dev', requested: true };
  const e = motor(livre, rodadas);
  e.config.reviewNavigationFacts = true;
  await e.runHeadlessReview({ ...livre });
  const guardado = fileProof.readFileProof(livre.key).alcance[arquivo.path];
  assert.equal(typeof guardado?.contextoExterno, 'string', 'sem a identidade na prova, a ausência nunca mais é herdada');
  assert.ok(guardado.contextoExterno.length > 0);

  relacoes = [{ from: 'src/loja.js', to: arquivo.path, line: 3, origin: 'parser', confidence: 'syntax-path' }];
  const contradito = { ...livre, key: 'acme/app#42', number: 42, url: 'https://github.com/acme/app/pull/42' };
  const e2 = motor(contradito, rodadas);
  e2.config.reviewNavigationFacts = true;
  await e2.runHeadlessReview({ ...contradito });
  assert.match(motivos(daRodada(e2, contradito, head)), /src\/loja\.js:3 .*declaração de ausência/, 'o import visto no head chega à conferência');
  assert.equal(fileProof.readFileProof(contradito.key).alcance?.[arquivo.path], undefined, 'a ausência contradita não vira prova herdável');
});
