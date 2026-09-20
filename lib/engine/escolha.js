// Escolha do agendador (7.C5, passos 4 e 5), PURA: qual item sai agora e em qual aparelho.
// Sem estado, sem IO e sem engine: tudo chega por argumento, e é isso que permite comparar
// a ordem dela com a do escalonador local de hoje.
//
// QUAL: o rodízio de hoje, por org, com contador monotônico. Ganha o item da org atendida
// HÁ MAIS TEMPO; org nunca atendida vale -Infinity e fura a fila; empate resolve pela
// ordem de chegada. É a mesma regra de `proximoHeadless`, com `orgTag` no lugar do nome da
// org, e por isso o resultado é o mesmo com um aparelho só.
//
// ELEGIBILIDADE MUDA DE DONO: de "conta abaixo do teto" para "existe aparelho apto com
// vaga". Elegível continua sendo PRÉ-REQUISITO, nunca critério, e por isso a política
// segue work-conserving: se existe item colocável, ele sai.
//
// ONDE: filtra publicadores aptos e com vaga, tira quem recusou ESTE item NESTE head
// dentro da espera que a recusa carregou, e ordena por prioridade e depois por folga
// relativa. Nenhum apto não trava a fila: o item fica com motivo e o laço tenta o próximo.
const NUNCA = -Infinity;

import { preferenciaValida } from '../sync/transferencia.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function aptoNaEspera(recusas, itemId, dev, agora) {
  const doItem = objeto(recusas) ? recusas[itemId] : null;
  const ate = objeto(doItem) ? Number(doItem[dev]) : 0;
  return !(ate > Number(agora));
}

function folga(aparelho) {
  const teto = Math.max(1, Number(aparelho.teto) || 1);
  return (teto - Math.max(0, Number(aparelho.ocupadas) || 0)) / teto;
}

// Aparelhos que podem executar ESTE item: publicaram o candidato, estão aptos, não estão
// pausados, têm vaga e não recusaram este item neste head dentro da janela.
function dadosDo(aparelhos, dev) {
  return objeto(aparelhos) && objeto(aparelhos[dev]) ? aparelhos[dev] : null;
}

function publicadoresDe(item) {
  return Array.isArray(item.publicadores) ? item.publicadores : [];
}

function aparelhosPara(item, aparelhos, { agora = 0, recusas = null } = {}) {
  const elegiveis = publicadoresDe(item)
    .map((dev) => ({ dev, ...dadosDo(aparelhos, dev) }))
    .filter((a) => a && a.apto === true && a.pausado !== true && folga(a) > 0)
    .filter((a) => aptoNaEspera(recusas, item.itemId, a.dev, agora));
  // Transferência voluntária (7.C7b): o destino pedido ganha enquanto a preferência vale e
  // ele continua elegível. Preferência vencida ou destino inelegível não segura o item:
  // reservar um PR para um aparelho que sumiu é o que a spec proíbe.
  const preferido = preferenciaValida({ dev: item.prefDev, ate: item.prefAte }, { agora });
  const escolhido = preferido ? elegiveis.filter((a) => a.dev === preferido) : [];
  return escolhido.length ? escolhido : elegiveis;
}

// POR QUE CADA PUBLICADOR ficou de fora, na mesma ordem em que o filtro acima os tira.
// Sem isto o item ficava "sem aparelho apto" e nada mais, e quem publicou o candidato não
// tinha como saber que o problema era vaga num aparelho e pausa em outro. É descritivo:
// quem decide continua sendo `aparelhosPara`, e nenhuma decisão lê estes textos.
function motivoDoAparelho(item, aparelhos, dev, { agora = 0, recusas = null } = {}) {
  const a = dadosDo(aparelhos, dev);
  if (!a) return 'sem-sinal';
  if (a.pausado === true) return 'pausado';
  // consentimento retirado tem motivo PRÓPRIO: sem ele, um aparelho que recusa admin por
  // princípio aparecia como "sem-sinal", e quem lesse o card procuraria um problema de
  // rede num aparelho que está ali, respondendo, e dizendo não de propósito
  if (a.semConsentimento === true) return 'sem-consentimento';
  if (a.apto !== true) return 'sem-sinal';
  if (!(folga(a) > 0)) return 'sem-vaga';
  if (!aptoNaEspera(recusas, item.itemId, dev, agora)) return 'recusou';
  return '';
}

function motivosPorAparelho(item, aparelhos, ctx = {}) {
  return publicadoresDe(item)
    .map((dev) => ({ dev, motivo: motivoDoAparelho(item, aparelhos, dev, ctx) }))
    .filter((x) => x.motivo);
}

function porPrioridadeEFolga(a, b) {
  const prioridade = (Number(a.prioridade) || 0) - (Number(b.prioridade) || 0);
  if (prioridade !== 0) return prioridade;
  const diferenca = folga(b) - folga(a);
  if (diferenca !== 0) return diferenca;
  return String(a.dev).localeCompare(String(b.dev));
}

function escolherOnde(item, aparelhos, ctx = {}) {
  const candidatos = aparelhosPara(item, aparelhos, ctx);
  if (!candidatos.length) return { dev: '', motivo: 'sem-aparelho-apto' };
  return { dev: [...candidatos].sort(porPrioridadeEFolga)[0].dev, motivo: '' };
}

// Ordem de chegada entre itens: `publishedAt`, com o `itemId` desempatando para a escolha
// ser a mesma em qualquer aparelho que rode a função.
function ordemDeChegada(a, b) {
  return a.publishedAt - b.publishedAt || String(a.itemId).localeCompare(String(b.itemId));
}

function vezDaOrg(item, ultimaDaOrg) {
  const visto = objeto(ultimaDaOrg) ? Number(ultimaDaOrg[item.orgTag]) : NaN;
  return Number.isFinite(visto) ? visto : NUNCA;
}

// A colocação: o item escolhido, o aparelho, e os que ficaram sem aparelho, com motivo.
function escolher(itens, aparelhos, ctx = {}) {
  const fila = [...(Array.isArray(itens) ? itens : [])].sort(ordemDeChegada);
  const semAparelho = [];
  let melhor = null;
  for (const item of fila) {
    const onde = escolherOnde(item, aparelhos, ctx);
    if (!onde.dev) {
      semAparelho.push({ itemId: item.itemId, motivo: onde.motivo, aparelhos: motivosPorAparelho(item, aparelhos, ctx) });
      continue;
    }
    const vez = vezDaOrg(item, ctx.ultimaDaOrg);
    if (!melhor || vez < melhor.vez) melhor = { item, dev: onde.dev, vez };
    if (melhor.vez === NUNCA) break; // org nunca atendida ganha de todas
  }
  if (!melhor) return { item: null, dev: '', semAparelho };
  return { item: melhor.item, dev: melhor.dev, semAparelho };
}

export default { escolher, escolherOnde, aparelhosPara, motivosPorAparelho };
export { escolher, escolherOnde, aparelhosPara, motivosPorAparelho };
