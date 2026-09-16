// O nome de um PR que chegou de outro aparelho só como tag (7.C3, catálogo cifrado).
//
// Pendência e andamento viajam com o PR como TAG (lib/sync/tags.js). Para a tela dizer QUAL
// PR, a tag é resolvida pelo catálogo (`lerDoCatalogo`, lib/engine/sync-publicacao.js), que
// já falha fechado: chave de outra época ou envelope adulterado viram `null`.
//
// Uma conferência a mais mora aqui, e é ela que impede o pior erro possível desta tela, que
// é nomear OUTRO PR: a linha que abre precisa gerar, com a chave do conjunto, a mesma tag que
// foi pedida. Linha que abre e nomeia outro PR é tratada como catálogo indisponível.
//
// A forma devolvida é `{ key, account, title, author }` ou `null`, a mesma que a montagem das
// operações usa. A conta sai da tag da conta comparada com as contas configuradas aqui: conta
// que este aparelho não conhece fica vazia, nunca adivinhada.
import kek from '../sync/kek.js';
import { acctTag, prTag, mesmaTag } from '../sync/tags.js';
import publicacao from './sync-publicacao.js';

function contaDaTag(engine, kId, tag) {
  if (!tag) return '';
  const contas = typeof engine.accountList === 'function' ? engine.accountList() : [];
  const achada = contas.find((c) => mesmaTag(acctTag(kId, c.user), tag));
  return achada ? String(achada.user) : '';
}

async function identificarPr(engine, cfg, { prTag: tag = '', acctTag: conta = '' } = {}) {
  const rt = engine.sync;
  if (!tag || !rt || !rt.material) return null;
  const kId = kek.bufferDe(rt.material.id);
  if (!kId) return null;
  const linha = await publicacao.lerDoCatalogo(engine, cfg, String(tag));
  if (!linha || !linha.key || !mesmaTag(prTag(kId, linha.key), tag)) return null;
  return { key: linha.key, account: contaDaTag(engine, kId, conta), title: linha.title, author: linha.author };
}

// Uma leitura por tag, mesmo que ela apareça em vários itens.
async function identificarLista(engine, cfg, itens) {
  const lista = Array.isArray(itens) ? itens : [];
  const nomes = new Map();
  for (const item of lista) {
    const chave = `${item.prTag || ''}|${item.acctTag || ''}`;
    if (!nomes.has(chave)) nomes.set(chave, await identificarPr(engine, cfg, item));
  }
  return lista.map((item) => ({ ...item, pr: nomes.get(`${item.prTag || ''}|${item.acctTag || ''}`) }));
}

export default { identificarPr, identificarLista };
export { identificarPr, identificarLista };
