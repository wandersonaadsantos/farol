// O Revisar tudo (`lote`) é clique sem escolha por PR (05/11/2026): atravessa a política da conta
// como o clique, mas o que segura a revisão automática segura também o lote.
import { pedidoSaiu } from './pedido-de-revisao.js';
import { avisaBloqueioHistorico } from './skip-review.js';

// Revisar tudo não escolhe PR: estacionado e saída de cena seguem valendo (só o clique por PR
// os desfaz), e o head decidido e o pedido removido seguram como no automático.
export async function seguraNoLote(engine, pr) {
  if (engine.autoReviewParked?.has(pr.key) || engine.skipComentado?.[pr.key]) return true;
  if (await pedidoSaiu(engine, pr)) return true;
  const historico = await engine.bloqueadoPorHistorico(pr);
  if (historico?.bloqueado) avisaBloqueioHistorico(engine, pr, historico);
  return !!historico?.bloqueado;
}
