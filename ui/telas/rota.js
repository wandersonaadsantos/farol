/* Farol · UI: o endereço da página reflete a tela, e a tela obedece ao endereço (18/10/2026).

   Pedido do dono: "As URLs não refletem exatamente o que vejo em tela". A rota mora no
   hash (`#/radar/aparelhos/<id>`, `#/sistema/contas`, `#/entregas?dias=7`), porque o engine
   serve um index.html só e o proxy e o login do Google devolvem para `/`: caminho não
   sobreviveria. A tradução (e o que pode ou não entrar no endereço) é de ui/pure/rota.js;
   aqui só se LÊ a tela e se APLICA a rota.

   Quando o endereço muda:
   - depois de todo clique, tecla, troca e digitação (ouvinte na window, em bolha: roda
     depois dos handlers do document, inclusive o data-goto, a paleta e os atalhos);
   - quando a caixa de revisão abre ou fecha (avisarNavegacao, telas/registro.js);
   - a cada estado novo do SSE, sempre substituindo (correções que o estado impõe: aba
     opcional desligada, aparelho que sumiu, conta que saiu).
   Lugar novo (aba, sub-aba, aparelho, seção, caixa aberta) empilha no histórico; filtro e
   conta substituem. Voltar e Avançar aplicam a rota da entrada.

   O login do Google devolve para `/` sem hash; aí a tela abre como sempre (o que estava
   guardado) e o endereço passa a dizer onde ela está. */

import { lerRota, escreverRota, mudancaDeRota, accountBarVisible } from '../pure.js';
import { estado, abaAtual, escopo, definirEscopo } from './estado.js';
import { $ } from './infra.js';
import { aoNavegar } from './registro.js';
import { guardarEscopo } from './contas.js';
import { radarSubAtual, switchRadarSub } from './radar.js';
import { aparelhoSelecionado, selecionarAparelho } from './radar-aparelhos.js';
import { secaoDoSistema, sysGoTo } from './sistema.js';
import { filtrosDeEntregas, aplicarFiltrosDeEntregas } from './entregas.js';
import { caixaAberta, abrirCaixaRevisao, fecharCaixaRevisao } from './caixa-revisao.js';

let _switchTab = null;
let _rerenderScope = null;
let ULTIMO_HASH = '';      // o que este módulo escreveu (ou aplicou) por último
let APLICANDO = false;     // aplicando uma rota: a tela muda, mas não é navegação nova
let ROTA_DE_ENTRADA = null; // a do endereço aberto, reaplicada quando o primeiro estado chega

function historicoDisponivel() {
  return typeof history !== 'undefined' && typeof history.pushState === 'function'
    && typeof location !== 'undefined' && typeof location.hash === 'string';
}

function nContas() { return ((estado() && estado().accounts) || []).length; }

function capturarRota() {
  const aba = abaAtual();
  const rota = { aba, sub: radarSubAtual(), aparelho: aparelhoSelecionado(), secao: secaoDoSistema(), pr: caixaAberta() };
  if (accountBarVisible(nContas(), aba) && escopo() !== 'all') rota.conta = escopo();
  if (aba === 'entregas') Object.assign(rota, filtrosDeEntregas());
  return rota;
}

function estadoDaEntrada(rota) {
  const anterior = history.state && history.state.farol ? history.state : {};
  return { farol: true, caixa: !!rota.pr && anterior.caixa === true };
}

/* Escreve no endereço o que está na tela. `substituir` força replace (correção imposta pelo
   estado do engine, nunca uma navegação da pessoa). */
function sincronizarUrl(substituir = false) {
  if (APLICANDO || !_switchTab || !historicoDisponivel()) return;
  const rota = capturarRota();
  const hash = escreverRota(rota);
  if (hash === ULTIMO_HASH) return;
  const modo = substituir ? 'replace' : mudancaDeRota(lerRota(ULTIMO_HASH), rota);
  ULTIMO_HASH = hash;
  if (modo === 'push') { history.pushState({ farol: true, caixa: !!rota.pr }, '', hash); return; }
  // fechar a caixa que a abertura empilhou volta aquela entrada, em vez de empilhar outra igual
  if (modo === 'fechou-caixa' && history.state && history.state.caixa === true) { history.back(); return; }
  history.replaceState(estadoDaEntrada(rota), '', hash);
}

function aplicarConta(rota) {
  let alvo = rota.conta || '';
  if (!alvo && accountBarVisible(nContas(), rota.aba)) alvo = 'all';
  if (!alvo || alvo === escopo()) return;
  definirEscopo(alvo);
  guardarEscopo(alvo);
  if (estado()) _rerenderScope();
}

// Aparelhos só existe com a visão compartilhada ligada (o botão da sub-aba some sem ela)
function aparelhosEscondido() {
  const apar = $('#rsub-apar');
  return !!estado() && !!apar && apar.hidden;
}

function aplicarRadar(rota) {
  const sub = rota.sub === 'apar' && aparelhosEscondido() ? 'mim' : rota.sub;
  if (sub === 'apar' && rota.aparelho) selecionarAparelho(rota.aparelho);
  if (radarSubAtual() !== sub) switchRadarSub(sub);
}

function aplicarCaixa(pr) {
  // antes do primeiro estado a decisão não está em mãos e a rota pode exigir pareamento:
  // a caixa abre quando a rota de entrada é reaplicada, com o estado já carregado
  if (!estado()) return;
  if (pr && caixaAberta() !== pr) abrirCaixaRevisao(pr);
  if (!pr && caixaAberta()) fecharCaixaRevisao();
}

function aplicarRota(rota) {
  APLICANDO = true;
  try {
    aplicarConta(rota);
    if (rota.aba === 'entregas') aplicarFiltrosDeEntregas(rota, _switchTab);
    else if (abaAtual() !== rota.aba) _switchTab(rota.aba);
    if (rota.aba === 'radar') aplicarRadar(rota);
    if (rota.aba === 'sistema' && secaoDoSistema() !== rota.secao) sysGoTo(rota.secao, null);
    aplicarCaixa(rota.pr);
  } finally {
    APLICANDO = false;
  }
}

// Voltar, Avançar e hash editado à mão. O navegador dispara popstate E hashchange para a
// mesma troca: o segundo encontra o endereço já aplicado e não faz nada.
function aoMudarEndereco() {
  if (location.hash === ULTIMO_HASH) return;
  const rota = lerRota(location.hash) || lerRota('#/radar');
  ULTIMO_HASH = location.hash;
  // sem estado ainda, as telas não sabem desenhar: a rota espera o primeiro estado
  if (!estado()) { ROTA_DE_ENTRADA = rota; return; }
  ROTA_DE_ENTRADA = null;
  aplicarRota(rota);
  sincronizarUrl(true);
}

// Há quem navegue um passo depois do evento (a paleta roda a ação numa microtarefa, para
// fechar antes): uma segunda leitura no fim da fila pega o que mudou depois.
let RELEITURA = null;
function releitura() { RELEITURA = null; sincronizarUrl(); }

function aoInteragir() {
  if (!estado()) return;    // antes do primeiro estado, a rota de entrada ainda vai valer
  ROTA_DE_ENTRADA = null;   // a pessoa já está mexendo: o endereço de entrada não manda mais
  sincronizarUrl();
  if (!RELEITURA) RELEITURA = setTimeout(releitura, 0);
}

/* Chamada pelo bootstrap depois de cada repintura por estado. Na primeira, reaplica a rota
   de entrada (nenhuma tela desenha sem estado); em todas, corrige
   a sub-aba Aparelhos escondida e substitui o endereço pelo que a tela mostra. */
function depoisDoEstado() {
  if (!_switchTab) return;
  if (ROTA_DE_ENTRADA) { const rota = ROTA_DE_ENTRADA; ROTA_DE_ENTRADA = null; aplicarRota(rota); }
  if (radarSubAtual() === 'apar' && aparelhosEscondido()) switchRadarSub('mim');
  sincronizarUrl(true);
}

function initRota(deps) {
  _switchTab = deps.switchTab;
  _rerenderScope = deps.rerenderScope;
  if (!historicoDisponivel()) return;
  // A rota de entrada espera o primeiro estado: antes dele as telas não sabem desenhar
  // (Sistema, por exemplo, lê o snapshot ao entrar) e as abas opcionais nem existem. O
  // endereço fica como veio até lá, para não apagar o que a pessoa abriu.
  const rota = lerRota(location.hash);
  ULTIMO_HASH = location.hash;
  if (rota) ROTA_DE_ENTRADA = rota;
  window.addEventListener('popstate', aoMudarEndereco);
  window.addEventListener('hashchange', aoMudarEndereco);
  for (const tipo of ['click', 'keydown', 'change', 'input']) window.addEventListener(tipo, aoInteragir);
  aoNavegar(() => sincronizarUrl());
}

export { initRota, depoisDoEstado, sincronizarUrl };
