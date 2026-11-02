// A revisão aguardando cota volta para a fila, sem consumir tentativa ou estacionar.
import { prepare, quotaFor, quotaError, notify } from './quota.js';
async function prepareAccount(engine, account, selectedAuth = null) {
  if (!selectedAuth) await prepare(engine, account);
  const auth = selectedAuth || engine.resolveClaudeAuth(account), state = quotaFor(engine, auth);
  notify(engine, [state]);
  if (state.blocked) throw quotaError(state);
  if (sessionBudgetBlocked(engine, account, selectedAuth)) throw Object.assign(new Error('Orçamento do perfil ou grupo indisponível após selecionar a cota.'),
    { quotaReservation: { ...state, blocked: true, status: 'budget', reason: 'Orçamento do perfil ou grupo indisponível.' } });
}
function sessionBudgetBlocked(engine, account, selectedAuth = null) {
  if (!selectedAuth) return engine.budgetBlockedFor?.(account) || engine.grupoSegura?.(account);
  const profile = engine.config?.claudeProfiles?.find(item => item.id === selectedAuth.id);
  if (selectedAuth.kind !== 'codex' || profile?.kind !== 'codex') throw new Error('Perfil explícito incompatível com a admissão.');
  // Codex é sem custo em dólar, também excluído do teto de grupo em statusDoGrupo.
  // O orçamento próprio da assinatura e sua reserva de cota continuam obrigatórios.
  return engine.profileBudgetStatus(profile).blocked ? profile : null;
}
function deferBlockedReview(engine, pr, state) {
  engine.unsee(pr.key);
  if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
  const previous = engine.retryAfterNet.get(pr.key);
  engine.retryAfterNet.set(pr.key, { tries: previous?.tries || 0, pr, notBefore: Date.now() + 60_000 });
  notify(engine, [state]);
}
export { prepareAccount, deferBlockedReview, sessionBudgetBlocked };
