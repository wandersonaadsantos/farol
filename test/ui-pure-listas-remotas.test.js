// Panorama e Meus PRs de outros aparelhos, e o nome do PR na visão compartilhada: a parte
// PURA da tela (ui/pure/listas-remotas.js e ui/pure/pr-compartilhado.js).
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estadoDasListas, estadoDoEscopo, mesclarListaRemota, panoramaRemotoHtml, meusPrsRemotoHtml,
  prIdentificadoHtml, pendenciasCompartilhadasHtml, operacoesRemotasHtml,
} from '../ui/pure.js';

const AGORA = Date.UTC(2026, 8, 16, 13, 0, 0);
const LIMITE = 180000;
const SYNC = { shared: true, bloqueioCompartilhamento: '', deviceId: 'dB' };

function linha(key, extra = {}) {
  return { key, url: `https://github.com/${key.replace('#', '/pull/')}`, title: `Título de ${key}`, author: 'ana', repo: key.split('#')[0], number: Number(key.split('#')[1]), isDraft: false, u: AGORA - 60000, account: 'alice', somenteLeitura: false, ...extra };
}

function escopo(tipo, linhas, extra = {}) {
  return { tipo, account: 'alice', dev: 'dA', aparelho: 'Notebook', estado: 'ok', lidoEm: AGORA - 5000, falhaEm: 0, confirmadoAte: AGORA + 600000, naoAbriram: 0, linhas, ...extra };
}

function listas(escopos, extra = {}) {
  return { ok: true, estado: 'ligada', limiteMs: LIMITE, escopos, ...extra };
}

/* ---------- estados ---------- */

test('estado geral: desligada, bloqueada, aguardando, indisponível e ligada são distintos', () => {
  assert.equal(estadoDasListas(listas([]), { shared: false }).estado, 'desligada');
  assert.equal(estadoDasListas(listas([]), { shared: true, bloqueioCompartilhamento: 'autenticacao-local' }).estado, 'bloqueada');
  assert.equal(estadoDasListas(null, SYNC).estado, 'aguardando');
  assert.equal(estadoDasListas(listas([], { estado: 'sem-frota' }), SYNC).estado, 'indisponivel');
  assert.equal(estadoDasListas(listas([], { estado: 'sem-chave' }), SYNC).estado, 'indisponivel');
  assert.equal(estadoDasListas(listas([]), SYNC).estado, 'ligada');
  const textos = new Set(['desligada', 'bloqueada', 'aguardando'].map((e) => estadoDasListas(e === 'aguardando' ? null : listas([]), e === 'desligada' ? { shared: false } : { shared: true, bloqueioCompartilhamento: e === 'bloqueada' ? 'x' : '' }).texto));
  assert.equal(textos.size, 3, 'cada estado tem a própria frase');
  assert.match(estadoDasListas(listas([], { estado: 'sem-frota' }), SYNC).texto, /nenhum outro aparelho/i);
  assert.match(estadoDasListas(listas([], { estado: 'sem-chave' }), SYNC).texto, /chave/);
});

test('estado do escopo: falhou, desatualizado pela leitura e pelo publicador, ok', () => {
  assert.equal(estadoDoEscopo(escopo('panorama', []), LIMITE, AGORA), 'ok');
  assert.equal(estadoDoEscopo(escopo('panorama', [], { estado: 'falhou', falhaEm: AGORA - 1000 }), LIMITE, AGORA), 'falhou');
  assert.equal(estadoDoEscopo(escopo('panorama', [], { lidoEm: AGORA - LIMITE - 1 }), LIMITE, AGORA), 'desatualizado');
  assert.equal(estadoDoEscopo(escopo('panorama', [], { lidoEm: AGORA - LIMITE }), LIMITE, AGORA), 'ok', 'no limite ainda vale');
  assert.equal(estadoDoEscopo(escopo('panorama', [], { confirmadoAte: AGORA }), LIMITE, AGORA), 'desatualizado', 'publicador que parou de confirmar');
  assert.equal(estadoDoEscopo(escopo('panorama', [], { estado: 'local' }), LIMITE, AGORA), 'local');
});

/* ---------- mescla: origem, dedup, filtro ---------- */

test('o PR visto aqui fica com a origem deste aparelho e não conta dobrado', () => {
  const m = mesclarListaRemota([{ key: 'Acme/App#1' }], listas([escopo('panorama', [linha('acme/app#1'), linha('acme/app#2')])]), 'panorama', { sync: SYNC, agora: AGORA });
  assert.deepEqual(m.remotas.map((l) => l.key), ['acme/app#2']);
  assert.equal(m.remotas[0].aparelho, 'Notebook');
  assert.equal(m.remotas[0].dev, 'dA');
  assert.equal(m.deste, 1);
  assert.equal(m.total, 2);
  assert.equal(m.outros, 1);
});

test('o mesmo PR em dois escopos remotos aparece uma vez', () => {
  const a = escopo('panorama', [linha('acme/app#2', { u: AGORA - 1000 })]);
  const b = escopo('panorama', [linha('acme/app#2', { u: AGORA - 9000, account: 'bob' })], { account: 'bob', dev: 'dC', aparelho: 'Celular' });
  const m = mesclarListaRemota([], listas([a, b]), 'panorama', { sync: SYNC, agora: AGORA });
  assert.equal(m.remotas.length, 1);
  assert.equal(m.remotas[0].aparelho, 'Notebook', 'vale a linha mais recente');
  assert.equal(m.total, 1);
});

test('o filtro da aba vale para as linhas remotas', () => {
  const doBob = escopo('panorama', [linha('acme/app#5', { account: 'bob' })], { account: 'bob' });
  const daAlice = escopo('panorama', [linha('acme/app#2')]);
  const soAlice = (pr) => pr.account === 'alice';
  const m = mesclarListaRemota([], listas([doBob, daAlice]), 'panorama', { sync: SYNC, agora: AGORA, filtro: soAlice });
  assert.deepEqual(m.remotas.map((l) => l.key), ['acme/app#2']);
  assert.equal(m.total, 1, 'a contagem também respeita o filtro');
});

test('só as linhas do tipo pedido entram', () => {
  const m = mesclarListaRemota([], listas([escopo('myPrs', [linha('acme/app#3', { somenteLeitura: true })]), escopo('panorama', [linha('acme/app#2')])]), 'myPrs', { sync: SYNC, agora: AGORA });
  assert.deepEqual(m.remotas.map((l) => l.key), ['acme/app#3']);
});

test('visão desligada, bloqueada ou indisponível não mostra linha remota guardada', () => {
  const guardadas = listas([escopo('panorama', [linha('acme/app#2')])]);
  for (const sync of [{ shared: false }, { shared: true, bloqueioCompartilhamento: 'x' }]) {
    const m = mesclarListaRemota([], guardadas, 'panorama', { sync, agora: AGORA });
    assert.deepEqual(m.remotas, []);
  }
  const semFrota = mesclarListaRemota([], { ...guardadas, estado: 'sem-frota' }, 'panorama', { sync: SYNC, agora: AGORA });
  assert.deepEqual(semFrota.remotas, []);
  assert.equal(semFrota.geral.estado, 'indisponivel');
});

test('avisos por escopo: falhou mantém as linhas e diz as duas horas; desatualizado diz a idade', () => {
  const falhou = escopo('panorama', [linha('acme/app#2')], { estado: 'falhou', falhaEm: AGORA - 2000, lidoEm: AGORA - 400000 });
  const m = mesclarListaRemota([], listas([falhou]), 'panorama', { sync: SYNC, agora: AGORA });
  assert.equal(m.remotas.length, 1, 'a visão anterior continua');
  assert.equal(m.avisos[0].estado, 'falhou');
  assert.match(m.avisos[0].texto, /falhou às 09:59/);
  assert.match(m.avisos[0].texto, /09:53/);
  const velho = escopo('panorama', [linha('acme/app#2')], { lidoEm: AGORA - LIMITE - 60000 });
  const mv = mesclarListaRemota([], listas([velho]), 'panorama', { sync: SYNC, agora: AGORA });
  assert.equal(mv.avisos[0].estado, 'desatualizado');
  assert.notEqual(mv.avisos[0].texto, m.avisos[0].texto);
  const parado = escopo('panorama', [linha('acme/app#2')], { confirmadoAte: AGORA - 1000 });
  assert.match(mesclarListaRemota([], listas([parado]), 'panorama', { sync: SYNC, agora: AGORA }).avisos[0].texto, /Notebook não confirma/);
  const bom = mesclarListaRemota([], listas([escopo('panorama', [linha('acme/app#2')])]), 'panorama', { sync: SYNC, agora: AGORA });
  assert.deepEqual(bom.avisos, []);
});

test('os que não abriram são somados', () => {
  const m = mesclarListaRemota([], listas([escopo('panorama', [], { naoAbriram: 2 }), escopo('panorama', [], { naoAbriram: 1, account: 'bob' })]), 'panorama', { sync: SYNC, agora: AGORA });
  assert.equal(m.naoAbriram, 3);
});

/* ---------- HTML ---------- */

test('linha remota do Panorama: menção navegável, origem, hora e nenhuma ação', () => {
  const m = mesclarListaRemota([{ key: 'acme/app#1' }, { key: 'acme/app#9' }], listas([escopo('panorama', [linha('acme/app#2', { isDraft: true })])]), 'panorama', { sync: SYNC, agora: AGORA });
  const html = panoramaRemotoHtml(m, { agora: AGORA });
  assert.match(html, /3 PRs: 2 deste aparelho e 1 de 1 outro/);
  assert.match(html, /pr-ref-mention[^>]*href="https:\/\/github\.com\/acme\/app\/pull\/2"/);
  assert.match(html, /person-mention[^>]*href="https:\/\/github\.com\/ana"/);
  assert.match(html, />Notebook</);
  assert.match(html, /atualizado 09:59/);
  assert.match(html, /rascunho/);
  assert.match(html, /só leitura/);
  assert.doesNotMatch(html, /<button/, 'nenhum botão em linha de outro aparelho');
});

test('sem linha remota e sem aviso, o bloco some; com estado, ele diz o estado', () => {
  assert.equal(panoramaRemotoHtml(mesclarListaRemota([], listas([]), 'panorama', { sync: SYNC, agora: AGORA }), { agora: AGORA }), '');
  assert.equal(panoramaRemotoHtml(mesclarListaRemota([], listas([]), 'panorama', { sync: { shared: false }, agora: AGORA }), { agora: AGORA }), '', 'desligada não polui a aba');
  const bloqueada = panoramaRemotoHtml(mesclarListaRemota([], listas([]), 'panorama', { sync: { shared: true, bloqueioCompartilhamento: 'x' }, agora: AGORA }), { agora: AGORA });
  assert.match(bloqueada, /bloque/);
  const semFrota = panoramaRemotoHtml(mesclarListaRemota([], listas([], { estado: 'sem-frota' }), 'panorama', { sync: SYNC, agora: AGORA }), { agora: AGORA });
  assert.match(semFrota, /nenhum outro aparelho/i);
  const falhou = panoramaRemotoHtml(mesclarListaRemota([], listas([escopo('panorama', [linha('acme/app#2')], { estado: 'falhou', falhaEm: AGORA - 1000 })]), 'panorama', { sync: SYNC, agora: AGORA }), { agora: AGORA });
  assert.match(falhou, /leitura falhou/);
  const naoAbriu = panoramaRemotoHtml(mesclarListaRemota([], listas([escopo('panorama', [], { naoAbriram: 1 })]), 'panorama', { sync: SYNC, agora: AGORA }), { agora: AGORA });
  assert.match(naoAbriu, /1 item de outro aparelho não abriu e ficou de fora/);
});

test('texto vindo de outro aparelho é escapado', () => {
  const m = mesclarListaRemota([], listas([escopo('panorama', [linha('acme/app#2', { title: '<img src=x onerror=1>' })], { aparelho: '<b>x</b>' })]), 'panorama', { sync: SYNC, agora: AGORA });
  const html = panoramaRemotoHtml(m, { agora: AGORA });
  assert.doesNotMatch(html, /<img src=x|<b>x/);
  assert.match(html, /&lt;img src=x onerror=1&gt;/);
});

test('Meus PRs remoto: só leitura, merge desabilitado com o motivo, nenhum botão', () => {
  const m = mesclarListaRemota([], listas([escopo('myPrs', [linha('acme/app#36', { somenteLeitura: true, mergeable: 'MERGEABLE', headRefName: 'feat/x', baseRefName: 'main' })])]), 'myPrs', { sync: SYNC, agora: AGORA });
  const html = meusPrsRemotoHtml(m, { agora: AGORA });
  assert.match(html, /do Notebook, só leitura/);
  assert.match(html, /Merge desabilitado aqui: dado vindo de outro aparelho nunca habilita merge/);
  assert.match(html, /feat\/x/);
  assert.match(html, /pr-ref-mention/);
  assert.doesNotMatch(html, /<button/);
  assert.equal(meusPrsRemotoHtml(mesclarListaRemota([], listas([]), 'myPrs', { sync: SYNC, agora: AGORA }), { agora: AGORA }), '');
});

/* ---------- o nome do PR na visão compartilhada ---------- */

const PR = { key: 'acme/app#37', account: 'alice', title: 'Troca a <biblioteca>', author: 'ana' };

test('PR identificado vira menção, título e autor; sem identificação, rótulo genérico', () => {
  const html = prIdentificadoHtml(PR, 'um PR seu');
  assert.match(html, /pr-ref-mention[^>]*>acme\/app#37</);
  assert.match(html, /Troca a &lt;biblioteca&gt;/);
  assert.match(html, /person-mention[^>]*href="https:\/\/github\.com\/ana"/);
  for (const vazio of [null, undefined, {}, { key: '' }, { key: 'nao-e-pr' }]) {
    const g = prIdentificadoHtml(vazio, 'um PR seu');
    assert.match(g, /um PR seu/);
    assert.doesNotMatch(g, /pr-ref-mention|person-mention/);
  }
  assert.doesNotMatch(prIdentificadoHtml({ ...PR, author: '' }, 'x'), /person-mention/, 'sem autor não inventa menção');
});

test('a pendência mostra o PR quando vem identificado, e o genérico quando não', () => {
  const base = { itemId: 'ab', dev: 'dA', aparelho: 'Notebook', at: AGORA, visto: false, veredito: 'request_changes', motivos: [], bloqueio: '' };
  const com = pendenciasCompartilhadasHtml([{ ...base, pr: PR }], {});
  assert.match(com, /pr-ref-mention[^>]*>acme\/app#37</);
  assert.match(com, /no Notebook/);
  assert.doesNotMatch(com, /Um PR seu/);
  const sem = pendenciasCompartilhadasHtml([{ ...base, pr: null }, { ...base, itemId: 'cd' }], {});
  assert.equal((sem.match(/Um PR seu/g) || []).length, 2, 'null e ausente caem no mesmo rótulo');
  assert.doesNotMatch(sem, /pr-ref-mention/);
  assert.match(sem, /catálogo/, 'o genérico explica por que não há nome');
});

test('a operação remota mostra o PR quando vem identificado, e o genérico quando não', () => {
  const op = { opId: 'o1', dev: 'dA', aparelho: 'Notebook', etapa: 'leitura', msPorEtapa: {}, subagentes: [], tipo: 'review', prTag: 'a'.repeat(32) };
  assert.match(operacoesRemotasHtml([{ ...op, pr: PR }], {}), /pr-ref-mention[^>]*>acme\/app#37</);
  const sem = operacoesRemotasHtml([{ ...op, pr: null }, op], {});
  assert.equal((sem.match(/um PR seu/gi) || []).length, 2);
  assert.doesNotMatch(sem, /pr-ref-mention/);
});

test('a faixa do andamento diz a falha quando o engine a informa, e só a idade quando não', async () => {
  const { andamentoAtrasadoHtml } = await import('../ui/pure.js');
  const falhou = andamentoAtrasadoHtml(AGORA - 5000, AGORA, AGORA - 1000);
  assert.match(falhou, /A última leitura falhou às 09:59/);
  assert.match(falhou, /Mostrando o andamento de 09:59/);
  assert.match(andamentoAtrasadoHtml(0, AGORA, AGORA), /Nenhuma leitura anterior deu certo/);
  assert.equal(andamentoAtrasadoHtml(AGORA - 5000, AGORA), '', 'leitura recente e sem falha não mostra faixa');
  assert.match(andamentoAtrasadoHtml(AGORA - 60000, AGORA), /leitura atrasada/);
});

test('o envio mostra "lote N de M" com o número do engine', async () => {
  const { envioHistoricoHtml, envioDepoisDoLote } = await import('../ui/pure.js');
  const medida = { ok: true, categorias: { revisoes: 650 }, pendentes: 650, bytes: 10, impressao: 'i', lote: 1, lotes: 13 };
  assert.match(envioHistoricoHtml({ fase: 'enviando', medida, parcial: null }), /lote 1 de 13/);
  const depois = envioDepoisDoLote(medida, { ok: true, enviados: 50, restantes: 450, concluido: false, lote: 4, lotes: 13 }, { enviados: 150, restantes: 500 });
  assert.deepEqual([depois.parcial.lote, depois.parcial.lotes], [4, 13]);
  assert.match(envioHistoricoHtml(depois), /lote 4 de 13/);
  assert.match(envioHistoricoHtml(depois), /200 enviadas, 450 faltando/);
  const semNumero = envioDepoisDoLote(medida, { ok: true, enviados: 50, restantes: 450, concluido: false }, null);
  assert.doesNotMatch(envioHistoricoHtml(semNumero), /lote \d+ de/, 'sem o número do engine, a tela não inventa');
  assert.doesNotMatch(envioHistoricoHtml({ fase: 'enviando', medida: { ...medida, lote: 0, lotes: 0 }, parcial: null }), /lote \d+ de/);
});
