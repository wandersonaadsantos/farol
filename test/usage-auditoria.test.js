// A auditoria de consumo tem que fechar nos DOIS sentidos: nada gasto fica invisível,
// e nada descartado é contado como útil.
//
// OS DOIS FUROS MEDIDOS (30 e 31/08/2026):
//
// 1. GASTO QUE SOME. O registro só acontecia quando o evento final da sessão chegava
//    (`if (resultEvent)` no session.js). Sessão morta no meio não gerava registro
//    nenhum, e os tokens ja queimados ficavam fora da tela E fora do teto de
//    orçamento. Ficou frequente quando a autoanálise passou a ser cancelada ao entrar
//    commit novo: o conserto de um lugar abriu o buraco no outro.
// 2. GASTO QUE MENTE DE SUCESSO. Sessão que roda até o fim e tem o resultado
//    DESCARTADO (commit novo durante a análise) entrava como `ok`. Em 30/08 foram
//    US$ 64,81 assim, e a aba Consumo mostrava sucesso em 100% das sessões.
//
// O custo em dólar SÓ existe no evento final (`total_cost_usd`); as mensagens do
// stream trazem token e nunca custo (conferido no transcript real de uma sessão do
// Farol). Então sessão morta no meio tem token MEDIDO e custo ESTIMADO, e o registro
// diz qual é qual: misturar os dois num campo só seria destruir a auditoria pra
// salvar a aparência dela.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-auditoria-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const usage = (await import('../lib/engine/usage.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

// sessão medida de referência: US$ 1,00 por 1000 tokens de saída = 1e-3 por token
const medida = (over = {}) => ({
  status: 'ok', kind: 'review', model: 'Opus 5',
  inputTokens: 10, outputTokens: 1000, cacheReadTokens: 5000, cacheCreationTokens: 100,
  costUsd: 1, ...over,
});

/* ---------- a taxa vem do registro do PRÓPRIO app, nunca de tabela de preço ---------- */

test('taxa observada sai da mediana das sessões medidas do mesmo tipo e modelo', () => {
  const sessions = [medida({ costUsd: 1 }), medida({ costUsd: 2 }), medida({ costUsd: 3 })];
  assert.equal(usage.taxaObservada(sessions, 'review', 'Opus 5'), 2 / 1000);
});

test('sem amostra do tipo, cai pro mesmo MODELO em qualquer tipo', () => {
  const sessions = [
    medida({ kind: 'pushback', costUsd: 1 }), medida({ kind: 'chat', costUsd: 1 }), medida({ kind: 'tool', costUsd: 1 }),
  ];
  assert.equal(usage.taxaObservada(sessions, 'review', 'Opus 5'), 1 / 1000);
});

test('modelo diferente não empresta taxa: preço de modelo não é fungível', () => {
  const sessions = [medida({ model: 'Haiku 4.5' }), medida({ model: 'Haiku 4.5' }), medida({ model: 'Haiku 4.5' })];
  assert.equal(usage.taxaObservada(sessions, 'review', 'Opus 5'), null);
});

test('amostra pequena demais não vira taxa: duas sessões não sustentam mediana', () => {
  assert.equal(usage.taxaObservada([medida(), medida()], 'review', 'Opus 5'), null);
});

test('sessão sem custo medido ou sem saída fica fora da amostra', () => {
  const sujas = [medida({ costUsd: 0 }), medida({ outputTokens: 0 }), medida({ status: 'cancelada' })];
  assert.equal(usage.taxaObservada(sujas, 'review', 'Opus 5'), null);
});

/* ---------- estimar nunca inventa: sem base, o custo é zero e diz que é ---------- */

test('com base, estima pelo token de saída e marca a origem', () => {
  const sessions = [medida(), medida(), medida()];
  assert.deepEqual(usage.estimarCusto(sessions, 'review', 'Opus 5', 250),
    { costUsd: 0.25, source: 'estimado' });
});

test('sem base, devolve zero com origem `sem-base`, e nunca um numero inventado', () => {
  assert.deepEqual(usage.estimarCusto([], 'review', 'Opus 5', 250), { costUsd: 0, source: 'sem-base' });
});

test('sem token de saída não há o que estimar', () => {
  const sessions = [medida(), medida(), medida()];
  assert.deepEqual(usage.estimarCusto(sessions, 'review', 'Opus 5', 0), { costUsd: 0, source: 'sem-base' });
});

/* ---------- o registro parcial entra, e diz que é estimado ---------- */

function engineDeTeste(sessions = []) {
  return {
    usage: usage.defaultUsage(),
    usageSessions: { sessions: [...sessions] },
    config: {},
    pushState() { },
  };
}

test('sessão morta no meio registra token MEDIDO e custo ESTIMADO', () => {
  const eng = engineDeTeste([medida(), medida(), medida()]);
  const parcial = { usage: { input_tokens: 7, output_tokens: 500 }, farol_parcial: true };
  usage.recordUsage(eng, 'r9', 'alguem', parcial, 'claude-opus-5', 'p1', 'o/r#1');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.outputTokens, 500, 'o token e o que a sessao de fato gastou');
  assert.equal(s.costUsd, 0.5, 'custo estimado pela taxa observada');
  assert.equal(s.costSource, 'estimado');
  assert.equal(s.status, 'parcial', 'o desfecho diz que a sessao nao chegou ao fim');
});

test('sessão completa continua com custo MEDIDO, sem passar por estimativa', () => {
  const eng = engineDeTeste([medida(), medida(), medida()]);
  const final = { usage: { input_tokens: 1, output_tokens: 9 }, total_cost_usd: 7.77 };
  usage.recordUsage(eng, 'r9', 'alguem', final, 'claude-opus-5', 'p1', 'o/r#1');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.costUsd, 7.77);
  assert.equal(s.costSource, 'medido');
  assert.equal(s.status, 'ok');
});

test('o gasto parcial entra no AGREGADO, senão o teto de orçamento segue cego', () => {
  const eng = engineDeTeste([medida(), medida(), medida()]);
  usage.recordUsage(eng, 'r9', 'alguem', { usage: { output_tokens: 500 }, farol_parcial: true }, 'claude-opus-5', 'p1', 'x');
  assert.equal(eng.usage.totals.costUsd, 0.5, 'dinheiro real gasto tem que contar no teto');
  assert.equal(eng.usage.totals.outputTokens, 500);
});

test('parcial sem base de estimativa ainda registra o TOKEN, que e medido', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 'r9', 'alguem', { usage: { output_tokens: 500 }, farol_parcial: true }, 'claude-opus-5', 'p1', 'x');
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.outputTokens, 500);
  assert.equal(s.costUsd, 0);
  assert.equal(s.costSource, 'sem-base');
});

/* ---------- gasto descartado deixa de parecer util ---------- */

test('marcarDesfecho corrige a linha da sessão pelo id, sem tocar no dinheiro', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 's4', 'alguem', { usage: { output_tokens: 9 }, total_cost_usd: 3 }, 'claude-opus-5', 'p1', 'o/r#1');
  assert.equal(usage.marcarDesfecho(eng, 's4', 'descartada'), true);
  const s = eng.usageSessions.sessions.at(-1);
  assert.equal(s.status, 'descartada');
  assert.equal(s.costUsd, 3, 'o gasto aconteceu e continua contado; o que muda e o DESFECHO');
  assert.equal(eng.usage.totals.costUsd, 3);
});

test('marcarDesfecho de id que não existe devolve false, sem inventar linha', () => {
  const eng = engineDeTeste();
  assert.equal(usage.marcarDesfecho(eng, 'nao-existe', 'descartada'), false);
  assert.equal(eng.usageSessions.sessions.length, 0);
});

test('marcarDesfecho só aceita desfecho conhecido', () => {
  const eng = engineDeTeste();
  usage.recordUsage(eng, 's4', 'a', { usage: { output_tokens: 9 }, total_cost_usd: 3 }, 'claude-opus-5', 'p1', 'x');
  assert.equal(usage.marcarDesfecho(eng, 's4', 'inventado'), false);
  assert.equal(eng.usageSessions.sessions.at(-1).status, 'ok');
});

/* ---------- a tela consegue mostrar o desperdicio ---------- */

test('o resumo separa gasto por desfecho e diz quanto do custo é estimado', () => {
  const eng = engineDeTeste();
  eng.usageSessions.sessions = [
    medida({ costUsd: 10, costSource: 'medido', status: 'ok' }),
    medida({ costUsd: 4, costSource: 'medido', status: 'descartada' }),
    medida({ costUsd: 1, costSource: 'estimado', status: 'parcial' }),
    medida({ costUsd: 2, costSource: 'medido', status: 'cancelada' }),
  ];
  const r = usage.auditoriaDeConsumo(eng.usageSessions.sessions);
  assert.equal(r.util.costUsd, 10, 'so o que produziu resultado conta como util');
  assert.equal(r.perdido.costUsd, 7, 'descartada + parcial + cancelada e desperdicio');
  assert.equal(r.perdido.sessions, 3);
  assert.equal(r.estimado.costUsd, 1, 'quanto do total nao foi medido');
  assert.equal(r.total.costUsd, 17);
});

test('a auditoria de um registro vazio nao quebra e nao inventa', () => {
  const r = usage.auditoriaDeConsumo([]);
  assert.deepEqual(r.total, { sessions: 0, costUsd: 0 });
  assert.deepEqual(r.perdido, { sessions: 0, costUsd: 0 });
});

test('sessao antiga sem costSource conta como MEDIDA, que e o que ela era', () => {
  const r = usage.auditoriaDeConsumo([medida({ costUsd: 5 })]);
  assert.equal(r.estimado.costUsd, 0);
  assert.equal(r.util.costUsd, 5);
});

/* ---------- fiação: os dois caminhos de descarte da autoanálise carimbam ---------- */
// Teste de fonte, mesmo padrão dos outros wirings deste repo: o caminho de verdade faz
// spawn e chamada gh. São DOIS descartes diferentes, e os dois desperdiçam igual:
// o imediato (commit novo durante a análise, no fim do runSelfAnalysis) e o tardio
// (a análise era válida quando saiu e envelheceu, percebido no polling seguinte).
const SELF = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'selfpr.js'), 'utf8');
const SERVER = fs.readFileSync(path.join(import.meta.dirname, '..', 'server.js'), 'utf8');

test('o descarte imediato carimba o desfecho da sessão', () => {
  assert.match(SELF, /engine\.marcarDesfecho\(id, 'descartada'\)/);
});

test('o desfecho tardio reencontra a sessão pelo id gravado na análise', () => {
  assert.match(SELF, /usageId: id/, 'a análise guarda o id da sessão do Farol');
  // `parcial`, e nao `descartada`: desde que o registro passou a PERSISTIR quando o head
  // anda, o gasto continua nao virando merge mas vira um relatorio que segue na tela e
  // segue sendo lido. Carimbar `descartada` diria que nada sobrou, e sobrou.
  assert.match(SELF, /if \(a\.usageId\) engine\.marcarDesfecho\(a\.usageId, 'parcial'\)/);
  // o descarte IMEDIATO (push durante a sessao) continua `descartada`: ali nao sobra
  // relatorio nenhum, a sessao inteira foi jogada fora.
  assert.match(SELF, /engine\.marcarDesfecho\(id, 'descartada'\)/);
});

test('a fachada existe no engine', () => {
  assert.match(SERVER, /marcarDesfecho\(id, status\) \{ return usageMod\.marcarDesfecho\(this, id, status\); \}/);
});

test('o resumo da aba Consumo carrega a auditoria', () => {
  const USAGE = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'usage.js'), 'utf8');
  assert.match(USAGE, /auditoria: auditoriaDeConsumo\(sessions\)/,
    'sem isso a auditoria existe no arquivo e não na tela');
});
