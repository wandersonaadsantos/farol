import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-read-evidence-'));
process.env.FAROL_HOME = home;
const { observeReadEvent, observarLeitura, relatarCoberturaEmSombra } = await import('../lib/engine/read-evidence.js');
const { ARQUIVO_DE_MEDICOES, TETO_EM_BYTES, registrarMedicao } = await import('../lib/engine/medicoes-leitura.js');
const { triage } = await import('../lib/log-taxonomy.js');
const { LOG_FILE } = await import('../lib/paths.js');
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

const medicoes = () => {
  try { return fs.readFileSync(ARQUIVO_DE_MEDICOES, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)); }
  catch { return []; }
};

function medir(enabled, roteiro) {
  fs.rmSync(ARQUIVO_DE_MEDICOES, { force: true });
  const e = fixture(enabled), log = [];
  e.review.keys = ['o/r#9'];
  e.log = (nivel, texto) => log.push(`${nivel} ${texto}`);
  roteiro(e);
  relatarCoberturaEmSombra(e, opts);
  return { credito: [...e.review.filesRead].sort(), registros: medicoes(), log };
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
  assert.deepEqual(r.registros.map(m => m.arquivo), ['b.js']);
});

test('sombra: divergência registra arquivo, linhas entregues e faltantes, sem conteúdo e fora do log', () => {
  const parcial = medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { lines: ['first'] }); });
  const [m] = parcial.registros;
  assert.equal(m.tipo, 'cobertura-sombra');
  assert.equal(m.pr, 'o/r#9');
  assert.equal(m.arquivo, 'a.js');
  assert.deepEqual([m.motivos, m.total, m.entregues, m.faltantes, m.faixasOmitidas], [['parcial'], 3, [[1, 1]], [[2, 3]], 0]);
  assert.deepEqual(parcial.log, []);
  assert.doesNotMatch(JSON.stringify(m), /first|second|third/);

  const buraco = medir(false, (e) => {
    request(e, 'a.js', 'r1'); response(e, 'a.js', 'r1', { start: 3, lines: ['third'] });
    request(e, 'a.js', 'r2'); response(e, 'a.js', 'r2', { start: 1, lines: ['first'] });
  }).registros[0];
  assert.deepEqual([buraco.entregues, buraco.faltantes], [[[1, 1], [3, 3]], [[2, 2]]]);

  const semRetorno = medir(false, e => request(e, 'a.js', 'r')).registros[0];
  assert.deepEqual([semRetorno.motivos, semRetorno.entregues, semRetorno.faltantes], [['sem-retorno'], [], [[1, 3]]]);

  const erro = medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { error: true }); }).registros[0];
  assert.deepEqual([erro.motivos, erro.faltantes], [['erro-do-read'], [[1, 3]]]);

  const adulterado = medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r', { lines: ['segredo-adulterado', 'second', 'third'] }); }).registros[0];
  assert.deepEqual(adulterado.motivos, ['conteudo-divergente']);
  assert.doesNotMatch(JSON.stringify(adulterado), /segredo-adulterado/);
});

test('sombra: as duas regras concordando não registram nada, nem leitura em partes completa', () => {
  assert.deepEqual(medir(false, (e) => { request(e, 'a.js', 'r'); response(e, 'a.js', 'r'); }).registros, []);
  assert.deepEqual(medir(false, (e) => {
    request(e, 'a.js', 'r1'); response(e, 'a.js', 'r1', { lines: ['first'] });
    request(e, 'a.js', 'r2'); response(e, 'a.js', 'r2', { start: 2, lines: ['second', 'third'] });
  }).registros, []);
  assert.deepEqual(medir(false, () => {}).registros, []);
});

test('sombra: relatório repetido não duplica, e os arquivos têm teto por sessão', () => {
  const uma = medir(false, (e) => { request(e, 'a.js', 'r'); relatarCoberturaEmSombra(e, opts); });
  assert.equal(uma.registros.length, 1);
  const muitos = medir(false, (e) => {
    for (let i = 0; i < 40; i++) request(e, `f${i}.js`, `r${i}`);
    relatarCoberturaEmSombra(e, opts);
    for (let i = 40; i < 45; i++) request(e, `f${i}.js`, `r${i}`);
  });
  assert.equal(muitos.registros.filter(m => m.tipo === 'cobertura-sombra').length, 30);
  assert.deepEqual(muitos.registros.filter(m => m.tipo === 'cobertura-sombra-teto').map(m => m.omitidos), [10]);
  assert.equal(muitos.registros[0].faltantes, null, 'arquivo que não existe: total desconhecido, sem chute');
});

test('sombra: faixas têm teto por registro, e o que ficou de fora é contado', () => {
  const nome = 'longo.js';
  const linhas = Array.from({ length: 60 }, (_, i) => `l${i + 1}`);
  fs.writeFileSync(path.join(root, nome), linhas.join('\n') + '\n');
  const [m] = medir(false, (e) => {
    for (let i = 1; i <= 41; i += 2) {
      request(e, nome, `r${i}`);
      response(e, nome, `r${i}`, { start: i, lines: [linhas[i - 1]] });
    }
  }).registros;
  assert.equal(m.entregues.length, 10);
  assert.equal(m.faltantes.length, 10);
  assert.ok(m.faixasOmitidas > 0);
});

test('sombra: engine sem log e arquivo sumido não derrubam a sessão', () => {
  const e = fixture(false);
  request(e, 'nao-existe.js', 'r');
  response(e, 'nao-existe.js', 'r');
  assert.doesNotThrow(() => relatarCoberturaEmSombra(e, opts));
  assert.doesNotThrow(() => relatarCoberturaEmSombra({ config: {} }, opts));
  assert.deepEqual([...e.review.filesRead], ['nao-existe.js']);
});

test('depois de muitas sessões divergentes, o ERROR real continua na triagem', () => {
  const erroReal = '[2026-11-04 10:00:00 -03:00] [ERROR] gh saiu com código 1 ao ler o/r#1';
  const logDoApp = [erroReal];
  const engine = { config: { reviewBatchedReads: false }, log: (nivel, texto) => logDoApp.push(`[2026-11-04 10:00:01 -03:00] [${nivel}] ${texto}`) };
  for (let sessao = 0; sessao < 12; sessao++) {
    const id = `s${sessao}`, opcoes = { id };
    engine.activeReviews = new Map([[id, { scopeRoot: root, filesRead: new Set(), keys: ['o/r#9'] }]]);
    for (let i = 0; i < 30; i++) {
      const block = { type: 'tool_use', name: 'Read', id: `r${i}`, input: { file_path: path.join(root, `f${i}.js`) } };
      observeReadEvent(engine, opcoes, { type: 'assistant', parent_tool_use_id: null, message: { content: [block] } });
      observarLeitura(engine, opcoes, block);
    }
    observarLeitura(engine, opcoes, { type: 'tool_use', name: 'Read', input: { file_path: path.join(os.homedir(), '.ssh', 'id_rsa') } });
    relatarCoberturaEmSombra(engine, opcoes);
  }
  assert.ok(medicoes().length >= 12 * 30, 'a medição foi feita');
  assert.deepEqual(logDoApp, [erroReal], 'nada de medição no log do app');
  assert.equal(fs.existsSync(LOG_FILE), false, 'nem por fora do engine.log');
  const grupos = triage(logDoApp.slice(-300));
  assert.equal(grupos.reduce((soma, g) => soma + g.count, 0), 1);
  assert.match(grupos[0].sample, /gh saiu com código 1/);
});

test('o arquivo de medições roda ao passar do teto e fica limitado a duas gerações', () => {
  fs.rmSync(ARQUIVO_DE_MEDICOES, { force: true });
  registrarMedicao('x', { p: 'a'.repeat(TETO_EM_BYTES + 10) });
  registrarMedicao('y', {});
  assert.ok(fs.statSync(`${ARQUIVO_DE_MEDICOES}.1`).size > TETO_EM_BYTES);
  assert.deepEqual(medicoes().map(m => m.tipo), ['y']);
  fs.rmSync(`${ARQUIVO_DE_MEDICOES}.1`, { force: true });
});
