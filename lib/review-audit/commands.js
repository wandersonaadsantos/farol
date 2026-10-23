// API local e tick: seleção, avaliação humana e configuração explícita.
import { start, running, accountEligibility } from './runner.js';
import * as store from './store.js';
import { targetFor } from './source.js';
import { check, text, policy, digest } from './contract.js';
import { currentPolicy, costFor, automaticAdmission, metrics, risk } from './sampling.js';

function candidateFor(engine, decision, account) {
  try {
    const target = targetFor(engine, decision.id, account.user);
    return { id: decision.id, account: target.account, key: target.key, head: target.head, risk: risk(decision), fingerprint: target.fingerprint };
  } catch { return null; }
}
function candidates(engine) {
  const result = [...engine.decisions.pending, ...engine.decisions.resolved].flatMap(d => engine.accountList().map(a => candidateFor(engine, d, a))).filter(Boolean);
  return result.sort((a, b) => b.risk - a.risk || a.id.localeCompare(b.id));
}
function view(engine) {
  const values = store.jobs().map(job => ({ job, result: store.read(job.id, 'result'), assessments: store.assessments(job.id), cost: costFor(engine, job) }));
  return { ok: true, policy: currentPolicy(engine), policyVersion: digest(currentPolicy(engine)), candidates: candidates(engine),
    jobs: values.map(v => ({ ...v, status: v.result?.status || (running(engine) ? 'running' : 'interrupted') })), metrics: metrics(engine, values), admission: automaticAdmission(engine, values.map(v => v.job)) };
}
function savePolicy(engine, next) {
  const previous = engine.config.auditSampling;
  engine.config.auditSampling = next;
  try { engine.saveConfig(); }
  catch (error) { engine.config.auditSampling = previous; throw error; }
}
function mutate(engine, body) {
  const unlock = store.lock();
  try {
      if (body.action === 'configure') {
        check(body.expected === digest(currentPolicy(engine)), 'Configuração mudou; recarregue.');
        const next = policy(body.policy);
        check(next.accounts.every(a => engine.accountList().some(c => c.user.toLowerCase() === a)), 'Conta da amostragem não configurada.');
        savePolicy(engine, next); engine.pushState(); return { ok: true };
      }
      if (body.action === 'assess') {
        const result = store.read(body.id, 'result');
        check(result?.status === 'completed' && result.report.items.some(i => i.id === body.item), 'Item auditado não encontrado.');
        check(['agree', 'disagree', 'inconclusive'].includes(body.verdict), 'Avaliação humana inválida.');
        const note = text(body.note);
        return { ok: true, assessment: store.assess(body.id, body.expected ?? null, body.item, body.verdict, note) };
      }
      throw new Error('Operação de auditoria inválida.');
  } finally { unlock(); }
}
async function command(engine, body) {
  try {
    if (body.action === 'view') return view(engine);
    if (body.action === 'start') { check(body.confirmed === true, 'Confirme o início da auditoria com consumo de IA.'); return start(engine, body); }
    return mutate(engine, body);
  } catch (error) { return { ok: false, error: error.code ? 'Falha no armazenamento local; registros preservados.' : error.message }; }
}
async function tick(engine) {
  if (!currentPolicy(engine).enabled || running(engine) || engine.activeReviews.size || engine.headlessQueue.length) return;
  const existing = store.jobs(), admission = automaticAdmission(engine, existing);
  if (!admission.ok) return;
  const allowed = currentPolicy(engine).accounts;
  const candidate = candidates(engine).find(c => allowed.includes(c.account) && !accountEligibility(engine, c.account) && !existing.some(j => j.target.fingerprint === c.fingerprint));
  if (candidate) start(engine, { decisionId: candidate.id, account: candidate.account }, 'automatic');
}
export { command, view, candidates, tick };
