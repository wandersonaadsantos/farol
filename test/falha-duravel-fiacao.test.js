// A falha estacionada precisa continuar explicável depois de Limpar log e depois de o PR
// ser relançado (spec 4.1: "Limpar log apaga a única cópia", "o motivo do estacionamento
// some ao relançar"). Aqui a fiação: quem falha registra, e o card e o Consumo apontam.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-falha-fiacao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { erroDeSessao, anotarFalhaDaSessao } = await import('../lib/engine/falhas.js');
const reviewMod = (await import('../lib/engine/review.js')).default;

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');

function engineDeFila() {
  const e = new Engine();
  e.pushState = () => { };
  e.processHeadless = () => { };
  e.freeHeadlessSlot = () => { };
  e.writeInflight = () => { };
  e.prState = async () => 'OPEN';
  e.budgetBlockedFor = () => null;
  e.accountForPr = () => 'conta';
  return e;
}

function esperar(cond, ms = 3000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cond()) { clearInterval(iv); resolve(); return; }
      if (Date.now() - t0 > ms) { clearInterval(iv); reject(new Error('timeout esperando a condição')); }
    }, 10);
  });
}

test('falha permanente de revisão: registro durável, card aponta a sessão e Limpar log não apaga', async () => {
  const e = engineDeFila();
  const pr = { key: 'o/r#7', url: 'https://github.com/o/r/pull/7', repo: 'o/r', number: 7 };
  const cauda = 'x'.repeat(900) + 'CAUDA-DO-STDERR';
  e.runHeadlessReview = async () => {
    throw Object.assign(erroDeSessao('falha de teste sem classe qwerty: ', cauda), {
      sessaoFarol: 'a-falha-1', sessionId: 'cli-1', resumeOutcome: 'recusada',
      etapas: { totalMs: 10, stages: [{ id: 'leitura', label: 'leitura', ms: 10 }] },
    });
  };
  await e.runOneHeadless(pr, 'conta');
  assert.ok(e.autoReviewParked.has(pr.key), 'falha permanente estaciona');
  assert.equal(e.parkedParaUi()[pr.key].sessionId, 'a-falha-1');
  assert.equal(e.clearLog().ok, true);
  const f = new Engine().falhaDaSessao('a-falha-1');
  assert.ok(f.motivo.endsWith('CAUDA-DO-STDERR'), 'motivo inteiro, sem o corte de 300');
  assert.equal(f.kind, 'review');
  assert.equal(f.ref, pr.key);
  assert.equal(f.cliSessionId, 'cli-1');
  assert.equal(f.resumeOutcome, 'recusada');
  assert.equal(f.etapas.stages[0].id, 'leitura');
  reviewMod.desestacionar(e, pr.key);
  assert.ok(e.falhaDaSessao('a-falha-1'), 'relançar não apaga a falha');
});

test('falha transitória também fica registrada, mesmo sem estacionar', async () => {
  const e = engineDeFila();
  const pr = { key: 'o/r#8', url: 'https://github.com/o/r/pull/8', repo: 'o/r', number: 8 };
  e.runHeadlessReview = async () => { throw anotarFalhaDaSessao(new Error('sessão retornou erro: API Error: 529 Overloaded'), 'a-trans', null); };
  await e.runOneHeadless(pr, 'conta');
  assert.equal(e.autoReviewParked.has(pr.key), false);
  assert.ok(e.falhaDaSessao('a-trans'));
});

test('cancelamento não é falha e não registra', async () => {
  const e = engineDeFila();
  const pr = { key: 'o/r#9', url: 'u', repo: 'o/r', number: 9 };
  e.runHeadlessReview = async () => { throw Object.assign(new Error('cancelada por você'), { cancelled: true, sessaoFarol: 'a-cancel' }); };
  await e.runOneHeadless(pr, 'conta');
  assert.equal(e.falhaDaSessao('a-cancel'), null);
});

test('autoanálise que falha registra com tipo self', async () => {
  const e = engineDeFila();
  e.runSelfAnalysis = async () => { throw anotarFalhaDaSessao(new Error('autoanálise quebrou qwerty'), 's-falha-1', null); };
  await e.runOneHeadless({ key: 'o/r#10', url: 'u', kind: 'self' }, 'conta');
  assert.equal(e.falhaDaSessao('s-falha-1').kind, 'self');
});

test('ferramenta que falha registra com tipo tool e o id da sessão', async () => {
  const e = new Engine();
  e.token = 'tok';
  e.pushState = () => { };
  e.toolPrompt = () => 'prompt';
  let idDaSessao = '';
  e.runClaudeStream = async (prompt, opts) => { idDaSessao = opts.id; throw erroDeSessao('claude saiu com código 1: ', 'k'.repeat(400) + 'CAUDA'); };
  await e.launchTool('health');
  await esperar(() => (e.toolRunGet('health') || {}).status === 'error');
  const f = e.falhaDaSessao(idDaSessao);
  assert.equal(f.kind, 'tool');
  assert.ok(f.motivo.endsWith('CAUDA'));
});

test('o resumo do Consumo liga a linha da sessão à falha', () => {
  const e = new Engine();
  e.recordUsage('a-resumo', 'eu', { usage: { output_tokens: 3 }, total_cost_usd: 0.1, is_error: true }, 'claude-opus-5', '', 'o/r#11');
  e.registrarFalha({ sessionId: 'a-resumo', kind: 'review', motivo: 'quebrou' });
  assert.equal(e.usageSummary().falhasPorSessao['a-resumo'].motivo, 'quebrou');
});

test('as sessões anotam a falha antes do finally apagar o feed', () => {
  const review = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'review.js'), 'utf8');
  const self = fs.readFileSync(path.join(RAIZ, 'lib', 'engine', 'selfpr.js'), 'utf8');
  assert.match(review, /anotarFalhaDaSessao\(err, id, stageSummaryFrom\(/);
  assert.match(self, /anotarFalhaDaSessao\(err, id, stageSummaryFrom\(/);
});
