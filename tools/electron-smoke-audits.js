import { captureReviewTools } from './electron-smoke-visual.js';
import { captureWindow } from './electron-smoke-capture.js';
// DOM, API, curadoria e armazenamento reais; só GitHub/IA são sintéticos.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import io, { safeStringify } from '../lib/io.js';
import { auditFixture } from '../test/helpers/audit-fixture.js';
import { auditResponse } from '../test/helpers/audit-response.js';
import { running } from '../lib/review-audit/runner.js';

async function checkReviewAudits(main, waitFor, output) {
  const e = main.engine, previousRun = io.run, previousStream = e.runClaudeStream;
  const fixture = auditFixture(e), prompts = [];
  e.config.auditSampling = { enabled: false, accounts: [], dailyLimit: 0, budgetUsd: 0, reserveUsd: 0 };
  io.run = fixture.run;
  e.runClaudeStream = async (prompt, opts) => {
    assert.equal(opts.somenteLeitura, true); assert.equal(opts.reviewCap, undefined);
    prompts.push(prompt);
    e.recordUsage(opts.id, 'dev', { total_cost_usd: 0.12, usage: { input_tokens: 10, output_tokens: 20 } }, 'fixture', '', 'Auditoria sintética');
    return { text: safeStringify(auditResponse(prompt)), sessionId: `synthetic-${prompts.length}` };
  };
  try {
    await main.win.webContents.executeJavaScript(`(() => { document.querySelector('#tabbtn-sistema').click(); document.querySelector('#sysbtn-reviewers').click(); document.querySelector('#auditLoad').click(); })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#auditCandidate').options.length > 0`), 'review elegível na auditoria');
    await main.win.webContents.executeJavaScript(`document.querySelector('#auditStart').click()`);
    await waitFor(() => prompts.length === 2, 'duas fases do auditor executadas');
    await running(e);
    assert.doesNotMatch(prompts[0], /Revisão original aprovada|Valor mutável/);
    await main.win.webContents.executeJavaScript(`document.querySelector('#auditLoad').click()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#auditJobs').textContent.includes('Concluída') && !!document.querySelector('[data-audit-assess]')`), 'relatório com custo e avaliação humana');
    await main.win.webContents.executeJavaScript(`document.querySelector('#auditJobs > details > summary').click()`);
    const cost = await main.win.webContents.executeJavaScript(`document.querySelector('#auditJobs').textContent`); assert.match(cost, /0\.2400/);
    await main.win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-audit-assess][data-verdict="agree"]');
      document.getElementById('audit-note-' + button.dataset.auditAssess + '-' + button.dataset.item).value = 'Conferi o trecho e concordo com a auditoria sintética.';
      button.click();
    })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#auditMetrics').textContent.includes('100.0%')`), 'comparação humana persistida');
    await main.win.webContents.executeJavaScript(`document.querySelector('#auditMetrics summary').click()`);
    await main.win.webContents.executeJavaScript(`(() => {
      for (const [id,value] of [['specialistAccount','dev'],['specialistRepo',${safeStringify(fixture.decision.pr.repo)}],['specialistBranch','main']]) {
        const el=document.getElementById(id); el.value=value; el.dispatchEvent(new Event('input',{bubbles:true}));
      }
      document.querySelector('#specialistLoad').click();
    })()`);
    await waitFor(() => main.win.webContents.executeJavaScript(`!!document.querySelector('[data-specialist-proposal]')`), 'auditoria validada gerar proposta sem ativar lição');
    await main.win.webContents.executeJavaScript(`new Promise(resolve => {
      document.querySelector('#auditManager').scrollIntoView({block:'start',behavior:'instant'});
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`);
    const visible = await main.win.webContents.executeJavaScript(`document.querySelector('#auditManager').getBoundingClientRect().top < innerHeight`);
    assert.equal(visible, true, 'formulário da auditoria visível na captura');
    const image = await captureWindow(main.win, 'audits'); fs.writeFileSync(path.join(output, 'review-audits.png'), image.toPNG());
    await captureReviewTools(main, output, 'audits', '#auditManager');
    return { status: 'passed', boundaries: 'GitHub and AI synthetic; real DOM, HTTP, store and usage ledger',
      twoFreshSessions: true, blindFirst: true, humanAssessment: true, lessonProposalOnly: true, costUsd: 0.24, automaticDefault: false };
  } finally { io.run = previousRun; e.runClaudeStream = previousStream; }
}
export { checkReviewAudits };
