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
const { avisoDaBase } = await import('../lib/engine/aviso-da-base.js');
const { avisoDaBaseNoCard, idadeDoAviso } = await import('../ui/pure.js');

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
  assert.deepEqual(r, {
    veredito: 'superado', total: 2, iguais: 1, contidos: 1, pendentes: [],
    arquivos: { iguais: ['.ci/script.sh'], contidos: ['pnpm-lock.yaml'] },
  });
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
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ data: { search: { nodes: estadoGh.numeros.map(number => ({
      number, ...noDaBusca(), baseRefName: 'staging',
      baseRefOid: estadoGh.baseOid, headRefOid: 'h1', repository: { nameWithOwner: 'acme/app' },
    })) } } }) };
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
    myPRs: estadoGh.numeros.map(n => ({ key: `acme/app#${n}`, repo: 'acme/app', url: `https://github.com/acme/app/pull/${n}` })),
    accountForPr: () => 'eu', tokenFor: () => 'tok', ghEnv: () => ({}),
    log: () => { }, emit: (nome, dado) => avisos.push([nome, dado]),
  };
  return { e, avisos };
}

beforeEach(() => {
  chamadas = { busca: 0, compare: 0, objetos: 0 };
  estadoGh = { baseOid: 'b1', buscaFalha: false, atrasDaBase: 4, numeros: [1] };
  noDaBusca = () => ({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  io.run = async (_cmd, args) => responder(args || []);
});

test('um ciclo: uma busca por conta, o PR fica marcado como superado e avisa uma vez', async () => {
  const { e, avisos } = motor();
  await refreshBaseDosMeusPRs(e);
  assert.equal(chamadas.busca, 1);
  const info = e.baseDosMeusPRs['acme/app#1'];
  assert.equal(info.superado.veredito, 'superado');
  assert.deepEqual(info.superado.arquivos, { iguais: ['a.sh'], contidos: ['pnpm-lock.yaml'] });
  assert.equal(info.base, 'staging');
  // um evento só, estruturado: o toast da tela e a notificação do sistema leem o mesmo
  assert.deepEqual(avisos.map(([n]) => n), ['meu-pr-base']);
  assert.equal(avisos[0][1].titulo, 'PR superado pela base');
  assert.equal(avisos[0][1].url, 'https://github.com/acme/app/pull/1');
  await refreshBaseDosMeusPRs(e);
  assert.equal(avisos.length, 1, 'o mesmo estado no mesmo head não avisa de novo');
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
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][1].titulo, 'PR em conflito');
  assert.match(avisos[0][1].corpo, /^acme\/app#1: em conflito com staging/);
});

test('dois PRs no mesmo ciclo (o caso de reabrir o app): um aviso só, agrupado', async () => {
  estadoGh.numeros = [1, 2];
  const { e, avisos } = motor();
  await refreshBaseDosMeusPRs(e);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0][1].titulo, '2 PRs seus precisam de você por causa da base');
  assert.equal(avisos[0][1].itens.length, 2);
});

test('sem conflito e entregando: nada a avisar', async () => {
  estadoGh.atrasDaBase = 0;
  noDaBusca = () => ({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
  const { e, avisos } = motor();
  await refreshBaseDosMeusPRs(e);
  assert.equal(e.baseDosMeusPRs['acme/app#1'].conflito, false);
  assert.deepEqual(avisos, []);
});

test('busca que falha preserva o último aviso e diz por quê', async () => {
  const { e } = motor();
  await refreshBaseDosMeusPRs(e);
  assert.equal(e.baseDosMeusPRs['acme/app#1'].falha, undefined);
  estadoGh.buscaFalha = true;
  await refreshBaseDosMeusPRs(e);
  const info = e.baseDosMeusPRs['acme/app#1'];
  assert.equal(info.superado.veredito, 'superado');
  assert.deepEqual(info.falha, { motivo: 'gh', conta: 'eu' });
  estadoGh.buscaFalha = false;
  await refreshBaseDosMeusPRs(e);
  assert.equal(e.baseDosMeusPRs['acme/app#1'].falha, undefined, 'a leitura que volta tira o motivo');
});

test('token que some depois do primeiro ciclo: motivo sem-token, sem chamar o gh', async () => {
  const { e } = motor();
  await refreshBaseDosMeusPRs(e);
  const antes = chamadas.busca;
  e.tokenFor = () => '';
  await refreshBaseDosMeusPRs(e);
  assert.equal(chamadas.busca, antes);
  assert.deepEqual(e.baseDosMeusPRs['acme/app#1'].falha, { motivo: 'sem-token', conta: 'eu' });
});

test('conta sem token desde o início: nada a mostrar, e o gh não é chamado', async () => {
  const { e } = motor();
  e.tokenFor = () => '';
  await refreshBaseDosMeusPRs(e);
  assert.equal(chamadas.busca, 0);
  assert.deepEqual(e.baseDosMeusPRs, {});
});

// --- os textos do toast e da notificação (lib/engine/aviso-da-base.js) ----------------------

const SUP = { key: 'acme-exemplo/app#57', url: 'https://github.com/acme-exemplo/app/pull/57', estado: 'superado', base: 'staging' };
const CONF = { key: 'acme-exemplo/web#12', url: 'https://github.com/acme-exemplo/web/pull/12', estado: 'conflito', base: 'develop' };

test('aviso de um PR: título sem "Farol", corpo com a chave inteira', () => {
  const a = avisoDaBase([SUP]);
  assert.equal(a.titulo, 'PR superado pela base');
  assert.equal(a.tituloSistema, 'PR superado pela base');
  assert.equal(a.corpo, 'acme-exemplo/app#57: tudo o que ele muda já está em staging. Não sobrou nada para entregar, dá para fechar sem merge.');
  assert.equal(avisoDaBase([CONF]).corpo, 'acme-exemplo/web#12: em conflito com develop. Atualize a branch antes do merge.');
});

test('aviso agrupado: chave curta, toast diz o que fazer, notificação em uma linha', () => {
  const a = avisoDaBase([SUP, CONF]);
  assert.equal(a.titulo, '2 PRs seus precisam de você por causa da base');
  assert.equal(a.tituloSistema, '2 PRs precisam de você por causa da base');
  assert.equal(a.corpo, 'app#57 superado pela base; web#12 em conflito com develop.');
  assert.deepEqual(a.itens.map(i => i.texto), ['app#57 superado pela base, dá para fechar', 'web#12 em conflito com develop']);
  assert.equal(avisoDaBase([]), null);
});

// --- o card (ui/pure/meus-prs-base.js) ------------------------------------------------------

const PR = { key: 'acme-exemplo/app#57', url: 'https://github.com/acme-exemplo/app/pull/57' };

test('card superado: selo cheio, prova contada, lista de arquivos e o link que só abre o PR', () => {
  const c = avisoDaBaseNoCard({ base: 'staging', conflito: true, superado: { veredito: 'superado', total: 7, iguais: 5, contidos: 2, arquivos: { iguais: ['a.ts'], contidos: ['package.json'] } } }, PR);
  assert.equal(c.alerta, true);
  assert.match(c.selo, /base-superado">Superado pela base/);
  assert.doesNotMatch(c.selo, /Em conflito/, 'superado vence conflito');
  assert.match(c.html, /Nada para entregar: tudo o que este PR muda já está em <code>staging<\/code>\./);
  assert.match(c.html, /dos 7 arquivos que ele muda, 5 estão idênticos em <code>staging<\/code> e 2 têm todas as linhas dele, mais mudanças da própria base\./);
  assert.match(c.html, /O conflito com <code>staging<\/code> não precisa ser resolvido\./);
  assert.match(c.html, /Ver os 7 arquivos/);
  assert.match(c.html, /e mais 4 arquivos/, 'a lista cortada diz quantos faltam');
  assert.match(c.html, /href="https:\/\/github\.com\/acme-exemplo\/app\/pull\/57" target="_blank" rel="noopener">Fechar no GitHub/);
});

test('card superado sem nomes: a contagem basta e a lista não aparece; singular e só um grupo', () => {
  const c = avisoDaBaseNoCard({ base: 'main', conflito: false, superado: { veredito: 'superado', total: 3, iguais: 3, contidos: 0 } }, PR);
  assert.doesNotMatch(c.html, /<details/);
  assert.match(c.html, /os 3 arquivos que ele muda estão idênticos em <code>main<\/code>\./);
  assert.doesNotMatch(c.html, /não precisa ser resolvido/);
  const um = avisoDaBaseNoCard({ base: 'main', superado: { veredito: 'superado', total: 1, iguais: 0, contidos: 1 } }, PR);
  assert.match(um.html, /o arquivo que ele muda tem todas as linhas dele em <code>main<\/code>/);
});

test('card em conflito: linha com a base, o que fazer, o que já está igual e o id do aviso', () => {
  const c = avisoDaBaseNoCard({ base: 'main', conflito: true, superado: { veredito: 'nao', total: 4, iguais: 1, contidos: 0 } }, PR);
  assert.match(c.selo, /base-conflito">Em conflito/);
  assert.match(c.html, /<b>Em conflito com <code>main<\/code>\.<\/b> Atualize a branch antes do merge\./);
  assert.match(c.html, /1 dos 4 arquivos que ele muda já está igual em <code>main<\/code>\./);
  assert.equal(c.id, 'base-acme-exemplo-app-57');
  assert.match(c.html, /id="base-acme-exemplo-app-57"/);
  const varios = avisoDaBaseNoCard({ base: 'main', conflito: true, superado: { veredito: 'nao', total: 7, iguais: 2, contidos: 1 } }, PR);
  assert.match(varios.html, /3 dos 7 arquivos que ele muda já estão iguais/);
});

test('inconclusivo aparece como conflito simples, sem frase sobre a base', () => {
  const c = avisoDaBaseNoCard({ base: 'main', conflito: true, superado: { veredito: 'inconclusivo', total: 4, iguais: 3, contidos: 0 } }, PR);
  assert.match(c.selo, /Em conflito/);
  assert.doesNotMatch(c.html, /já est/);
});

test('leitura que falhou: o último aviso fica, com a idade e o motivo', () => {
  const agora = Date.UTC(2026, 9, 10, 12, 0);
  const at = agora - 20 * 60 * 1000;
  const sem = avisoDaBaseNoCard({ base: 'main', conflito: true, at, falha: { motivo: 'sem-token', conta: 'ana-exemplo' } }, PR, agora);
  assert.match(sem.html, /Visto há 20 min\. A leitura de agora falhou: .*ana-exemplo.* está sem token\./);
  // comparação exata do href, não regex: o que se prova é o destino inteiro do link
  assert.ok(sem.html.includes('href="https://github.com/ana-exemplo"'), 'a conta é menção navegável');
  const gh = avisoDaBaseNoCard({ base: 'main', conflito: true, at, falha: { motivo: 'gh' } }, PR, agora);
  assert.match(gh.html, /Visto há 20 min\. A leitura de agora falhou no GitHub\./);
});

test('idade do aviso: minuto, hora, dia', () => {
  const agora = 10 * 24 * 3600 * 1000;
  assert.equal(idadeDoAviso(agora - 10 * 1000, agora), '1 min');
  assert.equal(idadeDoAviso(agora - 2 * 3600 * 1000, agora), '2 h');
  assert.equal(idadeDoAviso(agora - 24 * 3600 * 1000, agora), '1 dia');
  assert.equal(idadeDoAviso(agora - 3 * 24 * 3600 * 1000, agora), '3 dias');
});

test('card sem aviso: o caso comum não ganha nada; HTML da base é escapado', () => {
  assert.deepEqual(avisoDaBaseNoCard(undefined, PR), { alerta: false, selo: '', html: '', id: '', conflito: false });
  assert.equal(avisoDaBaseNoCard({ base: 'main', conflito: false, superado: { veredito: 'nao', total: 3, iguais: 0, contidos: 0 } }, PR).html, '');
  assert.doesNotMatch(avisoDaBaseNoCard({ base: '<b>x</b>', conflito: true }, PR).html, /<b>x/);
});
