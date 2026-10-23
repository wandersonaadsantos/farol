/* Farol · UI: som e notificação de PR novo, reação a evento do SSE (ver connect() em
   ui/app.js). */

import { quietNow } from '../pure/interventions.js';
import { estado, ehElectron } from './estado.js';
import { toastRich, tituloDaNotificacao } from './infra.js';

/* ---------- som + notificação ---------- */
let audioCtx = null;
function ping() {
  if (!estado()?.config?.soundEnabled || quietNow(estado()?.config)) return;
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

/* ---------- PR meu em conflito ou superado pela base ----------
   Desenho do Claude Design de 10/10/2026 (docs/superpowers/specs/2026-10-10-aviso-da-base-anexos/).
   O texto vem pronto do engine (lib/engine/aviso-da-base.js); aqui só se monta o DOM. Não some
   sozinho enquanto o ponteiro ou o foco estiver nele, e "Ver em Meus PRs" leva ao card. */
const AVISO_DA_BASE_MS = 10000;
// rede de segurança do toastBase: o tempo de verdade é o do próprio aviso, que pausa com o
// ponteiro em cima; isto só limpa o aviso que ficou esquecido com o foco nele
const AVISO_ESQUECIDO_MS = AVISO_DA_BASE_MS * 360;

function linkDoPr(texto, url) {
  const a = document.createElement('a');
  a.className = 't-pr'; a.href = url; a.target = '_blank'; a.rel = 'noopener';
  a.textContent = texto;
  return a;
}

function linhaDoAviso(item, unico) {
  const div = document.createElement('div');
  const chave = unico ? item.key : item.texto.split(' ')[0];
  const resto = unico ? `: ${item.texto}` : item.texto.slice(chave.length);
  div.append(linkDoPr(chave, item.url), document.createTextNode(resto));
  return div;
}

function avisoDaBase(a, onAbrir) {
  if (!a || !Array.isArray(a.itens) || !a.itens.length) return;
  const alvo = a.url || a.itens[0].url;
  const el = toastRich('base', (t) => {
    t.setAttribute('role', 'status');
    const corpo = document.createElement('div');
    corpo.className = 't-corpo';
    const titulo = document.createElement('div');
    titulo.className = 't-titulo';
    titulo.textContent = a.titulo;
    corpo.appendChild(titulo);
    for (const item of a.itens) corpo.appendChild(linhaDoAviso(item, a.itens.length === 1));
    const ver = document.createElement('button');
    ver.className = 't-acao'; ver.type = 'button'; ver.textContent = 'Ver em Meus PRs';
    ver.onclick = () => { fechar(); onAbrir(alvo); };
    corpo.appendChild(ver);
    const x = document.createElement('button');
    x.className = 't-fechar undo'; x.type = 'button'; x.textContent = '×';
    x.setAttribute('aria-label', 'Fechar aviso');
    x.onclick = () => fechar();
    t.append(corpo, x);
  }, AVISO_ESQUECIDO_MS);
  let timer = null;
  function fechar() { clearTimeout(timer); el.classList.add('out'); setTimeout(() => el.remove(), 300); }
  const contar = () => { clearTimeout(timer); timer = setTimeout(fechar, AVISO_DA_BASE_MS); };
  const parar = () => clearTimeout(timer);
  el.addEventListener('mouseenter', parar); el.addEventListener('focusin', parar);
  el.addEventListener('mouseleave', contar); el.addEventListener('focusout', contar);
  contar();
  if (!ehElectron() && 'Notification' in window && Notification.permission === 'granted') {
    const notif = new Notification(a.tituloSistema, { body: a.corpo });
    notif.onclick = () => { window.focus(); onAbrir(alvo); };
  }
}

export { ping, notifyNewPRs, avisoDaBase };
