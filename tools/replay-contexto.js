// Casos congelados para recuperação de evidência, sem provedor ou decisão de IA.
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { buildMap, impactPaths } from '../lib/review-context/map.js';
import { selectContext, contextBlock } from '../lib/review-context/select.js';

const API = 'src/api.js', CONSUMER = 'src/consumer.js', TEST = 'test/consumer.test.js';
const consumer = "import { amount } from './api.js';\nexport const screen = () => amount().toFixed(2);";
const consumerTest = "import { screen } from '../src/consumer.js'; export const run=()=>screen();";
const number = 'export function amount() { return 42; }';
const object = 'export function amount() { return { total: 42 }; }';
const sha = text => crypto.createHash('sha1').update(text).digest('hex');
const blob = text => sha(`blob ${Buffer.byteLength(text)}\0${text}`);
function entriesFor(text) {
  return Object.entries(text).map(([file, code]) => ({ path: file, type: 'blob', blob: blob(code), size: Buffer.byteLength(code) }));
}
function versions(headApi) {
  const previous = { [API]: number, [CONSUMER]: consumer, [TEST]: consumerTest };
  for (let i = 0; i < 80; i++) previous[`unrelated/module-${i}.js`] = `export const unrelated${i}=${i};`;
  return { head: Object.freeze({ ...previous, [API]: headApi }), mergeBase: Object.freeze(previous) };
}
const CASES = Object.freeze([
  Object.freeze({ id: 'outside-diff-regression', label: 'regressão conhecida fora do diff', headApi: object,
    versions: versions(object), consumerAvailable: true, expectedEvidence: 'amount().toFixed(2)', knownDefect: true }),
  Object.freeze({ id: 'compatible-change', label: 'mudança compatível sem defeito conhecido',
    versions: versions('export function amount() { return 43; }'), consumerAvailable: true,
    expectedEvidence: 'amount().toFixed(2)', knownDefect: false }),
  Object.freeze({ id: 'insufficient-context', label: 'contexto insuficiente no head', headApi: object,
    versions: versions(object), consumerAvailable: false, expectedEvidence: null, knownDefect: null }),
]);
function fixtureSource(fixture, ordinal = 1) {
  const H = sha(`farol-replay/${fixture.id}/head`), M = sha(`farol-replay/${fixture.id}/merge-base`);
  const B = sha(`farol-replay/${fixture.id}/base-tip`);
  const metrics = { reads: 0, headReads: 0, previousReads: 0 };
  const contents = side => {
    if (!['head', 'mergeBase'].includes(side)) throw new Error('Este replay só contém H e M; B não foi materializado.');
    return fixture.versions[side];
  };
  const reader = {
    async tree(side) {
      const text = contents(side), incomplete = side === 'head' && !fixture.consumerAvailable;
      return { complete: !incomplete, reason: incomplete ? 'Fixture: árvore parcial e consumidor indisponível.' : '',
        entries: entriesFor(text) };
    },
    async read(file, side) {
      metrics.reads++;
      if (side === 'head') metrics.headReads++; else metrics.previousReads++;
      const commit = side === 'head' ? H : M, text = contents(side)[file];
      if (side === 'head' && file === CONSUMER && !fixture.consumerAvailable) return { status: 'unavailable', path: file, commit, text: null };
      if (typeof text !== 'string') return { status: 'missing', path: file, commit, text: null };
      return { status: 'available', path: file, commit, text, blob: blob(text), size: Buffer.byteLength(text) };
    },
  };
  const manifest = { H, B, M, scope: { host: 'github.com', account: 'fixture', repo: `fixture/${fixture.id}`, repositoryId: ordinal } };
  return { manifest, reader, metrics };
}
async function replayCase(fixture, ordinal) {
  const source = fixtureSource(fixture, ordinal), files = [{ path: API, patch: '@@ -1 +1 @@' }];
  const start = performance.now(), cold = await buildMap(source), coldMs = performance.now() - start;
  const warmStart = performance.now(), warm = await buildMap(source), warmMs = performance.now() - warmStart;
  const selection = await selectContext(source, warm, files, { budgetTokens: 3000 });
  const paths = selection.snippets.map(item => item.path), affected = impactPaths(warm, files).affected;
  const selectedConsumer = selection.snippets.find(item => item.path === CONSUMER);
  const evidenceRecovered = !!selectedConsumer && selectedConsumer.text.includes(fixture.expectedEvidence || '\0');
  const knownContract = { before: fixture.versions.mergeBase[API], after: fixture.versions.head[API] };
  return { id: fixture.id, fixtureLabel: fixture.label, frozenIdentity: { H: source.manifest.H, B: source.manifest.B, M: source.manifest.M },
    gold: { knownDefect: fixture.knownDefect, consumer: CONSUMER, test: TEST, expectedEvidence: fixture.expectedEvidence, contract: knownContract },
    diffOnlyReference: { representsPreviousFarol: false, availablePaths: [API], consumerEvidenceAvailable: false, testEvidenceAvailable: false },
    recovered: { affectedPaths: affected, selectedSnippetPaths: paths, consumerReferenced: selection.references.some(r => r.path === CONSUMER),
      consumerEvidenceAvailable: evidenceRecovered, testEvidenceAvailable: paths.includes(TEST),
      omitted: selection.omitted, mapComplete: warm.complete, limitationCount: selection.limitations.length,
      insufficient: !warm.complete || selection.omitted.length > 0, decisionQualityMeasured: false, modelVerdict: null },
    measurements: { coldMs, warmMs, coldParses: cold.head.metrics.parses + cold.previous.metrics.parses,
      warmParses: warm.head.metrics.parses + warm.previous.metrics.parses, warmParserHits: warm.head.metrics.parserHits + warm.previous.metrics.parserHits,
      fixtureReadCalls: source.metrics.reads, contextBytes: Buffer.byteLength(contextBlock(selection)),
      tokenEstimate: Math.ceil(contextBlock(selection).length / 4), tokenMethod: 'caracteres/4, não tokens faturados' } };
}
async function replayContextCases() {
  const cases = [];
  for (const [index, fixture] of CASES.entries()) cases.push(await replayCase(fixture, index + 1));
  return { schema: 1, method: 'Fontes sintéticas H/M congeladas e diferentes, sem soluções posteriores ou comentários. Controle diff-only só disponibiliza o arquivo alterado; não representa o comportamento completo do Farol anterior.',
    commitIdentifiers: 'Identificadores SHA-1 sintéticos estáveis, não commits de repositórios reais.', cases,
    limitations: ['Mede recuperação de evidências e tamanho de contexto, não acerto do veredito ou severidade de IA.',
      'O caso sem defeito conhecido testa recuperação do contrato compatível; não demonstra aprovação correta por um modelo.',
      'O caso insuficiente exige registrar a limitação; não permite concluir ausência de regressão.',
      'Cache do parser vive em memória: execute o replay em processo novo para repetir a comparação fria, com FAROL_HOME temporário para isolar a persistência.',
      'Não mede uso de GitHub, agentes reais, tokens faturados ou desempenho em produção.'] };
}
export { CASES, fixtureSource, replayContextCases };
