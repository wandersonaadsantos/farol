/* Farol · UI: a faixa de prontidão (checks obrigatórios, reviewers, merge) nas telas do
   Radar (07/11/2026). Lê `estado().prontidao` (lib/engine/prontidao-pr.js) e o que está
   aberto em densidade.js, e devolve o HTML pronto para Pra mim, Meus PRs e Panorama. O
   desenho mora em ui/pure/prontidao-html.js e as frases da Compacta em ui/pure/densidade.js;
   aqui só se junta estado com desenho, para radar.js e meus-prs.js não incharem. */
import {
  esc, avatar, faixaDaProntidaoHtml, trioCurtoHtml, pontosDaProntidaoHtml, setaDaLinhaHtml, linhaCompactaHtml,
  barraDaProntidao, resumoDaProntidao, resumoDaProntidaoHtml, legendaDosPontosHtml, fraseDaDecisao, acaoDaDecisaoHtml,
  fraseDaEspera, fraseDaFila, fraseDaFilaDeExecucao, rodapeDasRecentes, resolvidasHoje, resumoPraMimHtml, separarPendentes,
} from '../pure.js';
import { estado } from './estado.js';
import { $ } from './infra.js';
import { ehCompacta, cardCheio, pilulaDe } from './densidade.js';

function prontidaoDe(key) { return (estado().prontidao || {})[key] || null; }

// a faixa de três pílulas do card cheio, com o detalhe da pílula aberta
function faixaDe(key, ctx = {}) {
  return `<div class="pron-bloco">${faixaDaProntidaoHtml(prontidaoDe(key), { key, aberta: pilulaDe(key), ctx })}</div>`;
}

function trioDe(key, ctx = {}) { return trioCurtoHtml(prontidaoDe(key), ctx); }
function barraDe(key, ctx = {}) { return barraDaProntidao(prontidaoDe(key), ctx); }

// a seta que recolhe o card cheio, só na Compacta (na Expandida não há linha para voltar)
function setaDoCard(key) { return ehCompacta() ? setaDaLinhaHtml(key, true, key) : ''; }

/* ---------- Meus PRs ---------- */
function linhaDoMeuPr(pr, o) {
  const ctx = { repoBloqueado: o.repoBloqueado };
  return linhaCompactaHtml({
    key: pr.key, url: pr.url, titulo: pr.title, inicio: o.mark.dot, style: o.mark.style,
    classe: ['mypr-linha', o.escondido && 'oculto', o.classeExtra].filter(Boolean).join(' '), barra: o.barra || barraDe(pr.key, ctx),
    meio: trioDe(pr.key, ctx), acoes: o.merge || '', ...(o.andamento || {}),
  });
}

function renderResumoDosMeus(lista) {
  const el = $('#myPRsResumo');
  if (el) el.innerHTML = resumoDaProntidaoHtml(resumoDaProntidao((lista || []).map(pr => prontidaoDe(pr.key))));
}

/* ---------- Pra mim ---------- */
function linhaDaDecisao(d, meta, o) {
  const frase = o.espera ? fraseDaEspera(o.ciObrigatorio) : fraseDaDecisao(d, meta);
  const acao = o.espera ? '' : acaoDaDecisaoHtml(d, meta, o.ciObrigatorio);
  return linhaCompactaHtml({
    key: d.key, url: d.pr?.url, titulo: d.pr?.title || '', inicio: avatar(d.pr?.author || d.author || ''),
    style: o.mark.style, classe: 'decision', refClasse: 'dec-ref', attrs: `data-id="${esc(d.id)}"`,
    estado: frase, meio: trioDe(d.key), acoes: acao,
  });
}

function linhaDaFila(pr, o) {
  const reg = prontidaoDe(pr.key);
  const checksRodando = reg?.checks?.tom === 'run';
  return linhaCompactaHtml({
    key: pr.key, url: pr.url, titulo: pr.title, inicio: avatar(pr.author), style: o.mark.style, classe: 'fila-linha',
    estado: fraseDaFila(pr, { posicao: o.posicao, parado: o.parado, manual: o.manual, checksRodando }), meio: trioDe(pr.key),
    acoes: `<button class="btn primary sm act-review" data-url="${esc(pr.url)}">${esc(o.rotulo || 'Revisar')}</button>`,
  });
}

function linhaDaFilaDeExecucao(pr, o) {
  return linhaCompactaHtml({
    key: pr.key, url: pr.url, titulo: pr.title, inicio: avatar(pr.author), style: o.mark.style, classe: 'fila-linha',
    estado: fraseDaFilaDeExecucao(o.distribuindo), meio: trioDe(pr.key),
  });
}

// Revisões recentes na Compacta: uma linha que abre a lista; aberta, a mesma linha recolhe
function rodapeDasRecentesHtml(resolved, aberto) {
  const texto = rodapeDasRecentes(resolvidasHoje(resolved), (resolved || []).length, aberto);
  return `<button type="button" class="mypr-hidden-toggle pron-rodape" data-recentes-alternar aria-expanded="${aberto ? 'true' : 'false'}">${esc(texto)}</button>`;
}

// A linha do topo de Pra mim, que leva a cada seção. Conta o que as seções mostram.
function renderResumoPraMim(filtro, totalDaFila) {
  const el = $('#praMimResumo');
  if (!el) return;
  const { precisam, esperandoCi } = separarPendentes((estado().decisions?.pending || []).filter(filtro));
  const analisando = (estado().activeSessions || []).filter(s => (s.mode === 'auto' || s.mode === 'self')).length;
  const html = resumoPraMimHtml({
    analisando, precisam: precisam.length, sozinhos: esperandoCi.length, fila: totalDaFila,
    resolvidas: resolvidasHoje((estado().decisions?.resolved || []).filter(filtro)),
  });
  el.innerHTML = html;
  el.hidden = !html;
}

// O pedaço da prontidão no cartão de "Analisando agora": o trio curto e a seta na Compacta,
// a faixa de pílulas na Expandida (ou no cartão aberto). O cartão é incremental, então quem
// chama troca só este pedaço a cada estado.
function prontidaoDaSessaoHtml(key) {
  if (!key) return '';
  // aberta, a seta fica na mesma linha e no mesmo canto em que estava fechada
  if (cardCheio(key)) return `<div class="sess-pron-aberta">${faixaDe(key)}${setaDoCard(key)}</div>`;
  // fechada, o cartão da sessão mostra a mesma faixa das três caixas (rótulo, valor e avatares),
  // só sem o feed; o trio curto apertava tudo em três pílulas sem rótulo (pedido do dono, 13/11)
  return `<div class="sess-pron-curta">${faixaDe(key)}${setaDaLinhaHtml(key, false, key)}</div>`;
}

/* ---------- Panorama ---------- */
// O que a linha do Panorama ganha: na Compacta, os três pontos e a seta no lado; aberta (ou
// na Expandida), os ramos, quem mais revisa e as três pílulas embaixo do título.
function prontidaoDoPanorama(pr) {
  const reg = prontidaoDe(pr.key);
  if (!cardCheio(pr.key)) return { pronPontos: pontosDaProntidaoHtml(reg), pronLado: setaDaLinhaHtml(pr.key, false, pr.key), pronCorpo: '' };
  const ramos = reg?.head && reg.base
    ? `<div class="pr-branches pw-ramos"><code>${esc(reg.head)}</code> <span class="arrow">→</span> <code>${esc(reg.base)}</code></div>`
    : '';
  const reserva = ehCompacta() ? `<span class="pron-pontos-reserva" aria-hidden="true">${pontosDaProntidaoHtml(reg)}</span>` : '';
  return { pronPontos: reserva, pronLado: setaDoCard(pr.key), pronCorpo: `${ramos}${faixaDe(pr.key)}` };
}

function renderLegendaDoPanorama(temLinhas) {
  const el = $('#panoLegenda');
  if (!el) return;
  el.innerHTML = temLinhas && ehCompacta() ? legendaDosPontosHtml() : '';
  el.hidden = !el.innerHTML;
}

export {
  prontidaoDe, faixaDe, trioDe, barraDe, setaDoCard, linhaDoMeuPr, renderResumoDosMeus, linhaDaDecisao, linhaDaFila,
  linhaDaFilaDeExecucao, rodapeDasRecentesHtml, renderResumoPraMim, prontidaoDaSessaoHtml, prontidaoDoPanorama,
  renderLegendaDoPanorama,
};
