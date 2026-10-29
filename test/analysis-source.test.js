import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-analysis-source-'));
process.env.FAROL_HOME = home;
const analysis = await import('../lib/engine/analysis-source.js');
const { cancelSession } = await import('../lib/engine/cancelamento-revisao.js');
const original = { ...analysis.sourceRuntime };
afterEach(() => Object.assign(analysis.sourceRuntime, original));
after(() => fs.rmSync(home, { recursive: true, force: true }));
const H = 'a'.repeat(40), B = 'b'.repeat(40), M = 'c'.repeat(40);
const pr = { key: 'org/repo#1', repo: 'org/repo', number: 1 };
function engine(mode = 'auto', contextMode = 'off') {
  return { config: { reviewContextMode: contextMode }, activeReviews: new Map([['s1', { mode, cancellable: true }]]),
    running: new Map(), log() {}, pushState() {}, killTree() { throw new Error('Não deve encerrar processos nesta fixture.'); } };
}
function source() {
  const files = [{ path: 'src/a.js', sha: 'd'.repeat(40), status: 'modified', patch: '@@ -1 +1 @@\n-old\n+new', patchStatus: 'available' },
    { path: 'src/b.bin', sha: 'e'.repeat(40), status: 'added', patch: '', patchStatus: 'unavailable' }];
  let releases = 0;
  return { status: 'complete', manifest: { H, B, M, files, limitations: [{ path: 'src/b.bin', reason: 'Patch indisponível.' }] },
    inventory: { status: 'complete', headSha: H, baseSha: B, files, changedFiles: files.length }, reader: {},
    release: async () => { releases++; }, releases: () => releases };
}
const map = () => ({ complete: true, head: { metrics: { files: 2 } }, previous: { metrics: { files: 2 } } });
const selection = () => ({ schema: 1, snippets: [], references: [], omitted: [], limitations: [], impactedPaths: ['src/caller.js'],
  metrics: { budgetTokens: 1000, tokenEstimate: 50 } });

test('review e autoanálise adquirem as mesmas fontes sem exigir perfil técnico ou clone pessoal', async () => {
  const calls = [], handles = [];
  analysis.sourceRuntime.prepareSources = async (_engine, target, options) => {
    calls.push({ target, head: options.expectedHead, signal: options.signal }); const handle = source(); handles.push(handle); return handle;
  };
  analysis.sourceRuntime.buildMap = async () => { throw new Error('Modo off não executa parser.'); };
  const reviewEngine = engine(), selfEngine = engine('self');
  const review = await analysis.prepareAnalysisSource(reviewEngine, pr, 's1', H);
  const self = await analysis.prepareAnalysisSource(selfEngine, pr, 's1', H);
  assert.deepEqual(review.source.manifest, self.source.manifest);
  assert.equal(calls.length, 2); assert.equal(calls[0].head, H); assert.equal(calls[1].head, H);
  assert.notEqual(calls[0].signal, calls[1].signal); assert.equal(review.block, ''); assert.equal(self.block, '');
  const a = analysis.preparedPatchScope(reviewEngine, pr, 's1', review);
  const b = analysis.preparedPatchScope(selfEngine, pr, 's1', self);
  assert.deepEqual(a.total, b.total); assert.notEqual(a.root, b.root);
  assert.equal(fs.readFileSync(path.join(a.root, 'src/a.js'), 'utf8'), fs.readFileSync(path.join(b.root, 'src/a.js'), 'utf8'));
  assert.match(fs.readFileSync(path.join(a.root, 'src/b.bin'), 'utf8'), /sem patch textual/);
  assert.equal(reviewEngine.activeReviews.get('s1').totalArquivos, 2);
  assert.equal(selfEngine.activeReviews.get('s1').scopeRoot, b.root);
  const block = analysis.preparedPatchBlock(review, a);
  for (const sha of [H, B, M]) assert.ok(block.includes(sha));
  assert.match(block, /não comprova leitura/);
  await analysis.releaseAnalysisSource(review, reviewEngine); await analysis.releaseAnalysisSource(self, selfEngine);
  assert.deepEqual(handles.map(h => h.releases()), [1, 1]);
});
test('inventário preparado evita nova aquisição de patches na preparação da review', async () => {
  const handle = source(), e = engine();
  e.fetchPrInventory = async () => { throw new Error('Inventário não deve ser solicitado novamente.'); };
  analysis.sourceRuntime.prepareSources = async () => handle;
  const result = await analysis.prepareReviewReading(e, pr, 's1', H);
  assert.equal(result.inventory, handle.inventory); assert.deepEqual(result.files, handle.manifest.files);
  assert.equal(e.activeReviews.get('s1').fileBlobs['src/a.js'], 'd'.repeat(40));
  await analysis.releaseAnalysisSource(result.prepared, e); assert.equal(handle.releases(), 1);
});

test('projeção restrita não reutiliza índice original nem muda a configuração de contexto', async () => {
  const e = engine('self', 'assist'); e.config.reviewNavigationFacts = true;
  let projection;
  analysis.sourceRuntime.prepareSources = async (_engine, _pr, options) => {
    projection = options.projection; return { ...source(), projection };
  };
  analysis.sourceRuntime.buildMap = async () => { throw new Error('Índice original não pode ser lido nesta execução.'); };
  const result = await analysis.prepareAnalysisSource(e, { ...pr, isolation: 'restricted-read' }, 's1', H);
  assert.ok(projection); assert.equal(result.source.projection, projection);
  assert.equal(result.map, null); assert.equal(result.selection, null);
  assert.equal(result.diagnostics.indexStatus, 'restricted-projection-not-indexed');
  assert.equal(e.config.reviewContextMode, 'assist'); assert.equal(e.config.reviewNavigationFacts, true);
  await analysis.releaseAnalysisSource(result, e);
});

test('cancelamento após aquisição da projeção ainda libera a fonte antes de qualquer retorno', async () => {
  const e = engine('self', 'assist'), handle = source(); let complete;
  analysis.sourceRuntime.prepareSources = () => new Promise(resolve => { complete = resolve; });
  const preparing = analysis.prepareAnalysisSource(e, { ...pr, isolation: 'restricted-read' }, 's1', H);
  assert.equal(cancelSession(e, 's1').ok, true); complete(handle);
  await assert.rejects(preparing, error => error.cancelled === true);
  assert.equal(handle.releases(), 1);
});
test('cancelar durante aquisição aborta a operação e libera fonte recém-adquirida', async () => {
  const e = engine(), handle = source(); let complete, signal;
  analysis.sourceRuntime.prepareSources = (_engine, _pr, options) => { signal = options.signal; return new Promise(resolve => { complete = resolve; }); };
  const preparing = analysis.prepareAnalysisSource(e, pr, 's1', H);
  assert.deepEqual(cancelSession(e, 's1'), { ok: true }); assert.equal(signal.aborted, true);
  complete(handle);
  await assert.rejects(preparing, error => error.cancelled === true); assert.equal(handle.releases(), 1);
});
test('cancelar durante construção do mapa libera a fonte sem retornar análise parcial', async () => {
  const e = engine('self', 'assist'), handle = source(); let started;
  const entered = new Promise(resolve => { started = resolve; });
  analysis.sourceRuntime.prepareSources = async () => handle;
  analysis.sourceRuntime.buildMap = (_source, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('Mapa cancelado.')), { once: true }); started();
  });
  const preparing = analysis.prepareAnalysisSource(e, pr, 's1', H); await entered;
  cancelSession(e, 's1'); await assert.rejects(preparing, /cancelado/); assert.equal(handle.releases(), 1);
});
test('falha do mapa degrada explicitamente e só libera fonte após finalizar o fluxo', async () => {
  const e = engine('auto', 'assist'), handle = source();
  analysis.sourceRuntime.prepareSources = async () => handle;
  analysis.sourceRuntime.buildMap = async () => { throw new Error('Mapa corrompido.'); };
  const prepared = await analysis.prepareAnalysisSource(e, pr, 's1', H);
  assert.equal(prepared.diagnostics.indexStatus, 'unavailable'); assert.equal(prepared.block, ''); assert.equal(handle.releases(), 0);
  await analysis.releaseAnalysisSource(prepared, e); assert.equal(handle.releases(), 1);
});
test('falha após formar bloco de contexto não deixa seleção parcial no prompt', async () => {
  const e = engine('auto', 'assist'), handle = source();
  analysis.sourceRuntime.prepareSources = async () => handle;
  analysis.sourceRuntime.buildMap = async () => ({ complete: true });
  analysis.sourceRuntime.selectContext = async () => selection();
  const prepared = await analysis.prepareAnalysisSource(e, pr, 's1', H);
  assert.equal(prepared.diagnostics.indexStatus, 'unavailable');
  assert.equal(prepared.block, ''); assert.equal(prepared.selection, null);
  await analysis.releaseAnalysisSource(prepared, e); assert.equal(handle.releases(), 1);
});
test('modo observação calcula diagnóstico sem injetar seleção no prompt', async () => {
  const handle = source(), e = engine('auto', 'observe');
  analysis.sourceRuntime.prepareSources = async () => handle; analysis.sourceRuntime.buildMap = async () => map();
  analysis.sourceRuntime.selectContext = async () => selection();
  const prepared = await analysis.prepareAnalysisSource(e, pr, 's1', H);
  assert.equal(prepared.block, ''); assert.equal(prepared.diagnostics.indexStatus, 'bounded');
  assert.equal(prepared.diagnostics.selection.tokenEstimate, 50); await analysis.releaseAnalysisSource(prepared, e);
});
test('assist só herda validade dos arquivos não afetados por relações novas ou antigas', () => {
  const inherited = { ativa: true, unchanged: ['src/caller.js', 'src/other.js'], changed: ['src/a.js'] };
  const result = analysis.inheritanceForContext(inherited, { mode: 'assist', map: map(), selection: selection() });
  assert.deepEqual(result.unchanged, ['src/other.js']); assert.deepEqual(result.changed, ['src/a.js', 'src/caller.js']);
  assert.deepEqual(result.contextRevisit, ['src/caller.js']); assert.equal(result.ativa, true);
});

test('matriz dos modos mede aquisição, mapa, seleção e injeção sem trabalho exclusivo em off', async () => {
  for (const mode of ['off', 'observe', 'assist']) {
    const calls = [], handle = source(), e = engine('auto', mode);
    analysis.sourceRuntime.prepareSources = async () => { calls.push('sources'); return handle; };
    analysis.sourceRuntime.buildMap = async () => { calls.push('map'); return map(); };
    analysis.sourceRuntime.selectContext = async () => { calls.push('selection'); return selection(); };
    const prepared = await analysis.prepareAnalysisSource(e, pr, 's1', H);
    assert.deepEqual(calls, mode === 'off' ? ['sources'] : ['sources', 'map', 'selection']);
    assert.deepEqual(prepared.diagnostics.work, { sources: true, map: mode !== 'off', selection: mode !== 'off', injection: mode === 'assist' });
    assert.equal(prepared.block.length > 0, mode === 'assist');
    assert.ok(prepared.diagnostics.timings.acquisitionMs >= 0);
    assert.ok(prepared.diagnostics.timings.contextMs >= 0);
    if (mode === 'off') assert.equal(prepared.diagnostics.timings.contextMs, 0);
    const inherited = { ativa: true, unchanged: ['src/caller.js'], changed: [] };
    if (mode !== 'assist') assert.equal(analysis.inheritanceForContext(inherited, prepared), inherited);
    await analysis.releaseAnalysisSource(prepared, e); assert.equal(handle.releases(), 1);
  }
});
test('falha observacional não injeta bloco nem altera herança, e assist informa tentativa sem bloco parcial', async () => {
  for (const mode of ['observe', 'assist']) {
    const e = engine('self', mode), handle = source();
    analysis.sourceRuntime.prepareSources = async () => handle;
    analysis.sourceRuntime.buildMap = async () => map();
    analysis.sourceRuntime.selectContext = async () => { throw new Error('Seleção indisponível na fixture.'); };
    const prepared = await analysis.prepareAnalysisSource(e, pr, 's1', H);
    assert.equal(prepared.block, ''); assert.equal(prepared.selection, null);
    assert.equal(prepared.diagnostics.indexStatus, 'unavailable');
    assert.deepEqual(prepared.diagnostics.work, { sources: true, map: true, selection: true, injection: false });
    const inherited = { ativa: true, unchanged: ['src/caller.js'], changed: [] };
    if (mode === 'observe') assert.equal(analysis.inheritanceForContext(inherited, prepared), inherited);
    else assert.equal(analysis.inheritanceForContext(inherited, prepared).ativa, false);
    await analysis.releaseAnalysisSource(prepared, e);
  }
});
test('assist sem mapa completo exige releitura em vez de presumir análise herdada válida', () => {
  const inherited = { ativa: true, unchanged: ['src/caller.js'], changed: ['src/a.js'] };
  for (const prepared of [{ mode: 'assist', map: null, selection: null }, { mode: 'assist', map: { complete: false }, selection: selection() }]) {
    const result = analysis.inheritanceForContext(inherited, prepared);
    assert.equal(result.ativa, false); assert.deepEqual(result.unchanged, []);
    assert.deepEqual(new Set(result.changed), new Set(['src/a.js', 'src/caller.js']));
  }
});
test('falha ao obter inventário de fallback libera a fonte e mantém o erro original', async () => {
  const e = engine(), handle = source(); handle.status = 'unavailable';
  analysis.sourceRuntime.prepareSources = async () => handle;
  e.fetchPrInventory = async () => { throw new Error('Inventário indisponível.'); };
  await assert.rejects(analysis.prepareReviewReading(e, pr, 's1', H), /Inventário indisponível/);
  assert.equal(handle.releases(), 1);
});
test('falha de liberação é registrada sem expor erro ou impedir limpeza externa', async () => {
  const warnings = [], e = engine(); e.log = (_level, message) => warnings.push(message);
  const prepared = { source: { release: async () => { throw new Error('conteúdo externo não deve vazar'); } }, diagnostics: {} };
  assert.equal(await analysis.releaseAnalysisSource(prepared, e), false);
  assert.equal(prepared.diagnostics.releaseStatus, 'pending'); assert.ok(warnings.length);
  assert.equal(warnings.some(w => w.includes('conteúdo externo')), false);
});
test('falha de liberação registra o código da causa (27/10/2026: o erro engolido escondia a trava órfã)', async () => {
  const warnings = [], e = engine(); e.log = (_level, message) => warnings.push(message);
  const failure = Object.assign(new Error('C:\caminho\interno'), { code: 'EPERM' });
  const prepared = { source: { release: async () => { throw failure; } }, diagnostics: {} };
  assert.equal(await analysis.releaseAnalysisSource(prepared, e), false);
  assert.ok(warnings.some(w => w.includes('EPERM')));
  assert.equal(warnings.some(w => w.includes('caminho')), false);
});
