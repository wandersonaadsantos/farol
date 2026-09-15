// Transporte autenticado da UI (A4, spec 7.A4 item 2). Sem token, nada muda. Com token,
// toda chamada leva Authorization: Bearer e o SSE é lido por fetch, porque EventSource
// não aceita cabeçalho e o token nunca vai em URL. Módulo de navegador sem import: pode
// ser carregado direto no Node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenLocal, comAutorizacao, separarEventos, FonteDeEventosAutenticada } from '../ui/transporte.js';

const TOKEN = 'a'.repeat(21) + '_' + 'B'.repeat(20) + '-';

function armazenamento(valor) { return { getItem: () => valor }; }

test('tokenLocal só devolve token com o formato de 32 bytes base64url', () => {
  assert.equal(tokenLocal(armazenamento(TOKEN)), TOKEN);
  assert.equal(tokenLocal(armazenamento(null)), '');
  assert.equal(tokenLocal(armazenamento('curto')), '');
  assert.equal(tokenLocal(armazenamento(TOKEN + '"')), '');
  assert.equal(tokenLocal(undefined), '');
});

test('tokenLocal não derruba a página quando o localStorage lança', () => {
  assert.equal(tokenLocal({ getItem() { throw new Error('bloqueado'); } }), '');
});

test('comAutorizacao só acrescenta o cabeçalho com token e não muta a entrada', () => {
  const base = { 'x-farol': '1' };
  assert.deepEqual(comAutorizacao(base, ''), { 'x-farol': '1' });
  assert.deepEqual(comAutorizacao(base, TOKEN), { 'x-farol': '1', Authorization: `Bearer ${TOKEN}` });
  assert.deepEqual(base, { 'x-farol': '1' });
});

test('separarEventos junta pedaços, ignora comentário e devolve o resto', () => {
  const r = separarEventos('event: state\ndata: {"a":1}\n\n: ping\n\nevent: toast\ndata: linha1\ndata: linha2\n\nevent: chat\ndata: {"pela');
  assert.deepEqual(r.eventos, [{ tipo: 'state', dados: '{"a":1}' }, { tipo: 'toast', dados: 'linha1\nlinha2' }]);
  assert.equal(r.resto, 'event: chat\ndata: {"pela');
});

function streamDe(partes) {
  const cod = new TextEncoder();
  return new ReadableStream({ start(c) { for (const p of partes) c.enqueue(cod.encode(p)); c.close(); } });
}

test('a fonte autenticada manda o cabeçalho, nunca o token na URL, e entrega os eventos', async () => {
  const pedidos = [];
  const agendados = [];
  const fetchFalso = async (url, init) => {
    pedidos.push({ url, init });
    return { ok: true, status: 200, body: streamDe(['event: state\ndata: {"x"', ':1}\n\n: ping\n\n']) };
  };
  const fonte = new FonteDeEventosAutenticada('/api/events', () => TOKEN, fetchFalso, (fn, ms) => agendados.push({ fn, ms }));
  const recebidos = [];
  let abriu = 0, erros = 0;
  fonte.addEventListener('open', () => abriu++);
  fonte.addEventListener('state', e => recebidos.push(e.data));
  fonte.onerror = () => erros++;
  assert.equal(agendados.length, 1);
  assert.equal(agendados[0].ms, 0);
  await agendados.shift().fn();
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].url, '/api/events', 'o token nunca vai em URL');
  assert.equal(pedidos[0].init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(abriu, 1);
  assert.deepEqual(recebidos, ['{"x":1}']);
  assert.equal(erros, 1, 'fim do stream avisa como o EventSource');
  assert.equal(agendados.length, 1, 'e agenda a reconexão');
  assert.equal(agendados[0].ms, 3000);
});

test('recusa do servidor (401) avisa e reconecta, sem emitir evento', async () => {
  const agendados = [];
  const fonte = new FonteDeEventosAutenticada('/api/events', () => TOKEN, async () => ({ ok: false, status: 401, body: null }), (fn, ms) => agendados.push({ fn, ms }));
  let abriu = 0, erros = 0;
  fonte.addEventListener('open', () => abriu++);
  fonte.onerror = () => erros++;
  await agendados.shift().fn();
  assert.equal(abriu, 0);
  assert.equal(erros, 1);
  assert.equal(agendados.length, 1);
});

test('close interrompe e não reagenda', async () => {
  const agendados = [];
  const fonte = new FonteDeEventosAutenticada('/api/events', () => TOKEN, async () => ({ ok: false, status: 500, body: null }), (fn, ms) => agendados.push({ fn, ms }));
  fonte.close();
  await agendados.shift().fn();
  assert.equal(agendados.length, 0);
});
