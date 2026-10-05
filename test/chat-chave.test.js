// A chave da conversa vem do corpo das rotas do chat e indexa um objeto comum (alerta de
// CodeQL js/remote-property-injection em lib/engine/chat.js, 05/10/2026). Com a chave
// "__proto__", o chatSend achava o Object.prototype como "conversa existente" e gravava a url
// nele: todo objeto do engine passava a herdar `url` até reiniciar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-chat-chave-'));
process.env.FAROL_HOME = DIR;
const { Engine } = await import('../server.js');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('chave que não é de PR é recusada e não toca o protótipo', async () => {
  const e = new Engine();
  e.log = () => { };
  for (const key of ['__proto__', 'constructor', 'prototype', 'acme/app', 'acme/app#1 x']) {
    const r = await e.chatSend(key, 'https://atacante.example/x', 'oi');
    assert.equal(r.ok, false, key);
  }
  assert.equal(({}).url, undefined, 'Object.prototype intacto');
  assert.equal(Object.hasOwn(e.chats, 'constructor'), false, 'nada é criado com chave inválida');
});

test('leitura, exportação e parada não confundem herança com conversa', () => {
  const e = new Engine();
  for (const key of ['__proto__', 'constructor', 'toString']) {
    const pub = e.chatPublic(key);
    assert.equal(pub.total, 0, key);
    assert.deepEqual(pub.messages, []);
    assert.equal(e.chatStop(key).ok, false);
  }
});
