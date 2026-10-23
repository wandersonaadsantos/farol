// Reserva por janela: só uma leitura recente, completa e da identidade correta é saldo.
import { TEMPOS } from '../constants.js';
import { grupoDoModelo, contaConfere, lerCota, aplicarLeitura } from '../agy/cota.js';
import { sanitizeAgyModel, AGY_MODELO_PADRAO } from '../parse.js';
import { authFromProfile } from '../engine/perfil-claude.js';
import { chaveDaAssinatura } from '../engine/limite-plano.js';

function policies(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 64) throw new Error('Reservas de cota inválidas.');
  const result = {};
  for (const [id, value] of Object.entries(raw)) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || !['observe', 'enforce'].includes(value?.mode)
      || !Number.isInteger(value.maxUsedPercent) || value.maxUsedPercent < 1 || value.maxUsedPercent > 99) throw new Error('Informe modo e percentual máximo entre 1 e 99.');
    result[id] = { mode: value.mode, maxUsedPercent: value.maxUsedPercent };
  }
  return result;
}
function identityFor(engine, auth) {
  const profile = (engine.config.claudeProfiles || []).find(p => p.id === auth?.id);
  if (auth?.kind === 'agy' && profile?.email) return `agy-identity:${profile.email.trim().toLowerCase()}:${auth.grupo || grupoDoModelo(sanitizeAgyModel(engine.config.agyReviewModel) || AGY_MODELO_PADRAO)}`;
  return chaveDaAssinatura(auth);
}
function policyFor(engine, auth) {
  const raw = engine.config?.quotaReservations;
  if (!raw || !Object.keys(raw).length) return null;
  const configured = policies(raw), identity = identityFor(engine, auth);
  const matches = (engine.config.claudeProfiles || []).filter(p => configured[p.id] && identityFor(engine, authFromProfile(p, engine.config)) === identity);
  const enforced = matches.filter(p => configured[p.id].mode === 'enforce');
  const applicable = enforced.length ? enforced : matches;
  if (!applicable.length) return null;
  return { mode: enforced.length ? 'enforce' : 'observe', maxUsedPercent: Math.min(...applicable.map(p => configured[p.id].maxUsedPercent)), profiles: applicable.map(p => p.id) };
}
function hasPolicies(engine) { return Object.keys(policies(engine.config?.quotaReservations || {})).length > 0; }
function quotaFor(engine, auth, now = Date.now()) {
  const policy = policyFor(engine, auth);
  const base = { profileId: auth?.id || '', mode: policy?.mode || 'off', maxUsedPercent: policy?.maxUsedPercent ?? null,
    policyProfiles: policy?.profiles || [], source: 'unavailable', observedAt: null, windows: [], known: false, wouldReserve: false, blocked: false };
  const unknown = reason => ({ ...base, status: 'unknown', reason, blocked: policy?.mode === 'enforce' });
  if (auth?.kind !== 'agy') return unknown('Medição verificável de cota ainda não integrada para este provedor.');
  const profile = (engine.config?.claudeProfiles || []).find(p => p.id === auth.id);
  const reading = engine.agyCotas?.get(auth.id)?.leitura;
  if (!profile || !reading?.ok || reading.reservaVerificada !== true || contaConfere(profile, reading) !== true) return unknown('Fonte incompleta, identidade não confirmada ou leitura indisponível.');
  if (!Number.isFinite(reading.em) || reading.em > now || now - reading.em >= TEMPOS.AGY_COTA_CACHE_MS) return unknown('Leitura de cota vencida; atualize antes de admitir trabalho.');
  const group = auth.grupo || grupoDoModelo(sanitizeAgyModel(engine.config?.agyReviewModel) || AGY_MODELO_PADRAO);
  const buckets = reading.grupos.find(g => g.grupo === group)?.buckets;
  if (!buckets?.length || buckets.some(b => !Number.isFinite(b.restante) || b.restante < 0 || b.restante > 1 || !b.id || !b.janela || !(b.reset > now))) return unknown('Janela não verificável ou reset já vencido.');
  const windows = buckets.map(b => ({ id: b.id, window: b.janela, usedPercent: (1 - b.restante) * 100, resetAt: b.reset }));
  const wouldReserve = !!policy && windows.some(w => w.usedPercent + 1e-9 >= policy.maxUsedPercent);
  let status = 'open';
  if (wouldReserve) status = policy.mode === 'enforce' ? 'reserved' : 'observing';
  return { ...base, known: true, source: 'agy /usage', observedAt: reading.em, windows, wouldReserve,
    status, blocked: wouldReserve && policy.mode === 'enforce', reason: wouldReserve ? 'Percentual máximo atingido em uma janela do grupo usado.' : '' };
}
function blockFor(engine, auth) {
  const state = quotaFor(engine, auth);
  return state.blocked ? state : null;
}
function quotaError(state) {
  return Object.assign(new Error(`Reserva de cota: ${state.reason} Nenhuma sessão nova foi iniciada neste perfil.`), { quotaReservation: state });
}
async function refresh(engine, profile, force = false) {
  if (profile?.kind !== 'agy') return;
  const group = grupoDoModelo(sanitizeAgyModel(engine.config?.agyReviewModel) || AGY_MODELO_PADRAO);
  const auth = { id: profile.id, kind: 'agy', grupo: group };
  const reading = await lerCota(engine, profile.id, { forcar: force });
  aplicarLeitura(engine, auth, reading);
}
async function prepare(engine, account) {
  const own = (engine.config.accounts || []).find(a => a.user?.toLowerCase() === String(account || '').toLowerCase())?.claudeProfileId;
  const ids = own ? [own] : (engine.config.cadeiaPerfis || []).filter(e => e.ativo).map(e => e.id);
  const profiles = (engine.config.claudeProfiles || []).filter(p => ids.includes(p.id) && policyFor(engine, authFromProfile(p, engine.config)));
  await Promise.all(profiles.map(p => refresh(engine, p)));
}
const observed = new WeakMap();
function notify(engine, states) {
  if (!observed.has(engine)) observed.set(engine, new Map());
  const previous = observed.get(engine);
  for (const state of states.filter(s => s.mode !== 'off')) {
    const key = `${state.status}:${state.mode}:${state.maxUsedPercent}`;
    if (previous.get(state.profileId) === key) continue;
    previous.set(state.profileId, key);
    if (['reserved', 'observing', 'unknown'].includes(state.status)) engine.emit('toast', { kind: 'info', text: `Cota do perfil ${state.profileId}: ${state.reason} ${state.blocked ? 'Novos trabalhos aguardam uma fonte válida ou outra opção autorizada.' : 'Somente observação.'}` });
  }
}
export { policies, policyFor, hasPolicies, quotaFor, blockFor, quotaError, refresh, prepare, notify };
