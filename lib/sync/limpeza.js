// O que a limpeza protegida alcança, e o que ela nunca alcança (7.C2). Puro: sem estado,
// sem IO, sem rede.
//
// A LISTA É POSITIVA, e isso é deliberado. Uma lista de proibidos parece equivalente e não
// é: o dia em que um nó novo nascer, a lista negativa o torna apagável por omissão, e
// ninguém vai lembrar de revisá-la. Com a lista positiva, o nó novo é preservado por
// omissão e alguém precisa decidir incluí-lo. Num ato irreversível, o default é preservar.
//
// `PROIBIDOS` existe só para poder afirmar, num teste, o que a spec nomeia: chaveiro,
// controle, leases, recibos e rodadas nunca entram. Quem decide de verdade é `alcancavel`,
// e ele responde `false` para tudo que não estiver em `CATEGORIAS`, inclusive um caminho
// inventado.
import { SYNC } from '../constants.js';

// Conteúdo sincronizado que existe hoje, e que as regras do banco deixam remover sob as
// condições da limpeza. Entrega que publicar conteúdo novo (C3 em diante) acrescenta o nó
// dela AQUI **junto com a regra dele**: sem concessão de remoção no nó pai, o banco recusa
// o DELETE e a categoria seria uma promessa que não se cumpre.
const CATEGORIAS = ['live/deviceStatus', 'live/devicePolicies', 'live/groups', 'catalog', 'recentReviews', 'reviewBodies', 'panorama', 'panoramaMeta', 'myPrs', 'myPrsMeta', 'pushbacks', 'live/queue', 'live/assign', 'live/ack', 'usageEvents'];

// Nomeados pela spec: nunca entram na limpeza, em nenhuma circunstância.
const PROIBIDOS = ['keyring', 'live/control', 'leases', 'receipts', 'dailyRounds'];

function texto(v) { return typeof v === 'string' ? v.trim().replace(/^\/+|\/+$/g, '') : ''; }

function alcancavel(caminho) {
  const c = texto(caminho);
  if (!c) return false;
  return CATEGORIAS.some((cat) => c === cat || c.startsWith(`${cat}/`));
}

// Só o que passa fica: pedido com categoria proibida junto não recusa o pacote inteiro,
// porque isso faria o dono perder o caminho legítimo por causa de um pedido torto.
function categoriasAlcancaveis(pedidas) {
  const lista = Array.isArray(pedidas) ? pedidas : CATEGORIAS;
  return lista.map(texto).filter((c) => alcancavel(c));
}

function formaDaTrava({ dev, agora }) {
  return { dev: texto(dev), x: (Number(agora) || 0) + SYNC.LIMPEZA_TRAVA_MS };
}

function travaViva(trava, agora) {
  if (!trava || typeof trava !== 'object') return false;
  return (Number(trava.x) || 0) > (Number(agora) || 0);
}

export default { CATEGORIAS, PROIBIDOS, alcancavel, categoriasAlcancaveis, formaDaTrava, travaViva };
export { CATEGORIAS, PROIBIDOS, alcancavel, categoriasAlcancaveis, formaDaTrava, travaViva };
