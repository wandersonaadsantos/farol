// A taxonomia de perfil existe DUAS vezes: em lib/taxonomy.js (engine, é o que o
// prompt da revisão lê) e em ui/pure.js (as tabelas dos <select> da aba Time).
//
// A duplicação é ESTRUTURAL, não descuido: o servidor estático só entrega o que
// está sob UI_DIR (o `startsWith(UI_DIR)` em lib/http-server.js), então o
// navegador não tem como importar lib/. Copiar era a única saída.
//
// O que ninguém defendia era a consequência: chave nova no engine (um papel, um
// domínio, um nível) não aparece na UI, e o silêncio é total. A pessoa marca o
// perfil na tela, o valor novo simplesmente não está na lista, e a revisão segue
// no tom antigo sem nada reclamar.
//
// Este teste compara os CONJUNTOS DE CHAVES, nunca os rótulos. Os rótulos DIVERGEM
// de propósito, porque na UI eles precisam caber num <select>: "Infra" no lugar de
// "Infra/DevOps", "Interm." no lugar de "Intermediário". Travar rótulo aqui só
// geraria falha chata sem defender nada.
//
// A UI tem uma opção a mais em dois eixos, e ela também é de propósito: o valor ''
// ("papel", "sem info") é o "não marcado", que no engine é a ausência da chave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PAPEL_LEVELS, DOMAINS, DOMAIN_LEVELS } from '../lib/taxonomy.js';
import { PAPEL_OPTS, DOMAIN_DEFS, DOMLEVEL_OPTS } from '../ui/pure.js';

// chaves de uma tabela de opções da UI, sem o '' de "não marcado"
const chavesUi = (opts) => new Set(opts.map(([v]) => v).filter(Boolean));

const EIXOS = [
  ['papel', PAPEL_LEVELS, PAPEL_OPTS, true],
  ['domínio', DOMAINS, DOMAIN_DEFS, false],
  ['nível de domínio', DOMAIN_LEVELS, DOMLEVEL_OPTS, true],
];

for (const [nome, doEngine, daUi, temVazio] of EIXOS) {
  test(`${nome}: a UI oferece exatamente as chaves que o engine conhece`, () => {
    const engine = new Set(doEngine);
    const ui = chavesUi(daUi);
    const faltando = [...engine].filter(k => !ui.has(k));
    const sobrando = [...ui].filter(k => !engine.has(k));
    assert.deepEqual(faltando, [],
      `${nome}: existe no engine e a UI não oferece, então ninguém consegue marcar: ${faltando.join(', ')}`);
    assert.deepEqual(sobrando, [],
      `${nome}: a UI oferece e o engine não entende, então marcar não faz efeito: ${sobrando.join(', ')}`);
  });

  test(`${nome}: a opção "não marcado" da UI ${temVazio ? 'existe' : 'não existe'}`, () => {
    const vazias = daUi.filter(([v]) => v === '').length;
    assert.equal(vazias, temVazio ? 1 : 0,
      temVazio
        ? `${nome}: sem a opção vazia não dá pra desmarcar alguém que foi marcado por engano`
        : `${nome}: domínio é uma linha fixa da matriz, não tem "nenhum"`);
  });
}

test('a ordem do engine é preservada na UI (a lista não pode embaralhar entre releases)', () => {
  // não é capricho: a ordem dos papéis é a progressão de carreira (estágio ->
  // especialista) e a dos níveis é a de competência. Um <select> fora de ordem
  // faz a pessoa marcar errado por leitura rápida.
  assert.deepEqual([...chavesUi(PAPEL_OPTS)], [...PAPEL_LEVELS]);
  assert.deepEqual([...chavesUi(DOMLEVEL_OPTS)], [...DOMAIN_LEVELS]);
  assert.deepEqual([...chavesUi(DOMAIN_DEFS)], [...DOMAINS]);
});

test('todo rótulo da UI é texto de verdade (a chave sozinha na tela seria vazamento)', () => {
  for (const [nome, , daUi] of EIXOS) {
    for (const [valor, rotulo] of daUi) {
      assert.equal(typeof rotulo, 'string', `${nome}: ${valor} sem rótulo`);
      assert.ok(rotulo.trim().length > 0, `${nome}: ${valor} com rótulo vazio`);
    }
  }
});

// Guarda-corpo do próprio teste: se um dia alguém esvaziar as tabelas, os deepEqual
// acima passam com dois conjuntos vazios e este arquivo vira verde permanente.
test('as tabelas não estão vazias (senão este teste passaria sem checar nada)', () => {
  assert.ok(PAPEL_LEVELS.length >= 5, 'PAPEL_LEVELS encolheu demais');
  assert.ok(DOMAINS.length >= 3, 'DOMAINS encolheu demais');
  assert.ok(DOMAIN_LEVELS.length >= 3, 'DOMAIN_LEVELS encolheu demais');
  assert.ok(PAPEL_OPTS.length > PAPEL_LEVELS.length, 'PAPEL_OPTS perdeu a opção vazia');
});
