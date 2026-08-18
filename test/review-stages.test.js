// Tempo por etapa da revisão + modo rápido. O resumo é calculado do feed de
// atividade antes de a sessão morrer (era impossível responder "por que demorou
// 10 minutos" depois do fim, caso real do #775 em 17/08/2026) e persiste na
// decisão; o modo rápido é um bloco de prompt opt-in que NUNCA afrouxa gate.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-review-stages-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { stageSummaryFrom, stageOfLine, fastModeBlock } = await import('../lib/engine/review.js');
const { decisionForUi } = await import('../lib/engine/public-review.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

/* ---------- classificação de linha ---------- */

test('stageOfLine: linha já estampada (item.s) vence a reclassificação', () => {
  // a esteira ao vivo e o resumo final leem a MESMA estampa: reclassificar uma
  // linha gravada faria os dois divergirem sobre o mesmo traço
  assert.equal(stageOfLine({ k: 'tool', text: 'Read · src/a.ts', s: 'verificacao' }), 'verificacao');
  assert.equal(stageOfLine({ k: 'tool', text: 'Read · src/a.ts', s: 'etapa-inventada' }), 'leitura',
    'estampa fora do vocabulário não vale, cai na classificação');
});

test('stageOfLine: cada tipo de linha cai na etapa certa', () => {
  assert.equal(stageOfLine({ k: 'tool', text: 'Bash · FAROL_CHECKPOINT: {"claim":"x"}' }), 'verificacao');
  assert.equal(stageOfLine({ k: 'tool', text: 'Bash · comparar heads', a: 'claim-verifier 2' }), 'verificacao');
  assert.equal(stageOfLine({ k: 'tool', text: 'Read · src/a.ts', a: 'pr-reviewer 1' }), 'leitura');
  assert.equal(stageOfLine({ k: 'tool', text: 'mcp__claude_ai_Atlassian_Rovo__getJiraIssue' }), 'card');
  assert.equal(stageOfLine({ k: 'text', text: 'vou consolidar os achados' }), 'raciocinio');
  assert.equal(stageOfLine({ k: 'tool', text: 'Bash · Fetch PR metadata' }), 'leitura');
  assert.equal(stageOfLine({ k: 'info', text: 'sessão do Claude iniciada' }), 'preparo');
});

/* ---------- soma por etapa ---------- */

test('stageSummaryFrom: o gap pertence à etapa da linha que o encerra; o resto final é fechamento', () => {
  const t0 = 1000_000;
  const items = [
    { t: t0 + 5_000, k: 'info', text: 'sessão do Claude iniciada' },       // 5s de preparo
    { t: t0 + 65_000, k: 'tool', text: 'Read · src/a.ts' },                // 60s de leitura
    { t: t0 + 95_000, k: 'tool', text: 'Bash · FAROL_CHECKPOINT: {...}' }, // 30s de verificação
  ];
  const st = stageSummaryFrom(items, t0, t0 + 155_000);                    // +60s até o fim = fechamento
  assert.equal(st.totalMs, 155_000);
  const porId = Object.fromEntries(st.stages.map(s => [s.id, s.ms]));
  assert.equal(porId.preparo, 5_000);
  assert.equal(porId.leitura, 60_000);
  assert.equal(porId.verificacao, 30_000);
  assert.equal(porId.fechamento, 60_000);
  assert.deepEqual(st.stages.map(s => s.id), ['preparo', 'leitura', 'verificacao', 'fechamento'],
    'ordem canônica, sem etapa zerada');
});

test('stageSummaryFrom: sem traço ou sem âncoras de tempo devolve null', () => {
  assert.equal(stageSummaryFrom([], 1, 2), null);
  assert.equal(stageSummaryFrom(null, 1, 2), null);
  assert.equal(stageSummaryFrom([{ t: 5, k: 'info', text: 'x' }], 0, 9), null);
  assert.equal(stageSummaryFrom([{ t: 5, k: 'info', text: 'x' }], 1, 0), null);
});

test('stageSummaryFrom: relógio andando pra trás não gera duração negativa', () => {
  const st = stageSummaryFrom([{ t: 900, k: 'info', text: 'x' }], 1000, 950);
  const total = st.stages.reduce((s, e) => s + e.ms, 0);
  assert.equal(total >= 0, true);
});

/* ---------- projeção pra UI ---------- */

test('decisionForUi: projeta stages saneado (números coagidos, nada além do contrato)', () => {
  const d = decisionForUi({
    key: 'org/app#1', status: 'posted', verdict: 'approve',
    stages: { totalMs: '9000', stages: [{ id: 'leitura', label: 'leitura', ms: '7000', extra: 'vaza?' }] },
  });
  assert.equal(d.stages.totalMs, 9000);
  assert.deepEqual(d.stages.stages, [{ id: 'leitura', label: 'leitura', ms: 7000 }]);
});

test('decisionForUi: decisão sem stages segue sem o campo', () => {
  const d = decisionForUi({ key: 'org/app#1', status: 'posted', verdict: 'approve' });
  assert.equal('stages' in d, false);
});

/* ---------- modo rápido ---------- */

test('fastModeBlock: corta tempo sem afrouxar gate (as promessas que importam estão no texto)', () => {
  const b = fastModeBlock();
  assert.match(b, /MODO RÁPIDO/);
  assert.match(b, /diff completo de TODOS os arquivos/, 'cobertura continua completa');
  assert.match(b, /apenas para afirmação que muda verdict\/decision/, 'verificação empírica só do que decide');
  assert.match(b, /prefira needs_decision/, 'experimento longo vira decisão humana, nunca afirmação sem prova');
  assert.match(b, /O que NÃO muda: o schema do envelope, a cobertura completa, os gates/);
  assert.doesNotMatch(b, /—/, 'sem travessão (invariante 6)');
});

/* Ajustes de 18/08/2026, depois de o Wanderson perguntar se as etapas refletem a
   realidade. Duas mudanças, e uma NÃO-mudança que vale registrar.

   NÃO mudou a atribuição: o intervalo continua indo pra etapa da linha que o ENCERRA.
   Cheguei a propor creditar à linha anterior, e estava errado: quando uma linha de
   ferramenta aparece em T, a ferramenta rodou em [prev, T], então o tempo é dela
   mesmo. Separar pensamento de execução dentro do mesmo intervalo exigiria
   instrumentação que o feed não dá. */

test('card só conta a partir de FERRAMENTA, não de prosa que menciona Jira', () => {
  // antes, qualquer linha cujo TEXTO casasse /atlassian|jira/ virava card, então
  // "o card do Jira não cobre esse caso" (raciocínio puro) levava junto todo o tempo
  // pensado até ali
  const t0 = 1000_000;
  const items = [
    { t: t0 + 10_000, k: 'text', text: 'O card do Jira não cobre esse caso' },
    // card fictício de propósito: o gate de higiene barra referência real solta
    { t: t0 + 20_000, k: 'tool', text: 'mcp__atlassian__getJiraIssue XX-000' },
  ];
  const st = stageSummaryFrom(items, t0, t0 + 20_000);
  const porId = Object.fromEntries(st.stages.map(s => [s.id, s.ms]));
  assert.equal(porId.raciocinio, 10_000, 'prosa é raciocínio, mesmo citando o card');
  assert.equal(porId.card, 10_000, 'só a consulta de verdade conta como card');
});

test('a etapa final se chama fechamento, porque é o que ela mede', () => {
  // ela não vem de linha nenhuma: é o silêncio entre a última atividade e o fim da
  // sessão. Costuma ser a composição do envelope, mas "redação" prometia medição
  const t0 = 1000_000;
  const st = stageSummaryFrom([{ t: t0 + 1_000, k: 'tool', text: 'x' }], t0, t0 + 5_000);
  const ids = st.stages.map(s => s.id);
  assert.ok(ids.includes('fechamento'));
  assert.ok(!ids.includes('redacao'), 'o rótulo antigo não volta');
  assert.equal(st.stages.find(s => s.id === 'fechamento').label, 'fechamento');
});
