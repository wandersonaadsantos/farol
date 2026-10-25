import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { safeStringify } from '../../lib/io.js';
const SELECTORS = ['#resolved', '#queue', '#reviewersEditor', '#myPRs', '#panorama'];
const consumo = marker => ({ usage: { marker } });
const eventoDeAtividade = n => ({ id: 'fixture', item: { t: 1000 + n, k: 'info', s: 'leitura', text: `evento ${n}` } });
async function executarTraco({ win, transport, delay, metrics, revised }) {
  const web = win.webContents;
  const js = source => web.executeJavaScript(source);
  const lerEstado = expression => js(`import('/telas/estado.js').then(m=>${expression})`);
  async function esperar(probe, label) {
    for (let n = 0; n < 200; n++) { if (await probe()) return; await delay(20); }
    throw new Error(`Tempo esgotado: ${label}`);
  }
  const pintar = () => js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const patch = campos => transport.enviar('state-patch', { campos, removidos: [] });
  const click = selector => js(`document.querySelector(${safeStringify(selector)}).click()`);
  async function fase(acao) {
    await js('for(const key of Object.keys(window.__bench.counts))window.__bench.counts[key]=0');
    const metricsBefore = metrics();
    const started = performance.now(); await acao(); await pintar();
    return { writes: await js('({...window.__bench.counts})'), elapsedMs: performance.now() - started,
      rendererMetricsBefore: metricsBefore, rendererMetricsAfter: metrics() };
  }
  await esperar(() => lerEstado('!!m.estado()?.config'), 'estado inicial');
  await pintar();
  await js(`(() => {
    const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
    window.__bench={counts:{},errors:[],visibility:[]};
    addEventListener('error',e=>window.__bench.errors.push(e.message));
    addEventListener('unhandledrejection',e=>window.__bench.errors.push(String(e.reason)));
    document.addEventListener('visibilitychange',()=>window.__bench.visibility.push(document.hidden));
    for(const selector of ${safeStringify(SELECTORS)}){
      const el=document.querySelector(selector);window.__bench.counts[selector]=0;
      Object.defineProperty(el,'innerHTML',{configurable:true,get(){return descriptor.get.call(this)},
        set(value){window.__bench.counts[selector]++;descriptor.set.call(this,value)}});
    }
  })()`);
  await click('#tabbtn-radar'); await click('#rsub-mim'); await pintar();
  const batch = await fase(async () => {
    for (let n = 0; n < 100; n++) patch(consumo(n));
    await esperar(() => lerEstado('m.estado()?.usage?.marker===99'), 'lote');
  });
  const spaced = await fase(async () => {
    for (let n = 0; n < 8; n++) {
      patch(consumo(100 + n));
      await esperar(() => lerEstado(`m.estado()?.usage?.marker===${100 + n}`), 'delta espaçado');
      await delay(120);
    }
  });
  const slowSpaced = await fase(async () => {
    for (let n = 0; n < 3; n++) {
      patch(consumo(120 + n));
      await esperar(() => lerEstado(`m.estado()?.usage?.marker===${120 + n}`), 'delta em um segundo');
      await delay(1000);
    }
  });
  const config = await lerEstado('m.estado().config');
  const myPRs = await lerEstado('m.estado().myPRs');
  const changedPRs = myPRs.map(pr => ({ ...pr, title: 'Contrato alterado em subaba oculta' }));
  const hiddenTab = await fase(async () => {
    patch({ config: { ...config, intervalSeconds: 900 }, myPRs: changedPRs });
    await esperar(() => lerEstado('m.estado()?.config?.intervalSeconds===900'), 'configuração oculta');
  });
  await click('#rsub-meus'); await pintar();
  const hiddenPRCorrect = await js("document.querySelector('#myPRs').textContent.includes('Contrato alterado em subaba oculta')");
  assert.equal(hiddenPRCorrect, true);
  await click('#tabbtn-sistema'); await click('#sysbtn-automation'); await pintar();
  const openingCorrect = await js("document.querySelector('#setInterval').value==='900'");
  assert.equal(openingCorrect, true, safeStringify(await js("({input:document.querySelector('#setInterval').value,tab:document.body.dataset.tab,html:document.querySelector('#setInterval').outerHTML})")));
  await js("document.querySelector('#setInterval').value='600';document.querySelector('#setInterval').focus()");
  const editing = await fase(async () => {
    for (let n = 0; n < 5; n++) {
      const changedConfig = { ...config, intervalSeconds: 900, parallelReviews: n + 2 };
      patch({ config: changedConfig });
      await esperar(() => lerEstado(`m.estado()?.config?.parallelReviews===${n + 2}`), 'estado durante edição');
      await delay(120);
    }
  });
  const focusPreserved = await js("document.activeElement.id==='setInterval'");
  const draftWhileFocused = await js("document.querySelector('#setInterval').value==='600'");
  await js("document.querySelector('#setInterval').blur()"); await pintar();
  const draftAfterBlur = await js("document.querySelector('#setInterval').value==='600'");
  // Aciona os handlers reais. O servidor apenas registra, sem executar qualquer efeito.
  const postsBefore = transport.requests.length;
  await js("document.querySelector('#setInterval').value='600';document.querySelector('#setInterval').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#btnCheck').click()");
  await esperar(() => transport.requests.slice(postsBefore).filter(r => r.method === 'POST').length === 2, 'ações HTTP');
  const actions = transport.requests.slice(postsBefore).filter(r => r.method === 'POST');
  assert.deepEqual(actions.map(r => ({ path: r.path, body: r.body })), [
    { path: '/api/settings', body: { intervalSeconds: 600 } }, { path: '/api/check', body: {} }]);
  await click('#tabbtn-radar'); await click('#rsub-mim'); await pintar();
  web.setBackgroundThrottling(true); win.hide();
  await esperar(() => js('document.hidden'), 'janela oculta nativa');
  await js('for(const key of Object.keys(window.__bench.counts))window.__bench.counts[key]=0');
  for (let n = 0; n < 8; n++) { patch({ usage: { marker: 200 + n } }); await delay(120); }
  await esperar(() => lerEstado('m.estado()?.usage?.marker===207'), 'estado da janela oculta');
  const hiddenWindow = await js('({...window.__bench.counts})');
  patch({ nextCheckAt: Date.now() - 5000 });
  await esperar(() => lerEstado('m.estado()?.nextCheckAt<Date.now()'), 'relógio atualizado oculto');
  win.showInactive(); web.setBackgroundThrottling(false);
  await esperar(() => js('!document.hidden'), 'retorno à janela'); await pintar();
  const clockCurrent = await js("document.querySelector('#metaCheck').textContent.includes('próxima em 0:00')");
  const returned = await lerEstado('m.estado()?.usage?.marker===207'); assert.equal(returned, true);
  const activity = await fase(async () => {
    for (let n = 0; n < 1500; n++) transport.enviar('activity', eventoDeAtividade(n));
    await esperar(() => lerEstado("m.estado()?.activity?.fixture?.at(-1)?.text==='evento 1499'"), 'atividade');
  });
  const retainedActivity = await lerEstado('m.estado().activity.fixture.length');
  const finalState = await lerEstado(`({status:m.estado().status, usage:m.estado().usage.marker,
    interval:m.estado().config.intervalSeconds, parallel:m.estado().config.parallelReviews,
    queue:m.estado().queue.length, resolved:m.estado().decisions.resolved.length,
    myPR:m.estado().myPRs[0].title, lastActivity:m.estado().activity.fixture.at(-1).text})`);
  const errors = await js('window.__bench.errors'); assert.deepEqual(errors, []);
  if (revised) {
    assert.equal(spaced.writes['#resolved'], 0); assert.equal(spaced.writes['#reviewersEditor'], 0);
    assert.equal(spaced.writes['#myPRs'], 0); assert.equal(hiddenTab.writes['#reviewersEditor'], 0);
    assert.deepEqual(hiddenWindow, Object.fromEntries(SELECTORS.map(s => [s, 0])));
    assert.equal(focusPreserved, true); assert.equal(draftWhileFocused, true); assert.equal(draftAfterBlur, true);
    assert.equal(retainedActivity, 300); assert.equal(clockCurrent, true);
  }
  return { batch, spaced, slowSpaced, hiddenTab, editing, hiddenWindow, activity, retainedActivity,
    finalState, checks: { openingCorrect, hiddenPRCorrect, focusPreserved, draftWhileFocused, draftAfterBlur, returned, clockCurrent, actions },
    visibilityEvents: await js('window.__bench.visibility'), pageErrors: errors };
}
export { executarTraco };

