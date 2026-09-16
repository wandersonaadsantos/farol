/* Farol · UI: som e notificação de PR novo, reação a evento do SSE (ver connect() em
   ui/app.js). */

import { reasonText } from '../pure.js';
import { estado, ehElectron } from './estado.js';
import { toastRich, tituloDaNotificacao } from './infra.js';

/* ---------- som + notificação ---------- */
let audioCtx = null;
function ping() {
  if (!estado()?.config?.soundEnabled) return;
  try {
    audioCtx = audioCtx || new AudioContext();
    const t = audioCtx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0, t + i * .12);
      g.gain.linearRampToValueAtTime(.08, t + i * .12 + .02);
      g.gain.exponentialRampToValueAtTime(.0001, t + i * .12 + .3);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + i * .12); o.stop(t + i * .12 + .35);
    });
  } catch { /* sem audio, sem drama */ }
}

function notifyNewPRs(data) {
  ping();
  const n = data.items.length;
  const first = data.items[0];
  const title = tituloDaNotificacao(data.auto, n);
  const body = n === 1 ? `${first.key}: ${first.title}` : data.items.map(i => i.key).join('  ·  ');
  toastRich('info', (el) => {
    const strong = document.createElement('b');
    strong.textContent = title;
    el.appendChild(strong);
    if (n === 1) el.appendChild(document.createTextNode(`\u00a0 ${first.key}`));
  });
  if (!ehElectron() && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      const notif = new Notification(`Farol · ${title}`, { body });
      notif.onclick = () => window.focus();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
}

/* ---------- notificação nativa de "precisa da sua atenção" ----------
   Mesma política de permissão/Electron de notifyNewPRs, num lugar só: o
   connect() do ui/app.js chamava new Notification(...) com a MESMA checagem
   (!ehElectron() && 'Notification' in window && permission === 'granted') que
   já morava aqui. onAbrir é a navegação (focusPr), que fica no app.js: este
   módulo não navega, só decide SE notifica. */
function notifyNeedsDecision(pr, item, onAbrir) {
  if (!ehElectron() && 'Notification' in window && Notification.permission === 'granted') {
    const notif = new Notification('Farol · precisa da sua atenção', { body: `${pr.key}: ${reasonText((item.reasons || [])[0]) || 'ver relatório'}` });
    notif.onclick = () => { window.focus(); onAbrir(); };
  }
}

export { ping, notifyNewPRs, notifyNeedsDecision };
