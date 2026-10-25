import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envSemRepositorioHerdado } from '../lib/git-env.js';
const root = path.join(import.meta.dirname, '..');
test('comparação usa engines reais, separa preparo de leitura e comprova reuso em análises distintas', () => {
  for (const flow of ['review', 'self']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-engine-compare-test-'));
    try {
      const report = JSON.parse(execFileSync(process.execPath, [path.join(root, 'tools/comparar-contexto-engine.js'), '--mode', 'assist', '--flow', flow],
        { cwd: root, env: { ...envSemRepositorioHerdado(), FAROL_HOME: home }, encoding: 'utf8', timeout: 30000 }));
      assert.equal(report.first.model.executed, false); assert.equal(report.first.model.boundaryStubCalls, 1);
      assert.equal(report.first.model.decisionQualityMeasured, false);
      assert.equal(report.first.recoveredEvidence.consumerInPrompt, true); assert.equal(report.first.recoveredEvidence.testInPrompt, true);
      assert.equal(report.first.acquisition.modelSearches, 0); assert.equal(report.first.acquisition.modelReads, 0);
      assert.equal(report.first.acquisition.blobAcquisitions, 4);
      assert.equal(report.distinctAnalysis.acquisition.blobAcquisitions, 0);
      assert.equal(report.distinctAnalysis.contextEvidence.headMetrics.parses, 0);
      assert.notEqual(report.first.pr, report.distinctAnalysis.pr);
      assert.equal(report.first.completePreparedInputBytes, report.first.fullPromptBytes + report.first.materializedPatchBytes + report.first.commonInstructionBytes);
      assert.equal(report.distinctAnalysis.contextEvidence.headMetrics.worker, null);
      assert.ok(report.first.contextEvidence.headMetrics.worker.workerHeapAfterBytes > 0);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }
});
