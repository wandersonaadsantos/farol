// A leitura do `codex login status` saiu do doctor (server.js) para lib/codex/auth.js em
// 24/09/2026. O motivo era uma duplicacao de regra: o doctor tinha a regex "logged in using
// chatgpt" escrita de novo, ao lado da `usaPlanoChatGPT` que ja respondia a mesma pergunta.
// Estes casos travam que a mudanca de lugar nao mudou o que o doctor mostra, com as quatro
// formas de resposta que o CLI devolve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const auth = (await import('../lib/codex/auth.js')).default;

test('login pelo plano ChatGPT: reconhecido, e a primeira linha vira o detalhe', () => {
  const r = auth.leituraDoLogin({ ok: true, code: 0, stdout: 'Logged in using ChatGPT\nconta: x', stderr: '' });
  assert.equal(r.chatGPT, true);
  assert.equal(r.detalhe, 'Logged in using ChatGPT');
});

test('login por API key: logado, mas NÃO é o plano que o Farol usa', () => {
  const r = auth.leituraDoLogin({ ok: true, code: 0, stdout: 'Logged in using an API key', stderr: '' });
  assert.equal(r.chatGPT, false);
  assert.equal(r.detalhe, 'Logged in using an API key');
});

test('o CLI responde pelo stderr: a mensagem continua aparecendo', () => {
  const r = auth.leituraDoLogin({ ok: false, code: 1, stdout: '', stderr: 'Not logged in' });
  assert.equal(r.chatGPT, false, 'saída com erro nunca conta como logado, mesmo que o texto casasse');
  assert.equal(r.detalhe, 'Not logged in');
});

test('comando que falhou calado: diz que falhou, com o código', () => {
  assert.equal(auth.leituraDoLogin({ ok: false, code: 127, stdout: '', stderr: '' }).detalhe,
    'codex login status falhou (código 127)');
  assert.equal(auth.leituraDoLogin({ ok: false, code: 0, stdout: '', stderr: '' }).detalhe,
    'codex login status falhou', 'sem código, sem parênteses vazios');
});

test('a regra do plano existe UMA vez: o doctor não tem mais a regex própria', async () => {
  const fs = await import('node:fs');
  const server = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.doesNotMatch(server, /logged in using chatgpt/i, 'a regex voltou a morar no server.js');
  assert.match(server, /codexAuth\.leituraDoLogin\(/, 'e o doctor lê pela função do módulo');
});
