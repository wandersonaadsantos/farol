// Catálogo cifrado de PR (7.C3) e o resumo do texto claro. Puro: sem estado, sem IO.
//
// O CATÁLOGO É REGENERÁVEL, e isso define o que ele pode ser. Ele existe para NOMEAR um PR
// em qualquer aparelho: título, autor, repo, número. Perdê-lo custa um nome na tela, nunca
// uma decisão. Por isso nada de gate, fila ou postagem pode ler daqui, e um teste guarda
// essa ausência.
//
// O RESUMO DO CLARO é o que decide se vale escrever. Ele precisa de duas propriedades, e
// as duas têm caso próprio no teste: ser ESTÁVEL entre execuções (senão toda reabertura do
// Farol republicaria tudo) e INDEPENDENTE DA ORDEM das chaves (senão um objeto montado por
// outro caminho pareceria mudado). Ele não é segredo nem identidade: é um resumo local do
// que já subiu, e nunca viaja.
import { createHash } from 'node:crypto';
import io from '../io.js';

const CAMPOS = ['key', 'url', 'title', 'author', 'repo', 'number', 'isDraft'];
const MAX_TITULO = 200;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function texto(v, max) {
  const t = typeof v === 'string' ? v.trim() : '';
  return max ? t.slice(0, max) : t;
}

// Ordenação recursiva das chaves: é o que torna o resumo independente da ordem em que o
// objeto foi montado.
function ordenado(v) {
  if (Array.isArray(v)) return v.map(ordenado);
  if (!objeto(v)) return v;
  const saida = {};
  for (const k of Object.keys(v).sort()) saida[k] = ordenado(v[k]);
  return saida;
}

function resumoDoClaro(valor) {
  return createHash('sha256').update(io.safeStringify(ordenado(valor), 'null'), 'utf8').digest('hex').slice(0, 32);
}

// Allowlist: o que vier a mais no objeto do PR não sobe. O que sobe é o que nomeia.
function linhaDoCatalogo(pr) {
  const p = objeto(pr) ? pr : {};
  return {
    key: texto(p.key),
    url: texto(p.url),
    title: texto(p.title, MAX_TITULO),
    author: texto(p.author),
    repo: texto(p.repo),
    number: Number(p.number) || 0,
    isDraft: p.isDraft === true,
  };
}

function resumoDaLinha(linha) {
  return resumoDoClaro(linhaDoCatalogo(linha));
}

export default { CAMPOS, MAX_TITULO, linhaDoCatalogo, resumoDaLinha, resumoDoClaro };
export { CAMPOS, MAX_TITULO, linhaDoCatalogo, resumoDaLinha, resumoDoClaro };
