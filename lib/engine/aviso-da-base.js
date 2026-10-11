// O aviso de PR meu em conflito ou superado pela base (11/10/2026), PURO: os textos do toast
// e da notificação do sistema, do desenho do Claude Design de 10/10/2026
// (docs/superpowers/specs/2026-10-10-aviso-da-base-anexos/HANDOFF.md).
//
// Um aviso por PR e commit; quando o mesmo ciclo acha mais de um (o caso de reabrir o app),
// sai UM aviso agrupado, em vez de uma pilha de toasts. O título não repete "Farol": Windows e
// macOS já mostram o nome do app no cabeçalho da notificação.

const CURTA = /^[^/]+\/(.+)$/;

// `acme-exemplo/app#57` vira `app#57`, a chave que cabe numa linha do aviso agrupado
function chaveCurta(key) {
  const m = String(key || '').match(CURTA);
  return m ? m[1] : String(key || '');
}

function fraseDoPr(item) {
  return item.estado === 'superado'
    ? `tudo o que ele muda já está em ${item.base}. Não sobrou nada para entregar, dá para fechar sem merge.`
    : `em conflito com ${item.base}. Atualize a branch antes do merge.`;
}

// a linha da notificação do sistema; o toast acrescenta o que fazer no superado
function linhaCurta(item) {
  return item.estado === 'superado'
    ? `${chaveCurta(item.key)} superado pela base`
    : `${chaveCurta(item.key)} em conflito com ${item.base}`;
}

function linhaDoToast(item) {
  return item.estado === 'superado' ? `${linhaCurta(item)}, dá para fechar` : linhaCurta(item);
}

// `itens`: [{ key, url, estado: 'superado' | 'conflito', base }], na ordem em que foram achados.
// Devolve o que o toast e a notificação mostram, ou null sem item.
function avisoDaBase(itens) {
  const lista = Array.isArray(itens) ? itens.filter(i => i && i.key) : [];
  if (!lista.length) return null;
  if (lista.length === 1) {
    const [i] = lista;
    const titulo = i.estado === 'superado' ? 'PR superado pela base' : 'PR em conflito';
    return {
      titulo, tituloSistema: titulo, url: i.url,
      corpo: `${i.key}: ${fraseDoPr(i)}`,
      itens: [{ key: i.key, url: i.url, texto: fraseDoPr(i) }],
    };
  }
  const n = lista.length;
  return {
    titulo: `${n} PRs seus precisam de você por causa da base`,
    tituloSistema: `${n} PRs precisam de você por causa da base`,
    url: '',
    corpo: `${lista.map(linhaCurta).join('; ')}.`,
    itens: lista.map(i => ({ key: i.key, url: i.url, texto: linhaDoToast(i) })),
  };
}

const aviso = { avisoDaBase, chaveCurta };
export default aviso;
export { avisoDaBase, chaveCurta };
