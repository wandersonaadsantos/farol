import { md } from '../pure/comum.js';

// Cache só da apresentação. A fonte continua no estado e o conteúdo alterado ganha outra entrada.
function criarCacheMarkdown(converter, maxEntradas = 32, maxCaracteres = 1024 * 1024) {
  const entradas = new Map();
  let caracteres = 0;
  return texto => {
    const fonte = String(texto || '');
    if (entradas.has(fonte)) {
      const html = entradas.get(fonte);
      entradas.delete(fonte); entradas.set(fonte, html);
      return html;
    }
    const html = converter(fonte);
    const tamanho = fonte.length + html.length;
    if (tamanho > maxCaracteres) return html;
    while (entradas.size && (entradas.size >= maxEntradas || caracteres + tamanho > maxCaracteres)) {
      const primeira = entradas.keys().next().value;
      caracteres -= primeira.length + entradas.get(primeira).length;
      entradas.delete(primeira);
    }
    entradas.set(fonte, html); caracteres += tamanho;
    return html;
  };
}
const markdownReutilizado = criarCacheMarkdown(md);
export { criarCacheMarkdown, markdownReutilizado };
