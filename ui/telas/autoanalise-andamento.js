// A autoanálise em andamento, por PR. O estado vivo vem do snapshot; aqui só o que a tela sabe
// sozinha: o clique que ainda não virou sessão, o cancelamento pedido e a sessão que sumiu sem
// deixar resultado. O desenho é ui/pure/autoanalise-faixa.js.
import { andamentoDaAutoanalise, faixaDaAutoanaliseHtml, linhaDaAutoanalise, selfSessionKey, sessaoSumiuSemResultado, tempoDecorrido, tomDaProntidao } from '../pure.js';
import { estado } from './estado.js';
import { api, toast } from './infra.js';

const INICIANDO = new Map();
const ACOMPANHADAS = new Map();
const CANCELANDO = new Set();
const FALHAS = new Map();
const ETAPA_VISTA = new Map();   // o feed é uma janela: a etapa não recua quando as linhas antigas saem
const SEM_RESULTADO = 'A sessão terminou sem resultado. O motivo saiu no aviso e fica em Sistema > Diagnóstico.';
const INICIANDO_MAX_MS = 60_000;   // aceito pelo servidor e nunca apareceu no estado: não gira para sempre

let repintar = () => {};
export function aoMudarAndamento(fn) { repintar = fn; }
export const iniciando = key => INICIANDO.has(key);

function sessaoDoPr(key) {
  return (estado().activeSessions || []).find(s => s.mode === 'self' && (s.keys || []).includes(key)) || null;
}

function acompanhar(key, { running, qpos, analise }) {
  if (running || qpos > 0) {
    INICIANDO.delete(key);
    FALHAS.delete(key);
    const sess = sessaoDoPr(key);
    if (sess?.cancelled) CANCELANDO.add(key);   // cancelada por "Analisando agora" ou por outra janela
    ACOMPANHADAS.set(key, sess?.startedAt || ACOMPANHADAS.get(key) || Date.now());
    return;
  }
  if (!ACOMPANHADAS.has(key)) return;
  const desde = ACOMPANHADAS.get(key);
  ACOMPANHADAS.delete(key);
  ETAPA_VISTA.delete(key);
  if (sessaoSumiuSemResultado({ desde, cancelada: CANCELANDO.delete(key), analise })) FALHAS.set(key, SEM_RESULTADO);
}

export function andamentoDoPr(key, { running, qpos, analise }) {
  acompanhar(key, { running, qpos, analise });
  const sess = running ? sessaoDoPr(key) : null;
  const vista = ETAPA_VISTA.get(key);
  const etapaMinima = (sess && vista?.id === sess.id && vista.etapa) || 0;
  const m = andamentoDaAutoanalise({ sess, itens: sess ? estado().activity?.[sess.id] : null, iniciandoDesde: INICIANDO.get(key) || 0,
    posicao: qpos, falha: FALHAS.get(key) || '', cancelando: CANCELANDO.has(key), etapaMinima });
  if (sess) ETAPA_VISTA.set(key, { id: sess.id, etapa: m.etapa });
  return m;
}

export function dispensarFalha(key) {
  FALHAS.delete(key);
  repintar();
}

export function pedirAutoanalise(url, key) {
  FALHAS.delete(key);
  CANCELANDO.delete(key);
  INICIANDO.set(key, Date.now());   // o retorno é na hora, antes de o servidor responder
  repintar();
  api('/api/self-review', { url }).then(r => {
    if (r?.ok) return;
    INICIANDO.delete(key);
    const motivo = r?.error || 'não consegui iniciar a autoanálise';
    FALHAS.set(key, motivo);
    toast('error', motivo);
    repintar();
  });
}

export async function cancelarAutoanalise(key) {
  CANCELANDO.add(key);
  repintar();
  const r = await api('/api/self-review/cancel', { key });
  if (r?.ok) return;
  // nunca afirmar "cancelado" sem o servidor confirmar
  CANCELANDO.delete(key);
  toast('error', r?.error || 'não consegui cancelar a autoanálise');
  repintar();
}

const barraDefinida = (el) => !el.querySelector('.aa-corre, .corre');

// Atualiza a barra no lugar: trocar o elemento reiniciaria a animação a cada evento.
function atualizarBarra(atual, nova, seletorDoCheio, m) {
  if (!atual || !nova) return;
  if (barraDefinida(atual) !== barraDefinida(nova)) { atual.replaceWith(nova); return; }
  const cheio = atual.querySelector(seletorDoCheio);
  if (cheio && m.barra === 'definida') cheio.style.width = `${m.pct}%`;
}

// Atualiza por partes, sem tocar em .aa-lado: trocar a faixa inteira tiraria o foco do Cancelar e
// perderia o clique que caísse entre o apertar e o soltar.
function pintarFaixa(faixa, m, key) {
  const molde = document.createElement('template');
  molde.innerHTML = faixaDaAutoanaliseHtml(m, { key }).trim();
  const nova = molde.content.firstElementChild;
  faixa.className = nova.className;
  if (faixa.dataset.aaEtapa !== nova.dataset.aaEtapa) {
    faixa.dataset.aaEtapa = nova.dataset.aaEtapa;
    faixa.querySelector('.aa-etapas').replaceWith(nova.querySelector('.aa-etapas'));
  }
  atualizarBarra(faixa.querySelector('.aa-trilho'), nova.querySelector('.aa-trilho'), '.aa-cheio', m);
  faixa.querySelector('.aa-rodape').replaceWith(nova.querySelector('.aa-rodape'));
}

function pintarLinha(linha, m, key) {
  const estadoEl = linha.querySelector('.pl-estado');
  if (estadoEl) {
    estadoEl.className = `pl-estado ${tomDaProntidao(m.tom)}`;
    estadoEl.lastChild.textContent = m.frase;
  }
  const molde = document.createElement('template');
  molde.innerHTML = linhaDaAutoanalise(m, { key }).rodape;
  atualizarBarra(linha.querySelector('.aa-fio'), molde.content.firstElementChild, 'i', m);
}

/* Chamado pelo connect() do ui/app.js pra cada evento de atividade de sessão, e pelo relógio: só
   age se a sessão for uma autoanálise, e repinta só aquele PR. */
export function updateAnalysisProgress(id) {
  const key = selfSessionKey(estado()?.activeSessions, id);
  if (!key) return;
  const faixa = document.querySelector(`.aa-faixa[data-aa-key="${CSS.escape(key)}"]`);
  const linha = faixa ? null : document.querySelector(`#myPRs .mypr-linha[data-key="${CSS.escape(key)}"]`);
  if (!faixa && !linha) return;
  const m = andamentoDoPr(key, { running: true, qpos: 0, analise: null });
  if (faixa) pintarFaixa(faixa, m, key);
  else pintarLinha(linha, m, key);
}

function expirarPedidos(agora) {
  let mudou = false;
  for (const [key, em] of INICIANDO) {
    if (agora - em <= INICIANDO_MAX_MS || sessaoDoPr(key) || (estado().headlessWaiting || []).includes(key)) continue;
    INICIANDO.delete(key);
    if (sessaoSumiuSemResultado({ desde: em, analise: estado().selfAnalyses?.[key] })) FALHAS.set(key, SEM_RESULTADO);
    mudou = true;
  }
  if (mudou) repintar();
}

// O relógio: o tempo de cada faixa, o "sem sinal" (sessão muda não gera evento nenhum) e o pedido
// que nunca virou sessão, sem repintar a tela, para não tirar o foco do botão Cancelar.
setInterval(() => {
  const agora = Date.now();
  document.querySelectorAll('[data-aa-tempo]').forEach(el => { el.textContent = tempoDecorrido(agora - Number(el.dataset.aaDesde)); });
  if (!estado()) return;
  for (const s of estado().activeSessions || []) if (s.mode === 'self') updateAnalysisProgress(s.id);
  expirarPedidos(agora);
}, 1000);
