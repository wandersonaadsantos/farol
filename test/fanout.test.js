'use strict';
// Cobre o fan-out de revisão em PR grande: o limiar, o agrupamento determinístico em
// lotes por afinidade de caminho, e o gate de cobertura (revisão que não leu o diff
// inteiro não posta sozinha). Tudo função pura, sem rede e sem IA. Runner nativo, ZERO deps.
const os = require('node:os');
const path = require('node:path');
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-fanout-' + process.pid);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Engine } = require('../server.js');
const fanout = require('../lib/engine/fanout.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

/* ---------- limiar ---------- */

test('limiar: 1000 linhas OU 20 arquivos liga o fan-out', () => {
  assert.equal(fanout.shouldFanOut({ lines: 999, changedFiles: 19 }), false, 'abaixo dos dois, passe único');
  assert.equal(fanout.shouldFanOut({ lines: 1000, changedFiles: 3 }), true, 'linhas bastam');
  assert.equal(fanout.shouldFanOut({ lines: 50, changedFiles: 20 }), true, 'arquivos bastam');
  assert.equal(fanout.shouldFanOut(null), false, 'sem medição, não fatia (degrada pro fluxo de sempre)');
});

test('quantidade de lotes cresce com o volume, sempre entre 2 e 4', () => {
  assert.equal(fanout.lotesAlvo(1200), 2);
  assert.equal(fanout.lotesAlvo(2500), 3);
  assert.equal(fanout.lotesAlvo(9000), 4);
});

/* ---------- agrupamento (funcao pura) ---------- */

function f(p, lines) { return { path: p, lines }; }

test('agrupa por afinidade de caminho: arquivos da mesma feature ficam no mesmo lote', () => {
  const lotes = fanout.planLotes([
    f('src/features/reports/a.ts', 400), f('src/features/reports/b.ts', 400),
    f('src/features/billing/c.ts', 400), f('src/features/billing/d.ts', 400),
  ]);
  assert.equal(lotes.length, 2, 'dois diretórios, dois lotes');
  for (const l of lotes) {
    const dirs = new Set(l.files.map(p => p.split('/').slice(0, -1).join('/')));
    assert.equal(dirs.size, 1, `lote ${l.id} não misturou features: ${[...dirs].join(', ')}`);
  }
});

test('respeita o teto de lotes fundindo os menores no caminho pai', () => {
  const files = [];
  for (let i = 0; i < 12; i++) files.push(f(`src/mod${i}/arq.ts`, 500));   // 12 dirs, 6000 linhas
  const lotes = fanout.planLotes(files);
  assert.ok(lotes.length >= 2 && lotes.length <= 4, `ficou com ${lotes.length} lotes, esperado 2..4`);
  const total = lotes.reduce((s, l) => s + l.files.length, 0);
  assert.equal(total, 12, 'nenhum arquivo se perdeu na fusão');
});

test('cobertura é exaustiva e sem duplicata: todo arquivo do diff cai em exatamente um lote', () => {
  const files = [
    f('src/a/1.ts', 100), f('src/a/2.ts', 100), f('src/b/3.ts', 900),
    f('src/b/c/4.ts', 300), f('README.md', 50), f('src/d/5.ts', 700),
  ];
  const lotes = fanout.planLotes(files);
  const todos = lotes.flatMap(l => l.files);
  assert.equal(todos.length, new Set(todos).size, 'nenhum arquivo em dois lotes');
  assert.deepEqual([...todos].sort(), files.map(x => x.path).sort(), 'a união dos lotes é o diff inteiro');
});

test('determinístico: mesma entrada, mesma saída', () => {
  const files = [f('src/a/1.ts', 300), f('src/b/2.ts', 800), f('src/c/3.ts', 500), f('lib/x/4.ts', 200)];
  assert.deepEqual(fanout.planLotes(files), fanout.planLotes(files));
});

test('casos de borda não explodem', () => {
  assert.deepEqual(fanout.planLotes([]), [], 'diff vazio');
  assert.deepEqual(fanout.planLotes(null), [], 'entrada nula');
  const um = fanout.planLotes([f('unico.ts', 5000)]);
  assert.equal(um.length, 1, 'um arquivo só devolve um lote (o chamador não fatia com <2)');
  const raiz = fanout.planLotes([f('a.ts', 600), f('b.ts', 600), f('c.ts', 600)]);
  assert.ok(raiz.length >= 1 && raiz.length <= 4, 'tudo na raiz não entra em laço infinito');
  assert.equal(raiz.flatMap(l => l.files).length, 3, 'e não perde arquivo');
});

/* ---------- bloco de prompt ---------- */

test('o bloco do prompt manda paralelizar, declarar cobertura e consolidar uma vez', () => {
  const lotes = fanout.planLotes([f('src/a/1.ts', 700), f('src/b/2.ts', 700)]);
  const bloco = fanout.fanOutBlock(lotes, { changedFiles: 2, lines: 1400 });
  assert.match(bloco, /em paralelo/i, 'pede paralelismo');
  assert.match(bloco, /deduplique/i, 'pede dedup');
  assert.match(bloco, /uma única vez/i, 'gate aplicado uma vez só');
  assert.match(bloco, /coverage/, 'exige o campo de cobertura');
  assert.match(bloco, /Nunca declare/i, 'proíbe declarar cobertura falsa');
  assert.ok(bloco.includes('src/a/1.ts') && bloco.includes('src/b/2.ts'), 'lista os arquivos dos lotes');
});

test('menos de 2 lotes não gera bloco (não faz sentido fatiar)', () => {
  assert.equal(fanout.fanOutBlock([{ id: 1, escopo: 'x', lines: 10, files: ['a.ts'] }], { changedFiles: 1, lines: 10 }), '');
  assert.equal(fanout.fanOutBlock(null, {}), '');
});

/* ---------- gate de cobertura ---------- */

const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true };
function engineLiberado() {
  const e = new Engine();
  e.config.autoApproveAll = true;
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => 'request_changes';
  e.accountForPr = () => 'alguem';
  return e;
}
function aprovavel(extra) {
  return {
    verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } }, ...extra
  };
}

test('cobertura completa aprova sozinho; lacuna declarada segura a postagem', () => {
  const e = engineLiberado();
  const completa = aprovavel({ coverage: { total: 2, reviewed: ['a.ts', 'b.ts'], missing: [] } });
  assert.equal(e.shouldAutoApprove(PR, completa), true, 'leu tudo e está limpo: aprova');

  const comLacuna = aprovavel({ coverage: { total: 3, reviewed: ['a.ts'], missing: ['b.ts', 'c.ts'] } });
  assert.equal(e.shouldAutoApprove(PR, comLacuna), false, 'ficou arquivo sem revisar: passa pelo humano');
  assert.deepEqual(e.coverageGap(comLacuna), ['b.ts', 'c.ts']);
});

test('rede de segurança: revisou menos que o total conta como lacuna mesmo com missing vazio', () => {
  const e = engineLiberado();
  const r = aprovavel({ coverage: { total: 10, reviewed: ['a.ts', 'b.ts'], missing: [] } });
  assert.equal(e.coverageGap(r).length, 1, 'a conta não fecha, então é lacuna');
  assert.match(e.coverageGap(r)[0], /8 arquivo\(s\)/, 'diz quantos faltaram');
  assert.equal(e.shouldAutoApprove(PR, r), false);
});

test('envelope sem coverage (PR pequeno, passe único) não muda nada', () => {
  const e = engineLiberado();
  const r = aprovavel();
  assert.deepEqual(e.coverageGap(r), []);
  assert.equal(e.shouldAutoApprove(PR, r), true, 'regime de hoje intacto');
});

test('ressalva NÃO entra na conta de cobertura: ressalva aprova, lacuna de leitura não', () => {
  const e = engineLiberado();
  const comRessalva = aprovavel({
    reasons: ['vale olhar a validação de tipo no upload quando passar por ali'],
    coverage: { total: 2, reviewed: ['a.ts', 'b.ts'], missing: [] }
  });
  assert.equal(e.shouldAutoApprove(PR, comRessalva), true, 'ressalva não bloqueia (decisão do Wanderson)');
  assert.equal(e.attentionPoints(comRessalva).length, 1, 'mas continua visível como ponto de atenção');
});

test('lacuna de cobertura também segura o reprovar sozinho', () => {
  const e = engineLiberado();
  const rej = {
    verdict: 'request_changes', decision: 'needs_decision', reasons: ['blocker'],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'x' } },
    coverage: { total: 5, reviewed: ['a.ts'], missing: ['b.ts'] }
  };
  assert.equal(e.shouldAutoReject(PR, rej), false, 'reprovar com leitura parcial é pior ainda');
});

test('a lacuna aparece nos pontos de atenção, com amostra dos arquivos', () => {
  const e = engineLiberado();
  const r = aprovavel({ coverage: { total: 9, reviewed: [], missing: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'] } });
  const pts = e.attentionPoints(r);
  assert.match(pts[0], /não cobriu 6 arquivo/, 'diz quantos');
  assert.match(pts[0], /a\.ts/, 'mostra amostra');
});

/* ---------- limiares: são decisão MEDIDA, não número redondo ----------
   O CLAUDE.md registra que 1000 linhas OU 20 arquivos foi calibrado sobre o histórico
   real (pega 28% dos PRs, 7 de 25) e que MAX_LOTES é o knob pra cauda de PRs gigantes.
   Sem teste, esses valores eram três constantes exportadas que ninguém lia: mudar 1000
   pra 100 triplicaria o custo de review sem nada reclamar. Isto não impede a mudança,
   obriga a mudança a ser deliberada. */

test('os limiares do fan-out são os medidos, e mudá-los é decisão consciente', () => {
  assert.equal(fanout.FANOUT_MIN_LINES, 1000, 'limiar de linhas calibrado no histórico real');
  assert.equal(fanout.FANOUT_MIN_FILES, 20, 'limiar de arquivos calibrado no histórico real');
  assert.equal(fanout.MAX_LOTES, 4, 'teto de subagentes por PR (custo por revisão)');
});

test('os limiares publicados são os que o shouldFanOut de fato usa', () => {
  // pina o acoplamento: constante exportada que não é a usada seria pior que nenhuma
  const L = fanout.FANOUT_MIN_LINES, F = fanout.FANOUT_MIN_FILES;
  assert.equal(fanout.shouldFanOut({ lines: L, changedFiles: 1 }), true, 'no limiar de linhas, fatia');
  assert.equal(fanout.shouldFanOut({ lines: L - 1, changedFiles: 1 }), false, 'abaixo, não fatia');
  assert.equal(fanout.shouldFanOut({ lines: 1, changedFiles: F }), true, 'no limiar de arquivos, fatia');
  assert.equal(fanout.shouldFanOut({ lines: 1, changedFiles: F - 1 }), false, 'abaixo, não fatia');
});

test('planLotes nunca passa do teto publicado, nem no PR gigante', () => {
  const arquivos = Array.from({ length: 300 }, (_, i) => ({ path: `src/m${i % 25}/f${i}.ts`, lines: 60 }));
  assert.ok(fanout.planLotes(arquivos).length <= fanout.MAX_LOTES);
});
