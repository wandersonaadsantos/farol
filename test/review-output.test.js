import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-output-'));
const { Engine } = await import('../server.js');
const { expandReviewOutput, singleReviewPrompt } = await import('../lib/engine/review-output.js');
const { payloadDoPrProprio } = await import('../lib/engine/desfecho-automatico.js');
after(() => fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }));
const comment = { path: 'src/a.js', line: 3, side: 'RIGHT', body: 'Preserve a validação.' };
const result = (verdict = 'request_changes') => ({ reviewOutputVersion: 1, verdict, analysisStatus: 'complete',
  decision: 'needs_decision', reportMarkdown: 'Diagnóstico interno.', findings: [{ title: 'Contrato', severity: 'blocking' }],
  review: { event: 'REQUEST_CHANGES', body: 'A validação permite acesso indevido.', comments: [comment] } });

test('expande só a ação escolhida sem perder achados, evidência, ressalvas ou texto público', () => {
  const raw = { ...result(), paraQuemMergeia: ['Confirme o escopo com produto.'] };
  const e = new Engine();
  const parsed = e.parseHeadlessResult(JSON.stringify(raw));
  assert.deepEqual(Object.keys(parsed.payloads), ['request_changes']);
  assert.equal(parsed.reviewMarkdown, raw.review.body);
  assert.deepEqual(parsed.payloads.request_changes.comments, [comment]);
  assert.deepEqual(parsed.findings, raw.findings);
  assert.deepEqual(parsed.paraQuemMergeia, raw.paraQuemMergeia);
  assert.equal(raw.payloads, undefined, 'não altera o envelope recebido');
});

test('não fabrica aprovação manual de uma revisão negativa e preserva PR próprio como comentário', async () => {
  const e = new Engine();
  const parsed = e.parseHeadlessResult(JSON.stringify(result()));
  e.decisions.pending = [{ ...parsed, id: 'decision-1' }];
  const response = await e.decide('decision-1', 'approve');
  assert.equal(response.ok, false);
  assert.match(response.error, /não disponível/);
  const own = payloadDoPrProprio(parsed);
  assert.equal(own.event, 'COMMENT');
  assert.equal(own.body, parsed.reviewMarkdown);
  assert.deepEqual(own.comments, [comment]);
});

test('APPROVE mantém o aviso para quem decide o merge e passa pelo parser real', () => {
  const raw = result('approve');
  raw.review.event = 'APPROVE';
  raw.paraQuemMergeia = ['Confirme a janela de implantação.'];
  const parsed = new Engine().parseHeadlessResult(JSON.stringify(raw));
  assert.match(parsed.payloads.approve.body, /Confirme a janela/);
  assert.equal(parsed.payloads.request_changes, undefined);
});

test('recusa versão desconhecida, evento conflitante e contratos misturados', () => {
  for (const raw of [{ ...result(), reviewOutputVersion: 2 }, { ...result(), verdict: 'approve' },
    { ...result(), payloads: {} }, { ...result(), payloads: null }, { ...result(), reviewMarkdown: '' }]) {
    assert.throws(() => expandReviewOutput(raw), /Contrato/);
  }
});

test('contrato legado continua disponível e resultado incompleto não vira completo', () => {
  const legacy = { ...result(), payloads: {} };
  delete legacy.reviewOutputVersion;
  assert.equal(expandReviewOutput(legacy), legacy);
  const incomplete = expandReviewOutput({ ...result(), analysisStatus: 'incomplete' });
  assert.equal(incomplete.analysisStatus, 'incomplete');
  assert.equal(incomplete.decision, 'needs_decision');
});

test('opt-in altera só o contrato de saída e ausência ou string true mantém prompt anterior', () => {
  const e = new Engine();
  const url = 'https://github.com/o/r/pull/1';
  const old = e.headlessPromptFor(url, 'autor');
  assert.equal(e.config.reviewSingleOutput, false);
  e.updateSettings({ reviewSingleOutput: 'true' });
  assert.equal(e.headlessPromptFor(url, 'autor'), old);
  e.updateSettings({ reviewSingleOutput: true });
  assert.equal(e.config.reviewSingleOutput, false, 'API comum não ativa experimento oculto');
  e.config.reviewSingleOutput = true;
  const next = e.headlessPromptFor(url, 'autor');
  assert.ok(next.length < old.length + 1500);
  assert.equal(/"payloads":\s*\{/.test(next), false);
  assert.match(next, /"reviewOutputVersion": 1/);
  assert.match(next, /Não reduza o raciocínio nem a leitura/);
  assert.match(next, /FAROL_CHECKPOINT/);
  assert.match(next, /"coverage":/);
  assert.equal(singleReviewPrompt(old, false), old);
  assert.throws(() => singleReviewPrompt('template desconhecido', true), /incompatível/);
  const custom = old.replace('  "memory":', '  "customRequirement": "não pode desaparecer",\n  "memory":');
  assert.throws(() => singleReviewPrompt(custom, true), /incompatível/);
});
