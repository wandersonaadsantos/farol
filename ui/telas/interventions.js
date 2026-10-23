import { interventionEvent, quietNow } from '../pure/interventions.js';
import { ping } from './avisos.js';
import { createInterventionVoice } from './intervention-voice.js';
import { estado, ehElectron } from './estado.js';
import { toastRich } from './infra.js';

const seen = new Map();
const VOICE_STATUS = { silent: 'Voz desligada ou silenciada para este evento.', unavailable: 'Nenhuma voz local disponível neste cliente. Os avisos visuais continuam ativos.',
  failed: 'Não foi possível reproduzir a voz. Os avisos visuais continuam ativos.', busy: 'Avisos simultâneos agrupados na fala atual.',
  speaking: 'Reproduzindo aviso por voz.', ready: 'Voz disponível.' };
const voice = createInterventionVoice(globalThis, code => {
  const element = document.querySelector('#interventionVoiceStatus');
  if (element) element.textContent = VOICE_STATUS[code] || '';
});

function interventionReceived(raw, onOpen) {
  const event = interventionEvent(raw);
  if (!event || seen.get(event.id) === event.revision) return false;
  seen.set(event.id, event.revision);
  const config = estado()?.config || {};
  toastRich('info', el => {
    el.appendChild(document.createTextNode(`${event.title}: ${event.body} `));
    const button = document.createElement('button');
    button.type = 'button'; button.className = 't-acao'; button.textContent = 'Abrir pendência';
    button.onclick = () => onOpen(event.target);
    el.appendChild(button);
  });
  if (!ehElectron() && !document.hasFocus() && globalThis.Notification?.permission === 'granted') {
    try {
      const notification = new Notification(`Farol · ${event.title}`, { body: event.body, tag: event.id, silent: quietNow(config) });
      notification.onclick = () => { window.focus(); onOpen(event.target); };
    } catch { notificationUnavailable(); }
  }
  const audio = voice.speak(event, config);
  if (!['speaking', 'busy'].includes(audio)) ping();
  return true;
}

function notificationUnavailable() {
  const el = document.querySelector('#interventionVoiceStatus');
  if (el) el.textContent = 'Notificação do sistema indisponível. Abra o aviso dentro do Farol.';
}

function interventionsFromState(snapshot, onOpen) {
  voice.configure(snapshot.config || {});
  const active = Array.isArray(snapshot.interventions) ? snapshot.interventions : [];
  const ids = new Set(active.map(e => e.id));
  for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id);
  for (const event of active) interventionReceived(event, onOpen);
}

function testInterventionVoice() {
  const config = estado()?.config || {};
  const kind = config.voiceEvents?.[0] || 'decision';
  return voice.speak({ kind, speech: 'Farol. Este é um teste de aviso de intervenção.' }, config);
}
export { interventionReceived, interventionsFromState, testInterventionVoice };
