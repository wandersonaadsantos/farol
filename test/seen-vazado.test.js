// PR marcado como "visto" por uma revisão que NUNCA decidiu volta pra fila.
//
// Sintoma relatado (18/08/2026): "mesmo com a automação ativada o review precisou de
// ação manual minha pra se dar início". Medido na instalação real: 246 PRs em `seen`,
// 56 sem decisão nenhuma.
//
// A causa é a ordem: `markSeen` acontece QUANDO A REVISÃO É LANÇADA, não quando ela
// decide (review.js:92). Se a sessão morre no meio (app fechado, crash, falha não
// classificada), o PR fica marcado pra sempre e sai da fila, porque a fila é
// `mineList.filter(p => !seen.has(p.key))`. Só clique manual o traz de volta.
//
// O que torna isso delicado, e por que a correção não é "desmarcar quem não tem
// decisão": `ignore()` (o "marcar como visto sem revisar") e o baseline da primeira
// execução deixam EXATAMENTE a mesma marca. Reconciliar às cegas ressuscitaria todo
// PR que a pessoa descartou de propósito. Por isso existe o conjunto `ignorados`: ele
// registra o MOTIVO, e a reconciliação devolve só o que sobra.
// Runner nativo, ZERO deps.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-vazado-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const PR = (k) => ({ key: k, url: 'https://github.com/' + k.replace('#', '/pull/'), title: 't', author: 'a' });

function engine() {
  const e = new Engine();
  e.log = () => { }; e.pushState = () => { }; e.saveSeen = () => { }; e.saveIgnorados = () => { };
  e.seen = new Set(); e.ignorados = new Set();
  e.decisions = { pending: [], resolved: [] };
  e.activeReviews = new Map(); e.headlessQueue = [];
  e.autoReviewParked = new Set(); e.retryAfterNet = new Map();
  return e;
}

test('revisão que morreu no meio devolve o PR pra fila', () => {
  const e = engine();
  e.seen.add('o/r#1');                       // lançou (markSeen) e a sessão morreu
  assert.equal(e.reconciliarVistos([PR('o/r#1')]), 1);
  assert.equal(e.seen.has('o/r#1'), false, 'volta a ser elegível pra auto-revisão');
});

test('descartado de propósito NÃO volta', () => {
  // é o clique em "marcar como visto sem revisar"; ressuscitar seria desfazer a
  // decisão da pessoa toda vez que o ciclo roda
  const e = engine();
  e.seen.add('o/r#2'); e.ignorados.add('o/r#2');
  assert.equal(e.reconciliarVistos([PR('o/r#2')]), 0);
  assert.equal(e.seen.has('o/r#2'), true);
});

test('PR com decisão registrada NÃO volta', () => {
  const e = engine();
  e.seen.add('o/r#3');
  e.decisions.resolved.push({ key: 'o/r#3', status: 'auto_approved' });
  assert.equal(e.reconciliarVistos([PR('o/r#3')]), 0);
});

test('revisão em andamento, estacionada ou em retry NÃO volta', () => {
  // estados legítimos: devolver à fila faria o card mentir "aguardando você" com a
  // sessão rodando, que é o bug que o G9 já tinha consertado
  for (const preparar of [
    e => e.activeReviews.set('s1', { keys: ['o/r#4'] }),
    e => e.headlessQueue.push(PR('o/r#4')),
    e => e.autoReviewParked.add('o/r#4'),
    e => e.retryAfterNet.set('o/r#4', {}),
  ]) {
    const e = engine();
    e.seen.add('o/r#4');
    preparar(e);
    assert.equal(e.reconciliarVistos([PR('o/r#4')]), 0);
    assert.equal(e.seen.has('o/r#4'), true);
  }
});

test('ignore registra o motivo; restore desfaz os dois', () => {
  const e = engine();
  e.queue = [PR('o/r#5')];
  e.ignore('o/r#5');
  assert.equal(e.seen.has('o/r#5'), true);
  assert.equal(e.ignorados.has('o/r#5'), true, 'sem isto a reconciliação ressuscitaria');
  e.checkNow = () => { };
  e.restore('o/r#5');
  assert.equal(e.seen.has('o/r#5'), false);
  assert.equal(e.ignorados.has('o/r#5'), false);
});

test('migração é conservadora: visto-sem-decisão antigo vira descarte deliberado', () => {
  // instalação que já rodava não tem como saber, olhando pra trás, qual era qual.
  // Ressuscitar dezenas de PRs de um golpe seria pior que o vazamento.
  const e = engine();
  e.ignorados = null;                        // arquivo ainda não existe
  e.seen = new Set(['o/r#6', 'o/r#7']);
  e.decisions.resolved.push({ key: 'o/r#6' });
  e.migrarIgnorados();
  assert.deepEqual([...e.ignorados], ['o/r#7'], 'só o sem decisão vira ignorado');
  assert.equal(e.reconciliarVistos([PR('o/r#7')]), 0, 'e por isso não é ressuscitado');
});

test('migração roda uma vez só', () => {
  const e = engine();
  e.ignorados = new Set(['ja-existe']);
  e.seen = new Set(['outro']);
  e.migrarIgnorados();
  assert.deepEqual([...e.ignorados], ['ja-existe'], 'não recalcula por cima do que já existe');
});

/* A função certa não serve de nada se ninguém a chama. Medido por mutação: apagar a
   chamada de `reconciliarVistos` do ciclo deixava os 7 testes acima VERDES, porque
   todos exercitam a função direto. É a mesma classe do bug de fan-out da v2.28.0 que
   o CLAUDE.md registra: a peça existe e o caminho até ela não. */

test('a reconciliação está LIGADA no ciclo, antes de montar a fila', () => {
  const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const chamada = src.indexOf('this.reconciliarVistos(mineList)');
  assert.ok(chamada > 0, 'reconciliarVistos precisa ser chamada no ciclo de checagem');
  const filtro = src.indexOf('mineList.filter(p => !this.seen.has(p.key))');
  assert.ok(filtro > 0, 'o filtro da fila existe');
  assert.ok(chamada < filtro,
    'a reconciliação tem que rodar ANTES do filtro: é o `seen` que o filtro usa');
});

test('a migração está LIGADA no start', () => {
  const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  assert.match(src, /this\.migrarIgnorados\(\)/, 'sem isto o arquivo nunca nasce e tudo vira vazamento');
});

test('ignore e restore mexem nos DOIS conjuntos', () => {
  // trava a simetria: consertar um lado e esquecer o outro foi como o problema
  // original nasceu
  const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
  const ign = src.match(/ {2}ignore\(key\) \{[\s\S]*?\n {2}\}/)[0];
  const res = src.match(/ {2}restore\(key\) \{[\s\S]*?\n {2}\}/)[0];
  assert.match(ign, /marcarIgnorado/, 'ignore registra o motivo');
  assert.match(res, /ignorados\.delete/, 'restore desfaz o registro');
});
