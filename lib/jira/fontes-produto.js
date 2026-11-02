// Fontes primárias para a revisão. Autoria registrada não comprova autoridade de PO.
import { createHash } from 'node:crypto';

function fonteProduto({ id, url, tipo, texto, autor = '', atualizadoEm = '' }) {
  if (typeof texto !== 'string' || !texto.trim()) return null;
  const hash = createHash('sha256').update(texto).digest('hex');
  return { id, url, tipo, texto, autor, atualizadoEm, hash, autoridade: 'nao_verificada' };
}

function fontesDoCard(bruto, site) {
  const url = `${site.baseUrl}/browse/${encodeURIComponent(bruto.key)}`;
  return [fonteProduto({ id: 'card', url, tipo: 'card', texto: bruto.fields.description,
    atualizadoEm: bruto.fields.updated || '' })].filter(Boolean);
}

function fontesDosComentarios(comentarios, bruto, site) {
  const url = `${site.baseUrl}/browse/${encodeURIComponent(bruto.key)}`;
  return comentarios.map(c => fonteProduto({ id: `comentario:${c.id}`,
    url: `${url}?focusedCommentId=${encodeURIComponent(c.id)}`, tipo: 'comentario',
    texto: c.body, autor: c.author?.accountId || c.author?.key || '',
    atualizadoEm: c.updated || c.created || '' })).filter(Boolean);
}

export { fontesDoCard, fontesDosComentarios };
