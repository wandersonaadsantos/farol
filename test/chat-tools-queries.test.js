// lib/engine/chat.js, tools.js e gh-queries.js: os três últimos módulos de produção sem
// nenhum teste. As partes que fazem rede ou abrem sessão do Claude ficam de fora (custam
// caro e dependem do ambiente); o que dá pra travar aqui é o que decide COMO essas
// chamadas são montadas e o que é servido pra UI.
//
// Vale mais do que parece: o preâmbulo do chat carrega as travas de comportamento (não
// postar no GitHub sem pedido explícito), o escopo do kudos decide quais destaques
// aparecem pra qual conta, e a janela de entregas decide o intervalo consultado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-ctq-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const { STATE_DIR } = await import('../lib/paths.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

/* ---------- chat: o que a UI recebe ---------- */

test('chatPublic: conversa que não existe devolve envelope vazio, não undefined', () => {
  // a UI faz destructuring direto do retorno: undefined quebraria a aba
  const e = new Engine();
  const c = e.chatPublic('acme/app#1');
  assert.equal(c.key, 'acme/app#1');
  assert.equal(c.url, null);
  assert.equal(c.status, 'idle');
  assert.deepEqual(c.messages, []);
});

test('chatPublic: corta em 100 mensagens (a conversa vai por SSE em todo estado)', () => {
  const e = new Engine();
  const messages = Array.from({ length: 250 }, (_, i) => ({ role: 'user', text: `m${i}`, at: i }));
  e.chats = { 'acme/app#1': { url: 'u', status: 'idle', messages, createdAt: 0 } };
  const c = e.chatPublic('acme/app#1');
  assert.equal(c.messages.length, 100);
  assert.equal(c.messages[99].text, 'm249', 'mantém as últimas, não as primeiras');
});

test('chatSummaries: resume cada conversa com status, contagem e último horário', () => {
  const e = new Engine();
  e.chats = {
    'a#1': { status: 'idle', createdAt: 10, messages: [{ at: 20 }, { at: 30 }] },
    'b#2': { status: 'running', createdAt: 5, messages: [] },
  };
  const s = e.chatSummaries();
  assert.deepEqual(s['a#1'], { status: 'idle', count: 2, updatedAt: 30 });
  assert.deepEqual(s['b#2'], { status: 'running', count: 0, updatedAt: 5 },
    'conversa sem mensagem cai no createdAt em vez de undefined');
});

test('chatPreamble: trava as regras de comportamento da conversa', () => {
  const e = new Engine();
  const p = e.chatPreamble('acme/app#1', 'https://github.com/acme/app/pull/1', false);
  // a mais importante: o chat não pode postar no GitHub por conta própria
  assert.match(p, /NÃO poste nada no GitHub.*a menos que ele peça explicitamente/s);
  assert.match(p, /Nunca use travessão/, 'a regra de escrita do projeto vale no chat');
  assert.match(p, /em português/);
  assert.match(p, /acme\/app#1/, 'o PR entra no preâmbulo');
  assert.match(p, /github\.com\/acme\/app\/pull\/1/);
});

test('chatPreamble: modo herdado avisa que as regras do headless não valem mais', () => {
  // sem isso a sessão continuaria respondendo só JSON, como no review
  const e = new Engine();
  const p = e.chatPreamble('acme/app#1', 'u', true);
  assert.match(p, /MUDANÇA DE MODO/);
  assert.match(p, /responda só JSON.*não valem mais/s);
  assert.match(p, /NÃO poste nada no GitHub/, 'a trava de postagem vale nos dois modos');
});

test('chatPreamble: sem url não quebra nem inventa link', () => {
  const e = new Engine();
  const p = e.chatPreamble('acme/app#1', '', false);
  assert.match(p, /acme\/app#1/);
  assert.doesNotMatch(p, /\(\)/, 'não deixa parêntese vazio no lugar da url');
});

/* ---------- tools: escopo do kudos ---------- */

test('kudosScopeKey: vazio, nulo e "*" são o escopo global', () => {
  const e = new Engine();
  for (const v of ['', null, undefined, '*', '  ']) {
    assert.equal(e.kudosScopeKey(v), '*', `escopo ${JSON.stringify(v)}`);
  }
});

test('kudosScopeKey: normaliza caixa e espaço do login', () => {
  const e = new Engine();
  assert.equal(e.kudosScopeKey('  Alice  '), 'alice');
});

test('scopeLabel: global não tem rótulo; conta usa o apelido, senão o login', () => {
  const e = new Engine();
  e.config.accounts = [
    { user: 'alice', owners: ['acme'], label: 'Trabalho' },
    { user: 'bob', owners: ['outra'] },
  ];
  assert.equal(e.scopeLabel('*'), '');
  assert.equal(e.scopeLabel('alice'), 'Trabalho');
  assert.equal(e.scopeLabel('bob'), 'bob', 'sem apelido, o login');
});

test('ownerFromUrl: extrai a org da URL do PR, e devolve vazio no que não é URL', () => {
  const e = new Engine();
  assert.equal(e.ownerFromUrl('https://github.com/acme/app/pull/1'), 'acme');
  assert.equal(e.ownerFromUrl('https://github.com/ACME/app/pull/1'), 'ACME');
  assert.equal(e.ownerFromUrl(''), '');
  assert.equal(e.ownerFromUrl(null), '');
  assert.equal(e.ownerFromUrl('não é url'), '');
});

test('highlightsForScope: global mostra tudo, conta filtra pela org dela', () => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(path.join(STATE_DIR, 'highlights.md'),
    '- 2026-07-01 · @x · [acme/app#1](https://github.com/acme/app/pull/1) — do trabalho\n' +
    '- 2026-07-02 · @y · [pessoal/site#2](https://github.com/pessoal/site/pull/2) — do pessoal\n');
  const e = new Engine();
  e.config.accounts = [
    { user: 'alice', owners: ['acme'] },
    { user: 'bob', owners: ['pessoal'] },
  ];
  assert.equal(e.highlightsForScope('*').length, 2);
  assert.deepEqual(e.highlightsForScope('alice').map(h => h.ref), ['acme/app#1']);
  assert.deepEqual(e.highlightsForScope('bob').map(h => h.ref), ['pessoal/site#2']);
});

test('toolRunGet/Set: kudos guarda por escopo, as outras ferramentas não', () => {
  // kudos é por conta (cada uma tem seus destaques); diagnóstico é um só
  const e = new Engine();
  e.toolRunSet('kudos', 'alice', { status: 'done', out: 'A' });
  e.toolRunSet('kudos', 'bob', { status: 'done', out: 'B' });
  e.toolRunSet('health', 'alice', { status: 'done', out: 'H' });
  assert.equal(e.toolRunGet('kudos', 'alice').out, 'A');
  assert.equal(e.toolRunGet('kudos', 'bob').out, 'B');
  assert.equal(e.toolRunGet('health', 'qualquer').out, 'H', 'health ignora o escopo');
});

/* ---------- gh-queries: janela de entregas ---------- */

test('deliveriesSince: devolve timestamp UTC completo (o GitHub corta data seca em 00:00 UTC, 3h antes da meia-noite local)', () => {
  const e = new Engine();
  assert.match(e.deliveriesSince(7), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  // o corte é a meia-noite LOCAL serializada em UTC, nunca 00:00Z cru
  const meiaNoiteLocal = new Date();
  meiaNoiteLocal.setHours(0, 0, 0, 0);
  assert.equal(e.deliveriesSince(0), meiaNoiteLocal.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    '"Hoje" começa exatamente na meia-noite local, sem a franja de 3h de ontem');
});

test('deliveriesSince: a janela cobre EXATAMENTE os dias que o gráfico desenha (hoje - (dias-1))', () => {
  const e = new Engine();
  const hoje = e.deliveriesSince(0);
  const sete = e.deliveriesSince(7);
  const trinta = e.deliveriesSince(30);
  assert.ok(sete < hoje, '7 dias atrás é anterior a hoje');
  assert.ok(trinta < sete, '30 dias atrás é anterior a 7');
  // dias-1: o gráfico desenha N dias INCLUINDO hoje, então o corte recua N-1
  // (era N, e os cartões contavam um dia inteiro que o gráfico nunca desenhava)
  const dias = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
  assert.equal(dias(hoje, sete), 6, 'janela de 7 = hoje + 6 dias pra trás');
  assert.equal(dias(hoje, trinta), 29, 'janela de 30 = hoje + 29 dias pra trás');
});

test('deliveriesSince: entrada inválida ou negativa cai em hoje, nunca no futuro', () => {
  const e = new Engine();
  const hoje = e.deliveriesSince(0);
  for (const v of [null, undefined, 'abc', -5, NaN]) {
    assert.equal(e.deliveriesSince(v), hoje, `entrada ${JSON.stringify(v)}`);
  }
});
