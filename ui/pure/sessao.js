// A sessão de revisão ao vivo: esteira de etapas, feed, subagentes e progresso.
//
// A esteira é o desenho estilo n8n do card "Analisando agora", e o progresso é a régua
// ÚNICA do app: quem muda a conta de etapas muda os dois lados (o card ao vivo e o resumo
// que fica na decisão), e é por isso que eles moram juntos.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
import { esc, fmtClock, fmtDur, stageLabel, aprovadosHoje } from './comum.js';
import { personMention } from './mencoes.js';

// Maquina de estados minima: 'running' e o unico estado que anda; done/error/cancelled
// sao terminais (nao viram um ao outro nem voltam a running: quem quer "de novo"
// cria outra operacao). O DOM do app.js so consome estas duas decisoes.
export function opTransition(atual, proximo) {
  if (atual === 'running' && (proximo === 'done' || proximo === 'error' || proximo === 'cancelled')) return proximo;
  return atual;
}

// prazo de auto-dismiss por estado: running nao some sozinho; done some rapido;
// erro e cancelamento ficam mais tempo na tela pra dar tempo de ler, mas SEMPRE
// somem (pill de erro imortal acumulava uma por tentativa, o M22).
export function opDismissDelay(status) {
  if (status === 'running') return null;
  if (status === 'done') return 3000;
  return 6000;
}

// linha "Tempo por etapa" das Revisões recentes, a partir do resumo persistido
// na decisão (stageSummaryFrom, lib/engine/review.js). Vazio quando não há traço.
export function stagesLine(st) {
  if (!st || !Array.isArray(st.stages) || !st.stages.length) return '';
  const partes = st.stages.map(s => `${s.label} ${fmtDur(s.ms) || '0s'}`);
  const total = fmtDur(st.totalMs);
  return `Tempo por etapa: ${partes.join(' · ')}${total ? ` (total ${total})` : ''}`;
}

export const STAGE_FLOW_ORDER = [
  ['preparo', 'preparo'], ['leitura', 'leitura'], ['card', 'card'],
  ['verificacao', 'verificação'], ['raciocinio', 'raciocínio'], ['redacao', 'redação'],
];

export function stageFlowFrom(items, startedAt, agora = Date.now()) {
  const linhas = (items || []).filter(i => i && i.t);
  if (!startedAt) return [];
  const ms = {};
  let prev = startedAt, atual = null;
  for (const it of linhas) {
    const s = it.s || atual || 'preparo';
    ms[s] = (ms[s] || 0) + Math.max(0, it.t - prev);
    prev = it.t; atual = s;
  }
  if (atual) ms[atual] = (ms[atual] || 0) + Math.max(0, agora - prev);
  return STAGE_FLOW_ORDER.map(([id, label]) => {
    const passada = ms[id] ? 'done' : 'pending';
    return { id, label, ms: ms[id] || 0, state: id === atual ? 'active' : passada };
  });
}

// vazio até o primeiro evento (a esteira só aparece com traço de verdade)
export function stageFlowHtml(flow) {
  if (!flow || !flow.length || !flow.some(s => s.ms)) return '';
  return flow.map(s => {
    const dur = s.ms ? fmtDur(s.ms) : '';
    const titulo = dur ? `${s.label} · ${dur}` : s.label;
    const durHtml = dur ? `<span class="sf-ms">${esc(dur)}</span>` : '';
    return `<span class="sf-node sf-${esc(s.state)}" title="${esc(titulo)}">` +
      `<span class="sf-dot"></span><span class="sf-lbl">${esc(s.label)}</span>${durHtml}</span>`;
  }).join('<span class="sf-link"></span>');
}

// tooltip do badge 👥 do card de sessão: uma linha por subagente, com a tarefa
// e o estado. PURA (texto de atributo title, sem HTML, então sem esc aqui).
export function agentsTitle(lista) {
  return (lista || []).map(a => {
    const desc = a.desc ? `: ${a.desc}` : '';
    const situacao = a.done ? 'concluído' : 'trabalhando';
    return `${a.label}${desc} (${situacao})`;
  }).join('\n');
}

export function feedLine(it) {
  const icon = { tool: '⚙', text: '💬', warn: '⚠', info: '·' }[it.k] || '·';
  // it.a = rótulo do subagente dono da linha (fan-out de leitura/verificação):
  // a linha ganha a etiqueta 👤 pra distinguir do trabalho da sessão principal
  const ag = it.a ? `<span class="feed-agent" title="linha de um subagente">👤 ${esc(it.a)}</span>` : '';
  return `<div class="feed-line k-${esc(it.k)}${it.a ? ' from-agent' : ''}"><span class="feed-t">${fmtClock(it.t)}</span><span class="feed-i">${icon}</span>${ag}<span class="feed-x">${esc(it.text)}</span></div>`;
}

export function analysisOpsPlan(ops, snap) {
  snap = snap || {};
  const presentes = new Set();
  for (const s of (snap.activeSessions || [])) {
    if (s && s.mode === 'self') for (const k of (s.keys || [])) presentes.add(k);
  }
  for (const k of (snap.headlessWaiting || [])) presentes.add(k);
  const markSeen = [], close = [];
  for (const op of (ops || [])) {
    if (presentes.has(op.key)) { if (!op.seen) markSeen.push(op.id); }
    else if (op.seen) close.push(op.id);
  }
  return { markSeen, close };
}

export function selfSessionKey(sessions, id) {
  const s = (sessions || []).find(x => x && x.id === id && x.mode === 'self');
  return (s && s.keys && s.keys[0]) || null;
}

export function sessionProgress(count) {
  const n = Math.max(0, Number(count) || 0);
  return Math.min(90, 5 + Math.round(85 * (1 - Math.exp(-n / 18))));
}

export function sessionCardHtml(s = {}, stages = '') {
  const id = esc(s.id);
  const linkPR = s.pr?.url ? `<a href="${esc(s.pr.url)}" target="_blank" rel="noreferrer">abrir PR</a>` : '';
  // dono do PR que está sendo revisto AGORA: mesma menção navegável (foto + link)
  // que as outras telas usam, nunca "@login" solto. Sessão sem PR (ferramenta) e
  // autor desconhecido não inventam linha: a menção só existe quando há alguém.
  const autor = String(s.pr?.author || '').trim();
  const quemPR = autor ? `<span class="session-author">PR de ${personMention(autor, 'xs')}</span>` : '';
  const cancelar = s.cancellable ? `<button class="btn sm danger-ghost act-cancel" data-id="${id}">Cancelar</button>` : '';
  return `
      <div class="card session-card" data-id="${id}">
        <div class="session-head">
          <span class="spin accent"></span>
          <b>${esc(s.label)}</b> <span class="session-stage" data-started="${s.startedAt || ''}">${stages}</span>
          <span class="session-model" data-id="${id}" hidden></span>
          <span class="session-agents" data-id="${id}" hidden></span>
          ${quemPR}
          ${linkPR}
          <span class="session-elapsed" data-started="${s.startedAt}"></span>
          ${cancelar}
        </div>
        <div class="op-progress sess-progress" data-id="${id}"><span class="sess-pct"></span><div class="op-bar"><div class="op-bar-fill"></div></div></div>
        <div class="stage-flow" data-id="${id}" hidden></div>
        <div class="activity-feed" data-id="${id}"></div>
      </div>`;
}
