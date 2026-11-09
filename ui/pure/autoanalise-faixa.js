// A autoanálise em andamento, na largura do card (08/11/2026). Desenho no Claude Design, em
// docs/superpowers/specs/2026-11-08-autoanalise-faixa-anexos/. Substitui o box flutuante: diz em
// que etapa está, com a barra só andando de verdade onde há denominador (arquivos lidos), e o
// resultado aparece no mesmo lugar quando termina.
import { esc } from './comum.js';
import { progressoDaSessao } from './sessao.js';
import { tomDaProntidao } from './prontidao.js';

// Sem "Avaliação técnica": ela é da revisão, a autoanálise não roda (lib/engine/selfpr.js).
export const ETAPAS_DA_AUTOANALISE = ['Código', 'Leitura', 'Verificação', 'Conclusão'];

export function tempoDecorrido(ms) {
  const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

// A etapa que o feed mostra agora. O feed é uma janela e perde as linhas antigas: quem garante que
// a etapa não recua é o `etapaMinima` de andamentoDaAutoanalise.
export function etapaDaAutoanalise(sess, itens) {
  const lista = Array.isArray(itens) ? itens : [];
  if (sess?.fase === 'fechando') return 3;
  const viu = (...etapas) => lista.some(i => etapas.includes(i?.s));
  if (viu('fechamento')) return 3;
  const total = Number(sess?.totalArquivos) || 0;
  const leuTudo = total > 0 && Number(sess?.lidos) >= total;
  if (viu('verificacao') || (leuTudo && viu('raciocinio'))) return 2;
  return viu('leitura', 'card', 'raciocinio') ? 1 : 0;
}

// A sessão saiu da tela: sem análise nova e sem cancelamento, ela terminou sem resultado.
export function sessaoSumiuSemResultado({ desde, cancelada = false, analise = null }) {
  return !cancelada && !(analise && analise.at >= desde);
}

function ultimaLinha(itens, teste) {
  for (let i = (itens || []).length - 1; i >= 0; i--) if (itens[i] && teste(itens[i])) return String(itens[i].text || '');
  return '';
}

const TEXTO_DA_ETAPA = ['Buscando o código do PR.', 'Lendo o código do PR.', 'Conferindo no código o que a análise afirmou.', 'Fechando o resultado.'];
const FRASE_DA_ETAPA = ['Buscando o código', 'Lendo', 'Verificando', 'Concluindo'];

function textoDaEtapa(etapa, itens) {
  if (etapa === 0) return ultimaLinha(itens, i => i.s === 'preparo' || !i.s) || TEXTO_DA_ETAPA[0];
  if (etapa === 1) return ultimaLinha(itens, i => i.k === 'tool') || TEXTO_DA_ETAPA[1];
  return TEXTO_DA_ETAPA[etapa];
}

function rodando(sess, itens, agora, etapaMinima) {
  const etapa = Math.max(etapaDaAutoanalise(sess, itens), etapaMinima);
  const p = progressoDaSessao(sess, [], agora);
  const total = Number(sess.totalArquivos) || 0;
  const lidos = Math.min(total, Number(sess.lidos) || 0);
  const base = { tipo: 'rodando', etapa, desde: Number(sess.startedAt) || agora };
  if (p.estado === 'muda') {
    return { ...base, tom: 'wait', texto: `Sem sinal do modelo ${p.texto.replace(/^sem sinal /, '')}. A sessão segue aberta.`, apoio: 'pode cancelar e tentar de novo', frase: 'Sem sinal', barra: 'indefinida' };
  }
  const comum = { ...base, tom: 'run', texto: textoDaEtapa(etapa, itens), apoio: '', frase: FRASE_DA_ETAPA[etapa], barra: 'indefinida', pct: 0 };
  if (!total || etapa < 1 || sess.lidos == null) return comum;   // sem leitura observada não há contagem (Codex e Antigravity não reportam)
  const contagem = `${lidos} de ${total}`;
  if (etapa !== 1) return { ...comum, apoio: `${contagem} arquivos` };
  return { ...comum, apoio: `${contagem} arquivos`, frase: `Lendo ${contagem}`, barra: 'definida', pct: Math.floor(lidos / total * 100) };
}

// A entrada é o que a tela sabe do PR agora; devolve null quando não há o que mostrar.
export function andamentoDaAutoanalise({ sess, itens, agora = Date.now(), iniciandoDesde = 0, posicao = 0, falha = '', cancelando = false, etapaMinima = 0 } = {}) {
  if (sess) return { ...rodando(sess, itens, agora, etapaMinima), cancelando };
  if (falha) return { tipo: 'falha', etapa: -1, tom: 'fail', texto: falha, apoio: 'nada foi publicado', frase: 'Não terminou', barra: '' };
  if (posicao > 0) return { tipo: 'fila', etapa: 0, tom: 'wait', texto: `${posicao}º na fila da autoanálise.`, apoio: 'começa quando abrir uma vaga', frase: `${posicao}º na fila`, barra: 'indefinida', cancelando };
  if (iniciandoDesde) return { tipo: 'iniciando', etapa: 0, tom: 'run', texto: 'Iniciando a autoanálise.', apoio: '', frase: 'Iniciando', barra: 'indefinida', desde: iniciandoDesde };
  return null;
}

function classeDaEtapa(i, m) {
  if (i < m.etapa) return ' feita';
  return i === m.etapa ? ' agora' : '';
}

function etapasHtml(m) {
  return ETAPAS_DA_AUTOANALISE.map((nome, i) => {
    const cls = classeDaEtapa(i, m);
    const ligaCls = i <= m.etapa ? 'aa-liga feita' : 'aa-liga';
    const liga = i > 0 ? `<span class="${ligaCls}" aria-hidden="true"></span>` : '';
    const marca = i < m.etapa ? '✓' : '';
    const aria = i === m.etapa ? ' aria-current="step"' : '';
    return `${liga}<span class="aa-et${cls}"${aria}><span class="aa-pt" aria-hidden="true">${marca}</span>${nome}</span>`;
  }).join('');
}

function barraHtml(m) {
  if (m.barra === 'definida') return `<div class="aa-trilho"><div class="aa-cheio" style="width:${Number(m.pct) || 0}%"></div></div>`;
  return m.barra ? '<div class="aa-trilho"><div class="aa-corre"></div></div>' : '';
}

function tempoHtml(m, agora) {
  return m.desde ? `<span class="aa-tempo" data-aa-tempo data-aa-desde="${Number(m.desde)}">${tempoDecorrido(agora - m.desde)}</span>` : '';
}

function acaoHtml(m, o) {
  if (m.tipo === 'falha') {
    return `<button type="button" class="btn sm ghost aa-dispensar" data-key="${esc(o.key)}">Dispensar</button><button type="button" class="btn sm ghost act-self" data-url="${esc(o.url || '')}">Tentar de novo</button>`;
  }
  if (m.tipo === 'iniciando') return '';
  if (m.cancelando) return `<button type="button" class="btn sm ghost aa-cancelar" data-key="${esc(o.key)}" disabled>Cancelando…</button>`;
  return `<button type="button" class="btn sm ghost aa-cancelar" data-key="${esc(o.key)}">Cancelar</button>`;
}

export function faixaDaAutoanaliseHtml(m, o = {}) {
  if (!m) return '';
  const agora = o.agora || Date.now();
  const etapas = m.tipo === 'falha' ? '<span class="aa-falha-titulo">A autoanálise não terminou</span>' : `<div class="aa-etapas">${etapasHtml(m)}</div>`;
  return `<div class="aa-faixa ${tomDaProntidao(m.tom)}" data-aa-key="${esc(o.key)}" data-aa-etapa="${m.etapa}" data-aa-tipo="${m.tipo}" role="group" aria-label="Andamento da autoanálise">
    <div class="aa-topo">${etapas}<div class="aa-lado">${tempoHtml(m, agora)}${acaoHtml(m, o)}</div></div>
    ${barraHtml(m)}
    <div class="aa-rodape${m.barra ? '' : ' sem-barra'}"><span class="aa-texto" title="${esc(m.texto)}">${esc(m.texto)}</span><span class="aa-apoio">${esc(m.apoio || '')}</span></div>
  </div>`;
}

function fioHtml(m) {
  if (m.barra === 'definida') return `<span class="aa-fio"><i style="width:${Number(m.pct) || 0}%"></i></span>`;
  return m.barra ? '<span class="aa-fio"><i class="corre"></i></span>' : '';
}

// O pedaço da linha da Compacta: a frase, o tempo, a ação e o fio de progresso.
export function linhaDaAutoanalise(m, o = {}) {
  const agora = o.agora || Date.now();
  const meio = m.tipo === 'falha' ? `<span class="aa-apoio" title="${esc(m.texto)}">${esc(m.apoio)}</span>` : tempoHtml(m, agora);
  return { estado: { tom: m.tom, texto: m.frase }, meio, acoes: acaoHtml(m, o), rodape: fioHtml(m) };
}
