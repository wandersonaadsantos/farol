import test from 'node:test';
import assert from 'node:assert/strict';
import { accountResult, modelBuckets, extractUsage } from '../lib/engine/usage-accounting.js';

const identity = { account: 'dev', profileId: 'p1' };
const model = (n = 1) => ({ inputTokens: n * 10, outputTokens: n * 100,
  cacheReadInputTokens: n * 1000, cacheCreationInputTokens: n * 20, thinkingTokens: n * 60, costUSD: n });
const event = (n = 1) => ({ session_id: 'session-1', usage: { input_tokens: 2, output_tokens: 5 },
  modelUsage: { opus: model(n) }, total_cost_usd: n });
const row = ev => ({ ...identity, accounting: ev.farol_accounting });

test('inclui árvore inteira e pensamento é subconjunto da saída; custo não é somado duas vezes', () => {
  const ev = accountResult(event(), [], identity);
  assert.equal(ev.usage.output_tokens, 100);
  assert.equal(ev.usage.thinking_tokens, 60);
  assert.equal(ev.usage.cache_read_input_tokens, 1000);
  assert.equal(ev.total_cost_usd, 1);
  assert.equal(ev.farol_accounting.scope, 'tree');
});

test('retomada desconta o cursor cumulativo salvo e resultado repetido tem delta zero', () => {
  const first = accountResult(event(), [], identity);
  const next = accountResult({ ...event(3), farol_resumed: true }, [row(first)], identity);
  assert.equal(next.total_cost_usd, 2);
  assert.equal(next.usage.output_tokens, 200);
  assert.equal(next.farol_accounting.scope, 'tree-delta');
  const again = accountResult(event(3), [row(first), row(next)], identity);
  assert.equal(again.total_cost_usd, 0);
  assert.equal(again.usage.output_tokens, 0);
});

test('não empresta cursor entre contas ou perfis; retomada sem cursor declara desconhecido', () => {
  const first = accountResult(event(), [], identity);
  for (const other of [{ ...identity, account: 'other' }, { ...identity, profileId: 'other' }]) {
    const ev = accountResult({ ...event(3), farol_resumed: true }, [row(first)], other);
    assert.equal(ev.farol_custo_desconhecido, true);
    assert.equal(ev.total_cost_usd, 0);
    assert.equal(ev.usage.output_tokens, 5, 'só o turno principal é conhecido');
    assert.equal(ev.farol_accounting.reason, 'missing-baseline');
  }
});

test('baseline desconhecido vira cursor para o próximo delta, sem inventar o gasto anterior', () => {
  const unknown = accountResult({ ...event(3), farol_resumed: true }, [], identity);
  const next = accountResult({ ...event(4), farol_resumed: true }, [row(unknown)], identity);
  assert.equal(next.total_cost_usd, 1);
  assert.equal(next.usage.output_tokens, 100);
});

test('interrupção não vira cursor completo e retomada não duplica a estimativa parcial', () => {
  const first = accountResult(event(), [], identity);
  const partial = accountResult({ session_id: 'session-1', farol_parcial: true, usage: { output_tokens: 5 } }, [row(first)], identity);
  assert.equal(partial.farol_accounting.scope, 'partial');
  const next = accountResult({ ...event(3), farol_resumed: true }, [row(first), row(partial)], identity);
  assert.equal(next.farol_custo_desconhecido, true);
});

test('regressão ou desaparecimento de modelo não vira economia negativa nem novo custo cumulativo', () => {
  const first = accountResult(event(3), [], identity);
  const ev = accountResult({ ...event(), farol_resumed: true }, [row(first)], identity);
  assert.equal(ev.farol_custo_desconhecido, true);
  assert.equal(ev.farol_accounting.reason, 'cumulative-counters-regressed');
  const mixed = accountResult({ ...event(3), modelUsage: { opus: model(2), haiku: model() } }, [], identity);
  const lost = accountResult({ ...event(4), farol_resumed: true }, [row(mixed)], identity);
  assert.equal(lost.farol_custo_desconhecido, true);
});

test('modelo misto atribui tokens e custo reais por modelo sem inflar o agregado', () => {
  const ev = accountResult({ ...event(3), modelUsage: { opus: model(2), haiku: model() } }, [], identity);
  const u = extractUsage(ev, 'opus');
  const buckets = modelBuckets(ev, u, 'opus');
  assert.equal(u.outputTokens, 300);
  assert.equal(buckets.length, 2);
  assert.equal(buckets[0][1].costUsd, 2);
  assert.equal(buckets[1][1].costUsd, 1);
  assert.equal(buckets.reduce((n, [, b]) => n + b.costUsd, 0), u.costUsd);
});

test('custo não reconciliado fica sem atribuição de modelo; total reportado é preservado', () => {
  const ev = accountResult({ ...event(), total_cost_usd: 2 }, [], identity);
  const buckets = modelBuckets(ev, extractUsage(ev, 'opus'), 'opus');
  assert.equal(buckets[0][1].costUsd, 0);
  assert.equal(buckets[1][0], '');
  assert.equal(buckets[1][1].costUsd, 2);
});

test('CLI legado preserva seus campos e provedor não Claude continua compatível', () => {
  const ev = { usage: { input_tokens: 3, output_tokens: 7, thinking_tokens: 4 }, total_cost_usd: 0.2 };
  const result = accountResult(ev, [], identity);
  assert.deepEqual(result.usage, ev.usage);
  assert.equal(result.total_cost_usd, 0.2);
  assert.equal(result.farol_accounting.source, 'result.usage');
});

test('totais ausentes, parciais, negativos e não finitos não substituem uso conhecido do turno', () => {
  for (const bad of [{}, { opus: {} }, { opus: { ...model(), outputTokens: -1 } }, { opus: { ...model(), inputTokens: Infinity } }]) {
    const ev = accountResult({ ...event(), modelUsage: bad }, [], identity);
    assert.equal(ev.usage.output_tokens, 5);
    assert.equal(ev.farol_accounting.scope, 'main-turn');
  }
});

test('cursor corrompido e custo zerado com gasto reportado não viram medição completa', () => {
  const zero = accountResult({ ...event(), total_cost_usd: 0, is_error: true }, [], identity);
  assert.equal(zero.farol_custo_desconhecido, true);
  const resumed = accountResult({ ...event(2), farol_resumed: true }, [row(zero)], identity);
  assert.equal(resumed.farol_custo_desconhecido, true, 'zero inválido não permite atribuir todo o custo acumulado ao turno novo');
  const measured = accountResult({ ...event(3), farol_resumed: true }, [row(zero), row(resumed)], identity);
  assert.equal(measured.total_cost_usd, 1, 'o próximo total confiável restabelece o cursor');
  const broken = { ...identity, accounting: { sessionId: 'session-1', snapshot: { models: null } } };
  const next = accountResult({ ...event(), farol_resumed: true }, [broken], identity);
  assert.equal(next.farol_accounting.reason, 'invalid-baseline');
});

test('custo zerado depois de um total positivo também invalida o cursor antes da comparação', () => {
  const first = accountResult(event(), [], identity);
  const failed = accountResult({ ...event(2), total_cost_usd: 0, is_error: true, farol_resumed: true }, [row(first)], identity);
  assert.equal(failed.farol_accounting.snapshot.costUsd, null);
  const next = accountResult({ ...event(3), farol_resumed: true }, [row(first), row(failed)], identity);
  assert.equal(next.farol_custo_desconhecido, true);
  assert.equal(next.total_cost_usd, 0);
});

test('falha que zera também todos os contadores não transforma zero em cursor válido', () => {
  const first = accountResult(event(), [], identity);
  const failed = accountResult({ ...event(0), total_cost_usd: 0, is_error: true, farol_resumed: true }, [row(first)], identity);
  assert.equal(failed.farol_accounting.snapshot.costUsd, null);
  const next = accountResult({ ...event(3), farol_resumed: true }, [row(first), row(failed)], identity);
  assert.equal(next.farol_custo_desconhecido, true);
  assert.equal(next.total_cost_usd, 0);
  const known = accountResult({ ...event(4), farol_resumed: true }, [row(first), row(failed), row(next)], identity);
  assert.equal(known.total_cost_usd, 1);
});

test('sessão legada de outro provedor pode repetir id sem herdar semântica cumulativa Claude', () => {
  const e = { session_id: 'other-provider', usage: { output_tokens: 10 }, total_cost_usd: 1 };
  const first = accountResult(e, [], identity);
  const second = accountResult(e, [row(first)], identity);
  assert.equal(second.total_cost_usd, 1);
  assert.equal(second.farol_custo_desconhecido, undefined);
});

test('modelo que só teve gasto anterior não conta como participante do turno retomado', () => {
  const first = accountResult(event(), [], identity);
  const next = accountResult({ ...event(2), farol_resumed: true,
    modelUsage: { opus: model(), haiku: model() } }, [row(first)], identity);
  const buckets = modelBuckets(next, extractUsage(next, 'opus'), 'opus');
  assert.deepEqual(buckets.map(([name]) => name), ['haiku']);
});
