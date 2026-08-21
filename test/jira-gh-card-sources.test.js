// A chave do card sai de título, branch e corpo. O item da fila só tem título,
// então esta consulta existe. Falha do gh NÃO pode derrubar a revisão: sem os
// metadados o card fica não verificável, que já é um estado previsto.
//
// O patch do io.run vem ANTES do import do módulo, idioma de
// test/gh-queries-capped.test.js. io.run NUNCA lança, então o caminho de falha
// que importa testar é r.ok === false, não um throw.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-jira-ghsrc-' + process.pid);

const io = (await import('../lib/io.js')).default;
let resposta = { ok: true, code: 0, stdout: '{"title":"t","headRefName":"feat/xx-1","body":"corpo"}', stderr: '' };
io.run = async () => resposta;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { prCardSources } = await import('../lib/engine/gh-queries.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = { url: 'https://github.com/org/repo/pull/1', repo: 'org/repo', number: 1 };
const ENGINE = { accountForPr: () => 'me', tokenFor: () => 'tok', ghEnv: () => ({}), log: () => {} };

test('devolve os três campos quando o gh responde', async () => {
  resposta = { ok: true, code: 0, stdout: '{"title":"t","headRefName":"feat/xx-1","body":"corpo"}', stderr: '' };
  assert.deepEqual(await prCardSources(ENGINE, PR), { title: 't', headRefName: 'feat/xx-1', body: 'corpo' });
});

test('campo ausente vira string vazia', async () => {
  resposta = { ok: true, code: 0, stdout: '{"title":"t"}', stderr: '' };
  assert.deepEqual(await prCardSources(ENGINE, PR), { title: 't', headRefName: '', body: '' });
});

test('gh que falha degrada para vazio, sem lançar', async () => {
  resposta = { ok: false, code: 1, stdout: '', stderr: 'gh caiu' };
  assert.deepEqual(await prCardSources(ENGINE, PR), { title: '', headRefName: '', body: '' });
});

test('saída que não é JSON degrada para vazio', async () => {
  resposta = { ok: true, code: 0, stdout: 'not json', stderr: '' };
  assert.deepEqual(await prCardSources(ENGINE, PR), { title: '', headRefName: '', body: '' });
});

test('conta sem token não consulta com outra identidade', async () => {
  resposta = { ok: true, code: 0, stdout: '{"title":"do PR errado"}', stderr: '' };
  assert.deepEqual(await prCardSources({ ...ENGINE, tokenFor: () => '' }, PR), { title: '', headRefName: '', body: '' });
});
