// A autoanálise em andamento, por PR. O estado vivo vem do snapshot; aqui só o que a tela sabe
// sozinha: o clique que ainda não virou sessão, o cancelamento pedido e a sessão que sumiu sem
// deixar resultado. O desenho é ui/pure/autoanalise-faixa.js.
import { andamentoDaAutoanalise, faixaDaAutoanaliseHtml, selfSessionKey, tempoDecorrido } from '../pure.js';
import { estado } from './estado.js';
import { api, toast } from './infra.js';

const INICIANDO = new Map();
const ACOMPANHADAS = new Map();
const CANCELANDO = new Set();
const FALHAS = new Map();
const SEM_RESULTADO = 'A sessão terminou sem resultado. O motivo saiu no aviso e fica em Sistema > Diagnóstico.';
const INICIANDO_MAX_MS = 60_000;   // aceito pelo servidor e nunca apareceu no estado: não gira para sempre

let repintar = () => {};
export function aoMudarAndamento(fn) { repintar = fn; }
export const iniciando = key => INICIANDO.has(key);

function sessaoDoPr(key) {
  return (estado().activeSessions || []).find(s => s.mode === 'self' && (s.keys || []).includes(key)) || null;
}

function acompanhar(key, { running, qpos, analise }) {
  const pedidoEm = INICIANDO.get(key);
  if (running || qpos > 0) {
    INICIANDO.delete(key);
    FALHAS.delete(key);
    ACOMPANHADAS.set(key, sessaoDoPr(key)?.startedAt || ACOMPANHADAS.get(key) || Date.now());
    return;
  }
  if (pedidoEm && Date.now() - pedidoEm > INICIANDO_MAX_MS) {
    INICIANDO.delete(key);
    if (!(analise && analise.at >= pedidoEm)) FALHAS.set(key, SEM_RESULTADO);
    return;
  }
  if (!ACOMPANHADAS.has(key)) return;
  const desde = ACOMPANHADAS.get(key);
  ACOMPANHADAS.delete(key);
  if (!CANCELANDO.delete(key) && !(analise && analise.at >= desde)) FALHAS.set(key, SEM_RESULTADO);
}

export function andamentoDoPr(key, { running, qpos, analise }) {
  acompanhar(key, { running, qpos, analise });
  const sess = running ? sessaoDoPr(key) : null;
  return andamentoDaAutoanalise({ sess, itens: sess ? estado().activity?.[sess.id] : null, iniciandoDesde: INICIANDO.get(key) || 0,
    posicao: qpos, falha: FALHAS.get(key) || '', cancelando: CANCELANDO.has(key) });
}

export function pedirAutoanalise(url, key) {
  FALHAS.delete(key);
  CANCELANDO.delete(key);
  INICIANDO.set(key, Date.now());   // o retorno é na hora, antes de o servidor responder
  repintar();
  api('/api/self-review', { url }).then(r => {
    if (r?.ok) return;
    INICIANDO.delete(key);
    FALHAS.set(key, r?.error || 'não consegui iniciar a autoanálise');
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

/* Chamado pelo connect() do ui/app.js pra cada evento de atividade de sessão: só age se a sessão
   for uma autoanálise. Repinta só a faixa daquele PR, ou o texto e o fio da linha na Compacta,
   para não redesenhar a tela a cada evento. */
export function updateAnalysisProgress(id) {
  const key = selfSessionKey(estado()?.activeSessions, id);
  if (!key) return;
  const faixa = document.querySelector(`.aa-faixa[data-aa-key="${CSS.escape(key)}"]`);
  const m = andamentoDoPr(key, { running: true, qpos: 0, analise: null });
  if (faixa) { faixa.outerHTML = faixaDaAutoanaliseHtml(m, { key }); return; }
  const linha = document.querySelector(`.pr-linha[data-key="${CSS.escape(key)}"]`);
  if (!linha) return;
  const texto = linha.querySelector('.pl-estado');
  if (texto) texto.lastChild.textContent = m.frase;
  const fio = linha.querySelector('.aa-fio i');
  if (fio && m.barra === 'definida') { fio.className = ''; fio.style.width = `${m.pct}%`; }
}

// o relógio da faixa: só o texto do tempo, para não tirar o foco do botão Cancelar a cada segundo
setInterval(() => {
  const agora = Date.now();
  document.querySelectorAll('[data-aa-tempo]').forEach(el => { el.textContent = tempoDecorrido(agora - Number(el.dataset.aaDesde)); });
  if ([...INICIANDO.values()].some(em => agora - em > INICIANDO_MAX_MS)) repintar();
}, 1000);
