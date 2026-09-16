/* Farol · UI: ferramentas internas (kudos/diagnóstico), exportar diagnóstico e som +
   notificação. */

import { esc, stripFence, fmtClock, md, logSummaryShort, diagnosticsText } from '../pure.js';
import { estado, escopo } from './estado.js';
import {
  $, get, api, toast, toastRich, confirmModal, copyToClipboard, tituloDaNotificacao,
} from './infra.js';
import { ACCT } from './contas.js';

// mesmo palpite do app.js (linha 46): sem SSE/estado ainda no primeiro paint, o
// jeito de saber se é o shell Electron é olhar o userAgent.
const isElectron = navigator.userAgent.includes('Electron');

/* ---------- ferramentas internas (kudos/diagnostico) ---------- */
let lastKudosOutput = '';
function kudosScopeKey() { return escopo() === 'all' ? '*' : String(escopo()).toLowerCase(); }
function renderTools() {
  const runs = estado().toolRuns || {};
  const btnK = $('#btnKudos'), btnH = $('#btnHealth');

  // kudos é por conta: cada escopo tem sua própria compilação (nunca mistura contas)
  const kmap = (runs.kudos && typeof runs.kudos === 'object') ? runs.kudos : {};
  const k = kmap[kudosScopeKey()] || {};
  const scopeName = escopo() === 'all' ? '' : ((ACCT[String(escopo()).toLowerCase()] || {}).label || escopo());
  btnK.disabled = k.status === 'running';
  btnK.innerHTML = k.status === 'running'
    ? '<span class="spin"></span> Gerando…'
    : `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3l1.9 4.6 4.9.4-3.7 3.2 1.1 4.8L12 13.5 7.8 16l1.1-4.8L5.2 8l4.9-.4L12 3z" fill="currentColor"/></svg> Gerar kudos${scopeName ? ' de ' + esc(scopeName) : ''}`;
  const kp = $('#kudosPanel');
  kp.hidden = k.status !== 'done';
  if (k.status === 'done') {
    lastKudosOutput = stripFence(k.output);
    $('#kudosOut').innerHTML = md(lastKudosOutput);
    $('#kudosMeta').textContent = `gerado às ${fmtClock(k.finishedAt)}${scopeName ? ' · ' + esc(scopeName) : ''} · pronto pra colar no canal`;
  }

  const h = runs.health || {};
  btnH.disabled = h.status === 'running';
  btnH.textContent = h.status === 'running' ? 'Diagnosticando…' : 'Diagnóstico com o Claude';
  const hp = $('#healthPanel');
  hp.hidden = h.status !== 'done';
  if (h.status === 'done') {
    $('#healthOut').innerHTML = md(stripFence(h.output));
    $('#healthMeta').textContent = `rodado às ${fmtClock(h.finishedAt)}`;
  }
}

$('#btnKudosCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(lastKudosOutput);
    toast('ok', 'Texto copiado. É só colar no canal.', 3000);
  } catch { toast('error', 'Não consegui copiar (permissão do navegador).'); }
};

/* limpar resultados de ferramenta: o painel some, nada além disso */
$('#btnKudosClear').onclick = async () => {
  const r = await api('/api/tool/clear', { name: 'kudos', scope: kudosScopeKey() });
  if (!r?.ok) toast('error', r?.error || 'não consegui limpar');
};
$('#btnHealthClear').onclick = async () => {
  const r = await api('/api/tool/clear', { name: 'health' });
  if (!r?.ok) toast('error', r?.error || 'não consegui limpar');
  else toast('ok', 'Diagnóstico limpo. O próximo parte do estado atual.', 3000);
};
$('#btnLogClear').onclick = async () => {
  // era o último confirm() nativo do app (o do update saiu na mesma leva)
  const ok = await confirmModal({
    danger: true,
    title: 'Zerar o log de falhas?',
    body: '<p>Use quando os pontos levantados já foram tratados: o próximo diagnóstico parte do zero, sem o histórico atual.</p>',
    confirmLabel: 'Zerar log'
  });
  if (!ok) return;
  const r = await api('/api/log/clear');
  if (!r?.ok) { toast('error', r?.error || 'não consegui limpar o log'); return; }
  toast('ok', 'Log de falhas zerado.', 3000);
  loadLog();
};

async function loadLog() {
  const [lines, grupos] = await Promise.all([get('/api/log'), get('/api/log/triage')]);
  const linhas = lines || [];
  $('#logBox').textContent = linhas.length ? linhas.join('\n') : 'Nenhuma falha registrada. Bom sinal.';
  // resumo agrupado ANTES do despejo: contagem crua não distingue "1 problema repetido
  // 70 vezes" de "70 problemas". Fica num parágrafo próprio de propósito, e não dentro
  // da .section-head: aquela linha é flex e quebra cedo (ver o CSS da aba).
  const resumo = $('#logResumo');
  const texto = logSummaryShort(grupos || [], 3);
  resumo.textContent = texto;
  resumo.hidden = !texto;
  const box = $('#logBox');
  box.scrollTop = box.scrollHeight;
}

/* ---------- exportar diagnóstico (pra reparar, ex.: no macOS) ---------- */
// Junta ambiente + contas + config + estado + log num texto SEM segredo (nada de
// token/senha), pra a pessoa copiar e mandar pra quem mantém o Farol.
// quantas linhas cruas do log entram no relatório: o texto é copiado e colado, e depois
// do resumo agrupado o despejo inteiro (159 linhas no caso real) só custava tamanho.
const DIAG_LOG_TAIL = 40;

async function buildDiagnostics() {
  const [logRaw, gruposRaw] = await Promise.all([get('/api/log'), get('/api/log/triage')]);
  return diagnosticsText({
    s: estado() || {}, log: logRaw || [], grupos: gruposRaw || [],
    agora: new Date().toLocaleString('pt-BR'), tail: DIAG_LOG_TAIL
  });
}
let lastDiag = '';
$('#btnDiag').onclick = async () => {
  const btn = $('#btnDiag'), prev = btn.textContent;
  btn.disabled = true; btn.textContent = 'Gerando…';
  lastDiag = await buildDiagnostics();
  $('#diagBox').textContent = lastDiag;
  $('#diagPanel').hidden = false;
  btn.disabled = false; btn.textContent = prev;
  const ok = await copyToClipboard(lastDiag);
  toast(ok ? 'ok' : 'info', ok ? 'Diagnóstico gerado e copiado. É só colar e mandar.' : 'Diagnóstico gerado. Use "Copiar" pra levar o texto.', 4500);
  $('#diagPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('#btnDiagCopy').onclick = async () => {
  const ok = await copyToClipboard(lastDiag || $('#diagBox').textContent);
  toast(ok ? 'ok' : 'error', ok ? 'Copiado.' : 'Não consegui copiar (permissão do navegador).', 2500);
};
$('#btnDiagClear').onclick = () => { $('#diagPanel').hidden = true; };

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
    if (n === 1) el.appendChild(document.createTextNode(`  ${first.key}`));
  });
  if (!isElectron && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      const notif = new Notification(`Farol · ${title}`, { body });
      notif.onclick = () => window.focus();
    } else if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
}

export { kudosScopeKey, renderTools, loadLog, buildDiagnostics, ping, notifyNewPRs };
