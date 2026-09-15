// A suspeita de contagem dobrada (spec 7.A1, item 1) só se decide com o stream REAL.
// Este teste trava a aritmética do instrumento sobre fixtures sintéticas: se o script
// medir errado, a correção do acumulador sairia de um número errado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-medicao-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const med = await import('../tools/medicao/contagem-dobrada.js');
const SCRIPT = path.join(import.meta.dirname, '..', 'tools', 'medicao', 'contagem-dobrada.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const linha = (o) => JSON.stringify(o);
const assistant = (id, usage) => linha({ type: 'assistant', message: { id, content: [{ type: 'text', text: 'x' }], usage } });
const resultado = (usage) => linha({ type: 'result', is_error: false, result: 'ok', usage, total_cost_usd: 1 });

const DOBRADA = [
  linha({ type: 'system', subtype: 'init', model: 'claude-opus-5' }),
  assistant('msg_1', { input_tokens: 10, output_tokens: 100 }),
  assistant('msg_1', { input_tokens: 10, output_tokens: 100 }),
  assistant('msg_2', { input_tokens: 5, output_tokens: 50 }),
  'linha que não é JSON',
  resultado({ input_tokens: 15, output_tokens: 150 }),
].join('\n');

test('mesmo message.id repetido com o mesmo uso: acumulador soma duas vezes e o desfecho é dobrada', () => {
  const m = med.medirContagem(DOBRADA);
  assert.equal(m.eventosAssistant, 3);
  assert.equal(m.mensagensUnicas, 2);
  assert.equal(m.repetidos, 1);
  assert.equal(m.repetidosDiferentes, 0);
  assert.equal(m.acumulador.output_tokens, 250);
  assert.equal(m.dedup.output_tokens, 150);
  assert.equal(m.final.output_tokens, 150);
  assert.equal(m.desfecho, 'dobrada');
});

test('sem id repetido o desfecho é sem-repeticao', () => {
  const texto = [assistant('a', { output_tokens: 7 }), assistant('b', { output_tokens: 3 }), resultado({ output_tokens: 10 })].join('\n');
  assert.equal(med.medirContagem(texto).desfecho, 'sem-repeticao');
});

test('id repetido com uso incremental: a soma é a certa e o desfecho é soma-correta', () => {
  const texto = [assistant('m', { output_tokens: 40 }), assistant('m', { output_tokens: 60 }), resultado({ output_tokens: 100 })].join('\n');
  const m = med.medirContagem(texto);
  assert.equal(m.repetidosDiferentes, 1);
  assert.equal(m.dedup.output_tokens, 60, 'dedup guarda o último uso de cada id');
  assert.equal(m.desfecho, 'soma-correta');
});

test('id repetido sem evento final não conclui nada', () => {
  const texto = [assistant('m', { output_tokens: 40 }), assistant('m', { output_tokens: 40 })].join('\n');
  assert.equal(med.medirContagem(texto).desfecho, 'inconclusiva-sem-final');
});

test('nenhuma soma perto do final: divergente', () => {
  const texto = [assistant('m', { output_tokens: 40 }), assistant('m', { output_tokens: 40 }), resultado({ output_tokens: 500 })].join('\n');
  assert.equal(med.medirContagem(texto).desfecho, 'divergente');
});

test('extrairFixture guarda só tipo, id e uso: nada de conteúdo da sessão', () => {
  const fixture = med.extrairFixture(DOBRADA);
  assert.doesNotMatch(fixture, /"text"/);
  assert.doesNotMatch(fixture, /claude-opus-5/);
  assert.equal(med.medirContagem(fixture).desfecho, 'dobrada', 'a fixture reproduz a medição');
});

test('CLI imprime o relatório e grava a fixture; sem argumento sai com 2', () => {
  const env = { ...process.env, FAROL_HOME };
  const arquivo = path.join(FAROL_HOME, 'stream.jsonl');
  fs.writeFileSync(arquivo, DOBRADA);
  const ok = spawnSync(process.execPath, [SCRIPT, arquivo], { encoding: 'utf8', env });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /desfecho: dobrada/);
  const saida = path.join(FAROL_HOME, 'fixture.jsonl');
  const comFixture = spawnSync(process.execPath, [SCRIPT, arquivo, '--fixture', saida], { encoding: 'utf8', env });
  assert.equal(comFixture.status, 0, comFixture.stderr);
  assert.equal(med.medirContagem(fs.readFileSync(saida, 'utf8')).desfecho, 'dobrada');
  assert.equal(spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env }).status, 2);
});
