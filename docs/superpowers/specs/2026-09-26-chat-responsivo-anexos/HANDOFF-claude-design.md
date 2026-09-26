# Handoff: chat do PR (Farol)

Referência visual: `Chat do PR.dc.html` (quadros D01 a D13 no computador, M01 a M14 no celular). Este arquivo traduz aqueles quadros para HTML e CSS puros, sem framework. Nada aqui muda o desenho. Onde houver diferença entre este texto e os quadros, valem os quadros.

Ids que o app já usa e continuam: `chatPanel`, `chatKey`, `chatLink`, `btnChatClose`, `chatMsgs`, `chatActivity`, `chatForm`, `chatInput`, `btnChatSend`, `btnChatStop`.

Ids novos: `btnChatTools`, `chatSession`, `chatSessionLabel`, `chatSessionId`, `btnChatCopyId`, `btnChatExport`, `chatExportMenu`, `btnExportMd`, `btnExportJson`, `btnExportCopy`, `chatNotice`, `chatWindowNote`.

---

## 1. Marcação

Uma marcação só para os dois tamanhos. O CSS decide: acima de 720 px, `#chatSession` é uma faixa fixa sob o cabeçalho e o Exportar abre um menu. Até 720 px, `#chatSession` vira uma gaveta que só aparece com `.tools-open` no painel, e as três opções de exportar ficam lado a lado dentro dela.

```html
<aside id="chatPanel" class="chat-panel" role="dialog" aria-modal="false" aria-labelledby="chatKey">

  <header class="chat-head">
    <div class="chat-title">
      <b id="chatKey">acme-exemplo/app#42</b>
      <a id="chatLink" href="https://github.com/acme-exemplo/app/pull/42" target="_blank" rel="noopener">
        <span class="only-desk">abrir PR ↗</span><span class="only-mob">abrir PR no GitHub ↗</span>
      </a>
    </div>
    <!-- só no celular; escondido nos estados carregando e vazio -->
    <button id="btnChatTools" class="btn chat-tools-btn" type="button"
            aria-expanded="false" aria-controls="chatSession">
      Id e exportar <span class="chev" aria-hidden="true"></span>
    </button>
    <button id="btnChatClose" class="btn icon chat-close" type="button" aria-label="Fechar">✕</button>
  </header>

  <section id="chatSession" class="chat-session" aria-label="Sessão e exportação">
    <div class="chat-sess-block">
      <div class="chat-sess-top">
        <div id="chatSessionLabel" class="chat-sess-label">
          <b>Sessão do Claude</b> · o id que o <code>claude --resume</code> usa
        </div>
        <!-- só no computador -->
        <button id="btnChatExport" class="btn chat-export-btn" type="button"
                aria-haspopup="menu" aria-expanded="false" aria-controls="chatExportMenu">
          Exportar <span class="chev" aria-hidden="true"></span>
        </button>
      </div>

      <!-- estado com sessão -->
      <div class="chat-sess-row" data-part="id">
        <span id="chatSessionId" class="chat-sess-id">0c5d0945-0d49-4567-895b-4d50408b418d</span>
        <button id="btnChatCopyId" class="btn chat-copy-id" type="button">Copiar id</button>
      </div>
      <!-- estados sem sessão, carregando e vazio: ver seção 3 -->
      <div class="chat-sess-empty" data-part="none" hidden></div>
      <div class="chat-skel chat-skel-id" data-part="skel" hidden></div>
    </div>

    <div class="chat-export-block">
      <div class="chat-sess-label only-mob">
        <b>Exportar a conversa completa</b> · <span data-bind="count">3 mensagens</span> · horários de Brasília
      </div>
      <div id="chatExportMenu" class="chat-export-menu" role="menu" aria-labelledby="btnChatExport">
        <div class="chat-note warn" data-part="streaming-warn" hidden></div>
        <button id="btnExportMd" class="chat-exp-item" role="menuitem" type="button">
          <span class="t"><span class="only-desk">Baixar Markdown (.md)</span><span class="only-mob">Baixar .md</span></span>
          <span class="d mono only-desk" data-bind="filename">farol-chat-acme-exemplo-app-42-2026-09-26-1306.md</span>
        </button>
        <button id="btnExportJson" class="chat-exp-item" role="menuitem" type="button">
          <span class="t"><span class="only-desk">Baixar JSON (.json)</span><span class="only-mob">Baixar .json</span></span>
          <span class="d only-desk">Mesmo conteúdo, com horários também em ISO</span>
        </button>
        <button id="btnExportCopy" class="chat-exp-item primary-mob" role="menuitem" type="button">
          <span class="t"><span class="only-desk">Copiar Markdown</span><span class="only-mob">Copiar .md</span></span>
          <span class="d only-desk">Para colar onde não dá para baixar arquivo</span>
        </button>
        <div class="chat-exp-foot only-desk">
          <span data-bind="count">3 mensagens</span> · horários de Brasília (-03:00) · segredos saem mascarados
        </div>
      </div>
      <div class="chat-exp-hint only-mob">Copiar .md é o caminho quando o navegador do celular não baixa arquivo. Segredos saem mascarados.</div>
    </div>

    <!-- confirmações e falhas de copiar id e exportar -->
    <div id="chatNotice" class="chat-notice" role="status" aria-live="polite"></div>
  </section>

  <div id="chatMsgs" class="chat-msgs" aria-live="polite">
    <div id="chatWindowNote" class="chat-window-note" hidden></div>

    <div class="msg-wrap user">
      <div class="msg-meta">Você · <time datetime="2026-09-26T13:06:12-03:00" title="26/09/2026 13:06:12 (Brasília)">13:06</time></div>
      <div class="msg user">refaça o review com opus, tem alguma diferença de resultado com relação ao modo auto?</div>
    </div>

    <div class="msg-wrap bot">
      <div class="msg-meta">Claude · <time datetime="2026-09-26T13:07:40-03:00" title="26/09/2026 13:07:40 (Brasília)">13:07</time></div>
      <div class="msg bot"><!-- Markdown renderizado; tabela sempre dentro de <div class="tbl"> --></div>
    </div>

    <div class="msg sys">Farol · <time datetime="2026-09-26T13:09:02-03:00">13:09</time> · geração interrompida por você</div>
  </div>

  <div id="chatActivity" class="chat-activity" hidden></div>

  <form id="chatForm" class="chat-form">
    <textarea id="chatInput" rows="2"
      placeholder="Pergunte ou peça algo sobre este PR... (Enter envia · Shift+Enter quebra linha)"
      data-placeholder-mob="Pergunte sobre este PR"></textarea>
    <div class="chat-form-actions">
      <button id="btnChatStop" class="btn" type="button" hidden>Parar</button>
      <button id="btnChatSend" class="btn primary" type="submit">Enviar</button>
    </div>
  </form>
</aside>
```

Regras de comportamento:

- **Tabela no Markdown:** o renderizador envolve cada `<table>` em `<div class="tbl">`. É esse invólucro que rola para o lado. Se não der para mexer no renderizador, a regra de reserva no CSS (`.msg.bot > table`) resolve, mas a tabela deixa de ocupar a largura toda.
- **Menu Exportar (computador):** Enter ou Espaço em `#btnChatExport` abre o menu e foca `#btnExportMd`. Setas sobem e descem, Esc fecha e devolve o foco ao botão, e clicar fora também fecha. `aria-expanded` acompanha o estado.
- **Gaveta (celular):** `#btnChatTools` alterna `.tools-open` em `#chatPanel` e o `aria-expanded`. Enquanto a gaveta estiver aberta, `#btnChatExport` fica escondido e o menu aparece inline, sem `role="menu"` (troque para `role="group"` abaixo de 720 px).
- **Rolagem da lista:** ao abrir o painel e quando chega mensagem nova, role `#chatMsgs` até o fim, a menos que a pessoa tenha subido mais de 80 px (aí deixe onde está).
- **Teclado do celular:** acrescente `interactive-widget=resizes-content` à meta viewport. Para navegadores que ignoram isso, atualize `--vvh` com `visualViewport.height` no evento `resize` de `visualViewport`. A folha encolhe; o campo e o Enviar continuam visíveis (M14).

---

## 2. CSS

Substitui o bloco `/* ---------- chat ---------- */` (linhas 967 a 998) e o bloco `.msg.streaming` / `.typing-dot` (linhas 1475 a 1490) de `farol-app.css`. Usa só os tokens que já existem, então o tema claro vem de graça.

```css
/* ---------- chat ---------- */
.chat-panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 92vw); background: var(--surface); color: var(--text); border-left: 1px solid var(--border); box-shadow: var(--shadow); z-index: 40; display: flex; flex-direction: column; min-height: 0; font-size: 14px; line-height: 1.5; color-scheme: dark; animation: chat-in .2s ease; }
body.electron .chat-panel { top: 0; }
body.electron .chat-head { padding-right: 150px; }
@keyframes chat-in { from { transform: translateX(30px); opacity: 0; } to { transform: none; opacity: 1; } }
@keyframes sheet-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }

.only-mob { display: none; }

/* cabeçalho */
.chat-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; min-height: 52px; box-sizing: border-box; border-bottom: 1px solid var(--border); flex-shrink: 0; }
.chat-title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.chat-title b { font-size: 13.5px; color: var(--accent); white-space: nowrap; flex-shrink: 0; }
.chat-title a { font-size: 13px; color: var(--info); white-space: nowrap; }
.chat-close { width: 32px; height: 32px; justify-content: center; padding: 0; flex-shrink: 0; }
.chat-tools-btn { display: none; }
.chat-panel .chev { color: var(--muted); }
.chat-panel .chev::before { content: "▾"; }
.chat-panel .btn[aria-expanded="true"] { border-color: var(--accent); background: var(--surface-2); }
.chat-panel .btn[aria-expanded="true"] .chev { color: var(--accent); }
.chat-panel .btn[aria-expanded="true"] .chev::before { content: "▴"; }

/* faixa da sessão (computador) */
.chat-session { position: relative; z-index: 3; flex-shrink: 0; display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--surface); }
.chat-sess-block { display: flex; flex-direction: column; gap: 6px; }
.chat-sess-top { display: flex; align-items: center; gap: 10px; }
.chat-sess-label { flex: 1; min-width: 0; font-size: 12px; color: var(--muted); }
.chat-sess-label b { font-weight: 400; color: inherit; }
.chat-sess-label code, .mono, .chat-sess-id { font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; }
.chat-sess-label code { font-size: 11.5px; }
.chat-export-btn { height: 28px; padding: 0 10px; font-size: 12.5px; font-weight: 600; flex-shrink: 0; }
.chat-sess-row { display: flex; align-items: center; gap: 8px; }
.chat-sess-id { min-width: 0; font-size: 12.5px; overflow-wrap: anywhere; user-select: all; border-radius: 4px; }
.chat-sess-id.is-selected { background: color-mix(in srgb, var(--info) 32%, transparent); padding: 1px 4px; }
.chat-copy-id { height: 26px; padding: 0 9px; font-size: 12px; font-weight: 600; border-radius: 8px; white-space: nowrap; flex-shrink: 0; }
.chat-copy-id.is-done { background: var(--ok-soft); border-color: transparent; color: var(--ok); }
.chat-sess-empty { font-size: 13px; color: var(--muted); }
.chat-skel { border-radius: 4px; background: var(--surface-2); }
.chat-skel-id { height: 14px; width: 270px; max-width: 100%; }

/* menu Exportar (computador) */
.chat-export-menu { position: absolute; top: 36px; right: 14px; width: 330px; display: none; flex-direction: column; gap: 2px; padding: 6px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); }
.chat-export-menu.open { display: flex; }
.chat-exp-item { display: flex; flex-direction: column; gap: 2px; text-align: left; border: 0; border-radius: 8px; padding: 8px 10px; background: transparent; color: var(--text); cursor: pointer; }
.chat-exp-item:hover, .chat-exp-item:focus-visible { background: var(--surface); }
.chat-exp-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.chat-exp-item .t { font-size: 13px; font-weight: 600; }
.chat-exp-item .d { font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
.chat-exp-item .d.mono { font-size: 11.5px; }
.chat-exp-foot { font-size: 11.5px; color: var(--muted); padding: 6px 10px 4px; margin-top: 4px; border-top: 1px solid var(--border-soft); }
.chat-exp-hint { font-size: 12px; color: var(--muted); }

/* avisos curtos */
.chat-notice:empty { display: none; }
.chat-note, .chat-notice > * { font-size: 12.5px; color: var(--text); border-radius: 9px; padding: 7px 10px; }
.chat-note.warn { background: var(--accent-soft); margin-bottom: 4px; }
.chat-note.ok { background: var(--ok-soft); }
.chat-note.ok b { color: var(--ok); }
.chat-note.fail { background: var(--danger-soft); display: flex; align-items: center; gap: 10px; }
.chat-note.fail b { color: var(--danger); }
.chat-note.fail > span { flex: 1; min-width: 0; }
.chat-note.fail .btn { height: 28px; padding: 0 10px; font-size: 12.5px; font-weight: 600; flex-shrink: 0; }
.chat-note.plain { background: var(--surface-2); border: 1px solid var(--border); }

/* lista de mensagens: UMA rolagem só */
.chat-msgs { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 14px; display: flex; flex-direction: column; gap: 16px; }
/* nada dentro da lista encolhe nem rola por conta própria: é esta regra que corrige o defeito */
.chat-msgs > * { flex-shrink: 0; min-width: 0; }
.chat-msgs .msg, .chat-msgs .report { max-height: none; overflow: visible; }

.chat-window-note { font-size: 13px; color: var(--text); background: var(--info-soft); border-radius: 10px; padding: 9px 12px; }
.chat-window-note b { color: var(--info); font-weight: 600; }
.chat-window-note.plain { background: var(--surface-2); border: 1px solid var(--border); }
.chat-hint { color: var(--muted); font-size: 14px; border: 1px dashed var(--border); border-radius: 10px; padding: 14px; }
.chat-hint b { color: var(--text); }
.chat-loading { font-size: 13px; color: var(--muted); }
.chat-skel-msg { height: 44px; border-radius: 12px; }
.chat-skel-msg.user { align-self: flex-end; width: 62%; background: color-mix(in srgb, var(--accent) 8%, transparent); }
.chat-skel-msg.bot { height: 180px; }

.msg-wrap { display: flex; flex-direction: column; gap: 4px; }
.msg-wrap.user { align-self: flex-end; align-items: flex-end; max-width: 85%; }
.msg-wrap.bot { align-self: stretch; }
.msg-meta { font-size: 11.5px; color: var(--muted); }
.msg { border-radius: 12px; padding: 9px 12px; min-width: 0; overflow-wrap: anywhere; }
.msg.user { white-space: pre-wrap; font-size: 14.5px; background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent); }
.msg.bot { font-size: 15px; line-height: 1.6; padding: 12px 14px; background: var(--surface-2); border: 1px solid var(--border); overflow-wrap: break-word; }
.msg.bot > :first-child { margin-top: 0; }
.msg.bot > :last-child { margin-bottom: 0; }
.msg.bot p { margin: 10px 0; text-wrap: pretty; }
.msg.bot h1, .msg.bot h2, .msg.bot h3, .msg.bot h4 { margin: 14px 0 6px; font-size: 15px; font-weight: 700; }
.msg.bot ol, .msg.bot ul { margin: 10px 0; padding-left: 22px; }
.msg.bot li { margin: 8px 0; }
.msg.bot li > ul, .msg.bot li > ol { margin: 6px 0 0; padding-left: 20px; }
.msg.bot li li { margin: 6px 0; }
.msg.bot a { color: var(--info); }
.msg.bot code { font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; font-size: .88em; background: var(--surface); padding: 1px 5px; border-radius: 5px; }
/* a única rolagem horizontal permitida: dentro do bloco de código e da tabela */
.msg.bot pre { margin: 10px 0; max-width: 100%; overflow-x: auto; overflow-y: visible; white-space: pre; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; line-height: 1.55; }
.msg.bot pre code { background: none; padding: 0; font-size: inherit; overflow-wrap: normal; }
.msg.bot .tbl { margin: 10px 0; max-width: 100%; overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
.msg.bot .tbl table { border-collapse: collapse; width: 100%; font-size: 13.5px; line-height: 1.45; }
.msg.bot > table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 13.5px; } /* reserva, sem invólucro */
.msg.bot th { text-align: left; padding: 7px 10px; background: var(--surface); color: var(--muted); font-weight: 600; }
.msg.bot td { padding: 7px 10px; border-top: 1px solid var(--border); overflow-wrap: normal; }

.msg.sys { align-self: center; padding: 0; color: var(--muted); font-size: 12.5px; }
.msg.sys.fail { align-self: stretch; padding: 10px 12px; font-size: 14px; color: var(--text); background: var(--danger-soft); border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent); border-radius: 10px; }
.msg.sys.fail b { color: var(--danger); }

/* digitação */
.msg.streaming { align-self: flex-start; display: inline-flex; align-items: center; gap: 5px; height: 12px; padding: 12px 14px; box-sizing: content-box; background: var(--surface-2); border: 1px solid var(--border); }
.msg.bot .typing { display: inline-flex; gap: 5px; align-items: center; height: 12px; }
.typing-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--muted); animation: chatTyping 1.2s infinite ease-in-out; }
.typing-dot:nth-child(2) { animation-delay: .15s; }
.typing-dot:nth-child(3) { animation-delay: .3s; }
@keyframes chatTyping { 0%, 80%, 100% { opacity: .25; transform: translateY(0); } 40% { opacity: 1; transform: translateY(-2px); } }
@media (prefers-reduced-motion: reduce) { .typing-dot { animation: none; opacity: .6; } }

/* atividade e campo */
.chat-activity { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 6px 14px; color: var(--info); font-size: 12px; font-family: "Cascadia Code", Consolas, "SF Mono", Menlo, monospace; border-top: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat-activity::before { content: ""; width: 6px; height: 6px; border-radius: 3px; background: var(--info); flex-shrink: 0; }
.chat-form { flex-shrink: 0; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border-top: 1px solid var(--border); }
.chat-form textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 60px; max-height: 180px; background: var(--surface-2); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 9px 12px; font: inherit; font-size: 14px; }
.chat-form textarea:focus { outline: none; border-color: var(--accent); }
.chat-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
.chat-form-actions .btn { height: 34px; padding: 0 14px; font-size: 13px; font-weight: 600; }

/* ---------- folha do celular ---------- */
@media (max-width: 720px) {
  .only-desk { display: none; }
  .only-mob { display: inline; }
  div.only-mob { display: block; }

  .chat-panel { inset: auto 0 0 0; width: auto; height: min(86dvh, calc(var(--vvh, 100dvh) - 8px)); border-left: 0; border-top: 1px solid var(--border); border-radius: 16px 16px 0 0; animation: sheet-in .2s ease; }
  .chat-panel::before { content: ""; position: absolute; top: 9px; left: 50%; margin-left: -20px; width: 40px; height: 4px; border-radius: 2px; background: var(--faint); }
  body.electron .chat-head, .chat-head { padding: 22px 6px 6px 14px; gap: 6px; }

  .chat-title { flex-direction: column; align-items: stretch; gap: 0; min-height: 44px; justify-content: center; }
  .chat-title b { font-size: 15px; overflow: hidden; text-overflow: ellipsis; }
  .chat-title a { font-size: 12.5px; }
  .chat-tools-btn { display: inline-flex; height: 44px; padding: 0 12px; font-size: 13.5px; font-weight: 600; }
  .chat-close { width: 44px; height: 44px; border-color: transparent; background: transparent; font-size: 18px; }

  /* gaveta: não ocupa altura enquanto fechada */
  .chat-session { display: none; gap: 14px; padding: 14px; background: var(--surface-2); }
  .chat-panel.tools-open .chat-session { display: flex; }
  .chat-export-btn { display: none; }
  .chat-sess-label { font-size: 12.5px; }
  .chat-sess-label b { color: var(--text); font-weight: 600; }
  .chat-sess-label code { font-size: 12px; }
  .chat-sess-id { flex: 1; font-size: 13.5px; }
  .chat-sess-id.is-selected { padding: 2px 4px; }
  .chat-copy-id { height: 44px; padding: 0 14px; font-size: 13.5px; border-radius: 9px; background: var(--surface); }
  .chat-sess-empty { font-size: 13.5px; }

  .chat-export-block { display: flex; flex-direction: column; gap: 6px; }
  .chat-export-menu { position: static; width: auto; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 0; background: none; border: 0; box-shadow: none; }
  .chat-export-menu .chat-note.warn { grid-column: 1 / -1; margin: 0; }
  .chat-exp-item { height: 44px; align-items: center; justify-content: center; padding: 0; border: 1px solid var(--border); border-radius: 9px; background: var(--surface); }
  .chat-exp-item .t { font-size: 13.5px; }
  .chat-exp-item.primary-mob { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .chat-note, .chat-notice > * { font-size: 13px; padding: 8px 11px; }
  .chat-note.fail { flex-wrap: wrap; }
  .chat-note.fail .btn { height: 44px; }
  .chat-note.plain { background: var(--surface); }

  .chat-form { flex-direction: row; align-items: flex-end; padding: 10px 12px 12px; }
  .chat-form textarea { flex: 1; min-width: 0; min-height: 44px; height: 44px; max-height: 120px; resize: none; font-size: 15px; line-height: 1.4; padding: 10px 12px; }
  .chat-form-actions { flex-shrink: 0; }
  .chat-form-actions .btn { height: 44px; font-size: 14px; }
}
```

---

## 3. Textos de cada estado

Os textos abaixo vão exatamente assim. `N`, `T` e `<nome>` vêm da API (`nome` é o campo da resposta de `/api/chat/export`).

**Rótulo da sessão (sempre que a faixa aparece)**
Computador: `Sessão do Claude · o id que o claude --resume usa` (`claude --resume` em fonte mono).
Celular, dentro da gaveta: o mesmo, com "Sessão do Claude" em negrito. Depois vem `Exportar a conversa completa · N mensagens · horários de Brasília`.

**Carregando** (D03, M03)
- Faixa: rótulo "Sessão do Claude" e uma barra de esqueleto no lugar do id. Sem botão Exportar.
- Lista: `Carregando a conversa deste PR...`, seguido de três blocos de esqueleto (`.chat-skel-msg.user`, `.bot`, `.user`).
- Celular: `#btnChatTools` escondido.
- Nunca mostre o convite de vazio enquanto carrega.

**Vazio** (D04, M04)
- Faixa (computador): `Sem conversa ainda. O id da sessão e a exportação aparecem depois da primeira resposta do Claude.` Sem Copiar id e sem Exportar.
- Lista: o convite que o app já usa, em `.chat-hint` (`Converse com o Claude sobre <b>owner/repo#N</b>...`).
- Celular: `#btnChatTools` escondido.

**Sem sessão ainda** (D05, M05; `sessionId` é `null` e há mensagem sua)
- No lugar do id: `Ainda não existe. O id nasce quando o Claude responder pela primeira vez.` Sem botão Copiar id.
- Exportar continua disponível (`1 mensagem`).
- Atividade: `iniciando a sessão do Claude`. O indicador de digitação aparece com o rótulo `Claude · escrevendo`. Parar fica visível.

**Respondendo** (D06, M06)
- Atividade: o que o engine manda, em uma linha (ex.: `lendo src/chat/useMiaChatReal.ts`).
- Mensagem em geração: rótulo `Claude · escrevendo`. O texto parcial vem seguido dos três pontos. Parar fica visível.
- Topo do menu Exportar (e da gaveta no celular): `A resposta atual ainda está sendo gerada. Se exportar agora, ela sai marcada como "ainda sendo gerada".`

**Id copiado** (D07, M07)
- O próprio botão vira `✓ Copiado` (classe `.is-done`), com o foco mantido nele. Depois de 2 s volta a `Copiar id`.

**Falha ao copiar** (D08, M08; `navigator.clipboard.writeText` rejeitou ou não existe)
- Selecione o texto de `#chatSessionId` com `Range` + `getSelection().addRange` e aplique `.is-selected`.
- Computador: `O navegador não liberou a área de transferência. O id já está selecionado: Ctrl+C copia.`
- Celular: `O navegador não liberou a área de transferência. Toque e segure no id acima para copiar à mão.`
- Em `#chatNotice`, como `.chat-note.plain`.

**Exportado** (D09, M09)
- Baixar .md ou .json: `✓ Baixado <nome>` (`<nome>` em mono; para JSON, troque `.md` por `.json`).
- Copiar .md: `✓ Markdown copiado. Conteúdo de <nome>, N mensagens.`
- Em `#chatNotice`, como `.chat-note.ok`. O menu fecha; a gaveta do celular continua aberta.
- Se a área de transferência recusar o Copiar .md: `O navegador não liberou a área de transferência. Use Baixar .md.` (`.chat-note.plain`).

**Falha ao exportar** (D10, M10)
- A rota falhou (HTTP diferente de 200): `Não deu para exportar. A rota de exportação respondeu 502. Nenhum arquivo foi gerado.` Use o código real no lugar de 502 e mostre o botão `Tentar de novo`.
- `{ ok: false, error }`: `Não deu para exportar.` seguido do `error` do engine (ex.: `Não há conversa deste PR para exportar.`), sem botão de tentar de novo.
- "Não deu para exportar." fica em negrito, em `.chat-note.fail`. Nunca gere um arquivo vazio.

**Mais de 100 mensagens** (D11, M11)
- No topo da lista (`#chatWindowNote`): `Mostrando as últimas 100 de T mensagens. <b>A exportação traz todas.</b>`

**Teto de retenção, 200 guardadas** (D12, M12)
- O mesmo aviso acima, com T = 200, e logo abaixo um segundo bloco (`.chat-window-note.plain`): `O Farol guarda as 200 mensagens mais recentes desta conversa. As anteriores já foram descartadas e não entram no arquivo, que também avisa isso.`

**Falha na conversa** (D13, M13)
- Mensagem do Farol em `.msg.sys.fail`, com o rótulo `Farol · HH:MM` acima: `<b>falha:</b>` seguido do motivo inteiro, sem cortar. Exemplo dos quadros: `falha: o Claude encerrou sem responder (código 1). Motivo informado: limite de uso da conta atingido, libera às 14:00. Sua mensagem continua guardada.`

**Mensagem do Farol comum**
- `Farol · HH:MM · geração interrompida por você` (`.msg.sys`).

**Campo de texto**
- Placeholder no computador: `Pergunte ou peça algo sobre este PR... (Enter envia · Shift+Enter quebra linha)`.
- Placeholder no celular (até 720 px): `Pergunte sobre este PR`, lido de `data-placeholder-mob`.

---

## 4. Horário em cada mensagem

Sempre no horário de Brasília (`America/Sao_Paulo`), qualquer que seja o fuso do aparelho. É o mesmo relógio do arquivo exportado.

- **Rótulo:** `Autor · hora`, em `.msg-meta` acima do balão. O autor é `Você`, `Claude` ou `Farol`. Enquanto o Claude gera, o rótulo é `Claude · escrevendo`, e a hora entra quando a resposta termina.
- **Hora na tela:**
  - mesmo dia em Brasília: `13:06`
  - outro dia do mesmo ano: `25/09 13:06`
  - outro ano: `25/09/2025 13:06`
- **`<time>`:** `datetime` em ISO com o fuso explícito (`2026-09-26T13:06:12-03:00`) e `title` com a data completa (`26/09/2026 13:06:12 (Brasília)`).
- **No arquivo (já sai do engine):** `2026-09-26 13:06:12 -03:00` no Markdown e ISO no JSON.

```js
const TZ = "America/Sao_Paulo";
const hm = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
const dm = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit" });
const dmy = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const full = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, dateStyle: "short", timeStyle: "medium" });
const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });

function horaMsg(iso, agora = new Date()) {
  const d = new Date(iso);
  if (ymd.format(d) === ymd.format(agora)) return hm.format(d);
  if (ymd.format(d).slice(0, 4) === ymd.format(agora).slice(0, 4)) return `${dm.format(d)} ${hm.format(d)}`;
  return `${dmy.format(d)} ${hm.format(d)}`;
}
const tituloMsg = (iso) => `${full.format(new Date(iso)).replace(",", "")} (Brasília)`;
```

