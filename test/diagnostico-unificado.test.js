// Diagnóstico unificado (spec 7.A3): UM Markdown para ver, copiar e alimentar o diagnóstico
// com IA. O que se prova aqui é o critério de aceite da spec: texto malicioso (script,
// `javascript:`, imagem remota, handler inline, token no meio da linha) sai inerte e
// mascarado no Markdown copiado E no HTML da tela, e `@login` nunca vira menção.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-diag-unificado-'));
process.env.FAROL_HOME = BASE;

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { startServer } = await import('../lib/http-server.js');
const { montarDiagnostico, diagnosticoMarkdown } = await import('../lib/engine/diagnostico.js');
const { diagnosticoHtml } = await import('../ui/pure.js');

const TOKEN = 'ghp_' + 'A1b2C3d4'.repeat(4);
const MALICIOSO = [
  '<script>alert(1)</script>',
  '[clique](javascript:alert(1)) e javascript:alert(2)',
  '![x](https://evil.example/pixel.png)',
  '<img src=x onerror=alert(3)>',
  `falhou com token ${TOKEN} no meio da linha`,
  'pediu para @fulano-de-tal olhar https://evil.example/caminho',
  '``` fecha a cerca antes da hora',
].join('\n');

let engine;
let server;
let base;

before(async () => {
  engine = new Engine();
  engine.log = () => { };
  engine.pushState = () => { };
  engine.config.port = 0;
  engine.doctorInfo = { node: 'v24.0.0', gh: 'gh version 2.0.0', ghAuth: true, claude: '1.0.0 (Claude Code)', codex: null, root: false, gitBash: 'C:/bash.exe', claudeAuth: [{ id: '', label: 'Padrão', ready: true, account: 'pessoa@exemplo.com' }] };
  engine.registrarFalha({ sessionId: 'a-diag', kind: 'review', ref: 'acme/repo#7 <b>x</b>', motivo: MALICIOSO });
  await new Promise((resolve, reject) => {
    server = startServer(engine, (url, err) => (err ? reject(err) : resolve()));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(() => resolve()));
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ }
});

// fora das cercas e dos trechos de código: é onde o Markdown renderiza
function foraDeCodigo(md) {
  return md.replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1$/gm, '').replace(/`[^`\n]*`/g, '');
}

test('o Markdown tem as três partes: ambiente, falhas registradas e resumo do log', () => {
  const md = diagnosticoMarkdown(engine);
  assert.match(md, /^# Diagnóstico do Farol$/m);
  assert.match(md, /^## Ambiente$/m);
  assert.match(md, /^## Falhas registradas/m);
  assert.match(md, /^## Resumo do log de falhas$/m);
  assert.match(md, /Sessão: `a-diag`/);
});

test('token some do Markdown inteiro, e a marca de mascaramento fica no lugar', () => {
  const md = diagnosticoMarkdown(engine);
  assert.equal(md.includes(TOKEN), false);
  assert.equal(md.includes('ghp_'), false);
  assert.match(md, /\[segredo mascarado\]/);
});

test('e-mail da conta e caminhos da máquina não entram no Markdown', () => {
  const md = diagnosticoMarkdown(engine);
  assert.doesNotMatch(md, /pessoa/, 'nem inteiro, nem quebrado pelo cofre de menção');
  assert.equal(md.includes('C:/bash.exe'), false);
});

test('fora de código não sobra menção, link, imagem, HTML nem URL ativa', () => {
  const md = montarDiagnostico({
    versao: '1.0.0', plataforma: 'linux', geradoEm: '2026-09-16T00:00:00.000Z',
    ambiente: [{ label: 'Check @fulano <b>', ok: false, detalhe: '[a](javascript:x) ![i](https://evil.example/i.png)' }],
    falhas: [{ at: 0, sessionId: 's`1', kind: 'review', classe: 'x', ref: '@outra-pessoa', motivo: MALICIOSO }],
    resumo: [{ label: 'Rede <i>', count: 2, first: 'a', last: 'b', kind: 'transitorio', sample: MALICIOSO }],
  });
  const livre = foraDeCodigo(md);
  assert.doesNotMatch(livre, /(^|[^\\`])@[A-Za-z0-9]/, 'menção fora de código');
  assert.doesNotMatch(livre, /(^|[^\\])!\[/, 'imagem ativa');
  assert.doesNotMatch(livre, /(^|[^\\])\]\(/, 'link ativo');
  assert.doesNotMatch(livre, /(^|[^\\])</, 'HTML cru');
  assert.doesNotMatch(livre, /\b(https?|javascript):/i, 'URL fora de código');
  assert.equal(md.includes(TOKEN), false);
});

test('texto com crase não fecha a cerca antes da hora', () => {
  const md = montarDiagnostico({ versao: '1', plataforma: 'x', geradoEm: 'y', ambiente: [], resumo: [], falhas: [{ at: 0, kind: 'review', motivo: 'a\n```\n# titulo injetado\n````' }] });
  assert.doesNotMatch(foraDeCodigo(md), /titulo injetado/);
  assert.match(md, /titulo injetado/, 'o texto continua presente, dentro da cerca');
});

test('seções vazias dizem que estão vazias', () => {
  const md = montarDiagnostico({ versao: '1', plataforma: 'x', geradoEm: 'y', ambiente: [], falhas: [], resumo: [] });
  assert.match(md, /Nenhuma falha registrada\./);
  assert.match(md, /O log de falhas está vazio\./);
});

test('o HTML da tela é inerte: sem tag ativa, sem atributo vindo do texto, sem link nem imagem', () => {
  // além do Markdown do engine (já mascarado), o hostil CRU: mascarar é do engine, ser
  // inerte é daqui, e o renderizador não pode depender de quem o alimenta
  const html = diagnosticoHtml(diagnosticoMarkdown(engine) + '\n' + MALICIOSO.replace(TOKEN, 'sem-segredo-aqui') + '\n[x](https://a.example) ![y](https://b.example/y.png)');
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.doesNotMatch(html, /<a[\s>]/i);
  assert.doesNotMatch(html, /<[^>]*\s(?:src|href|on\w+)\s*=/i);
  const tags = [...html.matchAll(/<\/?([a-z0-9]+)/gi)].map((m) => m[1].toLowerCase());
  const permitidas = new Set(['h2', 'h3', 'h4', 'p', 'ul', 'li', 'pre', 'code']);
  assert.deepEqual(tags.filter((t) => !permitidas.has(t)), []);
  assert.equal(html.includes(TOKEN), false);
});

test('o HTML mostra o conteúdo das cercas como texto e os títulos como título', () => {
  const html = diagnosticoHtml('# Título\n\n- item com `código`\n\n```text\n<b>cru</b>\n```');
  assert.match(html, /<h3>Título<\/h3>/);
  assert.match(html, /<li>item com <code>código<\/code><\/li>/);
  assert.match(html, /<pre>&lt;b&gt;cru&lt;\/b&gt;<\/pre>/);
});

test('cerca sem fechamento ainda sai como bloco de texto', () => {
  assert.match(diagnosticoHtml('```\n<i>solto</i>'), /<pre>&lt;i&gt;solto&lt;\/i&gt;<\/pre>/);
});

test('GET /api/diagnostics devolve o Markdown já mascarado, e visualizar não executa nada', async () => {
  let sessoes = 0;
  engine.runClaudeStream = async () => { sessoes++; return { text: '' }; };
  const corpo = await new Promise((resolve, reject) => {
    http.get(`${base}/api/diagnostics`, { headers: { 'x-farol': '1' } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) }));
    }).on('error', reject);
  });
  assert.equal(corpo.status, 200);
  assert.equal(corpo.body.ok, true);
  assert.match(corpo.body.markdown, /^# Diagnóstico do Farol$/m);
  assert.equal(corpo.body.markdown.includes(TOKEN), false);
  assert.equal(sessoes, 0);
});
