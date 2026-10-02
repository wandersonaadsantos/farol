// Outra pessoa revisando e limite do plano: o que o card da fila diz (02/10/2026).
//
// Desenho do Claude Design, handoff em
// docs/superpowers/specs/2026-10-02-revisando-junto-anexos/HANDOFF.md. Uma adaptação
// declarada: o login sai pelo personMention (foto + link num helper só, regra das menções
// navegáveis), em vez das fotos agrupadas que o quadro desenhou à parte.
//
// Dados: `pr.outrosRevisando` (logins, já sem a minha conta e sem ferramenta),
// `pr.foraDeCena` ({ quem, desde, coAssinado }), o `limitePlanoAte` da conta do PR e a
// chave `revisarComOutrosRevisando`. Tudo vem do motor (lib/engine/skip-review.js e
// lib/engine/contas-gh.js); aqui só se escolhe o texto.
import { esc, fmtStamp, localDayKey } from './comum.js';
import { personMention } from './mencoes.js';

const p2 = (n) => String(n).padStart(2, '0');

// A hora do reset nas duas formas do handoff: `as` ("às 21:00", "amanhã às 21:00",
// "em 04/10 às 21:00") para a frase longa e `curta` ("21:00", "amanhã 21:00", "04/10 21:00").
export function horaDoReset(ate, agora = Date.now()) {
  const d = new Date(ate);
  const hora = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  const ref = new Date(agora);
  if (localDayKey(d) === localDayKey(ref)) return { as: `às ${hora}`, curta: hora };
  const amanha = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + 1);
  if (localDayKey(d) === localDayKey(amanha)) return { as: `amanhã às ${hora}`, curta: `amanhã ${hora}` };
  const dia = `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
  return { as: `em ${dia} às ${hora}`, curta: `${dia} ${hora}` };
}

function quando(ate, forma, agora) {
  return `<span title="${esc(fmtStamp(ate))}">${esc(horaDoReset(ate, agora)[forma])}</span>`;
}

function pessoasHtml(logins) {
  const l = logins.map((x) => personMention(x, 'xs'));
  return l.length === 1 ? l[0] : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}

const VERBO = {
  terminou: ['revisou', 'revisaram'],
  sessao: ['também está revisando', 'também estão revisando'],
};

const CAUDA = {
  fora: 'Não reviso sozinho para não duplicar; o botão Revisar junto começa a sua revisão.',
  'curta-parada': 'Tentar de novo agora é revisar junto.',
  junto: 'Vou revisar junto mesmo assim, como pede <span class="is-goto" data-goto="sys:automation:#sys-row-revisarjunto" role="button" tabindex="0" title="Abrir Sistema → Automação">Sistema &gt; Automação</span>.',
  'junto-curta': 'Vou revisar junto mesmo assim.',
  terminou: 'Fiquei de fora neste commit; a decisão é sua.',
};

// A linha de quem está (ou esteve) revisando, nas formas do handoff. '' sem ninguém.
export function othersLineHtml(logins, forma) {
  const lista = (Array.isArray(logins) ? logins : []).filter(Boolean);
  if (!lista.length) return '';
  const [um, varios] = VERBO[forma] || ['está revisando', 'estão revisando'];
  const verbo = lista.length === 1 ? um : varios;
  const cauda = CAUDA[forma] ? ` ${CAUDA[forma]}` : '';
  return `<div class="pr-others"><span class="po-txt"><span class="po-lead">${pessoasHtml(lista)} ${verbo} este PR.</span>${cauda}</span></div>`;
}

// A nota do limite do plano no card. '' quando não há limite vivo.
export function limitNoteHtml(ate, forma, rotulo, agora = Date.now()) {
  if (!(Number(ate) > agora)) return '';
  if (forma === 'curta') return `<div class="pr-limit">Esperando o limite do plano, até ${quando(ate, 'curta', agora)}.</div>`;
  return `<div class="pr-limit">Revisão automática esperando o limite do plano do Claude: recomeço sozinho ${quando(ate, 'as', agora)}. O botão ${esc(rotulo)} tenta agora, mas pode bater no mesmo limite.</div>`;
}

// O aviso único no topo de Pra mim quando 2 ou mais cards da mesma conta esperam o limite.
export function queueLimitHtml(conta, ate, n, variasContas, agora = Date.now()) {
  const c = conta || {};
  const daConta = variasContas ? ` da conta <b>${esc(c.label || c.user || '')}</b>` : '';
  const ponto = variasContas ? '<span class="acct-dot" aria-hidden="true"></span>' : '';
  const estilo = variasContas && c.color ? ` style="--ac:${esc(c.color)}"` : '';
  return `<div class="queue-limit" role="status"${estilo}>${ponto}<span>Revisão automática${daConta} esperando o limite do plano do Claude: recomeço sozinho ${quando(ate, 'as', agora)}. Vale para ${Number(n) || 0} PRs desta fila. O botão Revisar de cada um tenta agora, mas pode bater no mesmo limite.</span></div>`;
}

// Panorama: o primeiro login e quantos mais, com a lista inteira no title.
export function pwOthersHtml(logins) {
  const lista = (Array.isArray(logins) ? logins : []).filter(Boolean);
  if (!lista.length) return '';
  const resto = lista.length > 1 ? ` e mais ${lista.length - 1}` : '';
  const todos = lista.map((x) => `@${x}`).join(', ');
  const title = lista.length > 1 ? ` title="${esc(todos)} estão revisando"` : '';
  return `<span class="pw-others"${title}>${personMention(lista[0], 'xs')}${resto} revisando</span>`;
}

// A precedência do handoff (seção 2), sem HTML: o que o card mostra. Entradas:
// `temParada` (a nota de revisão parada existe), `limiteAtivo`, `limiteNoTopo` e
// `revisarJunto` (a chave). Saída: o rótulo do botão, a forma da linha de pessoas (ou '')
// com os logins dela, e qual nota de revisão automática fica ('parada', 'limite',
// 'coordenacao' ou ''), com a forma do limite.
export function avisosDoCard(pr, { temParada = false, limiteAtivo = false, limiteNoTopo = false, revisarJunto = false } = {}) {
  const outros = Array.isArray(pr && pr.outrosRevisando) ? pr.outrosRevisando.filter(Boolean) : [];
  const temOutros = outros.length > 0;
  const foraDeCena = temOutros && !revisarJunto;
  let nota = '';
  if (temParada) nota = 'parada';
  else if (!foraDeCena && limiteAtivo) nota = 'limite';
  else if (!foraDeCena) nota = 'coordenacao';
  const rotulo = temOutros ? 'Revisar junto' : 'Revisar';
  const formaLimite = limiteNoTopo ? 'curta' : 'longa';
  const out = { rotulo, nota, formaLimite, forma: '', logins: outros };
  const registro = pr && pr.foraDeCena;
  if (temOutros) out.forma = formaComOutros(temParada, foraDeCena, nota);
  else if (registro && !registro.coAssinado && Array.isArray(registro.quem) && registro.quem.length) {
    out.forma = 'terminou';
    out.logins = registro.quem;
  }
  return out;
}

function formaComOutros(temParada, foraDeCena, nota) {
  if (temParada) return 'curta-parada';
  if (foraDeCena) return 'fora';
  return nota === 'limite' ? 'junto-curta' : 'junto';
}

// Quantos cards de cada conta cairiam na nota do limite (sem parada e sem fora de cena).
// Conta com 2 ou mais ganha o aviso no topo. `contaDe(pr)` diz a conta (a tela sabe, o PR
// nem sempre traz) e `limiteDe(pr)` devolve o epoch do reset dela.
export function contasNoLimiteDaFila(fila, { contaDe, limiteDe, parked = {}, revisarJunto = false, agora = Date.now() } = {}) {
  const porConta = {};
  for (const pr of fila || []) {
    const ate = Number(limiteDe(pr)) || 0;
    if (ate <= agora || parked[pr.key]) continue;
    const temOutros = Array.isArray(pr.outrosRevisando) && pr.outrosRevisando.length > 0;
    if (temOutros && !revisarJunto) continue;
    const conta = String(contaDe(pr) || '');
    porConta[conta] = porConta[conta] || { ate, n: 0 };
    porConta[conta].n++;
  }
  return Object.fromEntries(Object.entries(porConta).filter(([, v]) => v.n >= 2));
}
