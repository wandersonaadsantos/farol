// O fim de um item da distribuição (passo 9 do anexo S3, FECHAR E LIMPAR): quem executou
// fecha, quem publicou esquece, e o agendador varre o que venceu. Mora fora do
// sync-distribuicao.js porque não depende do ciclo: só dos dois nós do conjunto e do mapa
// de candidatos deste aparelho.
import candidato from '../sync/candidato.js';
import publicar from './sync-publicar.js';

const NO_FILA = 'live/queue';
const NO_ATRIBUICAO = 'live/assign';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mapaDe(v) {
  return objeto(v) ? v : {};
}

// o mesmo mapa que a publicação preenche (`rt.candidatos`), e só ele
function candidatosDe(rt) {
  if (!(rt.candidatos instanceof Map)) rt.candidatos = new Map();
  return rt.candidatos;
}

// 9. FECHAR E LIMPAR (anexo S3). Quem executou remove o item na conclusão: todos os
// registros de publicador e a atribuição. Sem isto o item seguia vivo depois da sessão, o
// agendador atribuía de novo quando a atribuição vencia, e o MESMO head rodava outra vez
// (medido na bancada com engines reais, 17/09/2026). "Conclusão" é o fim da execução,
// concluída ou não: falha aqui estaciona aqui, e outro aparelho que ainda queira o PR
// publica de novo e recebe a colocação, que é o que o estacionamento significa na spec.
async function fecharItem(engine, itemId) {
  const rt = engine.sync;
  const id = String(itemId || '');
  if (!rt || !rt.client || !rt.uid || !/^[0-9a-f]+_[0-9a-f]+$/.test(id)) return { ok: false, code: 'forma' };
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_FILA}/${id}`);
  let falhas = 0;
  for (const dev of Object.keys(mapaDe(lido && lido.valor))) {
    const r = await rt.client.del(`/users/${rt.uid}/${NO_FILA}/${id}/${dev}`);
    if (!r || !r.ok) falhas += 1;
  }
  const a = await rt.client.del(`/users/${rt.uid}/${NO_ATRIBUICAO}/${id}`);
  if (!a || !a.ok) falhas += 1;
  candidatosDe(rt).delete(id);
  return { ok: !!lido && falhas === 0 };
}

// Quem publicou deixa de esperar pelo item que saiu do conjunto (fechado por quem executou,
// ou apagado na faxina). O PR volta a ser da coleta local: se ele ainda precisar de
// revisão, o próximo ciclo publica de novo; se terminou em outro aparelho, o recibo já o
// marcou como visto. Publicação mais nova que a leitura fica: a leitura não a conhece.
function esquecerConcluidos(engine, arvoreFila, { lidoEm = Date.now() } = {}) {
  const rt = engine.sync;
  const vivos = new Set(Object.keys(mapaDe(arvoreFila)));
  const esquecidos = [];
  for (const [itemId, c] of candidatosDe(rt)) {
    if (vivos.has(itemId) || !(Number(c && c.publicadoEm) < Number(lidoEm))) continue;
    candidatosDe(rt).delete(itemId);
    if (engine.headlessDistribuindo instanceof Map && c.pr) engine.headlessDistribuindo.delete(c.pr.key);
    esquecidos.push(itemId);
  }
  return esquecidos;
}

// A faxina do agendador: registro de publicador vencido sai, e a atribuição de item que
// ficou sem publicador vivo sai junto. Sem ela `live/queue` acumula lixo a cada push,
// porque head novo cria item novo.
async function faxinaDaFila(rt, { fila, atribuicoes, agora }) {
  const comVivo = new Set();
  for (const [itemId, publicadores] of Object.entries(mapaDe(fila))) {
    for (const [dev, no] of Object.entries(mapaDe(publicadores))) {
      if (candidato.vivo(no, agora)) comVivo.add(itemId);
      else await rt.client.del(`/users/${rt.uid}/${NO_FILA}/${itemId}/${dev}`);
    }
  }
  for (const itemId of Object.keys(mapaDe(atribuicoes))) {
    if (!comVivo.has(itemId)) await rt.client.del(`/users/${rt.uid}/${NO_ATRIBUICAO}/${itemId}`);
  }
}

export default { fecharItem, esquecerConcluidos, faxinaDaFila, NO_FILA, NO_ATRIBUICAO };
export { fecharItem, esquecerConcluidos, faxinaDaFila, NO_FILA, NO_ATRIBUICAO };
