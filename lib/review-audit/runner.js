// Execução sem capability de postagem, sem checkpoint de review e sem retomada.
import { randomBytes } from 'node:crypto';
import { novoIdDeSessao } from '../engine/sessao-id.js';
import { snapshotFor, targetFor } from './source.js';
import { blindResult, reportResult, check, digest } from './contract.js';
import { blindPrompt, comparisonPrompt } from './prompt.js';
import { jobs, lock, write, read } from './store.js';
import { automaticAdmission } from './sampling.js';

const tasks = new WeakMap();
function running(engine) { return tasks.get(engine) || null; }
function accountEligibility(engine, account) {
  const configured = engine.accountList().find(a => a.user.toLowerCase() === account);
  if (!configured || configured.muted || engine.isMuted?.(account) || !engine.tokenFor(account)) return 'Conta indisponível ou silenciada.';
  if (engine.budgetBlockedFor(account) || engine.grupoSegura?.(account)) return 'Perfil ou grupo sem orçamento disponível.';
  // Uma sessão somente leitura do Claude/Codex tem contrato explícito no executor.
  if (!['dir', 'apikey', 'openrouter', 'codex'].includes(engine.resolveClaudeAuth(account)?.kind)) return 'Provedor sem contrato de leitura autorizado para auditoria.';
  return '';
}
function eligible(engine, account) {
  const reason = accountEligibility(engine, account); check(!reason, reason);
  check(!engine.activeReviews.size && !running(engine) && !engine.headlessQueue.length, 'Aguarde as sessões ou revisões na fila.');
}
async function session(engine, job, index, prompt) {
  check(!engine.activeReviews.size && !engine.budgetBlockedFor(job.target.account) && !engine.grupoSegura?.(job.target.account), 'Capacidade ou orçamento ocupado durante a preparação.');
  const id = job.usageIds[index];
  engine.activeReviews.set(id, { id, keys: [], label: `Auditoria ${job.target.key} · ${index + 1}/2`, mode: 'tool', startedAt: Date.now(), cancellable: true });
  engine.activity.set(id, []); engine.pushState();
  try {
    const response = await engine.runClaudeStream(prompt, { id, account: job.target.account, ref: `Auditoria ${job.target.key}`, operationKind: 'tool', somenteLeitura: true,
      onEvent: e => engine.pushActivity(id, e.kind, e.text, e.agent), onModel: model => engine.setSessionModel(id, model) });
    check(!response.blocked, 'Auditoria não admitida pelo executor.');
    return response;
  } finally { engine.activeReviews.delete(id); engine.activity.delete(id); engine.pushState(); }
}
async function execute(engine, job, unlock) {
  let result;
  try {
    const snapshot = await snapshotFor(engine, job.target);
    write(job.id, 'snapshot', snapshot);
    const first = await session(engine, job, 0, blindPrompt(snapshot));
    const blind = blindResult(first.text, snapshot);
    write(job.id, 'blind', { schema: 1, ...blind, sessionId: first.sessionId || null });
    // A segunda fase não retoma a conversa da primeira nem a sessão original.
    const second = await session(engine, job, 1, comparisonPrompt(snapshot, blind, job.target.original));
    const report = reportResult(second.text, snapshot, blind, job.target.original);
    result = { schema: 1, status: 'completed', at: Date.now(), snapshot: snapshot.fingerprint, report,
      independence: 'fresh-blind-then-comparison; same authorized provider, not human validation', sessions: [first.sessionId || null, second.sessionId || null] };
  } catch {
    // Saída, stderr e credenciais do provedor não são copiados para a API.
    engine.log('WARN', 'Auditoria inconclusiva: fontes, execução ou resposta não puderam ser verificadas. Consulte a atividade da sessão.');
    for (const id of job.usageIds) engine.marcarDesfecho(id, 'parcial');
    result = { schema: 1, status: 'inconclusive', at: Date.now(), reason: 'Fontes, execução ou resposta não puderam ser verificadas. Nenhuma classificação foi aceita.' };
  }
  try { write(job.id, 'result', result); }
  finally { tasks.delete(engine); unlock(); engine.pushState(); }
  return result;
}
function start(engine, { decisionId, account, retry = false }, mode = 'manual') {
  check(typeof account === 'string', 'Escolha a conta da revisão.');
  eligible(engine, account.toLowerCase());
  const target = targetFor(engine, decisionId, account);
  const unlock = lock('run');
  try {
    const existing = jobs();
    const previous = existing.filter(j => j.target.fingerprint === target.fingerprint).sort((a, b) => b.at - a.at)[0];
    if (previous && !retry) { unlock(); return { ok: true, id: previous.id, repeated: true }; }
    if (previous && !read(previous.id, 'result')) write(previous.id, 'result', { schema: 1, status: 'interrupted', at: Date.now(), reason: 'Execução anterior sem resultado. Nova tentativa manual autorizada, sem apagar o histórico.' });
    if (mode === 'automatic') { const admission = automaticAdmission(engine, existing); check(admission.ok, admission.reason); }
    const usageIds = [novoIdDeSessao(engine, 'f').id, novoIdDeSessao(engine, 'f').id];
    const id = digest([target.fingerprint, randomBytes(16).toString('hex')]).slice(0, 32);
    const job = { schema: 1, id, at: Date.now(), mode, target, usageIds };
    write(id, 'job', job);
    const task = Promise.resolve().then(() => execute(engine, job, unlock));
    tasks.set(engine, task);
    task.catch(() => engine.log('ERROR', 'Falha ao preservar resultado da auditoria; os registros existentes foram mantidos.'));
    return { ok: true, id };
  } catch (error) { unlock(); throw error; }
}
export { start, running, accountEligibility };
