// Invariante estrutural da Engine: fachada fina não pode engolir argumento.
//
// Por que este arquivo existe: o fan-out de PR grande (v2.26.0) ficou DUAS versões sem
// nunca ter rodado porque `Engine.headlessPromptFor` declarava (url, author) enquanto a
// implementação recebia (engine, url, author, lotes, metrics). Os dois últimos chegavam
// undefined e o bloco era descartado. Nenhum teste pegou, porque todos exercitavam as
// funções puras, não o caminho da fachada. E o `node --check` não vê isso: é JS válido.
//
// A primeira versão desta proteção era uma tabela curada de 6 fachadas, num universo de
// quase 100: cobria o caso já queimado e dependia de alguém lembrar de acrescentar as
// próximas. Aqui a checagem é DERIVADA DO FONTE: lê o server.js, acha toda fachada que
// delega, descobre no próprio texto se ela repassa `this` como primeiro argumento, e daí
// calcula a aridade esperada. Fachada nova entra sozinha, sem ninguém lembrar de nada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-facades-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');

after(() => { try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const RAIZ = path.join(import.meta.dirname, '..');
const FONTE = fs.readFileSync(path.join(RAIZ, 'server.js'), 'utf8');

// `nome(params) { return xMod.impl(args); }`, com ou sem async/await, indentado em 2
// espaços (corpo de classe). Fachada escrita em mais de uma linha não casa e fica de
// fora da checagem: por isso o teste de piso mais abaixo.
const RE_FACHADA = /^ {2}(?:async )?([a-zA-Z_$][\w$]*)\(([^)]*)\)\s*\{\s*return (?:await )?([a-z][\w]*)Mod\.([a-zA-Z_$][\w$]*)\(([^)]*)\);?\s*\}/gm;
const RE_IMPORT = /^import (\w+)Mod from '([^']+)';/gm;

/* Exceções, com o motivo. Só entra aqui o que é comprovadamente falso positivo do
   Function.length, NUNCA uma fachada que de fato engole argumento. */
const EXCECOES = {
  // Function.length para de contar no primeiro parâmetro com default, e o 2o parâmetro
  // desta é `{ keys = [], label, id, code } = {}`. Então impl.length é 1 (só `engine`),
  // a conta daria 0, e a fachada declara 1 de propósito. Não é argumento engolido.
  handleSessionExit: 'segundo parâmetro é objeto desestruturado com default, que zera o Function.length',
  // Function.length para de contar no primeiro parâmetro com default, e o 2o parâmetro
  // desta é `agora = Date.now()`. Então impl.length é 1 (só `engine`), a conta daria 0,
  // e a fachada declara 1 de propósito (repassa `agora` direto). Não é argumento engolido.
  refreshStaleStates: 'segundo parâmetro (agora) tem default, que zera o Function.length',
  // Mesmo motivo do refreshStaleStates: o 3o parâmetro da implementação é
  // `agora = Date.now()`, então impl.length para em 2 (conta só engine e
  // inflightKeys). A fachada declara 2 (inflightKeys, agora) de propósito,
  // pra repassar o agora explícito. Não é argumento engolido.
  reReviewTargets: 'terceiro parâmetro (agora) tem default, que zera o Function.length',
  reReviewEsgotados: 'terceiro parâmetro (agora) tem default, que zera o Function.length',
};

function mapaDeModulos() {
  const mods = {};
  for (const m of FONTE.matchAll(RE_IMPORT)) mods[m[1]] = m[2];
  return mods;
}

async function coletarFachadas() {
  const mods = mapaDeModulos();
  const achadas = [];
  for (const m of FONTE.matchAll(RE_FACHADA)) {
    const [, nome, , modKey, implNome, args] = m;
    const modPath = mods[modKey];
    if (!modPath) continue;
    let impl;
    try {
      const modUrl = pathToFileURL(path.resolve(RAIZ, modPath)).href;
      const modNs = await import(modUrl);
      impl = (modNs.default || modNs)[implNome];
    } catch { continue; }
    if (typeof impl !== 'function') continue;
    achadas.push({
      nome, implNome, modKey, impl,
      // o próprio texto da delegação diz se o engine é repassado
      passaThis: /^\s*this\b/.test(args),
    });
  }
  return achadas;
}

const FACHADAS = await coletarFachadas();

/* Guarda contra passar à toa: um teste dirigido por regex que deixa de casar vira um
   laço vazio e fica verde sem verificar nada. O piso é bem abaixo do que existe hoje
   (97), pra não quebrar a cada fachada removida, mas alto o bastante pra denunciar
   uma regex que parou de casar por mudança de formatação. */
test('a varredura de fachadas casa a maior parte da Engine (guarda anti-vacuidade)', () => {
  assert.ok(FACHADAS.length >= 80,
    `só ${FACHADAS.length} fachadas casaram. A RE_FACHADA provavelmente parou de casar ` +
    `(mudança de formatação no server.js). Um laço vazio passaria em silêncio.`);
});

test('toda fachada delegante repassa o engine ou é pura, nunca meio a meio', () => {
  // sanidade do que a varredura leu: se nenhuma passasse `this`, a heurística estaria
  // quebrada e todas as aridades esperadas sairiam erradas na mesma direção
  const comThis = FACHADAS.filter(f => f.passaThis).length;
  assert.ok(comThis > 0, 'nenhuma fachada repassa this: a leitura do fonte está errada');
  assert.ok(comThis < FACHADAS.length, 'todas repassam this: as puras sumiram da varredura');
});

for (const f of FACHADAS) {
  const motivo = EXCECOES[f.nome];
  test(`fachada ${f.nome} não engole argumento${motivo ? ' (exceção conhecida)' : ''}`, { skip: motivo ? `exceção: ${motivo}` : false }, () => {
    const fachada = Engine.prototype[f.nome];
    assert.equal(typeof fachada, 'function', `Engine.prototype.${f.nome} existe`);
    const esperado = f.impl.length - (f.passaThis ? 1 : 0);
    assert.equal(fachada.length, esperado,
      `${f.nome}: a fachada declara ${fachada.length} parâmetro(s) e ${f.modKey}Mod.${f.implNome} ` +
      `recebe ${f.impl.length}${f.passaThis ? ' (sendo o 1o o engine)' : ' (sem engine)'}, ` +
      `então o esperado é ${esperado}. Argumento a mais na implementação sem estar na fachada ` +
      `chega undefined e falha EM SILÊNCIO, que foi o que matou o fan-out por duas versões. ` +
      `Se for falso positivo do Function.length (parâmetro com default), documente em EXCECOES.`);
  });
}

test('as exceções declaradas ainda existem como fachada', () => {
  // exceção que sobrevive à remoção da fachada vira licença permanente pra um nome que
  // não existe mais, e o dia que alguém recriar esse nome já nasce sem proteção
  for (const nome of Object.keys(EXCECOES)) {
    assert.ok(FACHADAS.some(f => f.nome === nome),
      `EXCECOES tem "${nome}", mas nenhuma fachada com esse nome foi encontrada. Remova a exceção.`);
  }
});
