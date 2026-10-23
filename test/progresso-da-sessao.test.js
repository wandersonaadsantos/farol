// Andamento observável: tempo e eventos não são conclusão da análise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempoTipico, faixaDe, MIN_AMOSTRAS, etapasComTamanho, anotarEstimativa } from '../lib/engine/estimativa-sessao.js';
import { progressoDaSessao, conclusaoDaSessao, sessionCardHtml, SEM_SINAL_MS } from '../ui/pure/sessao.js';
import { materializarNaSessao } from '../lib/engine/pr-scope.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MIN = 60000;
const dec = (totalMs, arquivos) => ({ stages: { totalMs, stages: [], ...(arquivos ? { arquivos } : {}) } });

test('tempo típico: mediana das revisões do mesmo tamanho quando há amostra suficiente', () => {
  const hist = [
    ...[2, 3, 4, 5, 6].map(m => dec(m * MIN, 2)),
    ...[20, 30, 40, 50, 60].map(m => dec(m * MIN, 50)),
  ];
  assert.deepEqual(tempoTipico(hist, 3), { tipicoMs: 4 * MIN, amostras: 5, base: 'tamanho' });
  assert.deepEqual(tempoTipico(hist, 45), { tipicoMs: 40 * MIN, amostras: 5, base: 'tamanho' });
});

test('tempo típico: sem amostra do tamanho, cai na mediana geral (decisão antiga sem tamanho conta aí)', () => {
  const hist = [1, 2, 3, 4, 5, 6].map(m => dec(m * MIN));
  const est = tempoTipico(hist, 12);
  assert.equal(est.base, 'geral');
  assert.equal(est.amostras, 6);
  assert.equal(est.tipicoMs, Math.round(3.5 * MIN));
});

test('tempo típico: sem base suficiente não inventa número', () => {
  const hist = Array.from({ length: MIN_AMOSTRAS - 1 }, () => dec(5 * MIN, 2));
  assert.equal(tempoTipico(hist, 2), null);
  assert.equal(tempoTipico(undefined, 2), null);
});

test('tempo típico: sessão curtíssima (stub, cancelamento cedo) não entra na conta', () => {
  const hist = [...Array.from({ length: 10 }, () => dec(1000, 2)), ...[4, 5, 6, 7, 8].map(m => dec(m * MIN, 2))];
  assert.equal(tempoTipico(hist, 2).tipicoMs, 6 * MIN);
});

test('faixas de tamanho: sem medição não há faixa', () => {
  assert.equal(faixaDe(0), -1);
  assert.equal(faixaDe(undefined), -1);
  assert.equal(faixaDe(3), 0);
  assert.equal(faixaDe(4), 1);
  assert.equal(faixaDe(500), 3);
});

test('a estimativa e o tamanho chegam ao registro da sessão e às etapas da decisão', () => {
  const rec = { startedAt: Date.now() - 2 * MIN };
  const engine = {
    activeReviews: new Map([['a1', rec]]),
    activity: new Map([['a1', [{ t: Date.now() - MIN, k: 'tool', s: 'leitura', text: 'Read' }]]]),
    decisions: { resolved: [2, 3, 4, 5, 6].map(m => dec(m * MIN, 8)) },
  };
  anotarEstimativa(engine, 'a1', { changedFiles: 8, lines: 300 });
  assert.equal(rec.estimativa.base, 'tamanho');
  assert.equal(rec.arquivosPr, 8);
  const st = etapasComTamanho(engine, 'a1', { changedFiles: 8, lines: 300 });
  assert.equal(st.arquivos, 8);
  assert.equal(st.linhas, 300);
  assert.ok(st.totalMs > 0);
});

test('autoanálise: o escopo materializado carimba o total de arquivos na sessão', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-escopo-'));
  const rec = {};
  materializarNaSessao(rec, raiz, [{ path: 'a.js', patch: '+x' }, { path: 'b/c.js', patch: '+y' }]);
  assert.equal(rec.totalArquivos, 2);
  fs.rmSync(raiz, { recursive: true, force: true });
});

const t0 = 1000;
const viva = (min, extra = {}) => ({ startedAt: t0, fase: 'modelo', ultimoSinalEm: t0 + min * MIN, ...extra });
const est = { tipicoMs: 6 * MIN, amostras: 32, base: 'tamanho' };

test('tempo, histórico e etapas não produzem percentual de conclusão', () => {
  for (const minutos of [0, 3, 6, 20]) {
    const p = progressoDaSessao(viva(minutos, { estimativa: est }), [{ id: 'verificacao', label: 'verificação', state: 'active' }], t0 + minutos * MIN);
    assert.equal(p.pct, null);
    assert.equal(p.texto, 'verificação');
    assert.match(p.base, /típico: 6,0 min/);
    assert.doesNotMatch(p.texto + p.aria, /%|restante/);
  }
});
test('sem histórico ou evento, preparação e andamento permanecem explícitos', () => {
  assert.equal(progressoDaSessao({ startedAt: t0 }).texto, 'preparando');
  const p = progressoDaSessao(viva(1), [], t0 + MIN);
  assert.equal(p.pct, null); assert.match(p.base, /sem histórico/);
});
test('fração de leitura usa só denominador observado, sem confundir com conclusão', () => {
  const p = progressoDaSessao(viva(1, { lidos: 12, totalArquivos: 20 }), [], t0 + MIN);
  assert.equal(p.pct, 60); assert.match(p.texto, /12 de 20 arquivos declarados lidos/);
  assert.match(p.base, /não de conclusão/);
  assert.equal(progressoDaSessao(viva(1, { lidos: 100, totalArquivos: 20 }), [], t0 + MIN).pct, 100);
  assert.equal(progressoDaSessao(viva(1, { totalArquivos: -1 }), [], t0 + MIN).pct, null);
});
test('fechamento não promete porcentagem; conclusão real tem estado separado', () => {
  const p = progressoDaSessao({ fase: 'fechando' }); assert.equal(p.pct, null); assert.match(p.texto, /verificando e decidindo/);
  assert.deepEqual(conclusaoDaSessao({ startedAt: t0 }, t0 + 6 * MIN + 12000), { pct: null, estado: 'encerrada', texto: 'sessão encerrada', base: 'em 6min 12s · consulte o resultado da revisão', aria: 'sessão encerrada, consulte o resultado da revisão' });
});
test('silêncio não inventa progresso e informa duração', () => {
  const p = progressoDaSessao(viva(1), [], t0 + MIN + SEM_SINAL_MS + 5000);
  assert.equal(p.estado, 'muda'); assert.equal(p.pct, null); assert.equal(p.texto, 'sem sinal há 50s');
  assert.match(p.aria, /conclusão não medida/);
});
test('cartão nasce sem percentual determinado e tem equipe acessível', () => {
  const html = sessionCardHtml({ id: 'a1', label: 'Revisão', startedAt: t0 });
  assert.match(html, /role="progressbar"/); assert.doesNotMatch(html, /aria-valuenow=/);
  assert.match(html, /Conclusão não medida/); assert.match(html, /Equipe da sessão/);
});
