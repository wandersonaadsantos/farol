// A UI é uma página só (20/10/2026): a rota da tela mora no CAMINHO (`/radar/pra-mim`,
// `/sistema/contas`), então abrir ou recarregar um caminho profundo tem que devolver o
// index.html, e a tela lê o endereço (ui/pure/rota.js). Este módulo decide, sem lançar,
// o que o pedido recebe: um arquivo da pasta da UI que existe, o index.html (navegação) ou
// nada (404). Quem chama (lib/http-server.js) já aplicou a allowlist de Host e Origin, e
// /api (SSE incluso) é roteado antes de chegar aqui.
import fs from 'node:fs';
import path from 'node:path';

// último pedaço com extensão é pedido de ARQUIVO: se não existe, é 404, nunca a página no
// lugar de um script ou de uma folha de estilo que sumiu
const COM_EXTENSAO = /\.[A-Za-z0-9]+$/;
const METODOS_DE_LEITURA = new Set(['GET', 'HEAD']);

function arquivoComum(full) {
  try { return fs.statSync(full).isFile(); } catch { return false; }
}

// a página só vai para navegação: /api (sem a barra final, ou rota que o roteador da API
// não conhece) responde como API, e último pedaço com extensão é pedido de arquivo
function cabePagina(partes) {
  return partes[1] !== 'api' && !COM_EXTENSAO.test(partes[partes.length - 1]);
}

function pagina(raiz) { return { arquivo: path.join(raiz, 'index.html'), pagina: true }; }

// `%` malformado não decodifica, e então não resolve arquivo nenhum: leva a página (a tela
// cai no padrão, Radar > Pra mim), salvo se o pedido não cabe nela
function paginaSemDecodificar(cru, raiz) {
  return cru.startsWith('/') && cabePagina(cru.split('/')) ? pagina(raiz) : null;
}

/* Caminho do pedido (o pathname cru, ainda codificado) -> { arquivo, pagina } ou null.
   Travessia nunca escapa da pasta: o caminho é decodificado UMA vez e recusado se tiver
   `..`, `.`, barra invertida ou byte nulo (o `%2e%2e` e o `%5c` decodificam para isso), e o
   resolvido ainda é conferido contra a pasta. Recusa é 404, nunca o index.html. */
function resolverDaUi(pathname, uiDir, metodo = 'GET') {
  if (!METODOS_DE_LEITURA.has(String(metodo).toUpperCase())) return null;
  const cru = String(pathname || '/');
  const raiz = path.resolve(uiDir);
  let caminho;
  try { caminho = decodeURIComponent(cru); } catch { return paginaSemDecodificar(cru, raiz); }
  if (!caminho.startsWith('/') || caminho.includes('\\') || caminho.includes('\0')) return null;
  const partes = caminho.split('/');
  if (partes.some((s) => s === '..' || s === '.')) return null;
  const alvo = path.resolve(raiz, `.${caminho}`);
  const relativo = path.relative(raiz, alvo);
  if (relativo.startsWith('..') || path.isAbsolute(relativo)) return null;
  if (relativo && partes[1] !== 'api' && arquivoComum(alvo)) return { arquivo: alvo, pagina: false };
  return cabePagina(partes) ? pagina(raiz) : null;
}

export { resolverDaUi };
