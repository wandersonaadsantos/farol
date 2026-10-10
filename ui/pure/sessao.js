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
// Progresso de sessão: a régua ÚNICA do app.
// Regra do Wanderson (16/08/2026): previsibilidade com qualidade, centralizada
// e acessível pra todo o sistema. Antes cada fluxo chutava seu percentual (a
// autoanálise ficava em 25% fixo e concluía do nada, o chat idem) e a revisão
// automática nem barra tinha. sessionProgress é a régua única: converte a
// contagem de eventos REAIS da sessão (feed do SSE 'activity', ou contagem
// local no chat) num percentual sempre crescente, assintótico a 90 (os 10
// finais pertencem ao fechamento real, decidido pelo snapshot). Barra nova no
// app usa ESTA função, nunca um número escrito à mão; quem mudar a curva muda
// pra todos os fluxos de uma vez. selfSessionKey acha o PR da sessão de
// autoanálise dona de um evento de atividade (roteio feed -> widget).
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

// Progresso da sessão (09/10/2026): porcentagem sobre dado REAL, que nunca estaciona.
// Desenho e textos do Claude Design, handoff em
// docs/superpowers/specs/2026-10-09-progresso-da-sessao-anexos/HANDOFF.md.
//
// Revisão: tempo decorrido sobre o tempo TÍPICO de revisões parecidas, que o engine mede
// no histórico de decisões e manda em `s.estimativa` (lib/engine/estimativa-sessao.js).
// Até o tempo típico a barra anda em linha reta de 2% a 92%; depois dele ela segue
// subindo, cada vez mais devagar, rumo a 95%, e o texto diz que passou do típico em vez
// de a barra fingir que sabe. Autoanálise: os arquivos do PR já lidos sobre o total que
// o engine materializou (`lidos`/`totalArquivos`). Etapa real é piso: chegou na
// verificação, pelo menos 55%; modelo concluiu, 97%. 100% é só o fim de verdade, e quem
// garante que a barra nunca volta é a tela (ela guarda o maior valor já mostrado).
//
// Sem histórico (instalação nova) a barra anda pelo tempo típico PADRÃO, mas o texto não
// promete prazo nenhum: estimativa que o app não tem não vira "faltam 3 min".
export const TIPICO_PADRAO_MS = 6 * 60000;
export const PISO_VERIFICACAO = 55;
export const PCT_FECHANDO = 97;
const TETO_PASSOU = 95;

const minutosArredondados = (ms) => Math.max(1, Math.round(ms / 60000));
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

function pctDaSessao(s, flow, agora, tipico) {
  const r = s.startedAt ? Math.max(0, agora - s.startedAt) / tipico : 0;
  let pct = r <= 1 ? 2 + 90 * r : 92 + (TETO_PASSOU - 92) * (1 - Math.exp(-(r - 1)));
  const total = Number(s.totalArquivos) || 0;
  if (total) pct = Math.max(pct, 2 + 83 * (Math.min(total, Number(s.lidos) || 0) / total));
  const verificando = (flow || []).some(n => n && n.id === 'verificacao' && n.state !== 'pending');
  if (verificando) pct = Math.max(pct, PISO_VERIFICACAO);
  // uma casa decimal: a largura da barra anda de forma contínua mesmo quando o número
  // inteiro mostrado demora a mudar (depois do tempo típico, a subida é lenta)
  return { pct: Math.min(TETO_PASSOU, Math.floor(pct * 10) / 10), r };
}

// { pct, estado: 'viva' | 'muda', texto, base, aria }, com `pct` em uma casa decimal (a
// tela mostra o inteiro e usa o decimal na largura). Os textos são os do desenho, um
// por estado; `aria` é o aria-valuetext da barra.
export function progressoDaSessao(s = {}, flow = [], agora = Date.now()) {
  if (s.fase === 'fechando') {
    return { pct: PCT_FECHANDO, estado: 'viva', texto: 'modelo concluiu · decidindo e postando', base: '', aria: `${PCT_FECHANDO}%, modelo concluiu, decidindo e postando` };
  }
  const est = s.estimativa && s.estimativa.tipicoMs > 0 ? s.estimativa : null;
  const { pct, r } = pctDaSessao(s, flow, agora, est ? est.tipicoMs : TIPICO_PADRAO_MS);
  const mudoHa = s.ultimoSinalEm ? agora - s.ultimoSinalEm : 0;
  if (mudoHa > SEM_SINAL_MS) {
    return { pct, estado: 'muda', texto: `sem sinal há ${duracaoCurta(mudoHa)}`, base: 'a barra volta a andar quando chegar evento', aria: `${Math.floor(pct)}%, parado, sem sinal há ${duracaoFalada(mudoHa)}` };
  }
  const total = Number(s.totalArquivos) || 0;
  const viva = (texto, base, falado) => ({ pct, estado: 'viva', texto, base, aria: `${Math.floor(pct)}%, ${falado || texto}` });
  if (!s.ultimoSinalEm && !s.lidos) return viva('preparando', 'aguardando o primeiro evento');
  if (total) {
    const lidos = Math.min(total, Number(s.lidos) || 0);
    return viva(`${lidos} de ${total} arquivos lidos`, '');
  }
  if (!est) return viva('em andamento', 'ainda sem histórico para estimar o tempo', 'em andamento, sem estimativa de tempo');
  if (r > 1) {
    const m = minutosArredondados(est.tipicoMs);
    return viva(`passou do tempo típico (~${m} min)`, 'ainda trabalhando', `passou do tempo típico de cerca de ${m} minutos, ainda trabalhando`);
  }
  const falta = est.tipicoMs - (agora - s.startedAt);
  if (falta < 60000) return viva('menos de 1 min', baseDaEstimativa(est), 'menos de 1 minuto restante');
  const m = minutosArredondados(falta);
  const falado = m === 1 ? 'cerca de 1 minuto restante' : `cerca de ${m} minutos restantes`;
  return viva(`~${m} min restantes`, baseDaEstimativa(est), falado);
}

// estado 8: o fim real. O cartão fica assim por um instante antes de sair.
export function conclusaoDaSessao(s = {}, agora = Date.now()) {
  const dur = s.startedAt ? `em ${duracaoCurta(agora - s.startedAt)}` : '';
  return { pct: 100, estado: 'concluida', texto: 'concluída', base: dur, aria: '100%, concluída' };
}

// Rótulo da etapa ATIVA da esteira, que é a etapa de verdade (item.s do engine). Substitui
// o stageLabel(uptime), que só dizia "(iniciando…)"/"(processando…)" e virava string vazia
// aos 15 s, deixando o cabeçalho do cartão mudo pelo resto da revisão.
export function etapaAtiva(flow) {
  const no = (flow || []).find(x => x && x.state === 'active');
  return no ? no.label : '';
}

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
  const cancelar = s.cancellable ? `<button class="btn sm danger-ghost act-cancel" data-id="${id}">Cancelar</button>` : '';
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
        <div class="op-progress sess-progress" data-id="${id}" data-estado="viva" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span class="sess-pct">0%</span>
          <div class="op-bar"><div class="op-bar-fill" style="width:0%"></div></div>
          <span class="sess-sinal" aria-hidden="true"></span>
          <div class="sess-txt"><span class="sess-estado"></span><span class="sess-base"></span></div>
          <span class="sess-aviso" aria-live="polite"></span>
        </div>
        ${othersLineHtml(outros, 'sessao')}
        <div class="stage-flow" data-id="${id}" hidden></div>
        <div class="activity-feed" data-id="${id}"></div>
      </div>`;
}
