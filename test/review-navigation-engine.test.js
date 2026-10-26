import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-navigation-engine-'));
process.env.FAROL_HOME = home;
const analysis = await import('../lib/engine/analysis-source.js');
const { buildMap } = await import('../lib/review-context/map.js');
const { contextBlock } = await import('../lib/review-context/select.js');
const settings = await import('../lib/settings.js');
const { navigationSource, H } = await import('./helpers/navigation-fixture.js');
const original = { ...analysis.sourceRuntime };
afterEach(() => Object.assign(analysis.sourceRuntime, original));
after(() => fs.rmSync(home, { recursive: true, force: true }));
const pr = { key: 'org/project#1', repo: 'org/project', number: 1 };
function engine(mode = 'off', facts = false, kind = 'auto') {
  return { config: { reviewContextMode: mode, reviewNavigationFacts: facts },
    activeReviews: new Map([['s', { mode: kind, cancellable: true, filesRead: new Set() }]]), log() {} };
}

test('padrão e entradas não booleanas preservam off sem indexação extra', async () => {
  assert.equal(settings.defaults(0).reviewNavigationFacts, false);
  assert.equal(settings.EDITAVEIS.has('reviewNavigationFacts'), false);
  assert.equal(settings.paraGravar(settings.defaults(0)).reviewNavigationFacts, undefined);
  assert.equal(settings.sanear('reviewNavigationFacts', true), true);
  for (const value of [undefined, false, 'true', 1]) {
    assert.equal(settings.sanear('reviewNavigationFacts', value), false);
    const e = engine('off', value), source = navigationSource();
    analysis.sourceRuntime.prepareSources = async () => source;
    analysis.sourceRuntime.buildMap = async () => { throw new Error('Não pode indexar no caminho padrão.'); };
    const result = await analysis.prepareAnalysisSource(e, pr, 's', H);
    assert.equal(result.block, ''); assert.equal(result.diagnostics.work.map, false);
    assert.equal(result.diagnostics.navigation, undefined);
    await analysis.releaseAnalysisSource(result, e);
  }
});

test('opt-in independente acrescenta orientação e mantém patches e herança integralmente', async () => {
  for (const kind of ['auto', 'self']) {
    const e = engine('off', true, kind), source = navigationSource();
    analysis.sourceRuntime.prepareSources = async () => source;
    analysis.sourceRuntime.buildMap = buildMap;
    analysis.sourceRuntime.selectContext = async () => { throw new Error('Não selecionar ou cortar trechos neste experimento.'); };
    const result = await analysis.prepareAnalysisSource(e, pr, 's', H);
    assert.match(result.block, /Orientação sintática adicional/);
    assert.equal(result.diagnostics.work.selection, false); assert.equal(result.selection, null);
    const inherited = { ativa: true, unchanged: ['src/page.js'], changed: ['src/api.js'] };
    assert.equal(analysis.inheritanceForContext(inherited, result), inherited);
    const scope = analysis.preparedPatchScope(e, pr, 's', result);
    assert.equal(fs.readFileSync(path.join(scope.root, 'src/api.js'), 'utf8').includes(source.manifest.files[0].patch), true);
    assert.equal(e.activeReviews.get('s').totalArquivos, 1);
    assert.equal(e.activeReviews.get('s').filesRead.size, 0, 'metadados não concedem leitura ao modelo');
    assert.equal(result.diagnostics.navigation.readingProof, false);
    await analysis.releaseAnalysisSource(result, e); assert.equal(source.releases(), 1);
  }
});

test('cancelamento durante a indexação experimental propaga falha e libera a fonte', async () => {
  const e = engine('off', true), source = navigationSource(); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  analysis.sourceRuntime.prepareSources = async () => source;
  analysis.sourceRuntime.buildMap = (_source, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Mapeamento cancelado.')), { once: true }); entered();
  });
  const preparing = analysis.prepareAnalysisSource(e, pr, 's', H); await started;
  e.activeReviews.get('s').sourceAbort.abort();
  await assert.rejects(preparing, /cancelado/); assert.equal(source.releases(), 1);
});

test('fontes incompletas não ganham metadados favoráveis nem iniciam mapa adicional', async () => {
  const e = engine('off', true), source = navigationSource(); source.status = 'unavailable';
  analysis.sourceRuntime.prepareSources = async () => source;
  analysis.sourceRuntime.buildMap = async () => { throw new Error('Não deve construir mapa.'); };
  const result = await analysis.prepareAnalysisSource(e, pr, 's', H);
  assert.equal(result.block, ''); assert.equal(result.map, null); assert.equal(result.diagnostics.work.map, false);
  await analysis.releaseAnalysisSource(result, e);
});

test('metadados adicionais não consomem o orçamento nem removem o contexto assist existente', async () => {
  const e = engine('assist', true), source = navigationSource();
  analysis.sourceRuntime.prepareSources = async () => source;
  const result = await analysis.prepareAnalysisSource(e, pr, 's', H);
  const previous = contextBlock(result.selection);
  assert.ok(result.block.startsWith(previous));
  assert.ok(result.block.length > previous.length);
  assert.equal(result.diagnostics.selection.promptTokenEstimate, Math.ceil(previous.length / 4));
  await analysis.releaseAnalysisSource(result, e);
});

test('falha na orientação preserva o bloco assist existente e registra indisponibilidade', async () => {
  const e = engine('assist', true), source = navigationSource(), warnings = [];
  e.log = (_level, message) => warnings.push(message);
  analysis.sourceRuntime.prepareSources = async () => source;
  analysis.sourceRuntime.buildMap = async (...args) => ({ ...await buildMap(...args), identityKey: 'wrong' });
  const result = await analysis.prepareAnalysisSource(e, pr, 's', H);
  assert.equal(result.block, contextBlock(result.selection));
  assert.equal(result.diagnostics.navigation.status, 'unavailable');
  assert.equal(result.diagnostics.work.injection, true); assert.ok(warnings.length);
  await analysis.releaseAnalysisSource(result, e);
});
