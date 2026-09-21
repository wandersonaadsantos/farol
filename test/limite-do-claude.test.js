// Relato de 21/09/2026: colegas viam o Farol "colocando e tirando" a label <conta>:revisando
// nos PRs, várias vezes por hora. Medido no GitHub: a label entrava e saía 2 a 5 segundos
// depois, repetidamente, nas contas de quem estava com a sessão do Claude em 100%. Cada
// relançamento era uma revisão que morria no primeiro instante.
//
// A causa estava aqui: a classe `limite-plano` só reconhecia "hit your session/usage/weekly
// limit", e o Claude Code emite uma família maior. As frases abaixo foram extraídas do
// binário do Claude Code 2.1.268 (a função que as monta é `You've hit your ${nome}${sufixo}`).
// A que não casava caía em `ferramenta`, porque a mensagem do Farol começa com "claude saiu
// com código 1", e `ferramenta` é TRANSITÓRIA: relançava a cada ciclo em vez de esperar o
// reset que a própria mensagem informa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, resetAtFrom } from '../lib/log-taxonomy.js';

// o que o Farol lança quando o claude recusa: session.js, erroDeSessao
const comoOFarolRecebe = (frase) => `claude saiu com código 1: ${frase}`;

// Limites de JANELA: acabam sozinhos numa hora que a mensagem diz. Esperar é o certo.
const LIMITES_DE_JANELA = [
  "You've hit your session limit · resets 5:50pm",
  "You've hit your limit · resets 5:50pm",
  "You've hit your limit · resets 5:50pm · progress saved",
  "You've hit your weekly limit · resets Sep 24 at 5am",
  "You've hit your Opus limit · resets Sep 24 at 5am",
  "You've hit your Sonnet limit · resets Sep 24 at 5am",
  "You've hit your Fable limit · resets Sep 24 at 5am",
  "You've hit your usage limit · resets 5:50pm",
  "You've hit your usage credit limit · resets 5:50pm",
  "You're out of usage credits · resets 5:50pm",
  'Usage limit reached',
];

// Tetos da ORGANIZAÇÃO: não passam sozinhos numa hora conhecida; alguém com acesso de admin
// precisa subir o teto. Relançar a cada ciclo não resolve nada e só mexe na label do PR.
const TETOS_DA_ORGANIZACAO = [
  "You've hit your team's shared budget · ask your admin to raise it at claude.ai/admin-settings/usage",
  "You've hit your org's monthly spend limit · ask your admin for a higher limit",
  "You've hit your org's monthly usage limit",
  "You've hit your monthly spend limit · raise it at claude.ai/settings/usage",
  "You've hit your individual usage limit · ask your admin for a higher limit",
  "You've hit your channel's monthly spend limit",
  'Your org is out of usage · contact your admin',
  'Your usage allocation has been disabled by your admin · ask your admin for a higher limit',
  "Your group's usage limit is set to $0 · ask your admin for a higher limit",
];

test('todo limite de janela do Claude espera o reset, mesmo chegando como "saiu com código 1"', () => {
  for (const frase of LIMITES_DE_JANELA) {
    const c = classify(comoOFarolRecebe(frase));
    assert.equal(c.id, 'limite-plano', `caiu em ${c.id}: ${frase}`);
    assert.equal(c.kind, 'espera-reset', `${frase}`);
  }
});

test('teto da organização não é relançado a cada ciclo: estaciona com a ação de quem resolve', () => {
  for (const frase of TETOS_DA_ORGANIZACAO) {
    const c = classify(comoOFarolRecebe(frase));
    assert.equal(c.id, 'limite-da-organizacao', `caiu em ${c.id}: ${frase}`);
    assert.equal(c.kind, 'permanente', `teto de organização relançado sozinho: ${frase}`);
    assert.match(c.acao, /admin/);
  }
});

test('nenhuma frase de limite cai mais em "ferramenta"', () => {
  for (const frase of [...LIMITES_DE_JANELA, ...TETOS_DA_ORGANIZACAO]) {
    assert.notEqual(classify(comoOFarolRecebe(frase)).id, 'ferramenta', frase);
  }
});

test('claude que sai com código 1 por outro motivo continua em "ferramenta"', () => {
  // a mudança é só para limite: o resto do comportamento de quem sai com erro fica igual
  assert.equal(classify('claude saiu com código 1: sem saida').id, 'ferramenta');
  assert.equal(classify("claude saiu com código 1: Unknown option '--foo'").id, 'ferramenta');
});

/* ---------- a hora do reset, nos formatos que o Claude Code usa ---------- */

const AGORA = new Date(2026, 8, 21, 15, 58, 0); // 21/09/2026 15:58, hora local

test('resetAtFrom: o limite de sessão do relato volta às 17:50 do mesmo dia', () => {
  const d = resetAtFrom(comoOFarolRecebe("You've hit your limit · resets 5:50pm"), AGORA);
  assert.equal(d.getDate(), 21);
  assert.equal(d.getHours(), 17);
  assert.equal(d.getMinutes(), 50);
});

test('resetAtFrom: limite semanal com data e hora ("resets Sep 24 at 5am")', () => {
  const d = resetAtFrom("You've hit your weekly limit · resets Sep 24 at 5am", AGORA);
  assert.ok(d, 'sem a data, o limite semanal era relançado 12 vezes seguidas');
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 8, 24, 5, 0]);
});

test('resetAtFrom: "resets Sep 24, 5am" e "resets Sep 24 5:30pm"', () => {
  const a = resetAtFrom('resets Sep 24, 5am', AGORA);
  assert.deepEqual([a.getMonth(), a.getDate(), a.getHours()], [8, 24, 5]);
  const b = resetAtFrom('resets Sep 24 5:30pm', AGORA);
  assert.deepEqual([b.getMonth(), b.getDate(), b.getHours(), b.getMinutes()], [8, 24, 17, 30]);
});

test('resetAtFrom: só a data ("resets Oct 1") vale do começo daquele dia', () => {
  const d = resetAtFrom('resets Oct 1', AGORA);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()], [2026, 9, 1, 0]);
});

test('resetAtFrom: data que já passou neste ano é a do ano que vem', () => {
  const d = resetAtFrom('resets Jan 3 at 5am', AGORA);
  assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2027, 0, 3]);
});

test('resetAtFrom: mês que não existe não vira data', () => {
  assert.equal(resetAtFrom('resets Foo 24 at 5am', AGORA), null);
  assert.equal(resetAtFrom('resets Sep 31 at 5am', AGORA), null, 'setembro não tem 31');
});

test('resetAtFrom: os formatos só de hora continuam iguais', () => {
  assert.equal(resetAtFrom('resets 9pm', AGORA).getHours(), 21);
  assert.equal(resetAtFrom('resets 21:00', AGORA).getHours(), 21);
});
