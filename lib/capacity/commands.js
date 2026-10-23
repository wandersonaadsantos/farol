// Diagnóstico local e configuração explícita. Não muda a cadeia nem os orçamentos.
import { authFromProfile } from '../engine/perfil-claude.js';
import { contentHash } from '../engine/review-round-store.js';
import { policies, quotaFor, refresh, notify } from './quota.js';
import { resources } from './resources.js';
import { history } from './history.js';
import { provedorDoPerfil } from '../engine/provedores.js';

function view(engine) {
  const current = policies(engine.config.quotaReservations || {});
  const profiles = (engine.config.claudeProfiles || []).map(profile => ({ id: profile.id, label: String(profile.label || profile.id), kind: profile.kind || 'dir', provider: provedorDoPerfil(profile)?.rotulo || 'Não identificado',
    policy: current[profile.id] || null, quota: quotaFor(engine, authFromProfile(profile, engine.config)) }));
  notify(engine, profiles.map(p => p.quota));
  return { ok: true, profiles, version: contentHash(current), history: history() };
}
function configure(engine, body) {
  const current = policies(engine.config.quotaReservations || {});
  if (body.expected !== contentHash(current)) throw new Error('Configuração mudou; recarregue antes de salvar.');
  if (!(engine.config.claudeProfiles || []).some(p => p.id === body.profileId)) throw new Error('Perfil não configurado.');
  const next = { ...current };
  if (body.mode === 'off') delete next[body.profileId];
  else Object.assign(next, policies({ [body.profileId]: { mode: body.mode, maxUsedPercent: body.maxUsedPercent } }));
  const previous = engine.config.quotaReservations;
  engine.config.quotaReservations = policies(next);
  try { engine.saveConfig(); }
  catch (error) { engine.config.quotaReservations = previous; throw error; }
  engine.pushState();
  return view(engine);
}
async function command(engine, body) {
  try {
    if (body?.action === 'view') return view(engine);
    if (body?.action === 'configure') return configure(engine, body);
    if (body?.action === 'resources') return { ok: true, resources: await resources(engine) };
    if (body?.action === 'refresh') {
      const profile = (engine.config.claudeProfiles || []).find(p => p.id === body.profileId);
      if (!profile) throw new Error('Perfil não configurado.');
      await refresh(engine, profile, true); return view(engine);
    }
    throw new Error('Operação de capacidade inválida.');
  } catch { return { ok: false, error: 'Não foi possível verificar ou salvar a capacidade. Recarregue, confira perfil, modo e percentual; dados existentes foram preservados.' }; }
}
export { command, view };
