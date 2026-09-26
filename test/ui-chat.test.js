// O chat do PR na tela (ui/pure/chat.js, 26/09/2026): horário de Brasília em cada mensagem,
// a lista inteira como UMA rolagem, os estados da faixa da sessão e os textos exatos que o
// desenho do Claude Design fixou (docs/superpowers/specs/2026-09-26-chat-responsivo-anexos/).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chatHora, chatHoraCompleta, chatHoraIso, chatContagem, chatEnvolverTabelas, chatMensagensHtml,
  chatAvisoDaJanela, chatEstadoDaSessao, chatAvisoExportado, chatAvisoFalhaExport, chatCarregandoHtml, CHAT_TEXTOS, md,
} from '../ui/pure.js';

// 26/09/2026 16:06:12 UTC = 13:06:12 em Brasília
const T0 = Date.UTC(2026, 8, 26, 16, 6, 12);

test('hora da mensagem é de Brasília: HH:MM no mesmo dia, DD/MM em outro dia, DD/MM/AAAA em outro ano', () => {
  assert.equal(chatHora(T0, T0), '13:06');
  assert.equal(chatHora(T0 - 86_400_000, T0), '25/09 13:06');
  assert.equal(chatHora(Date.UTC(2025, 8, 25, 16, 6), T0), '25/09/2025 13:06');
  // 02:30 UTC do dia 27 ainda é dia 26 em Brasília (23:30)
  assert.equal(chatHora(Date.UTC(2026, 8, 27, 2, 30), T0), '23:30');
  assert.equal(chatHora(NaN, T0), '');
});

test('o <time> leva o instante com o fuso explícito e a data completa no title', () => {
  assert.equal(chatHoraIso(T0), '2026-09-26T13:06:12-03:00');
  assert.equal(chatHoraCompleta(T0), '26/09/2026 13:06:12 (Brasília)');
});

test('contagem no singular e no plural', () => {
  assert.equal(chatContagem(1), '1 mensagem');
  assert.equal(chatContagem(3), '3 mensagens');
});

test('tabela do Markdown vai dentro do invólucro que rola para o lado', () => {
  const html = chatEnvolverTabelas(md('| a | b |\n|---|---|\n| 1 | 2 |'));
  assert.match(html, /^<div class="tbl"><table>/);
  assert.match(html, /<\/table><\/div>$/);
});

test('md: bloco de código cercado vira <pre> preservando a indentação, e lista numerada vira <ol>', () => {
  const html = md('1. um\n2. dois\n```js\nif (a < b) {\n  x();\n}\n```');
  assert.match(html, /<ol>\n<li>um<\/li>\n<li>dois<\/li>\n<\/ol>/);
  assert.match(html, /<pre><code>if \(a &lt; b\) \{\n {2}x\(\);\n\}<\/code><\/pre>/);
});

const conversa = (extra = {}) => ({
  key: 'acme-exemplo/app#42', status: 'idle', sessionId: '0c5d0945-0d49-4567-895b-4d50408b418d', total: 3,
  messages: [
    { role: 'user', text: 'refaça o review com opus', at: T0 },
    { role: 'assistant', text: 'O resultado é o **mesmo**.\n\n| a | b |\n|---|---|\n| 1 | 2 |', at: T0 + 88_000 },
    { role: 'system', text: 'geração interrompida por você', at: T0 + 170_000 },
  ],
  ...extra,
});

test('cada mensagem traz autor e hora de Brasília, e a resposta do Claude sai em Markdown com a tabela envolvida', () => {
  const html = chatMensagensHtml(conversa(), T0);
  assert.match(html, /<div class="msg-meta">Você · <time datetime="2026-09-26T13:06:12-03:00" title="26\/09\/2026 13:06:12 \(Brasília\)">13:06<\/time><\/div><div class="msg user">refaça o review com opus<\/div>/);
  assert.match(html, /<div class="msg-meta">Claude · <time [^>]+>13:07<\/time><\/div><div class="msg bot"><p>O resultado é o <b>mesmo<\/b>\.<\/p>/);
  assert.match(html, /<div class="tbl"><table>/);
  assert.match(html, /<div class="msg sys">Farol · <time [^>]+>13:09<\/time> · geração interrompida por você<\/div>/);
});

test('nenhum balão nasce com rolagem própria: não existe max-height nem overflow no HTML da lista', () => {
  const html = chatMensagensHtml(conversa(), T0);
  assert.doesNotMatch(html, /max-height|overflow/);
  assert.doesNotMatch(html, /class="[^"]*\breport\b/, 'a classe .report (max-height 480px) saiu do balão');
});

test('falha da conversa aparece inteira, com o rótulo do Farol em cima', () => {
  const html = chatMensagensHtml(conversa({ messages: [{ role: 'system', text: 'falha: o Claude encerrou sem responder (código 1)', at: T0 }] }), T0);
  assert.match(html, /<div class="msg-meta">Farol · <time [^>]+>13:06<\/time><\/div><div class="msg sys fail"><b>falha:<\/b> o Claude encerrou sem responder \(código 1\)<\/div>/);
});

test('respondendo: a parcial sai com "Claude · escrevendo" e os três pontos; sem parcial ainda, só o indicador', () => {
  const parcial = chatMensagensHtml(conversa({ status: 'running', messages: [{ role: 'user', text: 'oi', at: T0 }, { role: 'assistant', text: 'lendo', at: T0, partial: true }] }), T0);
  assert.match(parcial, /<div class="msg-meta">Claude · escrevendo<\/div><div class="msg bot"><p>lendo<\/p><span class="typing"/);
  const esperando = chatMensagensHtml(conversa({ status: 'running', messages: [{ role: 'user', text: 'oi', at: T0 }] }), T0);
  assert.match(esperando, /<div class="msg-meta">Claude · escrevendo<\/div><div class="msg streaming">/);
});

test('texto do usuário é escapado', () => {
  const html = chatMensagensHtml(conversa({ messages: [{ role: 'user', text: '<img src=x onerror=alert(1)>', at: T0 }] }), T0);
  assert.doesNotMatch(html, /<img/);
});

test('mais de 100 mensagens avisa que a tela mostra as últimas; no teto de 200 avisa que as anteriores saíram', () => {
  assert.equal(chatAvisoDaJanela(100), '');
  assert.match(chatAvisoDaJanela(137), /Mostrando as últimas 100 de 137 mensagens\. <b>A exportação traz todas\.<\/b>/);
  assert.doesNotMatch(chatAvisoDaJanela(137), /guarda as 200/);
  assert.match(chatAvisoDaJanela(200), /O Farol guarda as 200 mensagens mais recentes desta conversa\./);
  assert.match(chatMensagensHtml(conversa({ total: 150 }), T0), /^<div class="chat-window-note">Mostrando as últimas 100 de 150/);
});

test('conversa vazia é o convite, e carregando nunca é o convite', () => {
  assert.match(chatMensagensHtml({ key: 'a/b#1', messages: [] }, T0), /^<div class="chat-hint">Converse com o Claude sobre <b>a\/b#1<\/b>/);
  assert.match(chatCarregandoHtml(), /^<div class="chat-loading">Carregando a conversa deste PR\.\.\.<\/div>/);
  assert.doesNotMatch(chatCarregandoHtml(), /Converse com o Claude/);
});

test('estado da faixa da sessão', () => {
  assert.equal(chatEstadoDaSessao(null), 'carregando');
  assert.equal(chatEstadoDaSessao({ messages: [] }), 'vazio');
  assert.equal(chatEstadoDaSessao({ messages: [{ role: 'user' }], sessionId: null }), 'sem-sessao');
  assert.equal(chatEstadoDaSessao(conversa()), 'com-sessao');
});

test('textos exatos dos estados, como o desenho fixou', () => {
  assert.equal(CHAT_TEXTOS.semSessao, 'Ainda não existe. O id nasce quando o Claude responder pela primeira vez.');
  assert.equal(CHAT_TEXTOS.falhaCopiarDesk, 'O navegador não liberou a área de transferência. O id já está selecionado: Ctrl+C copia.');
  assert.equal(CHAT_TEXTOS.gerando, 'A resposta atual ainda está sendo gerada. Se exportar agora, ela sai marcada como "ainda sendo gerada".');
  for (const t of Object.values(CHAT_TEXTOS)) assert.doesNotMatch(t, /—/, 'sem travessão');
});

test('exportado: baixado com o nome do arquivo, ou copiado com a contagem', () => {
  assert.equal(chatAvisoExportado('md', 'farol-chat-a-b-1-2026-09-26-1306', 3), '<div class="chat-note ok"><b>✓ Baixado</b> <span class="mono">farol-chat-a-b-1-2026-09-26-1306.md</span></div>');
  assert.match(chatAvisoExportado('json', 'x', 3), /x\.json/);
  assert.match(chatAvisoExportado('copia', 'x', 3), /✓ Markdown copiado\.<\/b> Conteúdo de <span class="mono">x\.md<\/span>, 3 mensagens\./);
});

test('falha ao exportar: rota que falhou oferece tentar de novo; recusa do engine diz o motivo e não oferece', () => {
  const rota = chatAvisoFalhaExport({ status: 502 });
  assert.match(rota, /<b>Não deu para exportar\.<\/b> A rota de exportação respondeu 502\. Nenhum arquivo foi gerado\./);
  assert.match(rota, /data-chat-retry-export>Tentar de novo</);
  const engine = chatAvisoFalhaExport({ erro: 'não há conversa deste PR para exportar' });
  assert.match(engine, /<b>Não deu para exportar\.<\/b> Não há conversa deste PR para exportar\./);
  assert.doesNotMatch(engine, /Tentar de novo/);
  assert.match(chatAvisoFalhaExport({}), /A rota de exportação não respondeu\./);
});
