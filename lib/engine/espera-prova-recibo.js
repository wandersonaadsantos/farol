// O recibo de coordenação que barraria a rodada da espera da prova no MESMO commit
// (revisão do PR #245, 17/10/2026).
//
// Com a coordenação entre aparelhos ligada, a primeira revisão grava ao terminar um recibo
// `completed` com a publicação `pending` (nada saiu: o resultado ficou guardado), e a
// identidade do recibo é a operação mais o head. A rodada que a espera da prova relança no
// MESMO head teria a mesma identidade: a admissão recusaria como `recibo` antes de abrir a
// sessão, o PR seria dado como visto e a rodada nunca rodaria enquanto o recibo valesse.
//
// Aqui o recibo sai, condicionado ao etag lido, e SÓ quando é exatamente o caso acima: deste
// aparelho, deste PR e deste head, com a publicação `pending`. Recibo publicado (alguma coisa
// foi para o GitHub), de outro aparelho, leitura que falha ou coordenação fora do ar seguram o
// relançamento neste ciclo, e a espera continua. Coordenação desligada não tem recibo nenhum.
import { coordinationActive } from '../sync/config.js';
import { accountHash, prHash, operationFingerprint } from '../sync/keys.js';
import { readReceipt, invalidateReceipt, receiptBlocks } from '../sync/receipts.js';

const CONECTADO = 'conectado';

function agoraDe(rt) {
  return typeof rt.agora === 'function' ? rt.agora() : Date.now();
}

// Devolve true quando a rodada pode ser relançada (não há recibo que a barre, ou ele saiu).
async function liberarReciboDaRodada(engine, item) {
  if (!coordinationActive((engine.config && engine.config.sync) || {})) return true;
  const rt = engine.sync || {};
  if (rt.status !== CONECTADO || !rt.client) return false;
  const ids = { uid: rt.uid, accountHash: accountHash(engine.accountForPr({ ...item.pr, key: item.key })), prHash: prHash(item.key) };
  if (!ids.prHash || !item.headSha) return false;
  const fp = operationFingerprint('review', item.headSha);
  const lido = await readReceipt(rt.client, ids, fp);
  if (!lido.ok) return false;
  const recibo = lido.receipt;
  if (!recibo || !receiptBlocks(recibo, agoraDe(rt))) return true;
  // Versões antigas carimbavam uma recusa técnica ANTES do POST como failed.
  // Só liberar esse legado sem registro de postagem: intenção incerta precisa ser reconciliada.
  const falhaSemPostagem = recibo.publicationState === 'failed' && !recibo.postagens;
  if ((!falhaSemPostagem && recibo.publicationState !== 'pending') || recibo.deviceId !== rt.deviceId) {
    engine.log('INFO', `${item.key}: espera da prova não relança no head ${String(item.headSha).slice(0, 7)}: o recibo deste commit não é uma revisão pendente deste aparelho.`);
    return false;
  }
  const apagado = await invalidateReceipt(rt.client, ids, fp, { ifMatch: lido.etag });
  if (!apagado.ok) return false;
  if (rt.recibosVistos) delete rt.recibosVistos[item.key];
  return true;
}

export default { liberarReciboDaRodada };
export { liberarReciboDaRodada };
