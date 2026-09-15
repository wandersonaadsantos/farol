// A falha de uma sessão de IA tinha uma cópia só: a linha do farol.log, cortada em 300
// caracteres na origem e apagada inteira pelo "Limpar log" (spec 4.1). O registro
// durável mora fora do log, com o motivo inteiro, teto próprio e segredo mascarado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-falhas-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const falhas = await import('../lib/engine/falhas.js');
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

test('motivo longo fica inteiro (sem o corte de 300) e sobrevive a um engine novo', () => {
  const e = new Engine();
  const motivo = 'sessão retornou erro: ' + 'x'.repeat(1200) + 'FIM-DO-STDERR';
  const r = e.registrarFalha({ sessionId: 'a-longo', attemptId: 't-1', kind: 'review', account: 'Conta', ref: 'o/r#1', motivo, etapas: null });
  assert.equal(r.motivo, motivo);
  assert.equal(r.account, 'conta');
  assert.ok(r.classe, 'a classe vem da taxonomia quando não é informada');
  const outro = new Engine();
  assert.equal(outro.falhaDaSessao('a-longo').motivo, motivo);
});

test('Limpar log não apaga o registro de falha', () => {
  const e = new Engine();
  e.registrarFalha({ sessionId: 'a-limpar', kind: 'review', motivo: 'quebrou qwerty' });
  e.log('ERROR', 'linha de teste');
  assert.equal(e.clearLog().ok, true);
  assert.ok(fs.existsSync(falhas.arquivoDeFalhas()));
  assert.equal(new Engine().falhaDaSessao('a-limpar').motivo, 'quebrou qwerty');
});

test('segredo no motivo é mascarado antes de gravar', () => {
  const e = new Engine();
  const motivo = [
    'ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop',
    'token ghp_abcdefghijklmnopqrstuvwxyz0123',
    'Authorization: Bearer eyJhbGciOi.abc.def',
    'https://db.exemplo/x.json?auth=segredo123&y=1',
    'sk-or-v1-abcdefghijklmnop',
  ].join(' | ');
  const r = e.registrarFalha({ sessionId: 'a-segredo', kind: 'review', motivo });
  for (const vazado of ['sk-ant-api03', 'ghp_abcdef', 'eyJhbGciOi', 'segredo123', 'sk-or-v1']) {
    assert.doesNotMatch(r.motivo, new RegExp(vazado), `vazou ${vazado}`);
  }
  assert.match(r.motivo, /ANTHROPIC_API_KEY=\[segredo mascarado\]/);
  assert.match(fs.readFileSync(falhas.arquivoDeFalhas(), 'utf8'), /\[segredo mascarado\]/);
});

test('motivo acima do teto é cortado no teto próprio e marcado', () => {
  const r = falhas.registrarFalha(new Engine(), { sessionId: 'a-teto', kind: 'review', motivo: 'y'.repeat(20000) });
  assert.equal(r.motivo.length, 8000);
  assert.equal(r.motivoTruncado, true);
});

test('o arquivo guarda no máximo 500 registros, os mais antigos saem', () => {
  const e = new Engine();
  e.falhasSessao = [];
  for (let i = 0; i < 505; i++) falhas.registrarFalha(e, { sessionId: `a-n${i}`, kind: 'review', motivo: 'm' });
  assert.equal(new Engine().falhasRecentes({ limite: 1000 }).length, 500);
  assert.equal(e.falhaDaSessao('a-n0'), null);
  assert.equal(e.falhasRecentes({ limite: 2 })[0].sessionId, 'a-n504', 'mais recente primeiro');
});

test('resumeOutcome da A5 é gravado só quando é um dos quatro valores', () => {
  const e = new Engine();
  assert.equal(e.registrarFalha({ sessionId: 'a-r1', motivo: 'm', resumeOutcome: 'recusada' }).resumeOutcome, 'recusada');
  assert.equal('resumeOutcome' in e.registrarFalha({ sessionId: 'a-r2', motivo: 'm', resumeOutcome: 'inventado' }), false);
});

test('etapas saneadas e id do CLI guardado à parte', () => {
  const r = new Engine().registrarFalha({ sessionId: 'a-et', cliSessionId: 'cli-1', motivo: 'm', etapas: { totalMs: 30, stages: [{ id: 'leitura', label: 'leitura', ms: 30, extra: 'x' }] } });
  assert.deepEqual(r.etapas, { totalMs: 30, stages: [{ id: 'leitura', label: 'leitura', ms: 30 }] });
  assert.equal(r.cliSessionId, 'cli-1');
});

test('erroDeSessao mantém a mensagem com o corte de sempre e o texto inteiro à parte', () => {
  const err = falhas.erroDeSessao('claude saiu com código 1: ', 'z'.repeat(1000) + 'FIM');
  assert.equal(err.message, 'claude saiu com código 1: ' + 'z'.repeat(300));
  assert.ok(err.detalheCompleto.endsWith('FIM'));
  assert.equal(falhas.detalheDaFalha(err), err.detalheCompleto);
  assert.equal(falhas.detalheDaFalha(new Error('só mensagem')), 'só mensagem');
});

test('anotarFalhaDaSessao não sobrescreve o que já veio anotado', () => {
  const err = falhas.anotarFalhaDaSessao(new Error('e'), 'a-1', { totalMs: 1, stages: [] });
  falhas.anotarFalhaDaSessao(err, 'a-2', null);
  assert.equal(err.sessaoFarol, 'a-1');
  assert.deepEqual(err.etapas, { totalMs: 1, stages: [] });
});

test('marcarErroNoConsumo tolera engine sem marcarDesfecho e sem id', () => {
  assert.equal(falhas.marcarErroNoConsumo({}, 'a-1'), false);
  assert.equal(falhas.marcarErroNoConsumo({ marcarDesfecho: () => true }, ''), false);
  const chamadas = [];
  falhas.marcarErroNoConsumo({ marcarDesfecho: (id, st) => { chamadas.push([id, st]); return true; } }, 'a-9');
  assert.deepEqual(chamadas, [['a-9', 'erro']]);
});

test('falhasPorSessao resume só as sessões pedidas', () => {
  const e = new Engine();
  e.registrarFalha({ sessionId: 'a-resumo', motivo: 'w'.repeat(500) });
  const r = falhas.falhasPorSessao(e, ['a-resumo', 'a-inexistente']);
  assert.deepEqual(Object.keys(r), ['a-resumo']);
  assert.equal(r['a-resumo'].motivo.length, 200);
});
