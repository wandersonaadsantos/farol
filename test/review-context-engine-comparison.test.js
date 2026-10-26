import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envSemRepositorioHerdado } from '../lib/git-env.js';
const root = path.join(import.meta.dirname, '..');
test('agendamento chega aos engines reais sem trocar patch ou instruções comuns', () => {
  for (const flow of ['review', 'self']) {
    const reports = [];
    for (const reads of ['off', 'on']) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-engine-compare-reads-'));
      try {
        reports.push(JSON.parse(execFileSync(process.execPath, [path.join(root, 'tools/comparar-contexto-engine.js'), '--flow', flow, '--reads', reads],
          { cwd: root, env: { ...envSemRepositorioHerdado(), FAROL_HOME: home }, encoding: 'utf8', timeout: 30000 })));
      } finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
    assert.equal(reports[0].first.batchedReadInstruction, false);
    assert.equal(reports[1].first.batchedReadInstruction, true);
    assert.equal(reports[1].first.materializedPatchBytes, reports[0].first.materializedPatchBytes);
    assert.equal(reports[1].first.commonInstructionBytes, reports[0].first.commonInstructionBytes);
    assert.equal(reports[1].first.contextEvidence.work.map, false);
    assert.equal(reports[1].first.model.executed, false);
  }
});
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

test('orientação experimental acrescenta referências sem substituir patches ou alegar review de modelo', () => {
  for (const flow of ['review', 'self']) {
    const reports = [];
    for (const navigation of ['off', 'on']) {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-engine-compare-navigation-'));
      try {
        reports.push(JSON.parse(execFileSync(process.execPath, [path.join(root, 'tools/comparar-contexto-engine.js'),
          '--mode', 'off', '--navigation', navigation, '--flow', flow],
        { cwd: root, env: { ...envSemRepositorioHerdado(), FAROL_HOME: home }, encoding: 'utf8', timeout: 30000 })));
      } finally { fs.rmSync(home, { recursive: true, force: true }); }
    }
    const [baseline, candidate] = reports;
    assert.deepEqual(candidate.frozen, baseline.frozen);
    assert.equal(candidate.first.materializedPatchBytes, baseline.first.materializedPatchBytes);
    assert.equal(candidate.first.commonInstructionBytes, baseline.first.commonInstructionBytes);
    assert.ok(candidate.first.fullPromptBytes > baseline.first.fullPromptBytes);
    assert.equal(baseline.first.contextEvidence.work.map, false);
    assert.equal(candidate.first.contextEvidence.navigation.status, 'bounded');
    assert.ok(candidate.first.contextEvidence.navigation.symbols > 0);
    assert.ok(candidate.first.contextEvidence.navigation.relations > 0);
    assert.equal(candidate.first.contextEvidence.navigation.readingProof, false);
    assert.equal(candidate.first.recoveredEvidence.consumerInPrompt, false, 'referência não substitui conteúdo do consumidor');
    assert.equal(candidate.first.model.executed, false);
    assert.equal(candidate.first.acquisition.modelReads, 0);
  }
});
