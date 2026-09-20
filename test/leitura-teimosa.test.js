// Ler JSON que OUTRO processo reescreve (v2.62.3).
//
// Medido no Farol real nos boots de 18 e 19/09/2026: "~/.claude.json ilegivel; nao vou
// pre-confiar o workspace". O arquivo estava íntegro e com JSON válido depois, e o Claude Code
// regrava ele o tempo todo: a leitura caiu no meio da escrita alheia. O efeito era a confiança
// do workspace deixar de ser semeada, e a primeira sessão poder parar no diálogo bloqueante.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import io from '../lib/io.js';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-leitura-teimosa-'));
after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ } });

function arquivo(nome, conteudo) {
  const p = path.join(BASE, nome);
  fs.writeFileSync(p, conteudo, 'utf8');
  return p;
}

test('JSON íntegro sai na primeira tentativa', () => {
  const r = io.lerJsonTeimoso(arquivo('ok.json', '{"projects":{"a":1}}'));
  assert.deepEqual(r.data, { projects: { a: 1 } });
  assert.equal(r.tentativas, 1);
});

test('leitura no meio da escrita alheia: a tentativa seguinte resolve', () => {
  let n = 0;
  const ler = () => { n++; return n < 2 ? '{"projects":{"a"' : '{"projects":{"a":1}}'; };
  const r = io.lerJsonTeimoso('qualquer.json', { ler });
  assert.equal(r.ok, true);
  assert.equal(r.tentativas, 2, 'a primeira pegou o arquivo pela metade');
});

test('arquivo ilegível de verdade desiste depois do teto de tentativas', () => {
  let n = 0;
  const ler = () => { n++; return 'isto nao e json'; };
  const r = io.lerJsonTeimoso('qualquer.json', { tentativas: 3, ler });
  assert.equal(r.ok, false);
  assert.equal(r.tentativas, 3);
  assert.equal(n, 3, 'tentou as três vezes antes de desistir');
  assert.ok(r.motivo, 'o motivo do parse acompanha a recusa');
});

test('arquivo ausente não vira tentativa repetida', () => {
  const r = io.lerJsonTeimoso(path.join(BASE, 'nao-existe.json'));
  assert.equal(r.ok, false);
  assert.equal(r.motivo, 'ausente');
  assert.equal(r.tentativas, 1);
});

test('nunca escreve nada: o arquivo é de outro dono', () => {
  const p = arquivo('torto.json', '{quebrado');
  const antes = fs.readdirSync(BASE).length;
  io.lerJsonTeimoso(p);
  assert.deepEqual(fs.readdirSync(BASE).length, antes, 'sem .bad, sem backup, sem reescrita');
  assert.equal(fs.readFileSync(p, 'utf8'), '{quebrado');
});
