// A lista de falhas do Diagnostico estava ilegivel (23/09/2026).
//
// Medido no aparelho do Wanderson: 19 registros, dos quais 15 sao o MESMO limite de plano
// no MESMO PR (biud-frontend#1050), um por tentativa entre 17:12 e 18:02. Cada um vira um
// cartao inteiro e ABERTO na tela (titulo, chip, "o que fazer", bloco com hora, sessao,
// referencia e o texto cru, mais o botao de copiar), entao quatro falhas ocupam a tela
// inteira e as duas que pedem acao ficam enterradas.
//
// Duas causas, uma correcao cada:
//   1. a fusao de repeticao so acontecia na ESCRITA, e esses 15 sao anteriores a ela. Quem
//      le passa a fundir pela MESMA regra, entao o historico antigo colapsa junto;
//   2. o cartao nascia aberto. Passa a nascer fechado, com uma linha de resumo, EXCETO a
//      falha que precisa de voce: essa e a que pede acao, e esconder seria o defeito.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = path.join(os.tmpdir(), 'farol-test-falhas-poluicao-' + process.pid);

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const falhasMod = (await import('../lib/engine/falhas.js')).default;
const diag = (await import('../lib/engine/diagnostico.js')).default;
const P = await import('../ui/pure.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const BASE = Date.parse('2026-09-17T20:12:41Z');
const MOTIVO_LIMITE = 'sessão retornou erro: You' + "'" + 've hit your weekly limit · resets 2am (America/Sao_Paulo)';

// o registro real que repetiu 15 vezes
const limite = (i) => ({
  id: 'f' + i, at: BASE + i * 60000, kind: 'pushback', classe: 'limite-plano',
  ref: 'biudtech/biud-frontend#1050', account: 'wandersonbiuder', motivo: MOTIVO_LIMITE,
});
const invalido = (i) => ({
  id: 'r' + i, at: BASE + i * 60000, kind: 'review', classe: 'resultado-invalido',
  ref: 'biudtech/tenant-company#126', account: 'wandersonbiuder',
  motivo: 'revisão não concluída: a sessão terminou sem entregar o resultado estruturado',
  sessionId: 'a-21b64dbd-2fb0-4e4f-b92d-da78c7c9e775',
});

function engineCom(registros) {
  const e = new Engine();
  e.log = () => { };
  e.falhasSessao = registros;
  return e;
}

/* ---------- 1) a repetição antiga colapsa na leitura ---------- */

test('15 registros idênticos viram UMA linha, com a contagem e desde quando', () => {
  const e = engineCom(Array.from({ length: 15 }, (_, i) => limite(i)));
  const lidas = falhasMod.falhasRecentes(e, { limite: 50 });
  assert.equal(lidas.length, 1, '15 cartões iguais eram 15 cópias da mesma notícia');
  assert.equal(lidas[0].ocorrencias, 15);
  assert.equal(lidas[0].primeiraAt, BASE, 'a contagem começa na PRIMEIRA vez');
  assert.equal(lidas[0].at, BASE + 14 * 60000, 'e a linha fala da última');
});

test('falha que PRECISA DE VOCÊ nunca funde: cada uma tem sessão própria para investigar', () => {
  const e = engineCom([invalido(0), invalido(1)]);
  assert.equal(falhasMod.falhasRecentes(e, { limite: 50 }).length, 2);
});

test('a leitura funde pela MESMA regra da escrita: PR diferente é falha diferente', () => {
  const e = engineCom([limite(0), { ...limite(1), ref: 'biudtech/engine-ai#216' }, limite(2)]);
  const lidas = falhasMod.falhasRecentes(e, { limite: 50 });
  assert.equal(lidas.length, 2);
  assert.deepEqual(lidas.map(f => f.ocorrencias || 1).sort(), [1, 2]);
});

test('o limite pedido conta LINHAS da tela, não registros crus', () => {
  const e = engineCom([...Array.from({ length: 15 }, (_, i) => limite(i)), invalido(99)]);
  const lidas = falhasMod.falhasRecentes(e, { limite: 2 });
  assert.equal(lidas.length, 2, 'duas notícias, e não duas cópias da mesma');
  assert.equal(lidas[0].classe, 'resultado-invalido', 'a mais recente primeiro');
});

test('a projeção da tela herda a fusão', () => {
  const e = engineCom(Array.from({ length: 15 }, (_, i) => limite(i)));
  const tela = diag.falhasParaTela(e);
  assert.equal(tela.length, 1);
  assert.equal(tela[0].ocorrencias, 15);
});

/* ---------- 2) o cartão nasce fechado ---------- */

const cartao = (f) => P.falhasSecaoHtml({ estado: 'pronto', falhas: [f], lidoEm: Date.now() });

test('falha que passa sozinha nasce FECHADA, com uma linha de resumo', () => {
  const html = cartao({
    id: 'x', at: BASE, classe: 'limite-plano', rotulo: 'Limite do plano Claude',
    acao: 'Espere o reset do plano.', gravidade: 'espera-reset', ref: 'o/r#1050',
    ocorrencias: 15, primeiraAt: BASE - 9e5, markdown: 'texto cru da falha',
  });
  assert.match(html, /<details/, 'o corpo fica atrás de um clique');
  assert.doesNotMatch(html, /<details[^>]*\sopen/, 'e não nasce aberto');
  assert.match(html, /<summary/);
  assert.match(html, /Limite do plano Claude/, 'o resumo diz o que é');
  assert.match(html, /o\/r#1050/, 'e sobre qual PR');
  assert.match(html, /15×/, 'e que repetiu');
  assert.match(html, /texto cru da falha/, 'o texto continua lá dentro, só não na cara');
});

test('falha que PRECISA DE VOCÊ nasce ABERTA: esconder o que pede ação seria o defeito', () => {
  const html = cartao({
    id: 'y', at: BASE, classe: 'resultado-invalido', rotulo: 'Sessão sem resultado estruturado válido',
    acao: 'Tente revisar de novo.', gravidade: 'permanente', precisaDeVoce: true,
    ref: 'o/r#126', ocorrencias: 1, primeiraAt: BASE, markdown: 'o texto da falha',
  });
  assert.match(html, /<details[^>]*\sopen/);
});

test('o botão de copiar continua um por falha, e dentro dela', () => {
  const html = cartao({
    id: 'z', at: BASE, classe: 'limite-plano', rotulo: 'Limite', acao: 'Espere.',
    gravidade: 'espera-reset', ref: 'o/r#1', ocorrencias: 1, primeiraAt: BASE, markdown: 'texto',
  });
  assert.equal((html.match(/data-copiar-falha="z"/g) || []).length, 1);
  assert.ok(html.indexOf('data-copiar-falha') > html.indexOf('<details'), 'o botão está no corpo, não no resumo');
});

test('o resumo não repete o identificador de sessão que já está no corpo', () => {
  const html = cartao({
    id: 'w', at: BASE, classe: 'resultado-invalido', rotulo: 'Sessão sem resultado',
    acao: 'Tente de novo.', gravidade: 'permanente', precisaDeVoce: true, ref: 'o/r#126',
    sessionId: 'a-21b64dbd-2fb0-4e4f-b92d-da78c7c9e775', ocorrencias: 1, primeiraAt: BASE,
    markdown: 'Sessão: a-21b64dbd-2fb0-4e4f-b92d-da78c7c9e775',
  });
  const resumo = html.slice(html.indexOf('<summary'), html.indexOf('</summary>'));
  assert.doesNotMatch(resumo, /a-21b64dbd/, '36 caracteres de id não ajudam a escolher o que abrir');
});

test('os três estados da seção continuam distintos', () => {
  assert.match(P.falhasSecaoHtml({ estado: 'carregando', falhas: [] }), /Lendo as falhas/);
  assert.match(P.falhasSecaoHtml({ estado: 'pronto', falhas: [] }), /Nenhuma falha registrada/);
  assert.match(P.falhasSecaoHtml({ estado: 'erro', falhas: [] }), /Não deu para ler/);
});
