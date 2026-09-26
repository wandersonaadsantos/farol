/* Farol · UI: chat com o Claude por PR (--resume da sessão, ver lib/engine/chat.js).
   Não é aba (não passa por registrarTela): abre por cima de qualquer uma, pelo
   botão .act-chat ou pela busca de URL. O connect() do ui/app.js só entrega os
   eventos `chat`/`chat-activity`; quem decide o que fazer com eles é este módulo,
   dono de chatKeyAtual() (o mesmo padrão de escopo()/definirEscopo()).

   Desenho do Claude Design (26/09/2026, handoff em
   docs/superpowers/specs/2026-09-26-chat-responsivo-anexos/): a conversa rola como UMA
   coisa só, o id da sessão e a exportação ficam numa faixa sob o cabeçalho (no celular,
   numa gaveta atrás de "Id e exportar"). O que não precisa de DOM mora em ui/pure/chat.js. */

import {
  canonicalGithubPrUrl, prKeyFromUrl, sessionProgress, CHAT_TEXTOS, chatAvisoExportado, chatAvisoFalhaExport,
  chatCarregandoHtml, chatContagem, chatEstadoDaSessao, chatMensagensHtml,
} from '../pure.js';
import { $, api, get, getComStatus, baixarArquivo, copyToClipboard, toast, ACTIVE_OPS, showOp, updateOp, closeOp } from './infra.js';

let chatKey = null, chatUrl = null;
// quem subiu mais que isso na conversa está lendo: mensagem nova não o arrasta para o fim
const FOLGA_DE_LEITURA_PX = 80;
const COPIADO_MS = 2000;
const celular = () => window.matchMedia('(max-width: 720px)').matches;

// leitura de mão única pra quem está fora do módulo (o connect() do app.js, que
// compara o evento recebido com a conversa aberta agora)
function chatKeyAtual() { return chatKey; }

function parte(nome) { return $('#chatSession').querySelector(`[data-part="${nome}"]`); }
function aviso(html) { $('#chatNotice').innerHTML = html || ''; }

function openChat(key, url) {
  const safeUrl = canonicalGithubPrUrl(url);
  chatKey = key; chatUrl = safeUrl || null;
  $('#chatKey').textContent = key;
  const link = $('#chatLink');
  if (safeUrl) { link.href = safeUrl; link.hidden = false; }
  else { link.removeAttribute('href'); link.hidden = true; }
  fecharGaveta(); fecharMenu(); aviso('');
  $('#chatPanel').hidden = false;
  $('#chatMsgs').innerHTML = chatCarregandoHtml();
  renderSessao(null);
  aplicarPlaceholder();
  get('/api/chat?key=' + encodeURIComponent(key)).then(c => { if (c && chatKey === key) renderChat(c); });
  $('#chatInput').focus();
}
function closeChat() {
  // fechar no meio da resposta: encerra a op ANTES de soltar a chave, senao a
  // entrada chat-<key> fica pra sempre no ACTIVE_OPS (B16)
  if (chatKey) closeOp(`chat-${chatKey}`, 'cancelled', '');
  chatKey = null;
  fecharMenu();
  $('#chatPanel').hidden = true;
}

/* ---------- faixa da sessão (quadros D03 a D05) ---------- */
function renderSessao(c) {
  const estado = chatEstadoDaSessao(c);
  const temConversa = estado === 'com-sessao' || estado === 'sem-sessao';
  parte('skel').hidden = estado !== 'carregando';
  parte('id').hidden = estado !== 'com-sessao';
  parte('export').hidden = !temConversa;
  $('#btnChatExport').hidden = !temConversa;
  $('#btnChatTools').hidden = !temConversa;
  if (!temConversa) fecharGaveta();
  const vazio = parte('none');
  vazio.hidden = estado !== 'vazio' && estado !== 'sem-sessao';
  vazio.textContent = estado === 'vazio' ? CHAT_TEXTOS.semConversa : CHAT_TEXTOS.semSessao;
  const id = $('#chatSessionId');
  if (estado === 'com-sessao' && id.textContent !== c.sessionId) { id.textContent = c.sessionId; id.classList.remove('is-selected'); }
  if (!c) return;
  const total = Number(c.total) || (c.messages || []).length;
  for (const el of $('#chatSession').querySelectorAll('[data-bind="count"]')) el.textContent = chatContagem(total);
  const gerando = parte('streaming-warn');
  gerando.hidden = c.status !== 'running';
  gerando.textContent = CHAT_TEXTOS.gerando;
}

function renderChat(c) {
  const box = $('#chatMsgs');
  const perto = box.scrollHeight - box.scrollTop - box.clientHeight <= FOLGA_DE_LEITURA_PX;
  box.innerHTML = chatMensagensHtml(c);
  renderSessao(c);
  const running = c.status === 'running';
  $('#btnChatSend').disabled = running;
  $('#btnChatStop').hidden = !running;
  const act = $('#chatActivity');
  act.hidden = !running;
  const chatOpId = `chat-${chatKey}`;
  if (running) {
    if (!ACTIVE_OPS.has(chatOpId)) {
      showOp(chatOpId, {
        type: 'chat',
        title: 'Claude respondendo',
        inline: true,
        container: act
      });
      // fase generica so no primeiro paint; depois quem escreve step E
      // progresso e o handler de chat-activity (regua unica sessionProgress)
      updateOp(chatOpId, { step: c.sessionId ? 'Lendo PR…' : CHAT_TEXTOS.iniciando, progress: 5 });
    }
  } else {
    closeOp(chatOpId, 'done', 'Resposta recebida');
  }
  if (perto) box.scrollTop = box.scrollHeight;
}

/* ---------- copiar id (quadros D07 e D08) ---------- */
function selecionarId() {
  const id = $('#chatSessionId');
  const faixa = document.createRange();
  faixa.selectNodeContents(id);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(faixa);
  id.classList.add('is-selected');
}
async function copiarId() {
  const botao = $('#btnChatCopyId');
  const id = $('#chatSessionId').textContent;
  if (!id) return;
  aviso('');
  if (await copyToClipboard(id)) {
    botao.textContent = CHAT_TEXTOS.copiado; botao.classList.add('is-done');
    setTimeout(() => { botao.textContent = CHAT_TEXTOS.copiarId; botao.classList.remove('is-done'); }, COPIADO_MS);
    return;
  }
  selecionarId();
  aviso(`<div class="chat-note plain">${celular() ? CHAT_TEXTOS.falhaCopiarMob : CHAT_TEXTOS.falhaCopiarDesk}</div>`);
}

/* ---------- exportar (quadros D09 e D10) ---------- */
const ARQUIVOS = {
  md: { ext: 'md', campo: 'markdown', tipo: 'text/markdown;charset=utf-8' },
  json: { ext: 'json', campo: 'jsonTexto', tipo: 'application/json' },
};
async function exportar(tipo) {
  const key = chatKey;
  if (!key) return;
  const { status, corpo } = await getComStatus('/api/chat/export?key=' + encodeURIComponent(key));
  if (chatKey !== key) return;
  fecharMenu();
  if (status !== 200 || !corpo) { aviso(chatAvisoFalhaExport({ status })); return; }
  if (!corpo.ok) { aviso(chatAvisoFalhaExport({ erro: corpo.error })); return; }
  const n = (corpo.json && corpo.json.mensagens || []).length;
  if (tipo === 'copia') {
    aviso(await copyToClipboard(corpo.markdown) ? chatAvisoExportado('copia', corpo.nome, n) : `<div class="chat-note plain">${CHAT_TEXTOS.falhaCopiarMd}</div>`);
    return;
  }
  const arquivo = ARQUIVOS[tipo === 'json' ? 'json' : 'md'];
  const baixou = baixarArquivo(`${corpo.nome}.${arquivo.ext}`, corpo[arquivo.campo], arquivo.tipo);
  aviso(baixou ? chatAvisoExportado(tipo, corpo.nome, n) : `<div class="chat-note plain">${CHAT_TEXTOS.falhaBaixar}</div>`);
}

/* ---------- menu Exportar (computador) e gaveta (celular) ---------- */
const itensDoMenu = () => [...$('#chatExportMenu').querySelectorAll('.chat-exp-item')];
function abrirMenu() {
  const menu = $('#chatExportMenu');
  menu.classList.add('open');
  $('#btnChatExport').setAttribute('aria-expanded', 'true');
  itensDoMenu()[0].focus();
  // o nome do arquivo aparece no menu antes do clique: vem da mesma rota, e uma falha aqui
  // só deixa a linha em branco (o clique é quem diz a falha)
  const key = chatKey;
  getComStatus('/api/chat/export?key=' + encodeURIComponent(key)).then(({ corpo }) => {
    const alvo = menu.querySelector('[data-bind="filename"]');
    if (chatKey === key && alvo) alvo.textContent = corpo && corpo.ok ? `${corpo.nome}.md` : '';
  });
}
function fecharMenu(devolverFoco = false) {
  const menu = $('#chatExportMenu');
  if (!menu.classList.contains('open')) return;
  menu.classList.remove('open');
  $('#btnChatExport').setAttribute('aria-expanded', 'false');
  if (devolverFoco) $('#btnChatExport').focus();
}
function alternarGaveta() {
  const painel = $('#chatPanel');
  const aberta = painel.classList.toggle('tools-open');
  $('#btnChatTools').setAttribute('aria-expanded', String(aberta));
  $('#chatExportMenu').setAttribute('role', aberta ? 'group' : 'menu');
}
function fecharGaveta() {
  $('#chatPanel').classList.remove('tools-open');
  $('#btnChatTools').setAttribute('aria-expanded', 'false');
  $('#chatExportMenu').setAttribute('role', 'menu');
}

function aplicarPlaceholder() {
  const campo = $('#chatInput');
  if (!campo.dataset.placeholderDesk) campo.dataset.placeholderDesk = campo.placeholder;
  campo.placeholder = celular() ? campo.dataset.placeholderMob : campo.dataset.placeholderDesk;
}

$('#btnChatClose').onclick = closeChat;
$('#btnChatStop').onclick = () => api('/api/chat/stop', { key: chatKey });
$('#btnChatCopyId').onclick = copiarId;
$('#btnChatTools').onclick = alternarGaveta;
$('#btnChatExport').onclick = () => ($('#chatExportMenu').classList.contains('open') ? fecharMenu(true) : abrirMenu());
$('#btnExportMd').onclick = () => exportar('md');
$('#btnExportJson').onclick = () => exportar('json');
$('#btnExportCopy').onclick = () => exportar('copia');
$('#chatNotice').addEventListener('click', (e) => { if (e.target.closest('[data-chat-retry-export]')) exportar('md'); });
$('#chatExportMenu').addEventListener('keydown', (e) => {
  if (celular()) return;
  const itens = itensDoMenu();
  const i = itens.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); fecharMenu(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); itens[(i + 1) % itens.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); itens[(i - 1 + itens.length) % itens.length].focus(); }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#chatExportMenu') && !e.target.closest('#btnChatExport')) fecharMenu();
});
window.matchMedia('(max-width: 720px)').addEventListener('change', () => { fecharMenu(); aplicarPlaceholder(); });
// teclado do celular: navegador que ignora interactive-widget=resizes-content encolhe só o
// visualViewport, e a folha acompanha por --vvh (quadro M14)
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', () => {
    $('#chatPanel').style.setProperty('--vvh', `${window.visualViewport.height}px`);
  });
}
$('#chatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#chatInput').value.trim();
  if (!text || !chatKey) return;
  $('#chatInput').value = '';
  const r = await api('/api/chat/send', { key: chatKey, url: chatUrl, text });
  if (!r?.ok) toast('error', r?.error || 'não consegui enviar a mensagem');
});
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chatForm').requestSubmit(); }
});

/* ---------- chat com o Claude: gatilhos que abrem a conversa ----------
   Registrada pelo bootstrap (ui/app.js) no mesmo ponto relativo em que estes dois
   listeners moravam, pra não mudar a ordem dos handlers de click do document. */
function initChatTriggers() {
  /* qualquer botão .act-chat da página abre a conversa do PR */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.act-chat');
    if (btn) openChat(btn.dataset.key, btn.dataset.url || null);
  });
  /* consultar um PR por URL: abre a conversa salva mesmo que ele não esteja na lista
     (some do "Revisões recentes" por escopo ou pelo limite de 30). Reusa o chat. */
  $('#lookupForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const url = canonicalGithubPrUrl($('#lookupUrl').value);
    const key = prKeyFromUrl(url);
    if (!key) { toast('error', 'Cole a URL de um PR do GitHub (…/pull/NN).'); return; }
    openChat(key, url);
    $('#lookupUrl').value = '';
  });
}

/* ---------- evento 'chat-activity' do SSE ----------
   Chamado pelo connect() do ui/app.js: só o chat sabe se o evento é da conversa
   ABERTA agora (chatKeyAtual). O texto vivo vira o step da MESMA pill que
   renderChat cria; escrever textContent no container destruía a pill e
   orfanava a op (B16). Se a atividade chegar antes do primeiro snapshot de
   chat, cria a op aqui. O chat não acumula feed em estado().activity; a
   contagem de eventos vive na própria op, e o percentual sai da MESMA régua
   (sessionProgress) dos outros fluxos. */
function handleChatActivity(key, text) {
  const chatKey = chatKeyAtual();
  if (chatKey && key === chatKey) {
    const el = $('#chatActivity');
    el.hidden = false;
    const opId = `chat-${key}`;
    if (!ACTIVE_OPS.has(opId)) showOp(opId, { type: 'chat', title: 'Claude respondendo', inline: true, container: el });
    const op = ACTIVE_OPS.get(opId);
    const n = (op.chatEvents = (op.chatEvents || 0) + 1);
    updateOp(opId, { step: text, progress: Math.max(op.progress || 0, sessionProgress(n)) });
  }
}

export { openChat, closeChat, renderChat, chatKeyAtual, initChatTriggers, handleChatActivity };
