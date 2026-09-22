// Cada regra do gate mecânico do Farol tem ao menos 1 caso que viola e
// 1 que não viola. As contagens alimentam o ratchet (gate.js), então o que se
// testa aqui é: a regra ENXERGA a violação e NÃO alucina em código limpo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFile } from '../tools/quality/rules.js';
import { comparar } from '../tools/quality/gate.js';

test('emptyCatch: pega catch {} e catch (e) {}, ignora catch com corpo', () => {
  const r = scanFile('try{a()}catch{}\ntry{b()}catch(e){}\ntry{c()}catch(e){log(e)}', 'x.js');
  assert.equal(r.emptyCatch, 2);
});

test('emptyCatch: catch vazio COM comentario de intencao nao conta', () => {
  // o comentario e removido pelo strip, entao o corpo fica so espacos; a regra
  // usa o fonte CRU pra checar se havia comentario dentro do corpo
  const r = scanFile('try{a()}catch{/* best-effort: log nunca derruba */}', 'x.js');
  assert.equal(r.emptyCatch, 0);
});

test('varUse: pega var, ignora dentro de string', () => {
  const r = scanFile(`var a = 1; const s = 'var b';`, 'x.js');
  assert.equal(r.varUse, 1);
});

test('jsonParseCru: conta JSON.parse fora de arquivo santuario', () => {
  assert.equal(scanFile('const a = JSON.parse(s);', 'ui/app.js').jsonParseCru, 1);
  // io.js e o wrapper legitimo (readJson): la ele mora com try/catch
  assert.equal(scanFile('const a = JSON.parse(s);', 'lib/io.js').jsonParseCru, 0);
});

test('processEnvDireto: conta fora da fonte unica, zera dentro', () => {
  assert.equal(scanFile('const x = process.env.FOO;', 'server.js').processEnvDireto, 1);
  assert.equal(scanFile('const x = process.env.FOO;', 'lib/env.js').processEnvDireto, 0);
});

test('ternarioAninhado: pega 2 ? no mesmo statement, ignora ?. e ??', () => {
  assert.equal(scanFile('const a = x ? y ? 1 : 2 : 3;', 'x.js').ternarioAninhado, 1);
  assert.equal(scanFile('const a = b?.c ?? (d ? 1 : 2);', 'x.js').ternarioAninhado, 0);
});

test('tempoMagico: literal de tempo em propriedade e multiplicacao de minutos', () => {
  assert.equal(scanFile('f({ timeout: 60000 });', 'x.js').tempoMagico, 1);
  assert.equal(scanFile('const t = 30 * 60 * 1000;', 'x.js').tempoMagico, 1);
  assert.equal(scanFile('f({ timeout: TEMPOS.GH });', 'x.js').tempoMagico, 0);
});

test('portaLiteral: 47170 fora de lib/constants.js conta', () => {
  assert.equal(scanFile('const p = 47170;', 'server.js').portaLiteral, 1);
  assert.equal(scanFile('const p = 47170;', 'lib/constants.js').portaLiteral, 0);
});

// maxLines conta as linhas uteis ACIMA do teto, nao 0/1. Binario, arquivo que ja estava
// na baseline crescia sem o ratchet ver: o server.js foi de 2144 para 2326 linhas entre
// 15 e 22/09/2026 com o gate verde em todos os commits.
const linhas = (n) => Array.from({ length: n }, (_, i) => `x${i}();`).join('\n');

test('maxLines: zero ate 400 linhas nao vazias', () => {
  assert.equal(scanFile(linhas(400), 'x.js').maxLines, 0);
  assert.equal(scanFile('a();\nb();', 'x.js').maxLines, 0);
});

test('maxLines: conta as linhas nao vazias acima de 400', () => {
  assert.equal(scanFile(linhas(401), 'x.js').maxLines, 1);
  assert.equal(scanFile(linhas(650), 'x.js').maxLines, 250);
  assert.equal(scanFile(linhas(650) + '\n\n\n', 'x.js').maxLines, 250);
});

test('maxLines: arquivo acima do teto que cresce reprova no ratchet', () => {
  const base = { 'x.js': scanFile(linhas(650), 'x.js') };
  const cresceu = { 'x.js': scanFile(linhas(651), 'x.js') };
  const encolheu = { 'x.js': scanFile(linhas(600), 'x.js') };
  assert.deepEqual(comparar(cresceu, base).regressoes, ['x.js: maxLines subiu de 250 pra 251']);
  assert.deepEqual(comparar(encolheu, base).regressoes, []);
});

test('profundidadeExcedida: chaves aninhadas alem de 3 dentro de funcao', () => {
  const fundo = 'function f(){ if(a){ if(b){ if(c){ if(d){ x(); } } } } }';
  assert.equal(scanFile(fundo, 'x.js').profundidadeExcedida >= 1, true);
  assert.equal(scanFile('function f(){ if(a){ x(); } }', 'x.js').profundidadeExcedida, 0);
});
