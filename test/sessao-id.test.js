// O id de sessão (a1, s1...) zerava a cada boot (server.js, sessionSeq), e o
// marcarDesfecho pega a entrada MAIS RECENTE com aquele id: depois de um reinício o
// desfecho de uma análise antiga caía na sessão nova de mesmo rótulo (spec 4.1, extras).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sessao-id-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const { novoIdDeSessao } = await import('../lib/engine/sessao-id.js');
const { kindFromId } = await import('../lib/engine/usage.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');
const RESULTADO = { usage: { input_tokens: 5, output_tokens: 7 }, total_cost_usd: 0.5 };

test('dois boots não reutilizam id, e o rótulo curto recomeça só para exibição', () => {
  const a = novoIdDeSessao(new Engine(), 'a');
  const b = novoIdDeSessao(new Engine(), 'a');
  assert.notEqual(a.id, b.id);
  assert.equal(a.rotulo, 'a1');
  assert.equal(b.rotulo, 'a1');
  assert.match(a.id, /^a-[0-9a-f-]{36}$/);
});

test('marcarDesfecho corrige a sessão certa depois de um reinício', () => {
  const primeiro = new Engine();
  const velho = novoIdDeSessao(primeiro, 's').id;
  primeiro.recordUsage(velho, 'eu', RESULTADO, 'claude-opus-5', '', 'o/r#1');
  const segundo = new Engine();
  const novo = novoIdDeSessao(segundo, 's').id;
  segundo.recordUsage(novo, 'eu', RESULTADO, 'claude-opus-5', '', 'o/r#2');
  assert.equal(segundo.marcarDesfecho(velho, 'descartada'), true);
  const linhas = segundo.usageSessions.sessions;
  assert.equal(linhas.find((s) => s.id === velho).status, 'descartada');
  assert.equal(linhas.find((s) => s.id === novo).status, 'ok', 'a sessão nova não herda o desfecho da antiga');
});

test('kindFromId continua lendo o tipo pelo prefixo do id opaco', () => {
  const e = new Engine();
  assert.equal(kindFromId(novoIdDeSessao(e, 'a').id), 'review');
  assert.equal(kindFromId(novoIdDeSessao(e, 's').id), 'self');
  assert.equal(kindFromId(novoIdDeSessao(e, 'pb').id), 'pushback');
  assert.equal(kindFromId(novoIdDeSessao(e, 'f').id), 'tool');
  assert.equal(kindFromId(novoIdDeSessao(e, 'c').id), 'chat');
});

test('prefixo desconhecido é recusado', () => {
  assert.throws(() => novoIdDeSessao(new Engine(), 'x'), /prefixo de sessão desconhecido/);
});

test('as cinco sessões de IA usam o id opaco, nenhuma monta id com o contador', () => {
  const sitios = [['lib/engine/review.js', 'a'], ['lib/engine/selfpr.js', 's'], ['lib/engine/pushback.js', 'pb'], ['lib/engine/tools.js', 'f'], ['lib/engine/chat.js', 'c']];
  for (const [arquivo, prefixo] of sitios) {
    const fonte = fs.readFileSync(path.join(RAIZ, arquivo), 'utf8');
    assert.match(fonte, new RegExp(`novoIdDeSessao\\(engine, '${prefixo}'\\)`), arquivo);
    assert.doesNotMatch(fonte, /\+\+engine\.sessionSeq/, `${arquivo} ainda monta id pelo contador`);
  }
});
