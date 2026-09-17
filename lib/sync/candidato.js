// Candidato à distribuição (7.C5 e anexo S3), a parte pura: a forma do ponteiro e a fusão
// de candidatos do mesmo trabalho. Sem estado, sem IO, sem rede.
//
// CANDIDATO É PONTEIRO, nunca o PR. Viajam tags (PR, conta, org e versão material), o
// rascunho, se é rodada automática e o TTL. Não viaja `requested` (CT-FIO: quem decide se
// a revisão foi pedida a mim é o executor, com a credencial dele), não viaja peso, não
// viaja estacionamento e não viaja texto legível.
//
// O HEAD VIAJA COMO TAG (`mat`). O executor calcula a tag do head ATUAL e compara: se não
// bater, recusa com código. Nunca se presume que o head de agora é o que foi atribuído.
//
// FUNDIR: o mesmo par (PR, versão material) publicado por dois aparelhos é UM item com
// dois publicadores, e os publicadores são exatamente os executores possíveis, porque só
// publica quem tem a conta e passou pelos gates locais.
import { tag, prTag, acctTag } from './tags.js';

const MAX_OWNER = 60;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// mesma normalização do headlessOrg: owner em minúsculas, inclusive owner pessoal
function orgTag(kId, owner) {
  return tag(kId, 'org', String(owner || '').trim().toLowerCase());
}

function matTag(kId, head) {
  return tag(kId, 'mat', String(head || '').trim());
}

function itemIdDe(prTagValor, matTagValor) {
  return `${prTagValor}_${matTagValor}`;
}

function ownerDe(chave) {
  return String(chave || '').split('/')[0];
}

// A projeção. O nome do owner fica FORA do claro: ele viaja cifrado, e só como apresentação.
// `preferencia` só existe na transferência voluntária (7.C7b): ela é o único jeito de a
// colocação sair para um aparelho específico, e por isso tem PRAZO. Sem prazo, um aparelho
// que sumiu reservaria o PR para sempre.
function candidatoDe(pr, { kId, conta, agora, ttlMs, preferencia = null }) {
  const p = objeto(pr) ? pr : {};
  const chave = String(p.key || '');
  const head = String(p.headSha || p.knownHead || '');
  if (!chave || !head) return null;
  const alvo = prTag(kId, chave);
  const material = matTag(kId, head);
  return {
    itemId: itemIdDe(alvo, material),
    prTag: alvo,
    matTag: material,
    acctTag: conta ? acctTag(kId, String(conta)) : '',
    orgTag: orgTag(kId, ownerDe(chave)),
    isDraft: p.isDraft === true,
    rodadaAutomatica: p.manual !== true,
    publishedAt: Number(agora) || 0,
    ttl: (Number(agora) || 0) + (Number(ttlMs) || 0),
    ...prefDe(preferencia),
  };
}

function prefDe(preferencia) {
  const p = objeto(preferencia) ? preferencia : null;
  const dev = p ? String(p.dev || '').trim().slice(0, 64) : '';
  const ate = p ? Number(p.ate) || 0 : 0;
  return dev && ate > 0 ? { prefDev: dev, prefAte: ate } : {};
}

// Nome do owner é APRESENTAÇÃO: entra cifrado e não decide nada (nem elegibilidade, nem
// prioridade, nem credencial). Sem ele, a tela mostra rótulo genérico e o rodízio segue
// pelo tag.
function nomeDoOwner(pr) {
  return ownerDe(objeto(pr) ? pr.key : '').slice(0, MAX_OWNER);
}

function vivo(c, agora) {
  return objeto(c) && Number(c.ttl) > Number(agora);
}

// Une candidatos de vários aparelhos: um item por (PR, versão material), com a lista de
// publicadores. Candidato vencido não entra, e o item guarda o `publishedAt` mais antigo,
// que é o que o rodízio usa como ordem de chegada.
function juntar(itens, dev, c) {
  const atual = itens.get(c.itemId);
  if (!atual) { itens.set(c.itemId, { ...c, publicadores: [dev] }); return; }
  if (!atual.publicadores.includes(dev)) atual.publicadores.push(dev);
  atual.publishedAt = Math.min(atual.publishedAt, c.publishedAt);
  // a preferência da transferência vale mesmo que só um publicador a carregue: ela é um
  // pedido de quem entregou o trabalho, não uma propriedade do PR
  if (!atual.prefDev && c.prefDev) { atual.prefDev = c.prefDev; atual.prefAte = c.prefAte; }
}

function listaDe(v) {
  return Array.isArray(v) ? v : [];
}

function mapaDe(v) {
  return objeto(v) ? v : {};
}

function fundir(publicados, { agora }) {
  const itens = new Map();
  for (const [dev, lista] of Object.entries(mapaDe(publicados))) {
    for (const c of listaDe(lista)) if (vivo(c, agora)) juntar(itens, dev, c);
  }
  return [...itens.values()].map((i) => ({ ...i, publicadores: [...i.publicadores].sort() }));
}

export default { orgTag, matTag, itemIdDe, candidatoDe, nomeDoOwner, fundir, vivo };
export { orgTag, matTag, itemIdDe, candidatoDe, nomeDoOwner, fundir, vivo };
