import { bloqueioDeInicio } from './review-scope.js';

export function aguardaCliquePorRegra(engine, pr, acct, encerrar) {
  // A regra pode mudar enquanto o item espera uma vaga. Revalide antes de IO ou IA.
  const politica = bloqueioDeInicio(engine, pr);
  if (politica) {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    engine.log('INFO', `${pr.key}: revisão aguardando clique (${politica}).`);
    encerrar(engine, pr, acct);
    return true;
  }
  return false;
}

