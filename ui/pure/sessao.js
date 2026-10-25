// A sessão de revisão ao vivo: esteira de etapas, feed, subagentes e progresso.
//
// A esteira é o desenho estilo n8n do card "Analisando agora", e o progresso é a régua
// ÚNICA do app: quem muda a conta de etapas muda os dois lados (o card ao vivo e o resumo
// que fica na decisão), e é por isso que eles moram juntos.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
//
// Esteira de etapas da revisão ao vivo (estilo n8n).
// Os itens do feed chegam ESTAMPADOS com a etapa (item.s, decidido no engine em
// stageOfLine; a UI nunca reclassifica). O tempo entre dois itens pertence à
// etapa do item que o encerra; item sem estampa (linha informativa do app) herda
// a etapa corrente. A etapa do último item é a ATIVA e acumula até `agora`.
//
// Ops de autoanálise: decisão de fechamento.
// A UI cria um widget por análise lançada (opId 'analysis-<key>'), mas quem sabe o FIM
// é o snapshot do SSE: a análise some de activeSessions (mode self) e de
// headlessWaiting quando termina. Protocolo seen/close por causa da corrida: um state
// emitido antes do servidor enfileirar pode chegar depois do clique, e sem o `seen` o
// widget recém-nascido fecharia como "concluído". headlessWaiting também carrega keys
// de revisão normal, sem colisão na prática (o GitHub não pede review pro autor).
//
// Etapas e sinais de atividade são observações. Sem denominador conhecido,
// widgets não apresentam porcentagem de conclusão.
//
// Cartão da sessão ao vivo.
// O bloco que aparece enquanto o Claude está trabalhando num PR. Os `data-id`/`data-started`
// não são decoração: o app volta neles depois para atualizar tempo, modelo e progresso sem
// redesenhar o cartão. Trocar um atributo desses quebra a atualização, não o layout.

// Maquina de estados minima: 'running' e o unico estado que anda; done/error/cancelled
// sao terminais (nao viram um ao outro nem voltam a running: quem quer "de novo"
// cria outra operacao). O DOM do app.js so consome estas duas decisoes.
import { esc, fmtClock, fmtDur } from './comum.js';
import { personMention } from './mencoes.js';
import { othersLineHtml } from './revisando.js';

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

// Os ids TÊM que ser os que o engine estampa em item.s (STAGE_ORDER, review.js). O nó
// final era 'redacao' aqui e 'fechamento' lá: o nó nunca acendia, e o tempo da última
// etapa (o silêncio entre a última linha e o fim, que costuma ser a parte mais longa)
// não aparecia em lugar nenhum da esteira ao vivo.
export const STAGE_FLOW_ORDER = [
  ['preparo', 'preparo'], ['leitura', 'leitura'], ['card', 'card'],
  ['verificacao', 'verificação'], ['raciocinio', 'raciocínio'], ['fechamento', 'fechamento'],
];

// Sem linha nova no feed por isto, a sessão está MUDA. Não é morte: o stream pode estar
// num bloco longo. Mas dizer "analisando" com o relógio subindo e nada acontecendo é o
// que faz o acompanhamento parecer inventado, então a tela passa a dizer o que sabe.
export const SEM_SINAL_MS = 45000;

// Tempo típico é referência histórica, nunca percentual de conclusão da IA.
// Só a fração de arquivos declarados lidos tem denominador observável.
const minutosDecimais = (ms) => (ms / 60000).toFixed(1).replace('.', ',');

// "45s", "1min 10s": o formato do desenho (o fmtDur do app escreve "1m10s")
function duracaoCurta(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${s % 60}s`;
}
function duracaoFalada(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const seg = (n) => `${n} segundo${n === 1 ? '' : 's'}`;
  if (s < 60) return seg(s);
  const m = Math.floor(s / 60);
  return `${m} minuto${m === 1 ? '' : 's'} e ${seg(s % 60)}`;
}

function baseDaEstimativa(est) {
  if (est.base === 'tamanho') return `típico: ${minutosDecimais(est.tipicoMs)} min em PR deste tamanho (${est.amostras} revisões)`;
  return `típico: ${minutosDecimais(est.tipicoMs)} min (mediana geral)`;
}

export function progressoDaSessao(s = {}, flow = [], agora = Date.now()) {
  const base = 'Etapas observadas não medem a conclusão da análise.';
  if (s.fase === 'fechando') return { pct: null, estado: 'viva', texto: 'modelo concluiu · verificando e decidindo', base, aria: 'modelo concluiu, verificando e decidindo, conclusão não medida' };
  const total = Number.isInteger(s.totalArquivos) && s.totalArquivos > 0 ? s.totalArquivos : 0;
  const lidos = Number.isInteger(s.lidos) && s.lidos >= 0 ? Math.min(total, s.lidos) : 0;
  const pct = total ? Math.floor(lidos / total * 100) : null;
  const cobertura = total ? `${lidos} de ${total} arquivos declarados lidos` : '';
  const mudoHa = s.ultimoSinalEm ? Math.max(0, agora - s.ultimoSinalEm) : 0;
  if (mudoHa > SEM_SINAL_MS) return { pct, estado: 'muda', texto: `sem sinal há ${duracaoCurta(mudoHa)}`, base: cobertura || 'Sem evento novo; não é possível medir a conclusão.', aria: `sem sinal há ${duracaoFalada(mudoHa)}, conclusão não medida` };
  if (total) return { pct, estado: 'viva', texto: cobertura, base: 'Percentual de leitura declarada, não de conclusão nem prova de cobertura.', aria: `${pct}% dos arquivos declarados lidos, análise ainda em andamento` };
  const stage = etapaAtiva(flow);
  const texto = stage || (s.ultimoSinalEm ? 'em andamento' : 'preparando');
  const est = s.estimativa;
  const referencia = est?.tipicoMs > 0 ? baseDaEstimativa(est) : 'ainda sem histórico de duração';
  return { pct: null, estado: 'viva', texto, base: `${referencia}. ${base}`, aria: `${texto}, conclusão não medida` };
}

// Saída observada do snapshot. Não prova sucesso da análise ou da postagem.
export function conclusaoDaSessao(s = {}, agora = Date.now()) {
  const dur = s.startedAt ? `em ${duracaoCurta(agora - s.startedAt)}` : '';
  return { pct: null, estado: 'encerrada', texto: 'sessão encerrada', base: `${dur} · consulte o resultado da revisão`, aria: 'sessão encerrada, consulte o resultado da revisão' };
}

// Rótulo da etapa ATIVA da esteira, que é a etapa de verdade (item.s do engine). Substitui
// o stageLabel(uptime), que só dizia "(iniciando…)"/"(processando…)" e virava string vazia
// aos 15 s, deixando o cabeçalho do cartão mudo pelo resto da revisão.
export function etapaAtiva(flow) {
  const no = (flow || []).find(x => x && x.state === 'active');
  return no ? no.label : '';
}

export function stageFlowFrom(items, startedAt, agora = Date.now(), anterior = null) {
  const linhas = (items || []).filter(i => i && i.t);
  if (!startedAt) return [];
  const ms = { ...(anterior?.ms || {}) };
  let prev = anterior?.lastT || startedAt, atual = anterior?.stage || null;
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

// Compatibilidade dos widgets: quantidade de eventos não mede conclusão.
export function sessionProgress() { return null; }

// `outros`: quem MAIS está revisando o PR desta sessão (estado 5 do desenho de 02/10/2026,
// ui/pure/revisando.js), só a linha curta e sem botão.
export function sessionCardHtml(s = {}, stages = '', outros = []) {
  const id = esc(s.id);
  const linkPR = s.pr?.url ? `<a href="${esc(s.pr.url)}" target="_blank" rel="noreferrer">abrir PR</a>` : '';
  // dono do PR que está sendo revisto AGORA: mesma menção navegável (foto + link)
  // que as outras telas usam, nunca "@login" solto. Sessão sem PR (ferramenta) e
  // autor desconhecido não inventam linha: a menção só existe quando há alguém.
  const autor = String(s.pr?.author || '').trim();
  const quemPR = autor ? `<span class="session-author">PR de ${personMention(autor, 'xs')}</span>` : '';
  const cancelamentoDisabled = s.cancelled ? ' disabled' : '';
  const cancelamentoTexto = s.cancelled ? 'Cancelando…' : 'Cancelar';
  const cancelar = s.cancellable ? `<button class="btn sm danger-ghost act-cancel" data-id="${id}"${cancelamentoDisabled}>${cancelamentoTexto}</button>` : '';
  return `
      <div class="card session-card" data-id="${id}">
        <div class="session-head">
          <b>${esc(s.label)}</b> <span class="session-stage" data-id="${id}">${stages}</span>
          <span class="session-model" data-id="${id}" hidden></span>
          <span class="session-agents" data-id="${id}" hidden></span>
          ${quemPR}
          ${linkPR}
          <span class="session-elapsed" data-started="${s.startedAt}"></span>
          ${cancelar}
        </div>
        <div class="op-progress sess-progress" data-id="${id}" data-estado="viva" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-label="Andamento da sessão" aria-valuetext="Conclusão não medida">
          <span class="sess-pct">Em andamento</span>
          <div class="op-bar"><div class="op-bar-fill" style="width:0%"></div></div>
          <span class="sess-sinal" aria-hidden="true"></span>
          <div class="sess-txt"><span class="sess-estado"></span><span class="sess-base"></span></div>
          <span class="sess-aviso" aria-live="polite"></span>
        </div>
        ${othersLineHtml(outros, 'sessao')}
        <div class="stage-flow" data-id="${id}" hidden></div>
        <details class="session-agent-details review-tools disc agents" data-id="${id}" hidden><summary>Equipe da sessão</summary><ul class="agent-list"></ul></details>
        <div class="activity-feed" data-id="${id}"></div>
      </div>`;
}
