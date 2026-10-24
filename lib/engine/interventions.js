// Pendências que precisam de uma pessoa. O relógio só observa estado existente;
// não relança sessões, autentica contas nem decide reviews.
import crypto from 'node:crypto';
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic, safeStringify } from '../io.js';
import { reasonText } from '../format.js';
import { interventionTarget } from '../../ui/pure/interventions.js';
import { prKeyFromUrl } from '../../ui/pure/mencoes.js';
import { permanente } from './sync-falha.js';

const runtimes = new WeakMap();
const hash = value => crypto.createHash('sha256').update(safeStringify(value)).digest('hex');
const MESSAGES = {
  decision: ['Decisão pendente', 'Uma revisão precisa da sua decisão. Abra a pendência no Farol.'],
  access: ['Acesso precisa de atenção', 'Um acesso precisa ser renovado ou configurado no Farol.'],
  failure: ['Revisão interrompida', 'Uma revisão parou sem recuperação automática. Confira a pendência no Farol.'],
  operational: ['Automação bloqueada', 'Uma configuração impede a automação de continuar. Confira o Sistema no Farol.'],
};

function candidate(kind, scope, material, target, since) {
  const [title, body] = MESSAGES[kind];
  return { id: hash([kind, scope]), fingerprint: hash(material), kind, title, body,
    speech: `Farol. ${body}`, target, since: Number(since) || 0 };
}

function decisionCandidates(snapshot) {
  return (snapshot.decisions?.pending || []).flatMap(item => {
    if (item.esperaCi || item.esperaProva || (item.postRetry && !item.postRetry.exhausted)) return [];
    // Commit novo tem relançamento automático; só a parada efetiva pede alguém.
    const round = snapshot.reRounds?.[item.key];
    if (item.blockedKind === 'stale_head' && ['aguardando', 'espera_longa', 'revisando'].includes(round?.estado)) return [];
    const target = interventionTarget({ type: 'pr', url: item.pr?.url, account: item.account || item.pr?.account });
    if (!target) return [];
    const { url } = target;
    const scope = [String(item.account || item.pr?.account || '').toLowerCase(), url];
    const material = [item.headSha || '', item.verdict || '', item.blockedKind || '', item.blockedReason || '',
      (item.reasons || []).map(reasonText).sort(), item.postRetry?.exhausted === true];
    const event = candidate('decision', scope, material, target, item.createdAt);
    event.body = `${prKeyFromUrl(url)}: ${event.body}`;
    return [event];
  });
}

function parkedCandidates(snapshot) {
  return Object.entries(snapshot.parked || {}).flatMap(([key, value]) => {
    if (!['falha', 'esgotado', 'autenticacao'].includes(value?.tipo)) return [];
    const pr = (snapshot.queue || []).find(p => p.key === key);
    const target = interventionTarget({ type: 'pr', url: pr?.url, account: pr?.account }) || { type: 'system', section: 'diag' };
    const kind = value.tipo === 'autenticacao' ? 'access' : 'failure';
    // Data e sessionId mudam a cada tentativa, mas não tornam o problema novo.
    return [candidate(kind, key, [value.tipo, value.motivo], target, Date.parse(value.at))];
  });
}

function candidates(snapshot, syncRequiresAction = false, missingAccounts = new Set()) {
  if (!snapshot || snapshot.status === 'starting') return [];
  const items = [...decisionCandidates(snapshot), ...parkedCandidates(snapshot)];
  for (const account of snapshot.accounts || []) {
    if (account.user && !account.muted && account.tokenOk === false && missingAccounts.has(account.user.toLowerCase())) items.push(candidate('access', ['gh', account.user],
      'sem-token', { type: 'system', section: 'accounts' }));
  }
  if (snapshot.sync?.enabled && (snapshot.sync.status === 'sem-credencial' || syncRequiresAction)) {
    items.push(candidate('operational', 'sync', snapshot.sync.lastError?.code || snapshot.sync.status,
      { type: 'system', section: 'sync' }));
  }
  return items;
}

// Só hashes e horários são persistidos: não duplica relatórios, nomes ou credenciais.
function validReceipts(saved) {
  if (saved?.schema !== 1 || !saved.receipts || typeof saved.receipts !== 'object') return {};
  return Object.fromEntries(Object.entries(saved.receipts).filter(([id, r]) =>
    /^[a-f0-9]{64}$/.test(id) && /^[a-f0-9]{64}$/.test(r?.fingerprint)
    && Number.isFinite(r.notifiedAt) && r.notifiedAt >= 0));
}

function observe(engine, snapshot, { now = Date.now(), file = path.join(STATE_DIR, 'interventions.json') } = {}) {
  let runtime = runtimes.get(engine);
  if (!runtime) {
    runtime = { receipts: validReceipts(readJson(file, null, message => engine.log('WARN', message))), active: [] };
    runtimes.set(engine, runtime);
  }
  // Boot ainda não comprovou ausência de pendências; preserva os recibos.
  if (snapshot.status === 'starting') return [];
  const sync = engine.sync;
  const blocked = sync?.status === 'erro' && permanente(sync, sync.lastError?.code);
  // A mesma confirmação usada pelo coletor do gh: mapa vazio no boot não é falha.
  const missingAccounts = engine.semTokenAvisado instanceof Set ? engine.semTokenAvisado : new Set();
  const active = candidates(snapshot, blocked, missingAccounts);
  const receipts = {};
  const events = [];
  const minutes = snapshot.config?.interventionReminderMinutes;
  const reminderMs = Number.isFinite(minutes) && minutes >= 5 ? Math.min(minutes, 1440) * 60000 : 0;
  for (const item of active) {
    const previous = runtime.receipts[item.id];
    const changed = previous?.fingerprint !== item.fingerprint;
    const reminder = !changed && reminderMs > 0 && now - previous.notifiedAt >= reminderMs;
    receipts[item.id] = previous;
    if (!changed && !reminder) continue;
    receipts[item.id] = { fingerprint: item.fingerprint, notifiedAt: now };
    const { fingerprint, ...event } = item;
    events.push({ ...event, reminder, notifiedAt: now, revision: hash([item.fingerprint, now]) });
  }
  runtime.active = active.map(({ fingerprint, ...item }) => {
    const notifiedAt = receipts[item.id]?.notifiedAt ?? now;
    return { ...item, notifiedAt, revision: hash([fingerprint, notifiedAt]) };
  });
  if (safeStringify(receipts) !== safeStringify(runtime.receipts)) {
    runtime.receipts = receipts;
    try { writeJsonAtomic(file, { schema: 1, receipts }); }
    catch { engine.log('WARN', 'Não foi possível persistir os recibos dos alertas de intervenção.'); }
  }
  return events;
}

function pushState(engine) {
  const snapshot = engine.snapshot();
  const events = observe(engine, snapshot);
  snapshot.interventions = forUi(engine);
  engine.emit('state', snapshot);
  for (const event of events) engine.emit('intervention', event);
}

function forUi(engine) { return runtimes.get(engine)?.active || []; }
export { candidates, observe, pushState, forUi };
export default { candidates, observe, pushState, forUi };
