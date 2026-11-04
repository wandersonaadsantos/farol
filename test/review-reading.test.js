import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-read-evidence-'));
process.env.FAROL_HOME = home;
const { observeReadEvent, observarLeitura, relatarCoberturaEmSombra } = await import('../lib/engine/read-evidence.js');
const { batchedReadBlock } = await import('../lib/engine/review-reading.js');
const { scopeBlock } = await import('../lib/engine/pr-scope.js');
const settings = await import('../lib/settings.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const root = path.join(home, 'patches');
fs.mkdirSync(root);
for (const name of ['a.js', 'b.js', 'c.js', 'd.js']) fs.writeFileSync(path.join(root, name), 'first\nsecond\nthird\n');
const opts = { id: 'review' };
function fixture(enabled = true) {
  const review = { scopeRoot: root, filesRead: new Set() };
  return { config: { reviewBatchedReads: enabled }, activeReviews: new Map([[opts.id, review]]), review };
}
function request(engine, file, id, parent = null) {
  const block = { type: 'tool_use', name: 'Read', id, input: { file_path: path.join(root, file) } };
  observeReadEvent(engine, opts, { type: 'assistant', parent_tool_use_id: parent, message: { content: [block] } });
  observarLeitura(engine, opts, block);
}
function response(engine, file, id, { start = 1, lines = ['first', 'second', 'third'], parent = null, error = false, display = null } = {}) {
  const content = display ?? lines.map((line, i) => ` ${start + i}→${line}`).join('\n');
  observeReadEvent(engine, opts, { type: 'user', parent_tool_use_id: parent,
    tool_use_result: { type: 'text', file: { filePath: path.join(root, file), content: lines.join('\n'), startLine: start, numLines: lines.length, totalLines: 3 } },
    message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: error, content }] } });
}

test('agendamento é opt-in estrito e mantém instruções de leitura completa e observabilidade', () => {
  assert.equal(settings.defaults(0).reviewBatchedReads, false);
  assert.equal(settings.paraGravar(settings.defaults(0)).reviewBatchedReads, undefined);
  assert.equal(settings.EDITAVEIS.has('reviewBatchedReads'), false);
  for (const value of [undefined, false, 'true', 1]) {
    assert.equal(settings.sanear('reviewBatchedReads', value), false);
    assert.equal(batchedReadBlock({ reviewBatchedReads: value }), '');
    assert.match(scopeBlock({ root, total: ['a.js'] }, { reviewBatchedReads: value }), /um por vez/);
  }
  assert.match(batchedReadBlock({ reviewBatchedReads: true }), /QUATRO chamadas Read independentes/);
  assert.match(batchedReadBlock({ reviewBatchedReads: true }), /Complete resultados truncados/);
  assert.doesNotMatch(scopeBlock({ root, total: ['a.js'] }, { reviewBatchedReads: true }), /um por vez/);
});

test('padrão mantém observação anterior; experimento exige resultado individual de cada Read', () => {
  const legacy = fixture(false); request(legacy, 'a.js', 'r1'); assert.deepEqual([...legacy.review.filesRead], ['a.js']);
  const e = fixture();
  for (const [i, file] of ['a.js', 'b.js', 'c.js', 'd.js'].entries()) request(e, file, `r${i}`);
  assert.equal(e.review.filesRead.size, 0);
  response(e, 'b.js', 'r1'); response(e, 'd.js', 'r3');
  assert.deepEqual([...e.review.filesRead].sort(), ['b.js', 'd.js']);
  response(e, 'a.js', 'r0'); response(e, 'c.js', 'r2'); assert.equal(e.review.filesRead.size, 4);
});

test('erro, ausência, caminho diferente, conteúdo adulterado e resultado truncado não concedem leitura', () => {
  for (const options of [{ error: true }, { lines: ['changed', 'second', 'third'] }, { display: ' 1→first\n[truncated]' }]) {
    const e = fixture(); request(e, 'a.js', 'read'); response(e, 'a.js', 'read', options); assert.equal(e.review.filesRead.size, 0);
  }
  const e = fixture(); request(e, 'a.js', 'read'); response(e, 'b.js', 'read'); response(e, 'a.js', 'unknown');
  assert.equal(e.review.filesRead.size, 0);
});

test('leitura parcial só fecha ao completar todas as linhas, sem preencher lacunas ou duplicar cobertura', () => {
  const e = fixture();
  request(e, 'a.js', 'first'); response(e, 'a.js', 'first', { lines: ['first'] });
  request(e, 'a.js', 'last'); response(e, 'a.js', 'last', { start: 3, lines: ['third'] });
  assert.equal(e.review.filesRead.size, 0);
  request(e, 'a.js', 'middle'); response(e, 'a.js', 'middle', { start: 2, lines: ['second'] });
  response(e, 'a.js', 'middle', { start: 2, lines: ['second'] }); assert.deepEqual([...e.review.filesRead], ['a.js']);
});

test('resultado de outro agente ou de fora do escopo não satisfaz leitura pendente', () => {
  const e = fixture(); request(e, 'a.js', 'same', 'agent-a');
  response(e, 'a.js', 'same', { parent: 'agent-b' }); assert.equal(e.review.filesRead.size, 0);
  response(e, 'a.js', 'same', { parent: 'agent-a' }); assert.equal(e.review.filesRead.size, 1);
  request(e, '../outside.js', 'outside'); response(e, '../outside.js', 'outside');
  assert.equal(e.review.filesRead.size, 1);
});

test('formato nativo inclui linha vazia final e aceita separador tab sem apagar conteúdo ou lacunas', () => {
  const e = fixture(); request(e, 'a.js', 'native');
  response(e, 'a.js', 'native', { lines: ['first', 'second', 'third', ''], display: '1\tfirst\n2\tsecond\n3\tthird\n4\t' });
  assert.deepEqual([...e.review.filesRead], ['a.js']);
  const truncated = fixture(); request(truncated, 'a.js', 'native');
  response(truncated, 'a.js', 'native', { lines: ['first', 'second', 'third', ''], display: '1\tfirst\n3\tthird\n4\t' });
  assert.equal(truncated.review.filesRead.size, 0);
});

function medir(enabled, roteiro) {
  const e = fixture(enabled), linhas = [];
  e.review.keys = ['o/r#9'];
  e.log = (nivel, texto) => linhas.push({ nivel, texto });
  roteiro(e);
  relatarCoberturaEmSombra(e, opts);
  return { credito: [...e.review.filesRead].sort(), linhas: linhas.map(l => l.texto), niveis: linhas.map(l => l.nivel) };
}

test('sombra: o crédito segue a regra do Read, com qualquer retorno', () => {
  const roteiros = [
    e => request(e, 'a.js', 'r'),
    e => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r'); },
    e => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { lines: ['first'] }); },
    e => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { error: true }); },
    e => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { lines: ['adulterado', 'second', 'third'] }); },
  ];
  for (const roteiro of roteiros) assert.deepEqual(medir(false, roteiro).credito, ['a.js']);
});

test('sombra: retorno comprovado sem o bloco que credita não vira crédito', () => {
  const e = fixture(false);
  const block = { type: 'tool_use', name: 'Read', id: 'r', input: { file_path: path.join(root, 'a.js') } };
  observeReadEvent(e, opts, { type: 'assistant', parent_tool_use_id: null, message: { content: [block] } });
  response(e, 'a.js', 'r');
  relatarCoberturaEmSombra(e, opts);
  assert.equal(e.review.filesRead.size, 0);
});

test('sombra: com a prova valendo, o crédito segue a prova e a divergência também é medida', () => {
  const r = medir(true, (e) => { request(e, 'a.js', 'r1'); response(e, 'a.js', 'r1'); request(e, 'b.js', 'r2'); response(e, 'b.js', 'r2', { lines: ['first'] }); });
  assert.deepEqual(r.credito, ['a.js']);
  assert.equal(r.linhas.length, 1);
  assert.match(r.linhas[0], /b\.js/);
});

test('sombra: divergência registra arquivo, linhas entregues e faltantes, sem conteúdo', () => {
  const parcial = medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { lines: ['first'] }); });
  assert.deepEqual(parcial.niveis, ['INFO']);
  assert.match(parcial.linhas[0], /o\/r#9/);
  assert.match(parcial.linhas[0], /a\.js: .*motivo parcial; entregues 1; faltantes 2-3\)/);
  assert.doesNotMatch(parcial.linhas[0], /first|second|third/);

  const buraco = medir(false, (e) => {
    request(e, 'a.js', 'r1'); response(e, 'a.js', 'r1', { start: 3, lines: ['third'] });
    request(e, 'a.js', 'r2'); response(e, 'a.js', 'r2', { start: 1, lines: ['first'] });
  });
  assert.match(buraco.linhas[0], /entregues 1,3; faltantes 2\)/);

  const semRetorno = medir(false, e => request(e, 'a.js', 'r'));
  assert.match(semRetorno.linhas[0], /motivo sem-retorno; entregues nenhuma; faltantes 1-3\)/);

  const erro = medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { error: true }); });
  assert.match(erro.linhas[0], /motivo erro-do-read; entregues nenhuma; faltantes 1-3\)/);

  const adulterado = medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { lines: ['segredo-adulterado', 'second', 'third'] }); });
  assert.match(adulterado.linhas[0], /motivo conteudo-divergente/);
  assert.doesNotMatch(adulterado.linhas[0], /segredo-adulterado/);
});

test('sombra: as duas regras concordando não registram nada, nem leitura em partes completa', () => {
  assert.deepEqual(medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r'); }).linhas, []);
  assert.deepEqual(medir(false, (e) => {
    request(e, 'a.js', 'r1'); response(e, 'a.js', 'r1', { lines: ['first'] });
    request(e, 'a.js', 'r2'); response(e, 'a.js', 'r2', { start: 2, lines: ['second', 'third'] });
  }).linhas, []);
  assert.deepEqual(medir(false, () => {}).linhas, []);
});

test('sombra: relatório repetido não duplica, e o log tem teto por sessão', () => {
  const e = fixture(false), linhas = [];
  e.log = (_n, texto) => linhas.push(texto);
  request(e, 'a.js', 'r');
  relatarCoberturaEmSombra(e, opts); relatarCoberturaEmSombra(e, opts);
  assert.equal(linhas.length, 1);
  const muitos = fixture(false), saida = [];
  muitos.log = (_n, texto) => saida.push(texto);
  for (let i = 0; i < 40; i++) request(muitos, `f${i}.js`, `r${i}`);
  relatarCoberturaEmSombra(muitos, opts);
  assert.equal(saida.length, 31);
  assert.match(saida.at(-1), /mais 10 arquivo/);
  assert.match(saida[0], /faltantes desconhecidas/);
});

test('sombra: engine sem log e arquivo sumido não derrubam a sessão', () => {
  const e = fixture(false);
  request(e, 'nao-existe.js', 'r');
  response(e, 'nao-existe.js', 'r');
  assert.doesNotThrow(() => relatarCoberturaEmSombra(e, opts));
  assert.doesNotThrow(() => relatarCoberturaEmSombra({ config: {} }, opts));
  assert.deepEqual([...e.review.filesRead], ['nao-existe.js']);
});
