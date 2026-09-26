/* Farol · UI: infra que as telas usam (chamada ao engine, avisos, modal de confirmação,
   feedback visual de operações assíncronas). */

import { analysisOpsPlan, esc, opDismissDelay, opTransition } from '../pure.js';
import { escopo, estado } from './estado.js';
import { comAutorizacao } from '../transporte.js';

export const $ = (s) => document.querySelector(s);

/* ---------- helpers ---------- */
// A4: com token de pareamento salvo, as chamadas levam Authorization (ui/transporte.js);
// sem token, os cabeçalhos são exatamente os de sempre.
export function api(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: comAutorizacao({ 'Content-Type': 'application/json', 'x-farol': '1' }),
    body: JSON.stringify(body || {})
  }).then(r => r.json()).catch(() => null);
}
export function get(path) { return fetch(path, { headers: comAutorizacao() }).then(r => r.json()).catch(() => null); }
// GET que devolve também o código HTTP, para a tela que precisa dizer "a rota respondeu 502"
// em vez de "falhou" (a exportação do chat). Rede fora é status 0; corpo que não é JSON
// é corpo null. Nunca lança.
export async function getComStatus(path) {
  try {
    const r = await fetch(path, { headers: comAutorizacao() });
    const corpo = await r.json().catch(() => null);
    return { status: r.status, corpo };
  } catch { return { status: 0, corpo: null }; }
}

// Entrega um arquivo gerado na tela para a pessoa salvar (a exportação do chat). Devolve
// false quando o navegador não oferece download, para a tela sugerir o caminho de copiar.
export function baixarArquivo(nome, conteudo, tipo) {
  try {
    const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.style.display = 'none';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch { return false; }
}

// Copia texto com fallback: a Clipboard API exige contexto seguro e foco; quando
// falha (ex.: janela sem foco), recai pro textarea + execCommand, que não depende
// de permissão. Devolve true se algum caminho copiou. Não é sobre nenhuma tela em
// particular (o app.js usa em Revisões recentes, Panorama e Diagnóstico; Meus PRs
// usa no prompt de correção): mora aqui, ao lado de $/toast/api, por só tocar
// document/navigator.
export async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* cai no fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed'; ta.style.left = '-9999px'; ta.style.top = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

// segmentado: a classe pinta, o aria-pressed e o que o leitor de tela anuncia.
// Um helper so pra os dois nunca divergirem. Usado por Entregas, Consumo e Sistema:
// mora aqui pra nenhuma dessas telas depender de outra por acidente de posição.
export function marcarSeg(botoes, ehAtivo) {
  botoes.forEach(b => { const a = ehAtivo(b); b.classList.toggle('active', a); b.setAttribute('aria-pressed', a ? 'true' : 'false'); });
}

// Mantém `abertos` em dia com os <details data-abre> de uma lista que se redesenha por
// innerHTML. É a convenção de Entregas (o listener de #deliveries em entregas.js): a
// tela guarda as chaves, o HTML sai com `open` a partir delas, e o redesenho a cada estado
// do SSE deixa de fechar o que a pessoa abriu. `toggle` não borbulha, daí a captura.
export function lembrarAbertos(box, abertos) {
  if (!box) return;
  box.addEventListener('toggle', (e) => {
    const d = e.target;
    const chave = d && d.dataset && d.dataset.abre;
    if (!chave) return;
    if (d.open) abertos.add(chave); else abertos.delete(chave);
  }, true);
}

// pisca o alvo depois de navegar, pra achar a linha no meio da seção. Usado pelo
// roteador de navegação interna (sysGoTo, gotoAba, gotoDeliv) e por quem abre um
// editor específico fora dele; mora aqui pelo mesmo motivo do marcarSeg acima.
export function sysFlash(el) {
  if (!el || !el.animate) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([
    { boxShadow: '0 0 0 0 rgba(255,180,84,0)' },
    { boxShadow: '0 0 0 3px rgba(255,180,84,.32)', offset: .5 },
    { boxShadow: '0 0 0 0 rgba(255,180,84,0)' }
  ], { duration: 850, iterations: 2 });
}

function toastBase(kind, ms) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
  return el;
}

export function toast(kind, text, ms = 5000) {
  const el = toastBase(kind, ms);
  el.textContent = String(text ?? '');
  return el;
}

// Só os dois avisos que realmente têm estrutura usam esta variante. O chamador
// constrói nós DOM; nenhuma string volta a ser reinterpretada como HTML.
export function toastRich(kind, build, ms = 5000) {
  const el = toastBase(kind, ms);
  build(el);
  return el;
}

/* ---------- modal de confirmação (ações destrutivas) ---------- */
// Devolve uma Promise<boolean>. body aceita HTML (controlado por nós). Toda ação
// que apaga/remove algo deve passar por aqui, deixando o IMPACTO claro.
export function confirmModal(opts) {
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.innerHTML = `<div class="modal-card ${opts.danger ? 'danger' : ''}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div class="modal-title" id="modalTitle">${esc(opts.title || 'Confirmar')}</div>
      <div class="modal-body">${opts.body || ''}</div>
      <div class="modal-actions">
        <button class="btn sm ghost modal-cancel">${esc(opts.cancelLabel || 'Cancelar')}</button>
        <button class="btn sm ${opts.danger ? 'danger-solid' : 'primary'} modal-ok">${esc(opts.confirmLabel || 'Confirmar')}</button>
      </div>
    </div>`;
    document.body.appendChild(ov);
    const close = (v) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    ov.querySelector('.modal-cancel').onclick = () => close(false);
    ov.querySelector('.modal-ok').onclick = () => close(true);
    ov.onclick = (e) => { if (e.target === ov) close(false); };
    document.addEventListener('keydown', onKey);
    setTimeout(() => ov.querySelector('.modal-cancel').focus(), 30);
  });
}

/* ---------- operation feedback system (async operations transparency) ---------- */
/* UNIFIED FEEDBACK VISUAL SYSTEM

   Goal: Users never unsure if app is frozen. Every async operation shows:
   - Current step (e.g., "Lendo arquivos…")
   - Progress % (0-100)
   - Expected time remaining (ETA)
   - Queue position (if applicable)
   - Auto-dismiss on completion or error

   API Functions:
   - showOp(opId, opts) — start operation widget (inline: true for compact pill)
   - updateOp(opId, {step, progress, eta, queuePos, status}) — update progress
   - closeOp(opId, status, message) — mark done/error, auto-dismiss after 3s

   Visual Patterns:
   1. Operation Widget (.op-widget) — full card with icon, step, progress bar
   2. Inline Pill (.op-inline-pill) — compact text badge for background ops
   3. Auto-dismiss — fades out 3s after completion

   Coverage (9 problem areas resolved):
   - Polling: status checks with queue feedback
   - Data Loading: spinners for Deliveries/Highlights/Team
   - Review/Analysis: progress through Lendo → Analisando → Montando
   - Merge: success toast on completion
   - Chat: phase progression + streaming indicator
   - Update: verification feedback badge
   - Settings: success toast on save
   - Tools: Kudos & Health execution feedback
   - Session Startup: stage indicators (iniciando → processando)

   Implementation: Pure JS, no frameworks. ACTIVE_OPS Map tracks all active operations.
   Reusable across all async flows via showOp/updateOp/closeOp pattern.
*/
export let ACTIVE_OPS = new Map();  // opId → {id, type, status, step, progress, eta, queuePos, startTime, cancellable, container, element}

export function showOp(opId, opts) {
  opts = opts || {};
  // reuso do mesmo opId nao pode orfanar a pill anterior no DOM (M22): a entrada
  // do Map era substituida e o elemento velho ficava pra sempre sem referencia
  const prev = ACTIVE_OPS.get(opId);
  if (prev && prev.element) prev.element.remove();
  const op = {
    id: opId,
    type: opts.type || 'generic',
    title: opts.title || 'Operação…',
    status: 'running',
    step: '',
    progress: 0,
    startTime: Date.now(),
    cancellable: opts.cancellable || false,
    cancel: opts.cancel || null,   // { path, body }: o POST real que o botão Cancelar dispara
    key: opts.key || '',           // key do PR (ops de autoanálise): liga o op ao snapshot
    seen: false,                   // o key já apareceu num snapshot? (guarda da corrida SSE)
    container: opts.container || document.body,
    inline: opts.inline || false
  };
  ACTIVE_OPS.set(opId, op);
  if (op.inline) {
    op.element = document.createElement('span');
    op.element.className = 'op-inline-pill';
  } else {
    op.element = document.createElement('div');
    op.element.className = 'op-widget';
    op.element.setAttribute('data-op-id', opId);
  }
  op.container.appendChild(op.element);
  updateOpDisplay(opId);
  return op.element;
}

export function updateOp(opId, update) {
  const op = ACTIVE_OPS.get(opId);
  if (!op) return;
  Object.assign(op, {
    step: update.step !== undefined ? update.step : op.step,
    progress: update.progress !== undefined ? update.progress : op.progress,
    eta: update.eta,
    queuePos: update.queuePos !== undefined ? update.queuePos : op.queuePos,
    status: update.status || op.status
  });
  updateOpDisplay(opId);
}

export function closeOp(opId, result = 'done', message = '') {
  const op = ACTIVE_OPS.get(opId);
  if (!op) return;
  op.status = opTransition(op.status, result);  // running -> done | error | cancelled
  op.message = message;
  updateOpDisplay(opId);
  const delay = opDismissDelay(op.status);
  if (delay !== null) {
    setTimeout(() => {
      if (op.element) op.element.remove();
      // so deleta se a entrada ainda for ESTA op: um showOp com o mesmo id pode
      // ter recriado a operacao, e o timer velho nao pode apagar a nova
      if (ACTIVE_OPS.get(opId) === op) ACTIVE_OPS.delete(opId);
    }, delay);
  }
}

// ---- auxiliares de rótulo e escolha, extraídos de cadeias de ternários ----

const TEXTO_DA_LISTA_VAZIA = {
  loading: () => 'Verificando os PRs abertos…',
  error: () => 'Não foi possível confirmar ainda (a checagem falhou; veja o aviso no topo). Vou tentar de novo no próximo ciclo.',
};
export function textoDaListaVazia(vs) {
  const f = TEXTO_DA_LISTA_VAZIA[vs];
  if (f) return f();
  return `Nenhum PR aberto ${escopo() === 'all' ? 'nas organizações monitoradas' : 'nesta conta'}.`;
}

// a ordem é de precedência: rodando agora vence a fila, que vence "já analisei antes"
export function rotuloDoBotaoDeAnalise({ running, queued, qpos, analisado }) {
  if (running) return 'Analisando…';
  if (queued) return `Na fila (${qpos})`;
  return analisado ? 'Reanalisar' : 'Analisar';
}

// a dimensão escolhe de qual mapa do envelope sair e onde estão os nomes das camadas
export const DIMENSAO_DO_CONSUMO = {
  model: { key: 'byModel', campoDeNomes: 'modelNames' },
  account: { key: 'byAccount', campoDeNomes: 'accountNames' },
  kind: { key: 'byKind', campoDeNomes: 'kindNames' },
};

export function origemLocal(u) {
  return u.source ? `fonte em <code>${esc(u.source)}</code>` : '';
}

export function tituloDaNotificacao(auto, n) {
  if (auto) return n === 1 ? 'PR novo, revisando sozinho' : `${n} PRs novos, revisando sozinho`;
  return n === 1 ? 'PR aguardando sua revisão' : `${n} PRs aguardando sua revisão`;
}

// conta silenciada mostra a pausa; as demais mostram a contagem, quando há o que contar
export function selo(a, showCounts, att) {
  if (a.muted) return '<span class="seg-pause">⏸</span>';
  return showCounts && att ? `<span class="seg-count">${att}</span>` : '';
}

// '__all__' passa tudo; usuário nomeado compara sem caixa; vazio pede entrada SEM dono
export function doUsuario(dono, user) {
  if (user === '__all__') return true;
  return user ? dono.toLowerCase() === user.toLowerCase() : !dono;
}

// três estados, e o que não é 'running' nem 'done' é erro: o ícone não inventa um
// quarto estado para status desconhecido
const ICONE_DA_OPERACAO = { running: 'spin', done: 'done' };
function classeDoIcone(status) {
  return ICONE_DA_OPERACAO[status] || 'error';
}

// a posição na fila manda quando existe (mesmo zero, que apaga o texto); sem ela, a
// estimativa de tempo; sem as duas, nada
function metaDaOperacao(op) {
  if (op.queuePos !== undefined) return `<span>${op.queuePos > 0 ? `fila: ${op.queuePos}` : ''}</span>`;
  if (op.eta) return `<span>~${formatDuration(op.eta)}</span>`;
  return '';
}

function updateOpDisplay(opId) {
  const op = ACTIVE_OPS.get(opId);
  if (!op || !op.element) return;
  const isInline = op.element.classList.contains('op-inline-pill');
  if (isInline) {
    op.element.className = `op-inline-pill ${op.status}`;
    const iconHtml = `<span class="op-icon ${classeDoIcone(op.status)}"></span>`;
    const text = esc(op.step || op.title);
    op.element.innerHTML = `${iconHtml} ${text}`;
  } else {
    op.element.className = `op-widget ${op.status}`;
    const iconHtml = `<span class="op-icon ${classeDoIcone(op.status)}"></span>`;
    const metaHtml = metaDaOperacao(op);
    const progressHtml = op.progress > 0 && op.progress < 100
      ? `<div class="op-progress"><span>${op.progress}%</span><div class="op-bar"><div class="op-bar-fill" style="width: ${op.progress}%"></div></div></div>`
      : '';
    const cancelHtml = op.cancellable && op.status === 'running'
      ? `<button class="op-cancel" data-op-id="${esc(opId)}">Cancelar</button>`
      : '';
    op.element.innerHTML = `
      <div class="op-header"><span class="op-icon ${classeDoIcone(op.status)}"></span><span>${esc(op.title)}</span></div>
      ${op.step ? `<div class="op-step" title="${esc(op.step)}">${esc(op.step)}</div>` : ''}
      ${progressHtml}
      ${metaHtml ? `<div class="op-meta">${metaHtml}</div>` : ''}
      ${op.message && op.status !== 'running' ? `<div style="color: var(--muted); font-size: 12px; margin-top: 4px;">${esc(op.message)}</div>` : ''}
      ${op.cancellable || cancelHtml ? `<div class="op-actions">${cancelHtml}</div>` : ''}
    `;
  }
}

function formatDuration(ms) {
  if (ms < 60000) return `${Math.ceil(ms / 1000)}s`;
  return `${Math.ceil(ms / 60000)}m`;
}

document.addEventListener('click', async (e) => {
  if (e.target.classList && e.target.classList.contains('op-cancel')) {
    const opId = e.target.dataset.opId;
    const op = ACTIVE_OPS.get(opId);
    // op sem pedido de cancelamento declarado: não há o que pedir ao servidor,
    // fecha só o widget (feedback puramente visual)
    if (!op || !op.cancel) { closeOp(opId, 'cancelled', 'Cancelado'); return; }
    e.target.disabled = true;   // evita POST duplo durante o await
    const r = await api(op.cancel.path, op.cancel.body);
    if (r && r.ok) closeOp(opId, 'cancelled', 'Cancelado pelo usuário');
    else {
      // NUNCA afirmar "cancelado" sem o servidor confirmar (a mentira do achado M18)
      closeOp(opId, 'error', (r && r.error) || 'não consegui cancelar');
      toast('error', (r && r.error) || 'não consegui cancelar a autoanálise');
    }
  }
});

/* ciclo de vida dos widgets de autoanálise: o FIM vem do snapshot (SSE), não de um
   response. Reanexa o elemento (o innerHTML de #myPRs destrói os filhos a cada
   re-render) e fecha quando a análise some do estado (analysisOpsPlan, pura, testada). */
export function syncAnalysisOps() {
  const ops = [...ACTIVE_OPS.values()].filter(o => o.type === 'analysis');
  if (!ops.length) return;
  for (const op of ops) {
    if (op.element && !op.element.isConnected) {
      const card = document.querySelector(`.mypr-card[data-key="${CSS.escape(op.key)}"]`);
      if (card) card.appendChild(op.element);
    }
  }
  const plan = analysisOpsPlan(ops.map(o => ({ id: o.id, key: o.key, seen: !!o.seen })), estado() || {});
  for (const id of plan.markSeen) { const op = ACTIVE_OPS.get(id); if (op) op.seen = true; }
  for (const id of plan.close) {
    const op = ACTIVE_OPS.get(id);
    if (!op) continue;
    if (op.status === 'running') closeOp(id, 'done', 'Análise concluída');
    else { if (op.element) op.element.remove(); ACTIVE_OPS.delete(id); }  // cancelado/erro: só limpa
  }
}
