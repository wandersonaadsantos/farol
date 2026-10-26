import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { safeStringify, parseJson } from '../lib/io.js';
import { semAsVariaveis } from '../lib/env.js';
import { qualityFixture } from './helpers/review-quality-fixture.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-review-quality-'));
after(() => fs.rmSync(home, { recursive: true, force: true }));
const cli = path.resolve(import.meta.dirname, '../tools/avaliar-qualidade-review.js');
function execute(fixture) {
  const files = ['corpus', 'baseline', 'candidate'].map(key => {
    const file = path.join(home, key + '.json'); fs.writeFileSync(file, safeStringify(fixture[key])); return file;
  });
  return spawnSync(process.execPath, [cli, ...files], { encoding: 'utf8', timeout: 10000,
    env: { ...semAsVariaveis(['NODE_TEST_CONTEXT']), FAROL_HOME: home } });
}

test('CLI usa códigos distintos para satisfeito, rejeitado e inconclusivo', () => {
  const ok = execute(qualityFixture()); assert.equal(ok.status, 0, ok.stderr);
  assert.equal(parseJson(ok.stdout).status, 'passed');
  const lost = qualityFixture(); lost.candidate.runs[0].assessment.controls[0].status = 'missed';
  const rejected = execute(lost); assert.equal(rejected.status, 1, rejected.stderr);
  assert.equal(parseJson(rejected.stdout).eligibleForPilot, false);
  const partial = qualityFixture(); partial.candidate.runs.pop();
  const unknown = execute(partial); assert.equal(unknown.status, 2, unknown.stderr);
  assert.equal(parseJson(unknown.stdout).status, 'inconclusive');
});

test('entrada incompatível não expõe texto da review nem cria dados do Farol', () => {
  const f = qualityFixture(); f.candidate.runs[0].review = 'TEXTO-PRIVADO-NAO-EXIBIR';
  const result = execute(f);
  assert.equal(result.status, 2);
  assert.ok(!result.stdout.includes('TEXTO-PRIVADO') && !result.stderr.includes('TEXTO-PRIVADO'));
  assert.deepEqual(fs.readdirSync(home).sort(), ['baseline.json', 'candidate.json', 'corpus.json']);
});
