import { canonicalGithubPrUrl } from './mencoes.js';

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
export { INTERVENTION_KINDS, interventionEvent, interventionTarget, clockMinutes, quietNow, voiceAllowed };
