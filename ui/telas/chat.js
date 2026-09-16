/* Farol · UI: chat com o Claude por PR (--resume da sessão, ver lib/engine/chat.js).
   Não é aba (não passa por registrarTela): abre por cima de qualquer uma, pelo
   botão .act-chat ou pela busca de URL. O handler `chat`/`chat-activity` do SSE
   continua no connect() do app.js, que chama renderChat e lê a chave atual por
   chatKeyAtual() (o mesmo padrão de escopo()/definirEscopo()). */

import { canonicalGithubPrUrl, esc, md, prKeyFromUrl } from '../pure.js';
import { $, api, get, toast, ACTIVE_OPS, showOp, updateOp, closeOp } from './infra.js';

let chatKey = null, chatUrl = null;

// leitura de mão única pra quem está fora do módulo (o connect() do app.js, que
// compara o evento recebido com a conversa aberta agora)
function chatKeyAtual() { return chatKey; }

function openChat(key, url) {
  const safeUrl = canonicalGithubPrUrl(url);
  chatKey = key; chatUrl = safeUrl || null;
  $('#chatKey').textContent = key;
  const link = $('#chatLink');
  if (safeUrl) { link.href = safeUrl; link.hidden = false; }
  else { link.removeAttribute('href'); link.hidden = true; }
  $('#chatPanel').hidden = false;
  $('#chatMsgs').innerHTML = '<div class="chat-hint">carregando…</div>';
  get('/api/chat?key=' + encodeURIComponent(key)).then(c => { if (c && chatKey === key) renderChat(c); });
  $('#chatInput').focus();
}
function closeChat() {
  // fechar no meio da resposta: encerra a op ANTES de soltar a chave, senao a
  // entrada chat-<key> fica pra sempre no ACTIVE_OPS (B16)
  if (chatKey) closeOp(`chat-${chatKey}`, 'cancelled', '');
  chatKey = null;
  $('#chatPanel').hidden = true;
}
function renderChat(c) {
  const box = $('#chatMsgs');
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  if (!(c.messages || []).length) {
    box.innerHTML = `<div class="chat-hint">Converse com o Claude sobre <b>${esc(c.key)}</b>. Quando o PR já passou pela revisão automática, ele chega sabendo o diff, o card e o relatório; e pode examinar o PR com <code>gh</code>. Pra responder no PR, é só pedir: "posta esse comentário".</div>`;
  } else {
    const msgs = c.messages.map(m => {
      if (m.role === 'user') return `<div class="msg user">${esc(m.text)}</div>`;
      if (m.role === 'system') return `<div class="msg sys">${esc(m.text)}</div>`;
      return `<div class="msg bot report">${md(m.text)}</div>`;
    }).join('');
    // Add streaming indicator when response is generating
    const streaming = c.status === 'running' && c.messages.length > 0 && c.messages[c.messages.length - 1].role !== 'user'
      ? `<div class="msg bot streaming"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`
      : '';
    box.innerHTML = msgs + streaming;
  }
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
      updateOp(chatOpId, { step: 'Lendo PR…', progress: 5 });
    }
  } else {
    closeOp(chatOpId, 'done', 'Resposta recebida');
  }
  if (stick || running) box.scrollTop = box.scrollHeight;
}
$('#btnChatClose').onclick = closeChat;
$('#btnChatStop').onclick = () => api('/api/chat/stop', { key: chatKey });
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

export { openChat, closeChat, renderChat, chatKeyAtual, initChatTriggers };
