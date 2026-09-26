/* Farol · UI pura: o chat do PR (26/09/2026). O desenho saiu do Claude Design (quadros D01 a
   D13 e M01 a M14, handoff em docs/superpowers/specs/2026-09-26-chat-responsivo-anexos/);
   aqui mora o que dá para testar sem DOM: o horário de Brasília de cada mensagem, a lista de
   mensagens em HTML, o estado da faixa da sessão e os textos exatos de cada estado.

   O horário é SEMPRE o de Brasília, qualquer que seja o fuso do aparelho: é o mesmo relógio
   do arquivo exportado (lib/engine/chat-export.js) e do farol.log. */
import { esc, md } from './comum.js';

const FUSO = 'America/Sao_Paulo';
// A tela recebe as últimas 100 (lib/engine/chat.js, chatPublic) e o engine guarda até 200.
const JANELA_DA_TELA = 100;
const TETO_GUARDADO = 200;

const fmtHm = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false });
const fmtDm = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit' });
const fmtDmy = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric' });
const fmtHms = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const fmtYmd = new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtOffset = new Intl.DateTimeFormat('en-US', { timeZone: FUSO, timeZoneName: 'longOffset' });

// "13:06" no mesmo dia de Brasília, "25/09 13:06" em outro dia do ano, "25/09/2025 13:06"
// em outro ano. Instante inválido devolve '' (a tela mostra só o autor).
export function chatHora(ms, agora = Date.now()) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  const dia = fmtYmd.format(d), hoje = fmtYmd.format(new Date(agora));
  if (dia === hoje) return fmtHm.format(d);
  if (dia.slice(0, 4) === hoje.slice(0, 4)) return `${fmtDm.format(d)} ${fmtHm.format(d)}`;
  return `${fmtDmy.format(d)} ${fmtHm.format(d)}`;
}

// title do <time>: "26/09/2026 13:06:12 (Brasília)"
export function chatHoraCompleta(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return `${fmtDmy.format(d)} ${fmtHms.format(d)} (Brasília)`;
}

// datetime do <time>, com o fuso explícito: "2026-09-26T13:06:12-03:00". O offset sai do
// IANA, nunca de literal, para acompanhar se o horário de verão voltar.
export function chatHoraIso(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  const parte = fmtOffset.formatToParts(d).find((p) => p.type === 'timeZoneName');
  const off = String((parte && parte.value) || 'GMT').replace('GMT', '').replace('−', '-') || '+00:00';
  return `${fmtYmd.format(d)}T${fmtHms.format(d)}${off}`;
}

export function chatContagem(n) {
  const v = Number(n) || 0;
  return `${v} ${v === 1 ? 'mensagem' : 'mensagens'}`;
}

// Tabela do Markdown dentro de <div class="tbl">: é o invólucro que rola para o lado, e só
// ele (o balão nunca rola). Fica aqui, e não no md(), porque o relatório e os outros lugares
// que usam md() têm o próprio estilo de tabela.
export function chatEnvolverTabelas(html) {
  return String(html || '').replace(/<table>/g, '<div class="tbl"><table>').replace(/<\/table>/g, '</table></div>');
}

function tempo(ms, agora) {
  const hora = chatHora(ms, agora);
  if (!hora) return '';
  return ` · <time datetime="${esc(chatHoraIso(ms))}" title="${esc(chatHoraCompleta(ms))}">${esc(hora)}</time>`;
}

const PONTOS = '<span class="typing" aria-label="escrevendo"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';

function mensagemHtml(m, agora) {
  if (m.role === 'user') {
    return `<div class="msg-wrap user"><div class="msg-meta">Você${tempo(m.at, agora)}</div><div class="msg user">${esc(m.text)}</div></div>`;
  }
  if (m.role === 'system') {
    const texto = String(m.text || '');
    if (/^falha:/i.test(texto)) {
      return `<div class="msg-wrap bot"><div class="msg-meta">Farol${tempo(m.at, agora)}</div><div class="msg sys fail"><b>falha:</b> ${esc(texto.replace(/^falha:\s*/i, ''))}</div></div>`;
    }
    return `<div class="msg sys">Farol${tempo(m.at, agora)} · ${esc(texto)}</div>`;
  }
  const meta = m.partial ? 'Claude · escrevendo' : `Claude${tempo(m.at, agora)}`;
  const corpo = chatEnvolverTabelas(md(m.text)) + (m.partial ? PONTOS : '');
  return `<div class="msg-wrap bot"><div class="msg-meta">${meta}</div><div class="msg bot">${corpo}</div></div>`;
}

// Avisos do topo da lista: a janela de 100 e o teto de 200 (quadros D11/D12).
export function chatAvisoDaJanela(total) {
  const t = Number(total) || 0;
  if (t <= JANELA_DA_TELA) return '';
  let html = `<div class="chat-window-note">Mostrando as últimas ${JANELA_DA_TELA} de ${t} mensagens. <b>A exportação traz todas.</b></div>`;
  if (t >= TETO_GUARDADO) {
    html += `<div class="chat-window-note plain">O Farol guarda as ${TETO_GUARDADO} mensagens mais recentes desta conversa. As anteriores já foram descartadas e não entram no arquivo, que também avisa isso.</div>`;
  }
  return html;
}

// A lista inteira. c = o que /api/chat devolve ({ key, status, messages, total }).
export function chatMensagensHtml(c, agora = Date.now()) {
  const msgs = (c && Array.isArray(c.messages)) ? c.messages : [];
  if (!msgs.length) {
    return `<div class="chat-hint">Converse com o Claude sobre <b>${esc((c && c.key) || '')}</b>. Quando o PR já passou pela revisão automática, ele chega sabendo o diff, o card e o relatório; e pode examinar o PR com <code>gh</code>. Pra responder no PR, é só pedir: "posta esse comentário".</div>`;
  }
  const total = Number(c.total) || msgs.length;
  const corpo = msgs.map((m) => mensagemHtml(m, agora)).join('');
  // a resposta ainda não começou a chegar: o Claude aparece escrevendo, sem texto
  const ultima = msgs[msgs.length - 1];
  const esperando = c.status === 'running' && ultima && ultima.role === 'user'
    ? `<div class="msg-wrap bot"><div class="msg-meta">Claude · escrevendo</div><div class="msg streaming">${PONTOS}</div></div>`
    : '';
  return chatAvisoDaJanela(total) + corpo + esperando;
}

export function chatCarregandoHtml() {
  return '<div class="chat-loading">Carregando a conversa deste PR...</div>'
    + '<div class="chat-skel chat-skel-msg user"></div><div class="chat-skel chat-skel-msg bot"></div><div class="chat-skel chat-skel-msg user"></div>';
}

// Estado da faixa da sessão (quadros D03 a D05): carregando, vazio, sem sessão ou com sessão.
export function chatEstadoDaSessao(c) {
  if (!c) return 'carregando';
  const msgs = Array.isArray(c.messages) ? c.messages : [];
  if (!msgs.length) return 'vazio';
  return c.sessionId ? 'com-sessao' : 'sem-sessao';
}

export const CHAT_TEXTOS = Object.freeze({
  semConversa: 'Sem conversa ainda. O id da sessão e a exportação aparecem depois da primeira resposta do Claude.',
  semSessao: 'Ainda não existe. O id nasce quando o Claude responder pela primeira vez.',
  iniciando: 'iniciando a sessão do Claude',
  gerando: 'A resposta atual ainda está sendo gerada. Se exportar agora, ela sai marcada como "ainda sendo gerada".',
  copiado: '✓ Copiado',
  copiarId: 'Copiar id',
  falhaCopiarDesk: 'O navegador não liberou a área de transferência. O id já está selecionado: Ctrl+C copia.',
  falhaCopiarMob: 'O navegador não liberou a área de transferência. Toque e segure no id acima para copiar à mão.',
  falhaCopiarMd: 'O navegador não liberou a área de transferência. Use Baixar .md.',
  // não está nos quadros: o navegador que não oferece download manda para o Copiar .md
  falhaBaixar: 'O navegador não baixou o arquivo. Use Copiar .md.',
});

// Confirmação de exportação (quadros D09/M09), em HTML para o #chatNotice.
export function chatAvisoExportado(tipo, nome, n) {
  if (tipo === 'copia') {
    return `<div class="chat-note ok"><b>✓ Markdown copiado.</b> Conteúdo de <span class="mono">${esc(nome)}.md</span>, ${esc(chatContagem(n))}.</div>`;
  }
  const ext = tipo === 'json' ? 'json' : 'md';
  return `<div class="chat-note ok"><b>✓ Baixado</b> <span class="mono">${esc(nome)}.${ext}</span></div>`;
}

// Falha de exportação (quadros D10/M10). status: código HTTP quando a rota falhou;
// erro: o `error` do engine quando ela respondeu { ok: false }. Nunca arquivo vazio.
export function chatAvisoFalhaExport({ status = 0, erro = '' } = {}) {
  if (erro) {
    const frase = String(erro).trim();
    const ponto = /[.!?]$/.test(frase) ? '' : '.';
    const texto = frase && frase.charAt(0).toUpperCase() + frase.slice(1) + ponto;
    return `<div class="chat-note fail"><span><b>Não deu para exportar.</b> ${esc(texto)}</span></div>`;
  }
  const codigo = Number(status) ? ` respondeu ${Number(status)}` : ' não respondeu';
  return `<div class="chat-note fail"><span><b>Não deu para exportar.</b> A rota de exportação${codigo}. Nenhum arquivo foi gerado.</span><button class="btn" type="button" data-chat-retry-export>Tentar de novo</button></div>`;
}
