import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-review-ownership-'));
process.env.FAROL_HOME = home;
const { planLotes, fanOutBlock } = await import('../lib/engine/fanout.js');
const { ownershipBlock } = await import('../lib/engine/review-ownership.js');
const { headlessPromptFor } = await import('../lib/engine/review-prompt.js');
const settings = await import('../lib/settings.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const files = ['lib/a.js', 'lib/b.js', 'ui/a.js', 'test/a.js'].map(file => ({ path: file, lines: 600 }));
const metrics = { files, changedFiles: files.length, lines: 2400 };
const lots = planLotes(files), enabled = { reviewAgentOwnership: true };

test('responsabilidade experimental mantém o plano e desliga com ausência ou valor não booleano', () => {
  const original = structuredClone(lots), baseline = fanOutBlock(lots, metrics);
  assert.equal(settings.defaults(0).reviewAgentOwnership, false);
  assert.equal(settings.paraGravar(settings.defaults(0)).reviewAgentOwnership, undefined);
  assert.equal(settings.EDITAVEIS.has('reviewAgentOwnership'), false);
  for (const value of [undefined, false, 'true', 1]) {
    assert.equal(ownershipBlock(lots, metrics, { reviewAgentOwnership: value }), '');
    assert.equal(fanOutBlock(lots, metrics, { reviewAgentOwnership: value }), baseline);
  }
  const candidate = fanOutBlock(lots, metrics, enabled);
  assert.ok(candidate.startsWith(baseline));
  const data = JSON.parse(candidate.split('\n').filter(line => line.startsWith('{')).at(-1));
  assert.equal(data.primaryOwners.length, files.length);
  assert.equal(new Set(data.primaryOwners.map(owner => owner.file)).size, files.length);
  assert.equal(data.crossLotOwner, 'coordenador'); assert.equal(data.outsideDiffOwner, 'coordenador');
  assert.equal(data.evidenceGrantsCoverage, false);
  assert.deepEqual(lots, original);
  assert.match(candidate, /assume tarefas de agentes que falharem/);
  assert.match(candidate, /releituras.*continuam obrigatórias/);
});

test('plano ambíguo ou incompatível não permite dispensar leitura', () => {
  const cases = [lots.map(l => ({ ...l, id: 1 })), [...lots, { id: 99, files: [files[0].path] }],
    lots.map((l, i) => i ? l : { ...l, files: ['../escape.js'] })];
  for (const plan of cases) assert.match(ownershipBlock(plan, metrics, enabled), /indisponíveis/);
  assert.match(ownershipBlock(lots, { ...metrics, files: files.slice(1) }, enabled), /indisponíveis/);
  assert.equal(ownershipBlock([lots[0]], metrics, enabled), '');
});

test('prompt headless real propaga o opt-in sem trocar o envelope ou critérios anteriores', () => {
  const engine = { config: {}, prFromUrl: () => null, personProfileBlock: () => '', reviewFormatBlock: () => '' };
  const baseline = headlessPromptFor(engine, 'https://github.com/org/repo/pull/1', 'author', lots, metrics);
  engine.config.reviewAgentOwnership = true;
  const candidate = headlessPromptFor(engine, 'https://github.com/org/repo/pull/1', 'author', lots, metrics);
  assert.ok(candidate.startsWith(baseline));
  assert.match(candidate, /Responsabilidades experimentais por lote/);
});
