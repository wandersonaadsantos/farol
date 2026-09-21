// "Ver relatório completo" fechava sozinho no meio da leitura (relato de 21/09/2026). As
// listas do Radar e de Meus PRs se redesenham por innerHTML a cada estado do SSE, e com uma
// revisão em andamento o estado chega a cada poucos segundos: todo <details> aberto voltava
// fechado. A correção segue a convenção de Entregas (openKeys em ui/pure/entregas.js): a
// tela guarda as chaves abertas num Set, um listener de `toggle` o mantém em dia, e o HTML
// sai com `open` a partir dele.
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';

instalarDom();
const P = await import('../ui/pure.js');
const { lembrarAbertos } = await import('../ui/telas/infra.js');

const AG = Date.parse('2026-09-21T15:00:00Z');
function linha(key, resolvedAt, extra) {
  return {
    key, status: 'auto_approved', action: 'approve', resolvedAt,
    pr: { url: `https://github.com/${key.replace('#', '/pull/')}`, title: 'Um PR', author: 'gabriel' },
    attention: [{ text: 'um ponto' }], reasons: [], reportMarkdown: '# relatório\n\ntexto longo',
    ...extra,
  };
}
const ctx = (openKeys) => ({ pushbacks: {}, chip: '', chatBadge: '', agora: AG, openKeys });
// o <details> de uma parte da linha, com os atributos da tag de abertura
function tagDe(html, classe) {
  const m = new RegExp(`<details class="${classe}"([^>]*)>`).exec(html);
  assert.ok(m, `a linha não tem o <details class="${classe}">`);
  return m[1];
}
const chaveDe = (attrs) => (/data-abre="([^"]*)"/.exec(attrs) || [])[1];
const aberto = (attrs) => /\sopen(\s|$)/.test(attrs);

test('o relatório que a pessoa abriu sai aberto no redesenho seguinte', () => {
  const r = linha('biudtech/biud-frontend#1087', AG - 60_000);
  const antes = P.resolvedRow(r, ctx(new Set()));
  const chave = chaveDe(tagDe(antes, 'dec-report'));
  assert.equal(aberto(tagDe(antes, 'dec-report')), false, 'nasce fechado');

  // o listener de toggle guardou a chave; o próximo estado do SSE redesenha a lista
  const depois = P.resolvedRow(r, ctx(new Set([chave])));
  assert.equal(aberto(tagDe(depois, 'dec-report')), true, 'o relatório voltou fechado');
  assert.equal(aberto(tagDe(depois, 'resolved-attn')), false, 'abrir o relatório abriu os motivos');
});

test('sem openKeys a linha sai como sempre saiu: tudo fechado', () => {
  const html = P.resolvedRow(linha('a/b#1', AG), { pushbacks: {}, chip: '', chatBadge: '', agora: AG });
  assert.equal(aberto(tagDe(html, 'dec-report')), false);
  assert.equal(aberto(tagDe(html, 'resolved-attn')), false);
});

test('motivos, relatório e pushback têm chaves próprias, e cada um abre sozinho', () => {
  const r = linha('a/b#1', AG);
  const html = P.resolvedRow(r, ctx(new Set()));
  const chaves = ['resolved-attn', 'dec-report', 'pushback'].map((c) => chaveDe(tagDe(html, c)));
  assert.equal(new Set(chaves).size, 3, `chaves repetidas: ${chaves.join(', ')}`);
  for (const [i, c] of ['resolved-attn', 'dec-report', 'pushback'].entries()) {
    const so = P.resolvedRow(r, ctx(new Set([chaves[i]])));
    assert.equal(aberto(tagDe(so, c)), true, `${c} não reabriu`);
    for (const outra of ['resolved-attn', 'dec-report', 'pushback'].filter((x) => x !== c)) {
      assert.equal(aberto(tagDe(so, outra)), false, `abrir ${c} abriu ${outra}`);
    }
  }
});

test('duas revisões do mesmo PR na lista são linhas diferentes', () => {
  const nova = linha('biudtech/biud-frontend#1087', AG - 60_000);
  const antiga = linha('biudtech/biud-frontend#1087', AG - 3_600_000);
  const chaveNova = chaveDe(tagDe(P.resolvedRow(nova, ctx(new Set())), 'dec-report'));
  const chaveAntiga = chaveDe(tagDe(P.resolvedRow(antiga, ctx(new Set())), 'dec-report'));
  assert.notEqual(chaveNova, chaveAntiga);
  assert.equal(aberto(tagDe(P.resolvedRow(antiga, ctx(new Set([chaveNova]))), 'dec-report')), false);
});

test('o pushback pendente continua abrindo sozinho, com ou sem a chave', () => {
  const r = linha('a/b#1', AG);
  const pendente = { 'a/b#1': { author: 'gabriel', outcome: 'author_right', status: 'pending', at: AG } };
  const html = P.resolvedRow(r, { ...ctx(new Set()), pushbacks: pendente });
  const attrs = tagDe(html, 'pushback');
  assert.equal(aberto(attrs), true);
  assert.match(attrs, /data-pending="1"/);
});

test('o listener guarda a chave quando abre e tira quando fecha, e ignora quem não tem chave', () => {
  let ouvinte = null;
  let captura = null;
  const box = { addEventListener(tipo, fn, cap) { assert.equal(tipo, 'toggle'); ouvinte = fn; captura = cap; } };
  const abertos = new Set();
  lembrarAbertos(box, abertos);
  assert.equal(captura, true, 'toggle não borbulha: sem captura o listener da lista nunca ouve');

  const det = { open: true, dataset: { abre: 'a/b#1@1|relatorio' } };
  ouvinte({ target: det });
  assert.deepEqual([...abertos], ['a/b#1@1|relatorio']);
  det.open = false;
  ouvinte({ target: det });
  assert.deepEqual([...abertos], []);
  ouvinte({ target: { open: true, dataset: {} } });
  ouvinte({ target: { open: true } });
  assert.deepEqual([...abertos], [], 'um <details> sem data-abre não é da conta deste Set');
});

test('as três listas que se redesenham a cada estado lembram o que foi aberto', () => {
  const ler = (f) => fs.readFileSync(path.join(import.meta.dirname, '..', 'ui', 'telas', f), 'utf8');
  const radar = ler('radar.js');
  const meus = ler('meus-prs.js');
  assert.match(radar, /lembrarAbertos\(\$\('#decisions'\), radarAbertos\)/);
  assert.match(radar, /lembrarAbertos\(\$\('#resolved'\), radarAbertos\)/);
  assert.match(radar, /openKeys: radarAbertos/, 'Revisões recentes não recebe as chaves abertas');
  assert.match(meus, /lembrarAbertos\(\$\('#myPRs'\), meusAbertos\)/);
  // todo "Ver relatório completo" desenhado pelas telas tem chave e lê o Set
  for (const [nome, fonte, conjunto] of [['radar.js', radar, 'radarAbertos'], ['meus-prs.js', meus, 'meusAbertos']]) {
    const relatorios = fonte.match(/<details class="dec-report"[^>]*>/g) || [];
    assert.ok(relatorios.length > 0, `${nome} não desenha relatório`);
    for (const tag of relatorios) {
      assert.match(tag, /data-abre=/, `${nome}: relatório sem chave`);
      assert.ok(tag.includes(`${conjunto}.has(`), `${nome}: relatório que não lê ${conjunto}`);
    }
  }
});
