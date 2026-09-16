// O QUE O ADMIN SABE DOS CANDIDATOS DO CONJUNTO, para a tela e para o comando `iniciar`
// (7.C6 sobre a fila da 7.C5).
//
// Duas coisas moram aqui, e as duas são LEITURA:
//   1. a fila do conjunto como o agendador acabou de fundi-la, guardada no runtime para a
//      tela do admin listar quem espera colocação (`anotarFilaDoConjunto`);
//   2. quem pode executar um item (`executoresDoCandidato`), que são exatamente os
//      aparelhos que publicaram aquele candidato, porque só publica quem tem a conta e
//      passou pelos gates locais. Forçar o início em quem não publicou seria mandar um
//      comando que o executor recusa com `nao_publiquei`.
//
// O NOME DO PR É APRESENTAÇÃO, e vem do catálogo cifrado pela tag, como no andamento: sem
// catálogo aberto a tela mostra o rótulo genérico e o comando continua valendo, porque ele
// anda por tags.
import candidato from '../sync/candidato.js';
import publicacao from './sync-publicacao.js';
import publicar from './sync-publicar.js';

const NO_FILA = 'live/queue';
const MAX_ITENS = 20;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mapaDe(v) {
  return objeto(v) ? v : {};
}

function atribuicaoDe(atribuicoes, itemId, agora) {
  const a = mapaDe(atribuicoes)[itemId];
  if (!objeto(a) || !a.dev || !(Number(a.ttl) > Number(agora))) return null;
  return { dev: String(a.dev), ate: Number(a.ttl) };
}

function nomeDoPr(pr) {
  return pr ? { key: pr.key, account: pr.account, title: pr.title, author: pr.author } : null;
}

function publicadoresDe(item) {
  return (Array.isArray(item.publicadores) ? item.publicadores : []).map((d) => String(d));
}

// Uma linha da fila do conjunto, com allowlist: tags, publicadores, prazo e o nome, quando
// o catálogo o resolve. Nada do registro cru do candidato passa direto.
async function linhaDoItem(engine, cfg, item, { atribuicoes, agora }) {
  const pr = await publicacao.prDaTag(engine, cfg, String(item.prTag || ''));
  return {
    itemId: String(item.itemId || ''),
    prTag: String(item.prTag || ''),
    matTag: String(item.matTag || ''),
    acctTag: String(item.acctTag || ''),
    owner: String(item.owner || ''),
    desde: Number(item.publishedAt) || 0,
    publicadores: publicadoresDe(item),
    atribuido: atribuicaoDe(atribuicoes, item.itemId, agora),
    pr: nomeDoPr(pr),
  };
}

// Só o aparelho que roda o agendador (o admin) enxerga a fila inteira, e é ele que emite
// comando: guardar isto em quem não agenda seria guardar um retrato que nunca se atualiza.
async function anotarFilaDoConjunto(engine, cfg, { itens, atribuicoes, agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!rt) return [];
  const lista = (Array.isArray(itens) ? itens : []).slice(0, MAX_ITENS);
  const linhas = [];
  for (const item of lista) linhas.push(await linhaDoItem(engine, cfg, item, { atribuicoes, agora }));
  rt.filaDoConjunto = linhas;
  return linhas;
}

// Os executores possíveis de um item, lidos AGORA do canal dos candidatos. Registro
// vencido não conta: o aparelho que parou de republicar deixou de se oferecer.
async function executoresDoCandidato(engine, { itemId, agora = Date.now() } = {}) {
  const rt = engine.sync;
  const id = String(itemId || '');
  if (!rt || !rt.client || !rt.uid || !/^[0-9a-f]{32}_[0-9a-f]{32}$/.test(id)) return null;
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_FILA}/${id}`);
  if (!lido) return null;
  const publicadores = [];
  let acctTag = '';
  let matTag = '';
  for (const [dev, no] of Object.entries(mapaDe(lido.valor))) {
    if (!objeto(no) || no.itemId !== id || !candidato.vivo(no, agora)) continue;
    publicadores.push(String(dev));
    acctTag = acctTag || String(no.acctTag || '');
    matTag = matTag || String(no.matTag || '');
  }
  return { itemId: id, publicadores: publicadores.sort(), acctTag, matTag };
}

export default { anotarFilaDoConjunto, executoresDoCandidato, MAX_ITENS };
export { anotarFilaDoConjunto, executoresDoCandidato, MAX_ITENS };
