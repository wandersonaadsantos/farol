/* Farol · UI: ferramentas internas (kudos, diagnóstico com o Claude, log de falhas e a
   exportação de diagnóstico). */

import { esc, stripFence, fmtClock, md, logSummaryShort, diagnosticoHtml, falhasSecaoHtml } from '../pure.js';
import { estado, escopo } from './estado.js';
import { $, get, api, toast, confirmModal, copyToClipboard } from './infra.js';
import { ACCT } from './contas.js';

/* ---------- ferramentas internas (kudos/diagnostico) ---------- */
let lastKudosOutput = '';
function kudosScopeKey() { return escopo() === 'all' ? '*' : String(escopo()).toLowerCase(); }
function renderTools() {
  const runs = estado().toolRuns || {};
  const btnK = $('#btnKudos'), btnH = $('#btnHealth');

  // kudos é por conta: cada escopo tem sua própria compilação (nunca mistura contas)
  const kmap = (runs.kudos && typeof runs.kudos === 'object') ? runs.kudos : {};
  const k = kmap[kudosScopeKey()] || {};
  const scopeName = escopo() === 'all' ? '' : ((ACCT[String(escopo()).toLowerCase()] || {}).label || escopo());
  btnK.disabled = k.status === 'running';
  btnK.innerHTML = k.status === 'running'
    ? '<span class="spin"></span> Gerando…'
    : `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3l1.9 4.6 4.9.4-3.7 3.2 1.1 4.8L12 13.5 7.8 16l1.1-4.8L5.2 8l4.9-.4L12 3z" fill="currentColor"/></svg> Gerar kudos${scopeName ? ' de ' + esc(scopeName) : ''}`;
  const kp = $('#kudosPanel');
  kp.hidden = k.status !== 'done';
  if (k.status === 'done') {
    lastKudosOutput = stripFence(k.output);
    $('#kudosOut').innerHTML = md(lastKudosOutput);
    $('#kudosMeta').textContent = `gerado às ${fmtClock(k.finishedAt)}${scopeName ? ' · ' + esc(scopeName) : ''} · pronto pra colar no canal`;
  }

  const h = runs.health || {};
  btnH.disabled = h.status === 'running';
  btnH.textContent = h.status === 'running' ? 'Diagnosticando…' : 'Diagnóstico com o Claude';
  const hp = $('#healthPanel');
  hp.hidden = h.status !== 'done';
  if (h.status === 'done') {
    $('#healthOut').innerHTML = md(stripFence(h.output));
    $('#healthMeta').textContent = `rodado às ${fmtClock(h.finishedAt)}`;
  }
}

$('#btnKudosCopy').onclick = async () => {
  try {
    await navigator.clipboard.writeText(lastKudosOutput);
    toast('ok', 'Texto copiado. É só colar no canal.', 3000);
  } catch { toast('error', 'Não consegui copiar (permissão do navegador).'); }
};

/* limpar resultados de ferramenta: o painel some, nada além disso */
$('#btnKudosClear').onclick = async () => {
  const r = await api('/api/tool/clear', { name: 'kudos', scope: kudosScopeKey() });
  if (!r?.ok) toast('error', r?.error || 'não consegui limpar');
};
$('#btnHealthClear').onclick = async () => {
  const r = await api('/api/tool/clear', { name: 'health' });
  if (!r?.ok) toast('error', r?.error || 'não consegui limpar');
  else toast('ok', 'Diagnóstico limpo. O próximo parte do estado atual.', 3000);
};
$('#btnLogClear').onclick = async () => {
  // era o último confirm() nativo do app (o do update saiu na mesma leva)
  const ok = await confirmModal({
    danger: true,
    title: 'Zerar o log de falhas?',
    body: '<p>Use quando os pontos levantados já foram tratados: o próximo diagnóstico parte do zero, sem o histórico atual.</p>',
    confirmLabel: 'Zerar log'
  });
  if (!ok) return;
  const r = await api('/api/log/clear');
  if (!r?.ok) { toast('error', r?.error || 'não consegui limpar o log'); return; }
  toast('ok', 'Log de falhas zerado.', 3000);
  loadLog();
};

async function loadLog() {
  const [lines, grupos] = await Promise.all([get('/api/log'), get('/api/log/triage')]);
  const linhas = lines || [];
  $('#logBox').textContent = linhas.length ? linhas.join('\n') : 'Nenhuma falha registrada. Bom sinal.';
  // resumo agrupado ANTES do despejo: contagem crua não distingue "1 problema repetido
  // 70 vezes" de "70 problemas". Fica num parágrafo próprio de propósito, e não dentro
  // da .section-head: aquela linha é flex e quebra cedo (ver o CSS da aba).
  const resumo = $('#logResumo');
  const texto = logSummaryShort(grupos || [], 3);
  resumo.textContent = texto;
  resumo.hidden = !texto;
  const box = $('#logBox');
  box.scrollTop = box.scrollHeight;
  // as falhas registradas vivem ao lado do log, e a mesma ida à aba atualiza as duas
  carregarDiagnostico();
}

/* ---------- diagnóstico unificado (A3) ----------
   UM texto só, montado no engine (GET /api/diagnostics): ambiente, falhas registradas e
   resumo do log, com segredo mascarado, menção e URL em código e texto livre em cerca. A
   tela mostra esse texto inerte, e o botão copia o próprio texto, nunca o HTML. O export
   antigo montado aqui saiu junto com a função pura que o montava: ele juntava contas e
   configuração inteiras no texto
   copiado, e havia três superfícies dizendo a mesma coisa de jeitos diferentes. */
const falhas = { estado: 'carregando', lista: [], lidoEm: 0 };
let ultimoDiagnostico = '';

function renderFalhas() {
  const alvo = $('#diagFalhas');
  if (alvo) alvo.innerHTML = falhasSecaoHtml({ estado: falhas.estado, falhas: falhas.lista, lidoEm: falhas.lidoEm });
}

// Leitura que falha preserva a última lista boa e diz de quando ela é: vazio e falha são
// estados diferentes, e confundir os dois é o defeito que o brief nomeia.
async function carregarDiagnostico() {
  const r = await get('/api/diagnostics');
  if (r && r.ok) {
    ultimoDiagnostico = String(r.markdown || '');
    falhas.estado = 'pronto';
    falhas.lista = Array.isArray(r.falhas) ? r.falhas : [];
    falhas.lidoEm = Date.now();
  } else {
    falhas.estado = 'erro';
  }
  renderFalhas();
  return falhas.estado === 'pronto' ? ultimoDiagnostico : '';
}

$('#btnDiag').onclick = async () => {
  const btn = $('#btnDiag'), prev = btn.textContent;
  btn.disabled = true; btn.textContent = 'Lendo…';
  const texto = await carregarDiagnostico();
  btn.disabled = false; btn.textContent = prev;
  if (!texto) { toast('error', 'Não deu para montar o diagnóstico agora.', 4000); return; }
  $('#diagBox').innerHTML = diagnosticoHtml(texto);
  $('#diagPanel').hidden = false;
  const ok = await copyToClipboard(texto);
  const recado = ok ? 'Diagnóstico copiado como texto, com segredos mascarados.' : 'Diagnóstico pronto. Use "Copiar" para levar o texto.';
  toast(ok ? 'ok' : 'info', recado, 4500);
  $('#diagPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('#btnDiagCopy').onclick = async () => {
  const ok = await copyToClipboard(ultimoDiagnostico);
  toast(ok ? 'ok' : 'error', ok ? 'Copiado como texto.' : 'Não consegui copiar (permissão do navegador).', 2500);
};
$('#btnDiagClear').onclick = () => { $('#diagPanel').hidden = true; };
// cada cartão copia SÓ a própria falha, já mascarada pelo engine
$('#diagFalhas').addEventListener('click', async (ev) => {
  const botao = ev.target.closest('[data-copiar-falha]');
  if (!botao) return;
  const f = falhas.lista.find((x) => x.id === botao.dataset.copiarFalha);
  const ok = f ? await copyToClipboard(f.markdown) : false;
  toast(ok ? 'ok' : 'error', ok ? 'Falha copiada como texto.' : 'Não consegui copiar esta falha.', 2500);
});

export { kudosScopeKey, renderTools, loadLog, carregarDiagnostico };
