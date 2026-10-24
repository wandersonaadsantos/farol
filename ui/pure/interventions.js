import { canonicalGithubPrUrl } from './mencoes.js';
import { esc } from './comum.js';

// Contrato do aviso recebido e política de áudio, compartilhados pelo shell e UI.
const INTERVENTION_KINDS = ['decision', 'access', 'failure', 'operational'];
const SYSTEM_SECTIONS = ['accounts', 'diag', 'sync', 'plans'];
function interventionEvent(raw) {
  if (!raw || typeof raw.id !== 'string' || !/^[a-f0-9]{64}$/.test(raw.id) || !INTERVENTION_KINDS.includes(raw.kind)) return null;
  if (!['title', 'body', 'speech'].every(k => typeof raw[k] === 'string' && raw[k].length <= 300)) return null;
  const target = interventionTarget(raw.target);
  if (!target) return null;
  const revision = typeof raw.revision === 'string' && /^[a-f0-9]{64}$/.test(raw.revision) ? raw.revision : String(Number(raw.notifiedAt) || 0);
  return { id: raw.id, kind: raw.kind, title: raw.title, body: raw.body, speech: raw.speech,
    target, revision,
    notifiedAt: Number(raw.notifiedAt) || 0, reminder: raw.reminder === true };
}
function interventionTarget(target) {
  if (target?.type === 'system' && SYSTEM_SECTIONS.includes(target.section)) return { type: 'system', section: target.section };
  if (target?.type !== 'pr') return null;
  const url = canonicalGithubPrUrl(target.url);
  if (!url) return null;
  const account = typeof target.account === 'string' ? target.account : '';
  return { type: 'pr', url, account };
}
function clockMinutes(text) {
  if (typeof text !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return null;
  const [hour, minute] = text.split(':').map(Number);
  return hour * 60 + minute;
}
function quietNow(config = {}, date = new Date()) {
  if (config.voiceQuietEnabled !== true) return false;
  const start = clockMinutes(config.voiceQuietStart), end = clockMinutes(config.voiceQuietEnd);
  if (start === null || end === null || start === end) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}
function voiceAllowed(config, event, date = new Date()) {
  return config?.voiceEnabled === true && Array.isArray(config.voiceEvents)
    && config.voiceEvents.includes(event.kind) && !quietNow(config, date);
}
function interventionInboxHtml(events) {
  const labels = { decision: 'Decisões pendentes', access: 'Acesso', failure: 'Falhas sem recuperação', operational: 'Configuração' };
  const groups = new Map();
  for (const event of events) {
    if (!groups.has(event.kind)) groups.set(event.kind, []);
    groups.get(event.kind).push(event);
  }
  const rows = [...groups].map(([kind, items]) => `<section class="set-block"><h4 class="set-subtitle">${esc(labels[kind])} · ${items.length}</h4><div class="ilist">${items.map(event => `<div class="irow"><div class="irow-main"><div class="irow-head">${esc(event.title)}</div><p class="irow-sub">${esc(event.body)}</p></div><div class="irow-acts"><button type="button" class="btn sm t-acao" data-intervention-id="${esc(event.id)}">Abrir pendência</button></div></div>`).join('')}</div></section>`).join('');
  return `<summary class="intv-head"><span class="set-title">Intervenções <span class="count">${events.length}</span></span><span class="set-desc">Pendências agrupadas · abra quando precisar</span></summary>${rows}<div class="intv-foot"><button type="button" class="btn sm ghost" data-goto="sys:prefs:#sys-row-interventions">Preferências de avisos</button></div>`;
}
export { INTERVENTION_KINDS, interventionEvent, interventionTarget, clockMinutes, quietNow, voiceAllowed, interventionInboxHtml };
