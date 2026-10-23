import { captureWindow } from './electron-smoke-capture.js';
// DOM, SSE, HTTP e disco reais; PRs, sessões e transporte GitHub sintéticos.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import io, { safeStringify } from '../lib/io.js';
async function checkJourneys(main, waitFor, output) {
  const e = main.engine, web = main.win.webContents;
  const previousRun = io.run;
  io.run = (cmd, args, opts) => cmd === 'gh' ? Promise.resolve({ ok: true, stdout: '[]', stderr: '' }) : previousRun(cmd, args, opts);
  try {
  e.config.theme = 'dark'; e.config.voiceEnabled = false; e.config.quotaReservations = {};
  e.config.accounts = [{ user: 'dev', owners: ['org'], autoReview: false }];
  e.tokens = { dev: 'synthetic-fixture' }; e.status = 'idle'; e.lastCheckAt = Date.now();
  e.queue = [1, 2, 3].map(n => {
    const repo = n === 3 ? 'org/repob' : 'org/repoa';
    return { key: `${repo}#${n}`, repo, number: n, author: 'fixture', title: `Fila sintética ${n}`, url: `https://github.com/org/repo/pull/${n}`, account: 'dev', mine: true };
  });
  e.panorama = []; e.decisions.pending = []; e.decisions.resolved = [];
  const id = 'f-ui-fixture', startedAt = Date.now() - 180000;
  const agents = { a: { label: 'Leitor', desc: 'Conferindo contratos', done: false } };
  e.activeReviews.clear(); e.activeReviews.set(id, { id, label: 'Sessão sintética', mode: 'auto', account: 'dev', startedAt, ultimoSinalEm: Date.now(), fase: 'modelo', keys: [],
    estimativa: { tipicoMs: 360000, amostras: 12, base: 'geral' }, agents });
  e.activity = new Map([[id, [{ t: Date.now(), s: 'verificacao', k: 'info', text: 'Etapa sintética observada' }]]]);
  e.saveConfig(); e.pushState();
  await web.executeJavaScript(`document.querySelector('#tabbtn-radar').click()`);
  await waitFor(() => web.executeJavaScript(`document.querySelectorAll('#queue .queue-card, #queue [data-key]').length > 0`), 'fila sintética visível');
  await web.executeJavaScript(`(() => { const s=document.querySelector('#queueGrouping'); s.value='repo'; s.dispatchEvent(new Event('change')); })()`);
  await waitFor(() => web.executeJavaScript(`document.querySelectorAll('.queue-group').length===2`), 'dois grupos sem perder itens');
  await web.executeJavaScript(`document.querySelector('.queue-group summary').focus()`);
  web.sendInputEvent({ type: 'keyDown', keyCode: 'Space' }); web.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
  await waitFor(() => web.executeJavaScript(`!document.querySelector('.queue-group').open`), 'recolhimento por teclado');
  e.pushState();
  await waitFor(() => web.executeJavaScript(`!document.querySelector('.queue-group').open`), 'recolhimento preservado no SSE');
  await waitFor(() => web.executeJavaScript(`!!document.querySelector('.sess-progress[data-id="${id}"]')`), 'sessão ativa no DOM');
  assert.equal(await web.executeJavaScript(`document.querySelector('.sess-progress[data-id="${id}"]').hasAttribute('aria-valuenow')`), false);
  assert.match(await web.executeJavaScript(`document.querySelector('.session-agent-details').textContent`), /Leitor.*Conferindo contratos/);
  await web.executeJavaScript(`document.querySelector('#tabbtn-sistema').click();document.querySelector('#sysbtn-overview').click();if(!document.querySelector('#setupManager').open)document.querySelector('#setupManager summary').click();document.querySelector('[data-setup-step="plans"]').click()`);
  const document = { type: 'farol-preferences', schema: 1, values: { theme: 'light' } };
  await web.executeJavaScript(`(() => { const d=new DataTransfer();d.items.add(new File([${safeStringify(safeStringify(document))}], 'preferences.json', {type:'application/json'}));const f=window.document.querySelector('#preferencesFile');f.files=d.files;f.dispatchEvent(new Event('change'));window.document.querySelector('#preferencesInspect').click(); })()`);
  await waitFor(() => web.executeJavaScript(`!!document.querySelector('[data-preference-key="theme"]')`), 'prévia sem gravação');
  assert.equal(e.config.theme, 'dark');
  await web.executeJavaScript(`(() => { const c=document.querySelector('[data-preference-key="theme"]');c.click();document.querySelector('#preferencesApply').click(); })()`);
  await waitFor(() => e.config.theme === 'light', 'preferência selecionada persistida');
  assert.equal(e.config.voiceEnabled, false);
  for (const theme of ['light', 'dark']) {
    if (await web.executeJavaScript('document.documentElement.dataset.theme') !== theme) await web.executeJavaScript(`document.querySelector('#btnTheme').click()`);
    await waitFor(() => web.executeJavaScript(`document.documentElement.dataset.theme==='${theme}'`), 'tema efetivo');
    const color = theme === 'light' ? 'rgb(28, 37, 54)' : 'rgb(231, 236, 245)';
    await waitFor(() => web.executeJavaScript(`getComputedStyle(document.body).color==='${color}'`), 'transição do tema concluída');
    await web.executeJavaScript(`new Promise(resolve => { document.querySelector('#setupManager').scrollIntoView({block:'start',behavior:'instant'}); requestAnimationFrame(() => requestAnimationFrame(resolve)); })`);
    fs.writeFileSync(path.join(output, `journeys-${theme}.png`), (await captureWindow(main.win, 'journeys')).toPNG());
  }
  web.reload();
  await waitFor(() => web.executeJavaScript(`!!document.querySelector('[data-setup-step="plans"][aria-pressed="true"]')`).catch(() => false), 'retomada do roteiro após recarga');
  await web.executeJavaScript(`document.querySelector('#tabbtn-radar').click()`);
  await waitFor(() => web.executeJavaScript(`document.querySelectorAll('.queue-group').length===2 && !document.querySelector('.queue-group').open`), 'grupo e recolhimento após recarga');
  e.activeReviews.delete(id); e.pushState();
  return { status: 'passed', boundaries: 'real DOM/SSE/HTTP/configuration; synthetic GitHub transport, PRs and session', keyboardCollapse: true, collapseSurvivesReload: true, noInferredCompletion: true, agentsAccessible: true, setupResumed: true, importPreviewAndSelection: true, themes: ['light', 'dark'], voiceDefault: false };
  } finally { io.run = previousRun; }
}
export { checkJourneys };
