// Comando do agente da autoanálise (issue #346): traduz pedir, ler e listar em chamadas às
// rotas /api/self-review/agent/* do motor local, com a credencial própria no cabeçalho
// x-farol-autoanalise. O fetch é falso: o que se prova aqui é o contrato do comando.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-farol-autoanalise-'));
process.env.FAROL_HOME = HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { executar } = await import('../tools/farol-autoanalise.js');
const { CONFIG_FILE } = await import('../lib/paths.js');
const { gravarCasca, apagarCasca } = await import('../lib/engine/casca-arquivo.js');
const { DEFAULT_PORT } = await import('../lib/constants.js');

after(() => { fs.rmSync(HOME, { recursive: true, force: true }); });

const URL_PR = 'https://github.com/acme/app/pull/7';
const TOKEN = 't'.repeat(43);

function fluxo() {
  const texto = [];
  return { texto, write: (t) => { texto.push(t); } };
}

function fetchFalso(resposta = { ok: true }, status = 200) {
  const chamadas = [];
  const fetch = async (alvo, opcoes) => {
    chamadas.push({ alvo, ...opcoes });
    return { ok: status < 400, status, text: async () => JSON.stringify(resposta) };
  };
  return { fetch, chamadas };
}

async function rodar(args, extra = {}) {
  const saida = fluxo();
  const erro = fluxo();
  const falso = fetchFalso(extra.resposta, extra.status);
  const codigo = await executar(args, saida, erro, { fetch: falso.fetch, token: TOKEN, port: 47999, ...extra.opcoes });
  return { codigo, saida: saida.texto.join(''), erro: erro.texto.join(''), chamadas: falso.chamadas };
}

test('pedir manda POST com a URL no corpo e a credencial no cabeçalho do agente', async () => {
  const r = await rodar(['pedir', URL_PR]);
  assert.equal(r.codigo, 0);
  const [c] = r.chamadas;
  assert.equal(c.alvo, 'http://127.0.0.1:47999/api/self-review/agent/request');
  assert.equal(c.method, 'POST');
  assert.deepEqual(JSON.parse(c.body), { url: URL_PR });
  assert.equal(c.headers['x-farol-autoanalise'], TOKEN);
  assert.equal(c.headers['x-farol'], '1');
  assert.equal(c.headers.authorization, undefined, 'nunca manda Bearer');
});

test('ler e listar usam GET, e a resposta sai no stdout', async () => {
  const ler = await rodar(['ler', URL_PR], { resposta: { ok: true, estado: 'pronta' } });
  assert.equal(ler.chamadas[0].alvo, `http://127.0.0.1:47999/api/self-review/agent/read?url=${encodeURIComponent(URL_PR)}`);
  assert.equal(ler.chamadas[0].method, 'GET');
  assert.equal(JSON.parse(ler.saida).estado, 'pronta');
  const listar = await rodar(['listar']);
  assert.equal(listar.chamadas[0].alvo, 'http://127.0.0.1:47999/api/self-review/agent/list');
  assert.equal(listar.codigo, 0);
});

test('recusa do motor e 401 saem com código 1, e a resposta continua no stdout', async () => {
  const recusa = await rodar(['pedir', URL_PR], { resposta: { ok: false, code: 'orcamento', motivo: 'estourou' } });
  assert.equal(recusa.codigo, 1);
  assert.match(recusa.saida, /orcamento/);
  const semAcesso = await rodar(['listar'], { resposta: { error: 'nao_autenticado' }, status: 401 });
  assert.equal(semAcesso.codigo, 1);
});

test('corpo que não é objeto sai com código 1, sem confundir com motor fora do ar', async () => {
  const r = await rodar(['listar'], { resposta: null });
  assert.equal(r.codigo, 1);
  assert.equal(r.saida, 'null\n');
  assert.equal(r.erro, '');
});

test('uso errado e falta de credencial não chamam o motor', async () => {
  for (const args of [[], ['pedir'], ['listar', URL_PR], ['apagar', URL_PR], ['ler', URL_PR, 'extra']]) {
    const r = await rodar(args);
    assert.equal(r.codigo, 2, args.join(' '));
    assert.match(r.erro, /Uso:/);
    assert.equal(r.chamadas.length, 0);
  }
  const semToken = await rodar(['listar'], { opcoes: { token: '' } });
  assert.equal(semToken.codigo, 2);
  assert.match(semToken.erro, /FAROL_AUTOANALISE_TOKEN/);
  assert.equal(semToken.chamadas.length, 0);
});

test('motor fora do ar diz a porta tentada, sem vazar a credencial', async () => {
  const saida = fluxo();
  const erro = fluxo();
  const fetch = async () => { throw new Error('connect ECONNREFUSED'); };
  assert.equal(await executar(['listar'], saida, erro, { fetch, token: TOKEN, port: 47999 }), 1);
  assert.match(erro.texto.join(''), /127\.0\.0\.1:47999/);
  assert.equal(erro.texto.join('').includes(TOKEN), false);
});

test('a porta vem do casca.json, senão do config.json, senão a padrão', async () => {
  const alvoCom = async () => {
    const falso = fetchFalso();
    await executar(['listar'], fluxo(), fluxo(), { fetch: falso.fetch, token: TOKEN });
    return new URL(falso.chamadas[0].alvo).port;
  };
  assert.equal(await alvoCom(), String(DEFAULT_PORT));
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port: 47123 }));
  assert.equal(await alvoCom(), '47123');
  gravarCasca({ porta: 47124, pid: process.pid, versao: '0', codigoPareamento: '', iniciadoEm: 0 });
  assert.equal(await alvoCom(), '47124');
  apagarCasca();
});

async function alvoComBind(bind, porta = 47200) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port: porta, bind }));
  const falso = fetchFalso();
  await executar(['listar'], fluxo(), fluxo(), { fetch: falso.fetch, token: TOKEN });
  return falso.chamadas[0].alvo;
}

test('o host segue o bind configurado, IPv6 entre colchetes', async () => {
  assert.equal(await alvoComBind('[::1]'), 'http://[::1]:47200/api/self-review/agent/list');
  assert.equal(await alvoComBind('192.168.0.10'), 'http://192.168.0.10:47200/api/self-review/agent/list');
});

test('escuta em tudo vai ao loopback, e sem bind fica em 127.0.0.1', async () => {
  assert.equal(await alvoComBind('0.0.0.0'), 'http://127.0.0.1:47200/api/self-review/agent/list');
  assert.equal(await alvoComBind('[::]'), 'http://[::1]:47200/api/self-review/agent/list');
  assert.equal(await alvoComBind(undefined), 'http://127.0.0.1:47200/api/self-review/agent/list');
});

test('com bind, a porta continua vindo do casca.json', async () => {
  gravarCasca({ porta: 47124, pid: process.pid, versao: '0', codigoPareamento: '', iniciadoEm: 0 });
  assert.equal(new URL(await alvoComBind('[::1]', 47123)).port, '47124');
  apagarCasca();
});

test('motor fora do ar com bind diz o host:porta tentado', async () => {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port: 47200, bind: '[::1]' }));
  const erro = fluxo();
  const fetch = async () => { throw new Error('connect ECONNREFUSED'); };
  assert.equal(await executar(['listar'], fluxo(), erro, { fetch, token: TOKEN }), 1);
  assert.match(erro.texto.join(''), /\[::1\]:47200/);
});

test('de ponta a ponta: alcança um motor que escuta só em ::1', async () => {
  const servidor = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); });
  await new Promise((ok, falha) => { servidor.once('error', falha); servidor.listen(0, '::1', ok); });
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port: servidor.address().port, bind: '[::1]' }));
    const saida = fluxo();
    assert.equal(await executar(['listar'], saida, fluxo(), { token: TOKEN }), 0);
    assert.equal(JSON.parse(saida.texto.join('')).ok, true);
  } finally {
    servidor.close();
    fs.rmSync(CONFIG_FILE, { force: true });
  }
});

test('o comando não roda processo nenhum (nada de gh nem git)', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'tools', 'farol-autoanalise.js'), 'utf8');
  assert.doesNotMatch(fonte, /child_process|\.run\(|\bspawn|\bexec(File|Sync)?\(/);
});
