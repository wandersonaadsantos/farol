// A decisão remota com o review completo (Task 8, 28/09/2026), parte PURA. Irmã de
// compartilhado.js e compartilhado-historico.js: separada só para cada uma caber no teto.
//
// O admin decide uma pendência de outro aparelho vendo o review inteiro: os motivos por
// extenso no card, e, ao abrir, o corpo e os inlines de cada ação que o aparelho dono
// postaria. As opções do diálogo são SÓ as ações que a pendência declara (`acoes`, que o
// dono monta a partir dos payloads que tem): oferecer uma ação sem payload seria oferecer
// um comando que o dono sempre recusaria.
import { esc, md, plural } from './comum.js';

const ROTULO_DA_ACAO = { approve: 'Aprovar', request_changes: 'Pedir mudanças', comment: 'Só comentar', skip: 'Pular' };
// ordem dos botões no diálogo: o mais leve primeiro, e aprovar (o primário) por último
const ORDEM_DAS_OPCOES = ['skip', 'comment', 'request_changes', 'approve'];
// pendência publicada por versão anterior não traz `acoes`: ficam as duas de antes
const OPCOES_ANTIGAS = [{ valor: 'reject', rotulo: 'Pedir mudanças' }, { valor: 'approve', rotulo: 'Aprovar', classe: 'primary' }];

export function opcoesDaDecisao(acoes) {
  if (!Array.isArray(acoes)) return OPCOES_ANTIGAS;
  return ORDEM_DAS_OPCOES.filter((a) => acoes.includes(a)).map((valor) => ({
    valor, rotulo: ROTULO_DA_ACAO[valor], classe: valor === 'approve' ? 'primary' : '',
  }));
}

// Motivos por extenso, e o botão que abre o corpo no histórico quando o dono o publicou. O
// que o orçamento do envio cortou é contado pelo dono (`motivosOmitidos`) e aparece aqui:
// a lista parcial nunca parece completa.
// quantos motivos o dono contou e não couberam; qualquer coisa fora de inteiro positivo é 0
export function motivosOmitidosDe(p) {
  const n = Number(p && p.motivosOmitidos);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export function motivosDaPendenciaHtml(p) {
  const motivos = Array.isArray(p && p.motivos) ? p.motivos.filter((m) => m && m.text) : [];
  const omitidos = motivosOmitidosDe(p);
  if (!motivos.length && !omitidos) return '';
  const mais = omitidos ? `<li class="md-fraco">+${plural(omitidos, 'motivo', 'motivos')} no review completo</li>` : '';
  return `<ul class="md-motivos">${motivos.map((m) => `<li>${esc(m.text)}</li>`).join('')}${mais}</ul>`;
}

export function botaoDoReviewHtml(p) {
  if (!p || !p.reviewId) return '';
  return `<button class="btn sm ghost md-review-completo" data-review="${esc(p.reviewId)}">Ver review completo</button>`;
}

function inlinesPorArquivo(comments) {
  const porArquivo = new Map();
  for (const c of Array.isArray(comments) ? comments : []) {
    if (!c || !c.body) continue;
    const arquivo = String(c.path || 'sem arquivo');
    if (!porArquivo.has(arquivo)) porArquivo.set(arquivo, []);
    porArquivo.get(arquivo).push(c);
  }
  return [...porArquivo].map(([arquivo, lista]) => `<div class="md-inline-arquivo"><div class="md-fraco">${esc(arquivo)}</div>
    ${lista.map((c) => `<div class="md-inline"><span class="md-fraco">${Number(c.line) > 0 ? `linha ${esc(c.line)}` : 'arquivo'}</span><div class="report">${md(c.body)}</div></div>`).join('')}</div>`).join('');
}

const AVISO_CORTE_PARCIAL = '<p class="md-nota md-ruim">O review era grande demais para o compartilhamento e chegou cortado aqui. O aparelho dono posta o review inteiro.</p>';
const AVISO_CORTE_TOTAL = '<p class="md-nota md-ruim">O texto do review não coube no envio cifrado; abra o PR no GitHub ou decida no aparelho dono.</p>';

// Uma seção por ação, na ordem em que o diálogo as oferece, com o corpo e os inlines.
// O aviso de corte sai ANTES de olhar os payloads: no último degrau do corte
// (lib/sync/historico.js) eles somem inteiros, e review cortado nunca parece completo.
export function payloadsDaRevisaoHtml(revisao) {
  const r = revisao || {};
  const payloads = r.payloads && typeof r.payloads === 'object' ? r.payloads : null;
  if (!payloads) return r.cortado === true ? AVISO_CORTE_TOTAL : '';
  const secoes = [...ORDEM_DAS_OPCOES].reverse().filter((a) => payloads[a]).map((a) => `<section class="md-payload">
    <div class="md-titulo">${esc(ROTULO_DA_ACAO[a])}</div>
    <div class="report">${md(payloads[a].body || '')}</div>${inlinesPorArquivo(payloads[a].comments)}
  </section>`).join('');
  return `${r.cortado === true ? AVISO_CORTE_PARCIAL : ''}${secoes}`;
}
