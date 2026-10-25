// DOM, SSE e janela reais, somente dados sintéticos na instância isolada do smoke.
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeJsonAtomic } from '../lib/io.js';

const stateCheck = expression => `import('/telas/estado.js').then(m => ${expression})`;
const settle = web => web.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');

async function checkPintura(main, waitFor, output) {
  const e = main.engine, win = main.win, web = win.webContents;
  const saved = { activeReviews: e.activeReviews, activity: e.activity, status: e.status };
  const previousSessions = e.usage.totals.sessions, previousParallel = e.config.parallelReviews;
  const throttling = web.getBackgroundThrottling();
  const visible = win.isVisible();
  const report = { status: 'running', boundaries: 'real DOM/SSE/window; synthetic engine data; no real provider or review', checks: {} };
  try {
    // Só a janela de teste. Mantém quadros disponíveis na fase visível mesmo encoberta.
    web.setBackgroundThrottling(false);
    win.showInactive();
    e.status = 'idle';
    e.activeReviews = new Map(); e.activity = new Map(); e.pushState();
    await web.executeJavaScript("document.querySelector('#tabbtn-radar').click();document.querySelector('#rsub-mim').click()");
    await waitFor(() => web.executeJavaScript(stateCheck("m.estado()?.status==='idle'")), 'estado sintético inicial');
    await settle(web);
    await web.executeJavaScript(`(() => {
      const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
      window.__paintProbe={counts:{},elements:[]};
      for(const selector of ['#resolved','#reviewersEditor','#queue','#myPRs']){
        const el=document.querySelector(selector);window.__paintProbe.counts[selector]=0;
        Object.defineProperty(el,'innerHTML',{configurable:true,get(){return descriptor.get.call(this)},set(value){window.__paintProbe.counts[selector]++;descriptor.set.call(this,value)}});
        window.__paintProbe.elements.push(el);
      }
    })()`);
    for (let n = 1; n <= 100; n++) { e.usage.totals.sessions = previousSessions + n; e.pushState(); }
    await waitFor(() => web.executeJavaScript(stateCheck(`m.estado()?.usage?.totals?.sessions===${previousSessions + 100}`)), 'rajada de consumo aplicada');
    await settle(web);
    const writes = await web.executeJavaScript('({...window.__paintProbe.counts})');
    assert.equal(writes['#resolved'], 0, 'consumo não reconstrói relatórios');
    assert.equal(writes['#reviewersEditor'], 0, 'consumo não reconstrói configurações ocultas');
    assert.equal(writes['#myPRs'], 0, 'subaba oculta não pinta');
    report.checks.usage = { writes, events: 100 };

    await web.executeJavaScript("document.querySelector('#tabbtn-sistema').click();document.querySelector('#sysbtn-automation').click()");
    await waitFor(() => web.executeJavaScript("document.querySelector('#setInterval').value!==''"), 'formulário projetado ao abrir');
    await web.executeJavaScript(`(() => {
      const input=document.querySelector('#preferencesFile');
      window.__paintProbe.fileInput=input;window.__paintProbe.previousFiles=input.files;
      const transfer=new DataTransfer();transfer.items.add(new File(['{"schema":1}'],'pintura-fixture.json',{type:'application/json'}));
      input.files=transfer.files;
    })()`);
    await web.executeJavaScript("document.querySelector('#setInterval').value='600';document.querySelector('#setInterval').focus()");
    e.config.parallelReviews = previousParallel === 1 ? 2 : 1;
    e.pushState();
    await waitFor(() => web.executeJavaScript(stateCheck(`m.estado()?.config?.parallelReviews===${e.config.parallelReviews}`)), 'estado atualizado durante edição');
    await settle(web);
    assert.equal(await web.executeJavaScript("document.activeElement.id==='setInterval' && document.querySelector('#setInterval').value==='600'"), true);
    await web.executeJavaScript("document.querySelector('#setInterval').blur()");
    await settle(web);
    assert.equal(await web.executeJavaScript("document.querySelector('#setInterval').value"), '600', 'rascunho sobrevive ao fim da edição');
    assert.equal(await web.executeJavaScript("document.querySelector('#preferencesFile')===window.__paintProbe.fileInput && document.querySelector('#preferencesFile').files[0]?.name==='pintura-fixture.json'"), true, 'arquivo escolhido preservado sem atribuir value');
    assert.equal(await web.executeJavaScript(`(async () => {
      const {criarPreservacaoDeFormulario}=await import('/telas/formularios.js');
      const root=document.createElement('div');root.innerHTML='<input id="file-preservation-probe" type="file">';
      const preserve=criarPreservacaoDeFormulario();preserve(root,()=>{});
      const original=root.firstElementChild,transfer=new DataTransfer();transfer.items.add(new File(['fixture'],'arquivo-fixture.json'));
      original.files=transfer.files;
      preserve(root,()=>{root.innerHTML='<input id="file-preservation-probe" type="file">'});
      return root.firstElementChild===original && original.files[0]?.name==='arquivo-fixture.json';
    })()`), true, 'mesmo FileList quando a projeção substitui o contêiner');
    report.checks.form = { stateAppliedDuringFocus: true, focusPreserved: true, draftPreservedAfterBlur: true, fileInputIdentityPreserved: true, fileListPreserved: true };

    const id = 'f-pintura-sintetica', startedAt = Date.now();
    e.activeReviews.set(id, { id, mode: 'auto', label: 'Sessão de teste', startedAt, fase: 'modelo', keys: [] });
    e.activity.set(id, []); e.pushState();
    await waitFor(() => web.executeJavaScript(stateCheck("m.estado()?.activeSessions?.some(s=>s.id==='f-pintura-sintetica')")), 'sessão sintética disponível');
    web.setBackgroundThrottling(true);
    win.hide();
    await waitFor(() => web.executeJavaScript('document.hidden'), 'janela realmente oculta');
    const beforeHidden = await web.executeJavaScript('({...window.__paintProbe.counts})');
    for (let n = 0; n < 2000; n++) e.emit('activity', { id, item: { t: startedAt + n, s: 'leitura', k: 'info', text: `Atividade sintética ${n}` } });
    await waitFor(() => web.executeJavaScript(stateCheck("m.estado()?.activity?.['f-pintura-sintetica']?.at(-1)?.text==='Atividade sintética 1999'")), 'atividade recebida mesmo oculta');
    assert.equal(await web.executeJavaScript(stateCheck("m.estado().activity['f-pintura-sintetica'].length")), 300);
    assert.deepEqual(await web.executeJavaScript('({...window.__paintProbe.counts})'), beforeHidden, 'nenhuma pintura nos alvos ocultos');
    win.showInactive(); web.setBackgroundThrottling(false);
    await waitFor(() => web.executeJavaScript('!document.hidden'), 'janela reaberta');
    await web.executeJavaScript("document.querySelector('#tabbtn-radar').click();document.querySelector('#rsub-mim').click()");
    await waitFor(() => web.executeJavaScript("document.querySelector('.activity-feed')?.textContent.includes('Atividade sintética 1999')"), 'cauda atual ao retornar');
    const feedLines = await web.executeJavaScript("document.querySelectorAll('.activity-feed .feed-line').length");
    assert.equal(feedLines, 300);
    report.checks.hidden = { actualPageHidden: true, stateContinued: true, noHiddenPaint: true, retainedActivity: 300, domFeedLines: feedLines };
    report.status = 'passed';
    writeJsonAtomic(path.join(output, 'pintura-native.json'), report);
    return report;
  } finally {
    await web.executeJavaScript('if(window.__paintProbe){if(window.__paintProbe.fileInput)window.__paintProbe.fileInput.files=window.__paintProbe.previousFiles;for(const el of window.__paintProbe.elements)delete el.innerHTML;delete window.__paintProbe;}').catch(() => {});
    Object.assign(e, saved);
    e.usage.totals.sessions = previousSessions; e.config.parallelReviews = previousParallel; e.pushState();
    web.setBackgroundThrottling(throttling);
    if (!visible) win.hide();
  }
}
export { checkPintura };
