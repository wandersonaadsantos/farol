/* Renderização INERTE do diagnóstico unificado (spec 7.A3).

   Não é um renderizador de Markdown de uso geral, e não vira um: o `md()` do comum.js
   monta link e é o certo para o relatório de review, que é conteúdo do próprio Farol. Aqui
   a entrada carrega mensagem de erro de terceiro, e a promessa é outra: nada do texto vira
   tag, atributo, link, imagem ou fonte externa. Só saem h3/h4/p/ul/li/pre/code, com o
   conteúdo escapado, e nenhuma tag recebe atributo vindo do texto. */
import { esc } from './comum.js';

const CERCA = /^(`{3,})\s*[a-z]*\s*$/i;
const TITULO = /^(#{1,3})\s+(.*)$/;
const ITEM = /^\s*[-*]\s+(.*)$/;

// só `código` volta a ser marcação; o resto do texto fica como o autor escreveu, escapado
function linhaInline(s) {
  return esc(s).split(/`/).map((p, i) => (i % 2 ? `<code>${p}</code>` : p.replace(/\\([\\`*_[\]()<>!#|~+-])/g, '$1'))).join('');
}

function diagnosticoHtml(src) {
  const out = [];
  let dentro = null;
  let bloco = [];
  let lista = false;
  const fecharLista = () => { if (lista) { out.push('</ul>'); lista = false; } };
  const fecharBloco = () => { out.push(`<pre>${esc(bloco.join('\n'))}</pre>`); bloco = []; dentro = null; };
  for (const bruta of String(src === undefined || src === null ? '' : src).split(/\r?\n/)) {
    const linha = bruta.replace(/\s+$/, '');
    if (dentro) {
      if (linha.trim() === dentro) fecharBloco();
      else bloco.push(bruta);
      continue;
    }
    const abre = CERCA.exec(linha.trim());
    if (abre) { fecharLista(); dentro = abre[1]; continue; }
    const t = TITULO.exec(linha);
    if (t) {
      fecharLista();
      const nivel = Math.min(4, t[1].length + 2);
      out.push(`<h${nivel}>${linhaInline(t[2])}</h${nivel}>`);
      continue;
    }
    const li = ITEM.exec(linha);
    if (li) {
      if (!lista) { out.push('<ul>'); lista = true; }
      out.push(`<li>${linhaInline(li[1])}</li>`);
      continue;
    }
    fecharLista();
    if (linha.trim()) out.push(`<p>${linhaInline(linha)}</p>`);
  }
  fecharLista();
  // cerca sem fechamento sai como bloco mesmo assim: engolir o resto seria esconder o
  // pedaço do diagnóstico que mais interessa, que é justamente o texto cru da falha
  if (dentro) fecharBloco();
  return out.join('');
}

export { diagnosticoHtml };
