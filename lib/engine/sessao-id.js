// Id de sessão de IA do Farol (spec 7.A1, item 5). O id é OPACO e único entre boots
// e aparelhos (prefixo do tipo + UUID): é por ele que o desfecho se corrige
// (marcarDesfecho), que a falha durável se liga à linha do Consumo e que a outbox
// monta o eventId. O rótulo curto (a1, s2...) continua existindo, só para exibição.
// O prefixo fica na frente de propósito: kindFromId (lib/engine/usage.js) lê o tipo
// por ele, e as linhas antigas (a1, pb3) continuam sendo lidas do mesmo jeito.
// Sessão de terminal (t<n>) fica fora: não registra consumo nem desfecho.
import { randomUUID } from 'node:crypto';

const PREFIXOS = new Set(['a', 's', 'pb', 'f', 'c']);

function novoIdDeSessao(engine, prefixo) {
  if (!PREFIXOS.has(prefixo)) throw new Error(`prefixo de sessão desconhecido: ${prefixo}`);
  const seq = (Number(engine && engine.sessionSeq) || 0) + 1;
  if (engine) engine.sessionSeq = seq;
  return { id: `${prefixo}-${randomUUID()}`, rotulo: `${prefixo}${seq}` };
}

export default { novoIdDeSessao };
export { novoIdDeSessao };
