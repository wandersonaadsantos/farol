// Memória de pushback entre aparelhos (7.C3), a parte pura. Sem estado, sem IO, sem rede.
//
// SÓ REGISTRO CONFIRMADO SOBE. Suspeita de baixa confiança é convite para a pessoa
// confirmar, e propagar suspeita faria cada aparelho mostrar como fato o que era palpite.
//
// PRECEDÊNCIA DA DECISÃO MANUAL. Entre manual e automático, manual vence, não importa qual
// é mais novo: alguém olhou e decidiu. Entre dois registros da MESMA origem, vence o mais
// novo; e dois manuais que discordam, com desfechos diferentes, NÃO viram concordância:
// a mesclagem devolve `conflito`, mantém o local e deixa a tela dizer que há divergência.
//
// A memória calibra tom e postura. Ela nunca autoriza postagem nem substitui gate, e um
// teste guarda que nenhum caminho de decisão importa este módulo.
import { tag, prTag } from './tags.js';

const DESFECHOS = ['accepted', 'rejected', 'partial', 'none'];
const ORIGENS = ['manual', 'auto'];
const MAX_NOTA = 300;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function daLista(lista, v) {
  return lista.includes(String(v || '')) ? String(v) : '';
}

function confirmado(reg) {
  return objeto(reg) && reg.status === 'confirmed' && DESFECHOS.includes(String(reg.outcome || ''));
}

// O autor viaja como tag: quem abre o banco não monta a lista de quem contestou o quê.
function projetar(reg, { kId }) {
  const r = objeto(reg) ? reg : {};
  return {
    desfecho: daLista(DESFECHOS, r.outcome),
    nota: String(r.note || '').slice(0, MAX_NOTA),
    origem: daLista(ORIGENS, r.source) || 'auto',
    autorTag: r.author ? tag(kId, 'acct', String(r.author).toLowerCase()) : '',
    at: Number(r.at) || 0,
  };
}

function idDe(kId, key) {
  return prTag(kId, String(key));
}

function pesoDaOrigem(x) {
  return objeto(x) && x.origem === 'manual' ? 2 : 1;
}

// Devolve quem vale e se há divergência. `remoto` já vem projetado; `local` é o registro
// deste aparelho, também projetado, ou nulo.
function vencedor(local, remoto, ficaOLocal, conflito) {
  if (ficaOLocal) return { valor: local, origem: 'local', conflito };
  return { valor: remoto, origem: 'remoto', conflito };
}

function mesclar(local, remoto) {
  if (!objeto(remoto)) return { valor: local || null, origem: 'local', conflito: false };
  if (!objeto(local)) return { valor: remoto, origem: 'remoto', conflito: false };
  const pLocal = pesoDaOrigem(local);
  const pRemoto = pesoDaOrigem(remoto);
  if (pLocal !== pRemoto) return vencedor(local, remoto, pLocal > pRemoto, false);
  const divergem = local.desfecho !== remoto.desfecho;
  if (divergem && pLocal === 2) return vencedor(local, remoto, true, true);
  return vencedor(local, remoto, Number(local.at) >= Number(remoto.at), false);
}

// Registro retirado ou corrigido vira lápide: quem já tinha o antigo apaga, e nenhum
// aparelho o ressuscita depois.
function retiradoDepoisDe(lapide, local) {
  if (!objeto(lapide) || lapide.del !== true) return false;
  return Number(lapide.u) >= Number(objeto(local) ? local.at : 0);
}

export default { DESFECHOS, MAX_NOTA, confirmado, projetar, idDe, mesclar, retiradoDepoisDe };
export { DESFECHOS, MAX_NOTA, confirmado, projetar, idDe, mesclar, retiradoDepoisDe };
