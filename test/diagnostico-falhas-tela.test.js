// A3 na tela: as falhas registradas aparecem uma por cartão, com o que É e o que FAZER (a
// lacuna medida no brief B2: "diagnóstico que diz o que é e não o que fazer"), e cada uma
// copiável como texto inerte. A ação sugerida mora na taxonomia, que é a fonte única de
// "que erro é esse e o que fazer": o retry, o triage e a tela leem a mesma tabela.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-diag-falhas-'));
process.env.FAROL_HOME = BASE;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { CLASSES, DESCONHECIDO, classify, triage } = await import('../lib/log-taxonomy.js');
const { falhasParaTela } = await import('../lib/engine/diagnostico.js');
const { falhasSecaoHtml, diagnosticoHtml } = await import('../ui/pure.js');

const TOKEN = 'ghp_' + 'Z9y8X7w6'.repeat(4);
let engine;
let server;
let base;

before(async () => {
  engine = new Engine();
  engine.log = () => { };
  engine.pushState = () => { };
  engine.config.port = 0;
  engine.registrarFalha({ sessionId: 'a-um', kind: 'review', ref: 'acme-exemplo/app-web#42', motivo: `OAuth access token has expired ${TOKEN}` });
  engine.registrarFalha({ sessionId: 'a-dois', kind: 'tool', ref: 'Diagnóstico do Farol', motivo: 'algo que ninguém classificou <script>x</script>' });
  await new Promise((resolve, reject) => { server = startServer(engine, (u, e) => (e ? reject(e) : resolve())); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

test('toda classe da taxonomia diz o que fazer, em português e sem travessão', () => {
  for (const c of [...CLASSES, DESCONHECIDO]) {
    assert.equal(typeof c.acao, 'string', c.id);
    assert.ok(c.acao.length > 10, `${c.id} sem ação`);
    assert.doesNotMatch(c.acao, /[—–]/, `${c.id} com travessão`);
    assert.match(c.acao, /\.$/, `${c.id} termina em ponto`);
  }
  assert.match(classify('OAuth access token has expired').acao, /login/i);
});

test('o triage do log carrega a ação da classe', () => {
  const grupos = triage(['[2026-09-16 10:00:00 -03:00] [ERROR] rede: getaddrinfo ENOTFOUND api.github.com']);
  assert.ok(grupos.length);
  assert.equal(typeof grupos[0].acao, 'string');
});

test('falhas para a tela: uma por registro, com classe, ação, gravidade e o texto inerte dela', () => {
  const falhas = falhasParaTela(engine);
  assert.equal(falhas.length, 2);
  const oauth = falhas.find((f) => f.sessionId === 'a-um');
  assert.equal(oauth.classe, 'oauth-expirado');
  assert.match(oauth.rotulo, /OAuth/);
  assert.match(oauth.acao, /login/i);
  assert.equal(oauth.precisaDeVoce, true);
  assert.match(oauth.markdown, /Sessão: `a-um`/);
  assert.equal(oauth.markdown.includes(TOKEN), false, 'o texto copiável já sai mascarado');
  assert.equal(JSON.stringify(falhas).includes(TOKEN), false, 'nada da lista leva o segredo');
  const outra = falhas.find((f) => f.sessionId === 'a-dois');
  assert.equal(outra.classe, 'desconhecido');
  assert.match(outra.acao, /mande para quem mantém/);
});

test('a rota do diagnóstico leva o Markdown inteiro e as falhas estruturadas', async () => {
  const corpo = await new Promise((resolve, reject) => {
    http.get(`${base}/api/diagnostics`, { agent: false, headers: { 'x-farol': '1' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
  assert.equal(corpo.ok, true);
  assert.match(corpo.markdown, /^# Diagnóstico do Farol$/m);
  assert.equal(corpo.falhas.length, 2);
  assert.equal(JSON.stringify(corpo).includes(TOKEN), false);
});

test('o cartão de falha diz o que é, o que fazer, e mostra o texto inerte', () => {
  const html = falhasSecaoHtml({ estado: 'pronto', falhas: falhasParaTela(engine) });
  assert.match(html, /O que fazer:/);
  assert.match(html, /data-copiar-falha="/);
  assert.match(html, /precisa de você/);
  assert.doesNotMatch(html, /<script/i);
  assert.equal(html.includes(TOKEN), false);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/, 'o texto hostil aparece como texto');
  assert.equal(typeof diagnosticoHtml, 'function');
});

test('os estados do painel são distintos: carregando, vazio, falha de leitura', () => {
  assert.match(falhasSecaoHtml({ estado: 'carregando' }), /lendo as falhas/i);
  assert.match(falhasSecaoHtml({ estado: 'pronto', falhas: [] }), /Nenhuma falha registrada/);
  const erro = falhasSecaoHtml({ estado: 'erro', falhas: [], lidoEm: 0 });
  assert.match(erro, /não deu para ler/i);
  assert.doesNotMatch(erro, /Nenhuma falha registrada/, 'falha não se disfarça de vazio');
});

test('a configuração entra em número e em sim ou não, sem login de conta nem caminho', () => {
  engine.config.accounts = [{ user: 'ana-exemplo', owners: ['acme-exemplo'] }, { user: 'bruno-teste', owners: [] }];
  engine.config.intervalSeconds = 300;
  const md = engine.diagnosticoMarkdown();
  assert.match(md, /Contas monitoradas: 2 \(1 com organização\)/);
  assert.match(md, /Intervalo de checagem: 300 s/);
  // a referência do PR continua aparecendo na falha, que é onde ela serve; o que não
  // aparece é a lista de contas e organizações da configuração
  const secao = md.slice(md.indexOf('## Configuração'), md.indexOf('## Falhas registradas'));
  assert.doesNotMatch(secao, /ana-exemplo|bruno-teste|acme-exemplo/, 'login e organização ficam de fora da configuração');
  engine.config.accounts = [];
});

test('a tela usa o Markdown único na cópia, e o export antigo saiu da tela', () => {
  const tela = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'telas', 'ferramentas.js'), 'utf8');
  assert.match(tela, /\/api\/diagnostics/);
  assert.doesNotMatch(tela, /diagnosticsText/);
  const html = fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'index.html'), 'utf8');
  assert.match(html, /id="diagFalhas"/);
  assert.match(html, />Copiar diagnóstico</);
  // a ida à aba atualiza log e falhas juntos: sem isto o painel fica preso em "lendo".
  // A asserção olha DENTRO do loadLog: a chamada do botão também casaria o nome solto.
  const corpoDoLoadLog = tela.slice(tela.indexOf('async function loadLog()'), tela.indexOf('/* ---------- diagnóstico unificado'));
  assert.match(corpoDoLoadLog, /carregarDiagnostico\(\)/);
});
