// Conflito e PR superado pela base em Meus PRs (10/10/2026).
//
// Caso que motivou: uma promoção ficou aberta e em conflito por 38 horas depois que outra
// promoção levou a mesma branch para a base. Os patches abaixo têm a forma do caso real (o
// compare devolveu sete arquivos: cinco idênticos na base e dois manifestos de dependência em
// que a base tinha as linhas do PR e mais coisa), e foi a forma conferida contra o GitHub antes
// deste teste existir.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-meus-base-'));

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const { superadoPelaBase, patchContidoNaBase, LIMITE_ARQUIVOS_DO_COMPARE } = await import('../lib/engine/superado-pela-base.js');
const { refreshBaseDosMeusPRs } = await import('../lib/engine/meus-prs-base.js');
const { notaDaBaseHtml } = await import('../ui/pure.js');

after(() => fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }));

const LOCK_PATCH = [
  '@@ -25,6 +25,7 @@ overrides:',
  '   moment: ^2.31.0',
  '+  proxy-addr: ^2.0.8',
  '@@ -3635,8 +3636,8 @@ packages:',
  '-  proxy-addr@2.0.7:',
  '+  proxy-addr@2.0.8:',
].join('\n');
const LOCK_NA_BASE = ['overrides:', '  moment: ^2.31.0', '  fast-copy: ^4.0.3', '  proxy-addr: ^2.0.8', 'packages:', '  proxy-addr@2.0.8:'].join('\n');

function base(blobs, textos = {}) {
  return { blobs: new Map(Object.entries(blobs)), textos: new Map(Object.entries(textos)) };
}

test('a forma do caso real: arquivos idênticos e manifesto com as linhas do PR viram superado', () => {
  const r = superadoPelaBase({
    atrasDaBase: 47,
    arquivos: [
      { filename: '.ci/script.sh', status: 'modified', sha: 's1', patch: '+x' },
      { filename: 'pnpm-lock.yaml', status: 'modified', sha: 'h-lock', patch: LOCK_PATCH },
    ],
  }, base({ '.ci/script.sh': 's1', 'pnpm-lock.yaml': 'b-lock' }, { 'pnpm-lock.yaml': LOCK_NA_BASE }));
  assert.deepEqual(r, { veredito: 'superado', total: 2, iguais: 1, contidos: 1, pendentes: [] });
});

test('base parada desde o ancestral comum nunca dá superado, mesmo com o arquivo igual nela', () => {
  // o arquivo igual na base faria a regra por arquivo dizer superado: quem responde aqui é o atalho
  const r = superadoPelaBase({ atrasDaBase: 0, arquivos: [{ filename: 'a.js', status: 'modified', sha: 's' }] }, base({ 'a.js': 's' }));
  assert.equal(r.veredito, 'nao');
});

test('uma linha do PR que a base não tem: o PR ainda entrega', () => {
  const r = superadoPelaBase({
    atrasDaBase: 3,
    arquivos: [{ filename: 'pnpm-lock.yaml', status: 'modified', sha: 'h', patch: `${LOCK_PATCH}\n+  algo-que-so-o-pr-tem: ^1.0.0` }],
  }, base({ 'pnpm-lock.yaml': 'b' }, { 'pnpm-lock.yaml': LOCK_NA_BASE }));
  assert.equal(r.veredito, 'nao');
  assert.deepEqual(r.pendentes, ['pnpm-lock.yaml']);
});

test('linha que o PR tira e a base ainda tem: o PR ainda entrega', () => {
  assert.equal(patchContidoNaBase('-  proxy-addr@2.0.7:\n+  proxy-addr@2.0.8:', '  proxy-addr@2.0.7:\n  proxy-addr@2.0.8:'), false);
});

test('linha curta não prova nada: patch só de chaves e parênteses é inconclusivo, nunca superado', () => {
  const r = superadoPelaBase({
    atrasDaBase: 2,
    arquivos: [{ filename: 'a.js', status: 'modified', sha: 'h', patch: '+  }\n-  });' }],
  }, base({ 'a.js': 'b' }, { 'a.js': '  }\n' }));
  assert.equal(r.veredito, 'inconclusivo');
});

test('linha que só mudou de lugar não conta como tirada', () => {
  assert.equal(patchContidoNaBase('-const valorComprido = 1;\n+const valorComprido = 1;', 'const valorComprido = 1;'), true);
});

test('sem patch (binário ou grande) e sem o conteúdo da base: inconclusivo', () => {
  const r = superadoPelaBase({ atrasDaBase: 1, arquivos: [{ filename: 'logo.png', status: 'modified', sha: 'h' }] }, base({ 'logo.png': 'b' }));
  assert.equal(r.veredito, 'inconclusivo');
});

test('arquivo que o PR apaga e a base ainda tem; arquivo novo que a base não tem: entrega', () => {
  assert.equal(superadoPelaBase({ atrasDaBase: 1, arquivos: [{ filename: 'velho.js', status: 'removed', sha: 'x' }] }, base({ 'velho.js': 'b' })).veredito, 'nao');
  assert.equal(superadoPelaBase({ atrasDaBase: 1, arquivos: [{ filename: 'velho.js', status: 'removed', sha: 'x' }] }, base({})).veredito, 'superado');
  assert.equal(superadoPelaBase({ atrasDaBase: 1, arquivos: [{ filename: 'novo.js', status: 'added', sha: 'n' }] }, base({})).veredito, 'nao');
});

test('renomeado com o nome antigo ainda na base: entrega', () => {
  const r = superadoPelaBase({ atrasDaBase: 1, arquivos: [{ filename: 'b.js', previous_filename: 'a.js', status: 'renamed', sha: 's' }] }, base({ 'a.js': 'x', 'b.js': 's' }));
  assert.equal(r.veredito, 'nao');
});

test('compare cortado no teto do GitHub: inconclusivo', () => {
  const arquivos = Array.from({ length: LIMITE_ARQUIVOS_DO_COMPARE }, (_, i) => ({ filename: `f${i}`, status: 'modified', sha: `s${i}` }));
  const blobs = Object.fromEntries(arquivos.map(f => [f.filename, f.sha]));
  assert.equal(superadoPelaBase({ atrasDaBase: 5, arquivos }, base(blobs)).veredito, 'inconclusivo');
});

// --- o ciclo: chamadas gh, cache pela dupla (head, base) e o aviso único --------------------

const runReal = io.run;
after(() => { io.run = runReal; });
let chamadas, estadoGh;

// o que a busca devolve sobre o PR: em conflito por padrão
let noDaBusca = () => ({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });

function responder(args) {
  const a = args.join(' ');
  if (a.includes('search(query')) {
    chamadas.busca++;
    if (estadoGh.buscaFalha) return { ok: false, code: 1, stdout: '', stderr: 'rede caiu' };
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ data: { search: { nodes: [{
      number: 1, ...noDaBusca(), baseRefName: 'staging',
      baseRefOid: estadoGh.baseOid, headRefOid: 'h1', repository: { nameWithOwner: 'acme/app' },
    }] } } }) };
  }
  if (a.includes('/compare/')) {
    chamadas.compare++;
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ atrasDaBase: estadoGh.atrasDaBase, arquivos: [
      { filename: 'a.sh', status: 'modified', sha: 'sa', patch: '+x' },
      { filename: 'pnpm-lock.yaml', status: 'modified', sha: 'h-lock', patch: LOCK_PATCH },
    ] }) };
  }
  if (a.includes('repository(owner')) {
    chamadas.objetos++;
    const comTexto = a.includes(' text ');
    const caminhos = args.filter(x => /^e\d+=/.test(x)).map(x => x.split(':').slice(1).join(':'));
    const repo = {};
    caminhos.forEach((c, k) => {
      const oid = c === 'a.sh' ? 'sa' : 'b-lock';
      repo[`f${k}`] = comTexto ? { oid, text: LOCK_NA_BASE, isBinary: false, isTruncated: false } : { oid };
    });
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ data: { repository: repo } }) };
  }
  return { ok: false, code: 1, stdout: '', stderr: `inesperado: ${a}` };
}

function motor() {
  const avisos = [];
  const e = {
    myPRs: [{ key: 'acme/app#1', repo: 'acme/app', url: 'https://github.com/acme/app/pull/1' }],
    accountForPr: () => 'eu', tokenFor: () => 'tok', ghEnv: () => ({}),
    log: () => { }, emit: (nome, dado) => avisos.push([nome, dado]),
  };
  return { e, avisos };
}

beforeEach(() => {
  chamadas = { busca: 0, compare: 0, objetos: 0 };
  estadoGh = { baseOid: 'b1', buscaFalha: false, atrasDaBase: 4 };
  noDaBusca = () => ({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  io.run = async (_cmd, args) => responder(args || []);
});

test('um ciclo: uma busca por conta, o PR fica marcado como superado e avisa uma vez', async () => {
  const { e, avisos } = motor();
  await refreshBaseDosMeusPRs(e);
  assert.equal(chamadas.busca, 1);
  const info = e.baseDosMeusPRs['acme/app#1'];
  assert.equal(info.superado.veredito, 'superado');
  assert.equal(info.base, 'staging');
  assert.deepEqual(avisos.map(([n]) => n), ['toast', 'meu-pr-base']);
  assert.equal(avisos[1][1].estado, 'superado');
  await refreshBaseDosMeusPRs(e);
  assert.equal(avisos.length, 2, 'o mesmo estado no mesmo head não avisa de novo');
});

test('mesma dupla (head, base) não confere de novo; base nova confere', async () => {
  const { e } = motor();
  await refreshBaseDosMeusPRs(e);
  const depoisDoPrimeiro = { ...chamadas };
  for (let i = 0; i < 5; i++) await refreshBaseDosMeusPRs(e);
  assert.equal(chamadas.compare, depoisDoPrimeiro.compare);
  assert.equal(chamadas.objetos, depoisDoPrimeiro.objetos);
  assert.equal(chamadas.busca, 6, 'só a busca roda a cada ciclo');
  estadoGh.baseOid = 'b2';
  await refreshBaseDosMeusPRs(e);
  assert.equal(chamadas.compare, depoisDoPrimeiro.compare + 1);
});

test('em conflito e ainda entregando: avisa o conflito, uma vez', async () => {
  estadoGh.atrasDaBase = 0;
  const { e, avisos } = motor();
  await refreshBaseDosMeusPRs(e);
  await refreshBaseDosMeusPRs(e);
  const info = e.baseDosMeusPRs['acme/app#1'];
  assert.equal(info.conflito, true);
  assert.equal(info.superado.veredito, 'nao');
  assert.equal(avisos.filter(([n]) => n === 'meu-pr-base').length, 1);
  assert.equal(avisos.find(([n]) => n === 'meu-pr-base')[1].estado, 'conflito');
  assert.match(avisos[0][1].text, /em conflito com staging/);
});

test('sem conflito e entregando: nada a avisar', async () => {
  estadoGh.atrasDaBase = 0;
  noDaBusca = () => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
  const { e, avisos } = motor();
  await refreshBaseDosMeusPRs(e);
  assert.equal(e.baseDosMeusPRs['acme/app#1'].conflito, false);
  assert.deepEqual(avisos, []);
});

test('busca que falha preserva o que se sabia do PR, não apaga a nota', async () => {
  const { e } = motor();
  await refreshBaseDosMeusPRs(e);
  estadoGh.buscaFalha = true;
  await refreshBaseDosMeusPRs(e);
  assert.equal(e.baseDosMeusPRs['acme/app#1'].superado.veredito, 'superado');
});

test('conta sem token não chama o gh', async () => {
  const { e } = motor();
  e.tokenFor = () => '';
  await refreshBaseDosMeusPRs(e);
  assert.equal(chamadas.busca, 0);
  assert.deepEqual(e.baseDosMeusPRs, {});
});

// --- a nota do card -----------------------------------------------------------------------

test('nota do card: superado diz o que fazer e como conferiu; conflito diz o que já está igual', () => {
  const sup = notaDaBaseHtml({ base: 'staging', conflito: true, superado: { veredito: 'superado', total: 7, iguais: 5, contidos: 2 } });
  assert.match(sup, /já está em <code>staging<\/code>/);
  assert.match(sup, /dá para fechar sem merge/);
  assert.match(sup, /5 arquivos idênticos e 2 arquivos com as mesmas linhas/);
  const conf = notaDaBaseHtml({ base: 'main', conflito: true, superado: { veredito: 'nao', total: 4, iguais: 1, contidos: 0 } });
  assert.match(conf, /Em conflito com <code>main<\/code>/);
  assert.match(conf, /1 dos 4 arquivos/);
});

test('nota do card: sem conflito e sem superado não aparece; base com HTML é escapada', () => {
  assert.equal(notaDaBaseHtml(undefined), '');
  assert.equal(notaDaBaseHtml({ base: 'main', conflito: false, superado: { veredito: 'nao', total: 3, iguais: 0, contidos: 0 } }), '');
  assert.doesNotMatch(notaDaBaseHtml({ base: '<b>x</b>', conflito: true }), /<b>/);
});
