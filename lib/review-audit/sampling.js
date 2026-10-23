// Amostragem local por risco, com contagem e custo honestos. Nunca decide review.
import { localDay } from '../engine/usage.js';
import { policy, DEFAULT_POLICY } from './contract.js';

function currentPolicy(engine) { return policy(engine.config.auditSampling || DEFAULT_POLICY); }
function costFor(engine, job) {
  const sessions = (engine.usageSessions?.sessions || []).filter(s => job.usageIds.includes(s.id));
  const complete = job.usageIds.every(id => sessions.some(s => s.id === id));
  if (!complete || sessions.some(s => !['medido', 'estimado'].includes(s.costSource) || !Number.isFinite(s.costUsd) || s.costUsd < 0)) return { source: 'unavailable', usd: null };
  let source = 'measured'; if (sessions.some(s => s.costSource === 'estimado')) source = 'estimated';
  return { source, usd: sessions.reduce((n, s) => n + s.costUsd, 0) };
}
function automaticAdmission(engine, jobs, now = new Date()) {
  const p = currentPolicy(engine), today = localDay(now);
  const daily = jobs.filter(j => localDay(new Date(j.at)) === today);
  if (!p.enabled) return { ok: false, reason: 'Amostragem desligada.' };
  if (daily.filter(j => j.mode === 'automatic').length >= p.dailyLimit) return { ok: false, reason: 'Quantidade diária atingida.' };
  let spent = 0;
  for (const job of daily) {
    const cost = costFor(engine, job);
    if (cost.usd === null) return { ok: false, reason: 'Há custo indisponível ou sessão interrompida hoje; amostragem suspensa.' };
    spent += cost.usd;
  }
  if (spent + p.reserveUsd > p.budgetUsd) return { ok: false, reason: 'Sem orçamento para a reserva da próxima auditoria.' };
  return { ok: true, reserveUsd: p.reserveUsd, remainingUsd: p.budgetUsd - spent };
}
function risk(decision) {
  const files = decision.inventarioDiff?.files || [];
  return (decision.verdict === 'approve' ? 10 : 0) + Math.min(files.length, 100)
    + (decision.roundReview?.unresolvedCount || 0) * 10 + (decision.roundReview?.lateCount || 0) * 10
    + files.filter(f => /auth|permission|payment|migration|security|contract/i.test(f.path)).length * 15;
}
function metrics(engine, values) {
  let agree = 0, disagree = 0, inconclusive = 0, confirmedErrors = 0, cost = 0, unavailable = 0, costEstimated = 0;
  for (const value of values) {
    const byItem = new Map(value.assessments.map(a => [a.item, a]));
    for (const item of value.result?.report?.items || []) {
      const human = byItem.get(item.id);
      if (!human) continue;
      if (human.verdict === 'agree') { agree++; if (['incorrect', 'omitted'].includes(item.kind)) confirmedErrors++; }
      else if (human.verdict === 'disagree') disagree++;
      else inconclusive++;
    }
    const c = costFor(engine, value.job); if (c.usd === null) unavailable++; else cost += c.usd;
    if (c.source === 'estimated') costEstimated++;
  }
  let agreement = null, costPerConfirmedError = null;
  if (agree + disagree) agreement = agree / (agree + disagree);
  if (!unavailable && confirmedErrors) costPerConfirmedError = cost / confirmedErrors;
  return { agree, disagree, inconclusive, confirmedErrors, humanCompared: agree + disagree,
    agreement, costKnownUsd: cost, costUnavailable: unavailable, costEstimated, costPerConfirmedError };
}
export { currentPolicy, costFor, automaticAdmission, risk, metrics };
