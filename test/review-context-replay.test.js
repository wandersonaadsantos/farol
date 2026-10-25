import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CASES, fixtureSource, replayContextCases } from '../tools/replay-contexto.js';

test('fixtures congelam H/M distintos e não misturam a ponta B com a comparação', async () => {
  for (const [index, fixture] of CASES.entries()) {
    const source = fixtureSource(fixture, index + 1);
    assert.notEqual(source.manifest.H, source.manifest.M);
    assert.notEqual(source.manifest.B, source.manifest.M);
    const head = await source.reader.read('src/api.js', 'head'), before = await source.reader.read('src/api.js', 'mergeBase');
    assert.equal(head.commit, source.manifest.H); assert.equal(before.commit, source.manifest.M);
    assert.notEqual(head.text, before.text);
    await assert.rejects(source.reader.tree('base'), /não foi materializado/);
    assert.equal(Object.isFrozen(fixture.versions.head), true);
    assert.equal(Object.isFrozen(fixture.versions.mergeBase), true);
  }
});
test('replay distingue evidência externa, controle sem defeito e fonte insuficiente sem veredito de modelo', async () => {
  const report = await replayContextCases();
  const [regression, compatible, insufficient] = report.cases;
  for (const item of report.cases) {
    assert.equal(item.diffOnlyReference.representsPreviousFarol, false);
    assert.equal(item.diffOnlyReference.consumerEvidenceAvailable, false);
    assert.equal(item.recovered.decisionQualityMeasured, false);
    assert.equal(item.recovered.modelVerdict, null);
    assert.equal(item.measurements.warmParses, 0);
    assert.ok(item.measurements.warmParserHits > 0);
  }
  assert.equal(regression.gold.knownDefect, true);
  assert.equal(regression.recovered.consumerEvidenceAvailable, true);
  assert.equal(regression.recovered.testEvidenceAvailable, true);
  assert.match(regression.gold.contract.before, /return 42/);
  assert.match(regression.gold.contract.after, /return \{ total/);
  assert.equal(compatible.gold.knownDefect, false);
  assert.equal(compatible.recovered.consumerEvidenceAvailable, true);
  assert.match(compatible.gold.contract.after, /return 43/);
  assert.equal(insufficient.gold.knownDefect, null);
  assert.equal(insufficient.recovered.mapComplete, false);
  assert.equal(insufficient.recovered.consumerReferenced, true);
  assert.equal(insufficient.recovered.consumerEvidenceAvailable, false);
  assert.equal(insufficient.recovered.insufficient, true);
  assert.ok(insufficient.recovered.omitted.includes('src/consumer.js'));
});
