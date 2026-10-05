// Estado gravado vai para o disco antes de trocar de nome, e o log não recebe byte de controle.
//
// Medido em 04/10/2026: a máquina caiu sem desligar (Kernel-Power 41 e EventLog 6008 no log
// do Windows) e o inflight.json voltou com 2 bytes nulos no lugar do "[]". O rename sem fsync
// troca o nome, mas os dados do arquivo novo ainda podiam estar só no cache. O aviso de
// arquivo corrompido citou esse conteúdo, e os bytes nulos foram parar crus no farol.log.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-duravel-'));
process.env.FAROL_HOME = DIR;
const io = (await import('../lib/io.js')).default;
const { semControle } = await import('../lib/format.js');
const { Engine } = await import('../server.js');
const { LOG_FILE } = await import('../lib/paths.js');
after(() => fs.rmSync(DIR, { recursive: true, force: true }));

function registrarOrdem(fn) {
  const ordem = [];
  const orig = { fsyncSync: fs.fsyncSync, renameSync: fs.renameSync };
  fs.fsyncSync = (fd) => { ordem.push('fsync'); return orig.fsyncSync(fd); };
  fs.renameSync = (a, b) => { ordem.push('rename'); return orig.renameSync(a, b); };
  try { fn(); } finally { Object.assign(fs, orig); }
  return ordem;
}

test('JSON e texto: fsync do temporário ANTES do rename, e o conteúdo chega inteiro', () => {
  const arq = path.join(DIR, 'estado.json');
  assert.deepEqual(registrarOrdem(() => io.writeJsonAtomic(arq, [1, 2])), ['fsync', 'rename']);
  assert.deepEqual(JSON.parse(fs.readFileSync(arq, 'utf8')), [1, 2]);
  const txt = path.join(DIR, 'seen.txt');
  assert.deepEqual(registrarOrdem(() => io.writeTextAtomic(txt, 'a\nb\n')), ['fsync', 'rename']);
  assert.equal(fs.readFileSync(txt, 'utf8'), 'a\nb\n');
  assert.equal(fs.existsSync(arq + '.tmp'), false);
});

test('arquivo zerado como o de 04/10: volta o padrão e o original fica preservado em .bad', () => {
  const arq = path.join(DIR, 'inflight.json');
  fs.writeFileSync(arq, Buffer.from([0, 0]));
  const avisos = [];
  const v = io.readJson(arq, [], (msg) => avisos.push(msg));
  assert.deepEqual(v, []);
  assert.deepEqual([...fs.readFileSync(arq + '.bad')], [0, 0], 'a prova do defeito não se perde');
  assert.equal(avisos.length, 1);
});

test('a rotação do log mede o arquivo aberto: passou do teto, vira .1 e a linha vai no novo', async () => {
  const { gravarLinhaDeLog } = await import('../lib/log-arquivo.js');
  const arq = path.join(DIR, 'rotacao.log');
  gravarLinhaDeLog(arq, 'a\n', 4);
  gravarLinhaDeLog(arq, 'b\n', 4);
  assert.equal(fs.readFileSync(arq, 'utf8'), 'a\nb\n', 'até o teto, anexa no mesmo arquivo');
  gravarLinhaDeLog(arq, 'c\n', 3);
  assert.equal(fs.readFileSync(arq + '.1', 'utf8'), 'a\nb\n', 'o anterior vira .1 inteiro');
  assert.equal(fs.readFileSync(arq, 'utf8'), 'c\n');
});

test('o log escapa byte de controle e mantém quebra de linha e tabulação', () => {
  assert.equal(semControle('a\u0000\u0000b'), 'a\\u0000\\u0000b');
  assert.equal(semControle('x\ty\nz\r'), 'x\ty\nz\r');
  assert.equal(semControle('del\u007f esc\u001b'), 'del\\u007f esc\\u001b');
  const e = new Engine();
  e.log('WARN', 'inflight.json corrompido (Unexpected token \u0000 in JSON)');
  const log = fs.readFileSync(LOG_FILE);
  assert.equal(log.includes(0), false, 'nenhum byte nulo cru no farol.log');
  assert.match(log.toString('utf8'), /Unexpected token \\u0000 in JSON/);
});
