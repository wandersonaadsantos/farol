// A revisão aguardando cota volta para a fila, sem consumir tentativa ou estacionar.
import { prepare, quotaFor, quotaError, notify } from './quota.js';
async function prepareAccount(engine, account) {
  await prepare(engine, account);
  const auth = engine.resolveClaudeAuth(account), state = quotaFor(engine, auth);
  notify(engine, [state]);
  if (state.blocked) throw quotaError(state);
  if (engine.budgetBlockedFor?.(account) || engine.grupoSegura?.(account)) throw Object.assign(new Error('Orçamento do perfil ou grupo indisponível após selecionar a cota.'),
    { quotaReservation: { ...state, blocked: true, status: 'budget', reason: 'Orçamento do perfil ou grupo indisponível.' } });
}
function deferBlockedReview(engine, pr, state) {
  engine.unsee(pr.key);
  if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
  const previous = engine.retryAfterNet.get(pr.key);
  engine.retryAfterNet.set(pr.key, { tries: previous?.tries || 0, pr, notBefore: Date.now() + 60_000 });
  notify(engine, [state]);
}
export { prepareAccount, deferBlockedReview };
