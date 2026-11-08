// O HTML da faixa de prontidão (07/11/2026): as três pílulas clicáveis com o detalhe embaixo,
// a forma curta da Compacta, os três pontos do Panorama e a linha compacta de um PR. Os textos
// e os tons saem de prontidao.js; aqui é só desenho, com as classes de app.css (.pron-*).
// Desenho do Claude Design em docs/superpowers/specs/2026-11-07-meus-prs-prontidao-anexos/.
import { esc } from './comum.js';
import { avatar, personMention } from './mencoes.js';
import { pilulasDaProntidao, linhasDoDetalhe, pontosDaProntidao, tomDaProntidao, ROTULOS_DA_PRONTIDAO } from './prontidao.js';

const TRACOS = {
  ok: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  fail: '<path d="M6 6l12 12M18 6L6 18"/>',
  wait: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  run: '<path d="M20 12a8 8 0 1 1-8-8"/>',
  none: '<path d="M6 12h12"/>',
};

// o ícone de cada tom, desenhado com currentColor (a cor vem da classe do tom)
export function iconeDaProntidao(tom) {
  const tracos = TRACOS[tom] || TRACOS.none;
  return `<span class="pron-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${tracos}</svg></span>`;
}

// "owner/repo#N" vira "repo#N", como no desenho da linha compacta
export function chaveCurta(key) {
  return String(key || '').replace(/^[^/]+\//, '');
}

function avataresHtml(avatares) {
  if (!(avatares || []).length) return '';
  const um = a => `<span class="pp-av ${tomDaProntidao(a.tom)}" title="${esc(a.titulo)}">${avatar(a.login, 'xs')}</span>`;
  return `<span class="pp-avs">${avatares.map(um).join('')}</span>`;
}

function nomeDaLinha(l) {
  if (l.pessoa) return personMention(l.pessoa, 'xs');
  if (l.codigo) return `<code>${esc(l.nome)}</code>`;
  return esc(l.nome);
}

// O detalhe de uma pílula: a lista dos checks exigidos, dos reviewers ou do que o merge exige.
export function detalheDaPilulaHtml(id, reg, ctx = {}) {
  const d = linhasDoDetalhe(id, reg, ctx);
  if (!d) return '';
  const linha = l => `<div class="pd-linha"><span class="pd-nome">${nomeDaLinha(l)}</span>${l.voce ? '<span class="badge">você</span>' : ''}<span class="pd-estado ${tomDaProntidao(l.tom)}">${esc(l.estado)}</span></div>`;
  return `<section class="pron-detalhe" aria-label="${esc(ROTULOS_DA_PRONTIDAO[id] || '')}">
    <p class="pd-titulo">${esc(d.titulo)}</p>${d.linhas.map(linha).join('')}
    <p class="pd-nota">${esc(d.nota)}</p>
  </section>`;
}

const FAIXA_VAZIA = '<div class="pron-faixa vazia">Checks obrigatórios, reviewers e merge: ainda lendo do GitHub.</div>';

// A faixa de três pílulas (<button>), na ordem Checks, Reviewers, Merge, com o detalhe da
// pílula aberta embaixo (uma por vez por card). opts: { key, aberta, ctx }.
export function faixaDaProntidaoHtml(reg, opts = {}) {
  const ctx = opts.ctx || {};
  const pilulas = pilulasDaProntidao(reg, ctx);
  if (!pilulas.length) return FAIXA_VAZIA;
  const botao = p => {
    const aberta = opts.aberta === p.id;
    return `<button type="button" class="pron-pill ${tomDaProntidao(p.tom)}${aberta ? ' aberta' : ''}" data-pron-key="${esc(opts.key || '')}" data-pron-pilula="${p.id}" aria-expanded="${aberta}" title="${esc(`${p.rotulo}: ${p.valor}`)}">`
      + `${iconeDaProntidao(p.tom)}<span class="pp-txt"><span class="pp-lb">${esc(p.rotulo)}</span><span class="pp-vl">${esc(p.valor)}</span></span>${avataresHtml(p.avatares)}</button>`;
  };
  const detalhe = opts.aberta ? detalheDaPilulaHtml(opts.aberta, reg, ctx) : '';
  return `<div class="pron-faixa" role="group" aria-label="Prontidão do PR">${pilulas.map(botao).join('')}</div>${detalhe}`;
}

// A forma curta da Compacta: os três estados lado a lado ("7/7", "1/2", "Falta 1 aprovação").
export function trioCurtoHtml(reg, ctx = {}) {
  const pilulas = pilulasDaProntidao(reg, ctx);
  if (!pilulas.length) return '<span class="pron-trio vazia" title="Checks, reviewers e merge ainda não lidos">lendo…</span>';
  const mini = p => `<span class="pron-mini ${tomDaProntidao(p.tom)}" title="${esc(`${p.rotulo}: ${p.valor}`)}">${iconeDaProntidao(p.tom)}${esc(p.curto)}</span>`;
  return `<span class="pron-trio" aria-label="Prontidão do PR">${pilulas.map(mini).join('')}</span>`;
}

// Os três pontos do Panorama (checks, reviewers, merge), com o texto completo no title e no
// aria-label: a cor sozinha não pode ser a única forma de ler o estado.
export function pontosDaProntidaoHtml(reg, ctx = {}) {
  const p = pontosDaProntidao(reg, ctx);
  const ponto = t => `<span class="pp-ponto ${tomDaProntidao(t)}"></span>`;
  return `<span class="pron-pontos" role="img" aria-label="${esc(p.rotulo)}" title="${esc(p.rotulo)}">${p.tons.map(ponto).join('')}</span>`;
}

// A legenda curta acima da lista do Panorama.
export function legendaDosPontosHtml() {
  const item = (i, texto) => `<span class="pl-item"><span class="pron-pontos" aria-hidden="true">${[0, 1, 2].map(k => `<span class="pp-ponto ${k === i ? 't-ok' : 't-none'}"></span>`).join('')}</span>${texto}</span>`;
  return `<div class="pron-legenda">Pontos de cada linha: ${item(0, 'checks obrigatórios')}${item(1, 'reviewers')}${item(2, 'merge')}</div>`;
}

// "1 pronto pra merge · 2 esperando · 1 travado"; vazio quando não há nada a contar.
export function resumoDaProntidaoHtml(resumo) {
  const r = resumo || {};
  const s = n => (n === 1 ? '' : 's');
  const chips = [
    [r.prontos, 't-ok', n => `${n} pronto${s(n)} pra merge`],
    [r.esperando, 't-wait', n => `${n} esperando`],
    [r.travados, 't-fail', n => `${n} travado${s(n)}`],
  ].filter(([n]) => n > 0).map(([n, tom, texto]) => `<span class="pron-chip ${tom}">${texto(n)}</span>`);
  return chips.length ? `<div class="pron-resumo" aria-label="Resumo da lista">${chips.join('')}</div>` : '';
}

const SETA = { abrir: '<path d="M6 9l6 6 6-6"/>', recolher: '<path d="M6 15l6-6 6 6"/>' };

// A seta que abre o card cheio de um PR na Compacta (e recolhe, no card aberto).
export function setaDaLinhaHtml(key, aberta, rotulo = '') {
  const acao = aberta ? 'Recolher' : 'Expandir';
  return `<button type="button" class="pron-seta" data-linha="${esc(key)}" aria-expanded="${!!aberta}" aria-label="${acao} ${esc(rotulo || key)}" title="${acao}">`
    + `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${aberta ? SETA.recolher : SETA.abrir}</svg></button>`;
}

function estadoDaLinha(estado) {
  if (!estado || !estado.texto) return '';
  return `<span class="pl-estado ${tomDaProntidao(estado.tom)}"><span class="pl-pt" aria-hidden="true"></span>${esc(estado.texto)}</span>`;
}

// Uma linha da Compacta: barra de estado, o começo (ponto da conta ou avatar), repo#N, título
// cortado, o estado numa frase, a forma curta, a ação principal e a seta. O.attrs leva os
// atributos que o listener da seção precisa (data-id da decisão, por exemplo).
export function linhaCompactaHtml(o = {}) {
  const ref = `<a class="pl-ref${o.refClasse ? ` ${o.refClasse}` : ''}" href="${esc(o.url || '#')}" target="_blank" rel="noreferrer" title="${esc(o.key)}">${esc(chaveCurta(o.key))}</a>`;
  return `<div class="pr-linha ${o.classe || ''} ${o.barra || ''}" data-key="${esc(o.key)}" data-url="${esc(o.url || '')}" ${o.attrs || ''} style="${o.style || ''}">
    ${o.inicio || ''}
    <div class="pl-main">${ref}<span class="pl-titulo" title="${esc(o.titulo)}">${esc(o.titulo)}</span></div>
    ${estadoDaLinha(o.estado)}${o.meio || ''}${o.acoes || ''}
    ${setaDaLinhaHtml(o.key, false, o.key)}
  </div>`;
}
