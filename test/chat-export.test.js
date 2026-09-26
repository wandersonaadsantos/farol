// Exportação da conversa do chat por PR (lib/engine/chat-export.js): o arquivo que sai do
// app para análise externa, com os metadados e o horário de Brasília com o fuso explícito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportarConversa } from '../lib/engine/chat-export.js';

// 26/09/2026 16:06:12 UTC = 13:06:12 em Brasília (UTC-3)
const T0 = Date.UTC(2026, 8, 26, 16, 6, 12);
const conversa = () => ({
  key: 'acme-exemplo/app#42',
  url: 'https://github.com/acme-exemplo/app/pull/42',
  sessionId: '0c5d0945-0d49-4567-895b-4d50408b418d',
  createdAt: T0,
  status: 'idle',
  messages: [
    { role: 'user', text: 'refaça o review com opus', at: T0 },
    { role: 'assistant', text: 'O resultado é o **mesmo**.', at: T0 + 65_000 },
    { role: 'system', text: 'geração interrompida por você', at: T0 + 70_000 },
  ],
});

test('markdown traz os metadados e cada mensagem com hora de Brasília e fuso explícito', () => {
  const r = exportarConversa(conversa(), { agora: T0 + 3_600_000, versao: '2.62.22' });
  assert.equal(r.ok, true);
  const md = r.markdown;
  assert.match(md, /^# Conversa do Farol: acme-exemplo\/app#42$/m);
  assert.match(md, /\| PR \| acme-exemplo\/app#42 \|/);
  assert.match(md, /\| Link \| https:\/\/github\.com\/acme-exemplo\/app\/pull\/42 \|/);
  assert.match(md, /\| Id da sessão do Claude \| `0c5d0945-0d49-4567-895b-4d50408b418d` \|/);
  assert.match(md, /\| Conversa iniciada em \| 2026-09-26 13:06:12 -03:00 \|/);
  assert.match(md, /\| Exportada em \| 2026-09-26 14:06:12 -03:00 \|/);
  assert.match(md, /\| Mensagens \| 3 \|/);
  assert.match(md, /\| Versão do Farol \| 2\.62\.22 \|/);
  assert.match(md, /horário de Brasília \(America\/Sao_Paulo\)/);
  assert.match(md, /^### Você · 2026-09-26 13:06:12 -03:00$/m);
  assert.match(md, /^### Claude · 2026-09-26 13:07:17 -03:00$/m);
  assert.match(md, /^### Farol · 2026-09-26 13:07:22 -03:00$/m);
  assert.ok(md.indexOf('refaça o review') < md.indexOf('O resultado é o **mesmo**.'), 'ordem da conversa preservada');
});

test('json traz os mesmos dados, com o instante em ISO e em Brasília', () => {
  const r = exportarConversa(conversa(), { agora: T0, versao: '2.62.22' });
  assert.equal(r.json.sessionId, '0c5d0945-0d49-4567-895b-4d50408b418d');
  assert.equal(r.json.fuso, 'America/Sao_Paulo');
  assert.equal(r.json.mensagens.length, 3);
  assert.deepEqual(r.json.mensagens[0], {
    papel: 'voce', texto: 'refaça o review com opus', em: '2026-09-26T16:06:12.000Z', emBrasilia: '2026-09-26 13:06:12 -03:00',
  });
});

test('o nome do arquivo identifica o PR e o instante, sem caractere proibido no Windows', () => {
  const r = exportarConversa(conversa(), { agora: T0, versao: '2.62.22' });
  assert.equal(r.nome, 'farol-chat-acme-exemplo-app-42-2026-09-26-1306');
  assert.doesNotMatch(r.nome, /[\/:*?"<>|#\s]/);
});

test('a conversa INTEIRA sai, não só a janela da tela', () => {
  const c = conversa();
  c.messages = Array.from({ length: 180 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i}`, at: T0 + i * 1000 }));
  const r = exportarConversa(c, { agora: T0 });
  assert.equal(r.json.mensagens.length, 180);
  assert.match(r.markdown, /\bm0\b/);
  assert.match(r.markdown, /\bm179\b/);
});

test('conversa no teto de retenção avisa que as mais antigas podem ter saído', () => {
  const c = conversa();
  c.messages = Array.from({ length: 200 }, (_, i) => ({ role: 'user', text: `m${i}`, at: T0 + i }));
  const r = exportarConversa(c, { agora: T0 });
  assert.match(r.markdown, /guarda as 200 mensagens mais recentes/);
  assert.equal(r.json.podeTerMensagensAnteriores, true);
  assert.equal(exportarConversa(conversa(), { agora: T0 }).json.podeTerMensagensAnteriores, false);
});

test('segredo colado na conversa sai mascarado: o arquivo vai para fora do app', () => {
  const c = conversa();
  c.messages[0].text = 'usa esse token ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA por favor';
  const r = exportarConversa(c, { agora: T0 });
  assert.doesNotMatch(r.markdown, /ghp_A{20}/);
  assert.match(r.markdown, /\[segredo mascarado\]/);
  assert.doesNotMatch(JSON.stringify(r.json), /ghp_A{20}/);
});

test('conversa sem sessão ainda diz isso, e mensagem parcial fica marcada', () => {
  const c = conversa();
  c.sessionId = null;
  c.status = 'running';
  c.messages[1].partial = true;
  const r = exportarConversa(c, { agora: T0 });
  assert.match(r.markdown, /\| Id da sessão do Claude \| ainda sem sessão \|/);
  assert.match(r.markdown, /^### Claude · 2026-09-26 13:07:17 -03:00 \(resposta ainda sendo gerada\)$/m);
  assert.equal(r.json.mensagens[1].parcial, true);
});

test('conversa que não existe devolve falha com motivo, não arquivo vazio', () => {
  assert.deepEqual(exportarConversa(null, { agora: T0 }), { ok: false, error: 'não há conversa deste PR para exportar' });
  assert.deepEqual(exportarConversa({ key: 'a/b#1', messages: [] }, { agora: T0 }), { ok: false, error: 'não há conversa deste PR para exportar' });
});

/* ---------- a rota e a tela recebem o que a exportação promete ---------- */

test('chatExport lê a conversa guardada inteira, e chatPublic leva o id da sessão e o início', async () => {
  const { chatExport, chatPublic } = await import('../lib/engine/chat.js');
  const c = conversa();
  c.messages = Array.from({ length: 150 }, (_, i) => ({ role: 'user', text: `m${i}`, at: T0 + i }));
  // a tela segue recebendo as últimas 100 (teto do SSE, travado em chat-tools-queries); a
  // exportação é que leva as 150
  const engine = { chats: { [c.key]: c } };
  const pub = chatPublic(engine, c.key);
  assert.equal(pub.messages.length, 100);
  assert.equal(pub.sessionId, '0c5d0945-0d49-4567-895b-4d50408b418d');
  assert.equal(pub.createdAt, T0);
  const r = chatExport(engine, ` ${c.key} `);
  assert.equal(r.ok, true);
  assert.equal(r.json.mensagens.length, 150);
  assert.match(r.json.versaoDoFarol, /^\d+\.\d+\.\d+$/);
  assert.equal(chatExport(engine, 'x/y#1').ok, false);
  assert.equal(chatPublic(engine, 'x/y#1').sessionId, null);
});
