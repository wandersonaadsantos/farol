// Integração real engine -> SSE -> renderer e engine -> notificação nativa.
// O clique é emitido na Notification real; não simula um clique físico do SO.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Notification } from 'electron';
import { safeStringify } from '../lib/io.js';

async function checkInterventions(main, waitFor, output) {
  const engine = main.engine;
  engine.status = 'idle';
  engine.config.voiceEnabled = false;
  engine.config.accounts = [];
  engine.config.ghUser = '';
  engine.decisions.pending = [{ id: 'intervention-smoke', createdAt: Date.now(), key: 'smoke/intervention#1',
    headSha: 'smoke-head', verdict: 'manual', status: 'pending', reasons: ['Confirmação humana sintética'],
    pr: { repo: 'smoke/intervention', number: 1, url: 'https://github.com/smoke/intervention/pull/1', title: 'Pendência sintética' } }];
  main.win.hide();
  await waitFor(() => !main.win.isFocused(), 'janela escondida antes do alerta');
  const notifications = [];
  const nativeShow = Notification.prototype.show;
  Notification.prototype.show = function (...args) {
    const record = { notification: this, shown: false };
    this.once('show', () => { record.shown = true; });
    notifications.push(record);
    return nativeShow.apply(this, args);
  };
  try {
    engine.pushState(); engine.pushState();
    await waitFor(() => notifications.some(n => n.shown), 'alerta de intervenção aceito pela API nativa');
    assert.equal(notifications.length, 1, `polling não deve repetir notificação: ${notifications.map(n => n.notification.title).join(', ')} / ${safeStringify(engine.snapshot().accounts)}`);
    notifications[0].notification.emit('click');
    await waitFor(async () => main.win.isVisible() && main.win.webContents.executeJavaScript(
      `!!document.querySelector('[data-url="https://github.com/smoke/intervention/pull/1"].pulse-focus')`), 'clique chegar à pendência correta');
    const controls = await main.win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#tabbtn-sistema').click();
      document.querySelector('#sysbtn-prefs').click();
      const enabled = document.querySelector('#setVoiceEnabled');
      const selected = Array.from(document.querySelector('#setVoiceEvents').options).filter(o => o.selected).length;
      return { enabled: enabled.checked, selected, volume: document.querySelector('#setVoiceVolume').value,
        testButton: !!document.querySelector('#testInterventionVoice'),
        voices: (window.speechSynthesis?.getVoices() || []).filter(v => v.localService).length };
    })()`);
    assert.equal(controls.enabled, false); assert.equal(controls.selected, 4);
    assert.equal(controls.volume, '50'); assert.equal(controls.testButton, true);
    await main.win.webContents.executeJavaScript(`document.querySelector('#setVoiceEnabled').click()`);
    await waitFor(() => engine.config.voiceEnabled === true, 'preferência de voz salva pelo formulário real');
    await waitFor(() => main.win.webContents.executeJavaScript(`import('/telas/estado.js').then(m => m.estado().config.voiceEnabled === true)`), 'estado do cliente receber configuração de voz');
    const audioProbe = await main.win.webContents.executeJavaScript(`(async () => {
      document.querySelector('#testInterventionVoice').click();
      return { status: document.querySelector('#interventionVoiceStatus').textContent,
        localVoices: (window.speechSynthesis?.getVoices() || []).filter(v => v.localService).length };
    })()`);
    let audioResult = 'unavailable';
    if (audioProbe.localVoices === 0) {
      assert.match(audioProbe.status, /Nenhuma voz local/);
    } else {
      await waitFor(() => main.win.webContents.executeJavaScript(`!document.querySelector('#interventionVoiceStatus').textContent.includes('Reproduzindo')`), 'síntese terminar ou informar falha');
      audioResult = await main.win.webContents.executeJavaScript(`document.querySelector('#interventionVoiceStatus').textContent`);
      assert.match(audioResult, /Voz disponível|Não foi possível reproduzir/);
    }
    await main.win.webContents.executeJavaScript(`document.querySelector('#sys-row-interventions').scrollIntoView({block:'start'})`);
    await waitFor(() => main.win.webContents.executeJavaScript(`document.querySelector('#sys-row-interventions').getBoundingClientRect().top < 130`), 'preferências de voz visíveis para captura');
    const image = await main.win.webContents.capturePage();
    fs.writeFileSync(path.join(output, 'intervention-settings.png'), image.toPNG());
    // Cliente reaberto recebe a pendência pelo snapshot, sem nova notificação nativa.
    await main.win.webContents.reload();
    await waitFor(() => main.win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.t-acao')).some(b => b.textContent === 'Abrir pendência')`), 'reconexão recuperar aviso ativo');
    assert.equal(notifications.length, 1);
    return { status: 'passed', nativeApiAccepted: true, repeatedPollingNotifications: 0,
      correctPrFocused: true, reconnectRecovered: true, controls, audioProbe, audioResult, audioOutput: 'synthesis exercised; audible output not inspected',
      click: 'programmatic event on real Notification; physical OS click not exercised' };
  } finally {
    Notification.prototype.show = nativeShow;
    for (const n of notifications) n.notification.close();
    engine.decisions.pending = []; engine.pushState();
  }
}
export { checkInterventions };
