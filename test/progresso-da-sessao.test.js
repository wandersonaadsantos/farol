// A barra do cartão "Analisando agora" volta a ter porcentagem, agora sobre dado real.
// Estes casos travam as duas mentiras das versões anteriores: estacionar em 90% e pular
// para 100% (régua por contagem de linhas), e prometer prazo sem base para isso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempoTipico, faixaDe, MIN_AMOSTRAS, etapasComTamanho, anotarEstimativa } from '../lib/engine/estimativa-sessao.js';
import { progressoDaSessao, conclusaoDaSessao, sessionCardHtml, PISO_VERIFICACAO, PCT_FECHANDO, SEM_SINAL_MS } from '../ui/pure/sessao.js';
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

test('progresso: anda em linha reta até o tempo típico e mostra quanto falta', () => {
  const p = progressoDaSessao(viva(3, { estimativa: est }), [], t0 + 3 * MIN);
  assert.equal(p.estado, 'viva');
  assert.equal(Math.floor(p.pct), 47);
  assert.equal(p.texto, '~3 min restantes');
  assert.equal(p.base, 'típico: 6,0 min em PR deste tamanho (32 revisões)');
  assert.equal(p.aria, '47%, cerca de 3 minutos restantes');
  const geral = progressoDaSessao(viva(3, { estimativa: { ...est, base: 'geral' } }), [], t0 + 3 * MIN);
  assert.equal(geral.base, 'típico: 6,0 min (mediana geral)');
  assert.equal(progressoDaSessao(viva(5.5, { estimativa: est }), [], t0 + 5.5 * MIN).texto, 'menos de 1 min');
});

// a reclamação de origem: a barra parava em 90% e depois pulava para 100%
test('progresso: depois do tempo típico continua subindo, nunca estaciona', () => {
  const pcts = [6, 8, 10, 14, 20].map(m => progressoDaSessao(viva(m, { estimativa: est }), [], t0 + m * MIN).pct);
  for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] > pcts[i - 1], `parou em ${pcts[i]}% (${pcts})`);
  assert.ok(pcts.at(-1) <= 95, 'passar do típico fica abaixo do piso do fechamento');
  const passou = progressoDaSessao(viva(9, { estimativa: est }), [], t0 + 9 * MIN);
  assert.equal(passou.texto, 'passou do tempo típico (~6 min)');
  assert.equal(passou.base, 'ainda trabalhando');
});

test('progresso: sem estimativa a barra anda, mas o texto não promete prazo', () => {
  const p = progressoDaSessao(viva(1), [], t0 + MIN);
  assert.ok(p.pct > 2);
  assert.equal(p.texto, 'em andamento');
  assert.equal(p.base, 'ainda sem histórico para estimar o tempo');
  assert.doesNotMatch(p.texto + p.base, /d+ min/);
});

test('progresso: antes do primeiro evento a sessão está preparando', () => {
  const p = progressoDaSessao({ startedAt: t0, fase: 'modelo', estimativa: est }, [], t0 + 4000);
  assert.equal(p.texto, 'preparando');
  assert.equal(p.base, 'aguardando o primeiro evento');
});

test('progresso: autoanálise usa os arquivos lidos sobre o total', () => {
  const p = progressoDaSessao(viva(0.1, { lidos: 12, totalArquivos: 20 }), [], t0 + 0.1 * MIN);
  assert.equal(p.texto, '12 de 20 arquivos lidos');
  assert.equal(Math.floor(p.pct), 51);
});

test('progresso: chegar à verificação é piso', () => {
  const flow = [{ id: 'leitura', state: 'done' }, { id: 'verificacao', state: 'active' }];
  assert.equal(progressoDaSessao(viva(0.5, { estimativa: est }), flow, t0 + 0.5 * MIN).pct, PISO_VERIFICACAO);
});

test('progresso: modelo concluiu é quase o fim, e 100% fica para o fim de verdade', () => {
  const p = progressoDaSessao({ startedAt: t0, fase: 'fechando' }, [], t0 + MIN);
  assert.equal(p.pct, PCT_FECHANDO);
  assert.equal(p.texto, 'modelo concluiu · decidindo e postando');
  const fim = conclusaoDaSessao({ startedAt: t0 }, t0 + 6 * MIN + 12000);
  assert.deepEqual(fim, { pct: 100, estado: 'concluida', texto: 'concluída', base: 'em 6min 12s', aria: '100%, concluída' });
});

test('progresso: stream mudo para a barra e avisa', () => {
  const s = { startedAt: t0, fase: 'modelo', ultimoSinalEm: t0 + MIN, estimativa: est };
  const p = progressoDaSessao(s, [], t0 + MIN + SEM_SINAL_MS + 5000);
  assert.equal(p.estado, 'muda');
  assert.equal(p.texto, 'sem sinal há 50s');
  assert.equal(p.base, 'a barra volta a andar quando chegar evento');
  const longo = progressoDaSessao(s, [], t0 + MIN + 70000);
  assert.equal(longo.texto, 'sem sinal há 1min 10s');
  assert.match(longo.aria, /parado, sem sinal há 1 minuto e 10 segundos$/);
});

test('o cartão mostra a linha de progresso como barra acessível, sem o círculo girando', () => {
  const html = sessionCardHtml({ id: 'a1', label: 'Revisão', startedAt: t0 });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /class="sess-sinal" aria-hidden="true"/);
  assert.match(html, /aria-live="polite"/);
  assert.doesNotMatch(html, /spin accent/);
  assert.doesNotMatch(html, /indeterminada/);
});
