/* Farol · UI: Panorama e Meus PRs de outros aparelhos (visão compartilhada, 7.C3).

   A projeção chega por dois caminhos: `POST /api/sync/lists` quando a página abre (o que o
   relógio do engine já leu) e o evento SSE `sync-lists`, que o bootstrap só repassa. O HTML
   mora em ui/pure/listas-remotas.js; aqui mora o que toca DOM, estado() e rede.

   As duas abas continuam donas das próprias listas (telas/radar.js e telas/meus-prs.js):
   elas chamam `renderPanoramaRemoto`/`renderMeusPrsRemoto` com a lista local e o filtro que
   já aplicam, e recebem de volta quantas linhas remotas entraram, para a contagem da aba
   somar sem repetir. Quando chega projeção nova, a tela pede o redesenho pela função que o
   bootstrap injeta em `initListasRemotas` (nunca importando as abas: seria ciclo). */

import { mesclarListaRemota, panoramaRemotoHtml, meusPrsRemotoHtml } from '../pure.js';
import { estado } from './estado.js';
import { $, api } from './infra.js';

// a busca inicial é uma só; falhou, tenta de novo no máximo uma vez por minuto
const BUSCA_MIN_MS = 60000;

const LISTAS = { dados: null, buscando: false, buscadoEm: 0 };
let _redesenhar = null;

function syncAtual() { return (estado() && estado().sync) || {}; }

function pintar(seletor, html) {
  const alvo = $(seletor);
  alvo.innerHTML = html;
  alvo.hidden = !html;
}

async function buscarListas() {
  if (LISTAS.buscando || LISTAS.dados || Date.now() - LISTAS.buscadoEm < BUSCA_MIN_MS) return;
  LISTAS.buscando = true;
  LISTAS.buscadoEm = Date.now();
  const r = await api('/api/sync/lists', {});
  LISTAS.buscando = false;
  // o evento pode ter chegado durante a busca, e ele é mais novo que a resposta
  if (!r || r.ok !== true || LISTAS.dados) return;
  LISTAS.dados = r;
  if (_redesenhar) _redesenhar();
}

function mesclar(locais, tipo, filtro) {
  const sync = syncAtual();
  // quem decide se ainda falta a projeção é buscarListas, numa guarda só
  if (sync.shared === true && !sync.bloqueioCompartilhamento) buscarListas();
  return mesclarListaRemota(locais, LISTAS.dados, tipo, { sync, filtro, agora: Date.now() });
}

// Devolve quantas linhas remotas entraram na aba, já sem as que a lista local tem.
function renderPanoramaRemoto(locais, filtro) {
  const m = mesclar(locais, 'panorama', filtro);
  pintar('#panoramaRemoto', panoramaRemotoHtml(m));
  return m.remotas.length;
}

function renderMeusPrsRemoto(locais, filtro) {
  const m = mesclar(locais, 'myPrs', filtro);
  pintar('#myPRsRemoto', meusPrsRemotoHtml(m));
  return m.remotas.length;
}

function aoListasRemotas(d) {
  LISTAS.dados = d && typeof d === 'object' ? d : null;
  if (_redesenhar && estado()) _redesenhar();
}

function initListasRemotas(redesenhar) {
  _redesenhar = redesenhar;
}

export { initListasRemotas, aoListasRemotas, renderPanoramaRemoto, renderMeusPrsRemoto };
