/* Farol · UI: as densidades Compacta (padrão) e Expandida do Radar (07/11/2026).

   Vale para Pra mim, Meus PRs e Panorama. A escolha é preferência local da tela
   (localStorage, com try/catch: sem armazenamento a escolha vale nesta janela). O que está
   aberto (a linha que virou card cheio na Compacta, a pílula com o detalhe aberto em cada
   card, Revisões recentes à mostra) é estado só da tela, igual ao meusAbertos de Meus PRs, e
   trocar de densidade recolhe tudo, como no desenho.

   Os cliques são um listener delegado no document; quem redesenha é a função que o
   bootstrap injeta em initDensidade (a mesma repintura do aoMudarRadarSub), para este módulo
   não importar o app.js de volta. */
import { densidadeValida } from '../pure.js';

const CHAVE = 'farol-densidade';
let DENSIDADE = 'compacta';
try { DENSIDADE = densidadeValida(localStorage.getItem(CHAVE)); } catch { /* sem armazenamento local: fica a Compacta */ }

// PR aberto em card cheio na Compacta, pílula com o detalhe aberto por PR e o rodapé de
// Revisões recentes. Donos de escrita: só os handlers abaixo e trocarDensidade.
const linhasAbertas = new Set();
const pilulaAberta = new Map();
let recentesAbertas = false;
let _repintar = null;

function ehCompacta() { return DENSIDADE === 'compacta'; }
// o PR aparece em card cheio? Na Expandida, sempre; na Compacta, só o que a pessoa abriu
function cardCheio(key) { return !ehCompacta() || linhasAbertas.has(key); }
function pilulaDe(key) { return pilulaAberta.get(key) || null; }
function recentesVisiveis() { return !ehCompacta() || recentesAbertas; }

function aplicarDensidade() {
  document.body.dataset.densidade = DENSIDADE;
  document.querySelectorAll('#densidade .dens').forEach(b => {
    const ligado = b.dataset.densidade === DENSIDADE;
    b.classList.toggle('on', ligado);
    b.setAttribute('aria-pressed', ligado ? 'true' : 'false');
  });
}

function repintar() {
  if (_repintar) _repintar();
}

function trocarDensidade(nova) {
  DENSIDADE = densidadeValida(nova);
  linhasAbertas.clear();
  pilulaAberta.clear();
  recentesAbertas = false;
  try { localStorage.setItem(CHAVE, DENSIDADE); } catch { /* sem armazenamento local: vale nesta janela */ }
  aplicarDensidade();
  repintar();
}

// depois de redesenhar, o foco volta ao controle equivalente (o elemento antigo saiu da tela)
function devolverFoco(seletor) {
  const el = document.querySelector(seletor);
  if (el && typeof el.focus === 'function') el.focus();
}

function alternarLinha(key) {
  if (linhasAbertas.has(key)) linhasAbertas.delete(key); else linhasAbertas.add(key);
  pilulaAberta.delete(key);
  repintar();
  devolverFoco(`.pron-seta[data-linha="${CSS.escape(key)}"]`);
}

function alternarPilula(key, id) {
  if (pilulaAberta.get(key) === id) pilulaAberta.delete(key); else pilulaAberta.set(key, id);
  repintar();
  devolverFoco(`.pron-pill[data-pron-key="${CSS.escape(key)}"][data-pron-pilula="${CSS.escape(id)}"]`);
}

function onCliqueDaDensidade(e) {
  const dens = e.target.closest('#densidade .dens');
  if (dens) { if (dens.dataset.densidade !== DENSIDADE) trocarDensidade(dens.dataset.densidade); return; }
  const seta = e.target.closest('.pron-seta[data-linha]');
  if (seta) { alternarLinha(seta.dataset.linha); return; }
  const pilula = e.target.closest('.pron-pill[data-pron-pilula]');
  if (pilula) { alternarPilula(pilula.dataset.pronKey, pilula.dataset.pronPilula); return; }
  if (e.target.closest('[data-recentes-alternar]')) {
    recentesAbertas = !recentesAbertas;
    repintar();
    devolverFoco('[data-recentes-alternar]');
  }
}

function initDensidade(repintarRadar) {
  _repintar = repintarRadar;
  aplicarDensidade();
  document.addEventListener('click', onCliqueDaDensidade);
}

export { initDensidade, ehCompacta, cardCheio, pilulaDe, recentesVisiveis };
