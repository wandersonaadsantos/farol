// Identidade e forma do grupo de consumo (CT-GRUPO). Puro: sem estado, sem IO.
//
// O caso mais importante deste arquivo é o que prova uma AUSÊNCIA: o id do grupo não pode
// ser derivado de credencial, nome ou caminho. A spec recusa inferência automática por
// hash, porque hash reconhece a mesma credencial e não resolve nem chaves diferentes que
// devem dividir um teto, nem a continuidade depois de uma rotação.
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import grupo from '../lib/sync/grupo.js';

const RAIZ = path.join(import.meta.dirname, '..');

test('o id é opaco, único e não aceita nada que o faça derivar de uma entrada', () => {
  const a = grupo.novoIdDeGrupo();
  const b = grupo.novoIdDeGrupo();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.equal(grupo.novoIdDeGrupo.length, 0, 'a função não recebe argumento: entrada é o que permitiria derivar');
  assert.notEqual(grupo.novoIdDeGrupo('mesmo-nome'), grupo.novoIdDeGrupo('mesmo-nome'));
});

test('nada em grupo.js deriva identidade de credencial', () => {
  const fonte = fs.readFileSync(path.join(RAIZ, 'lib', 'sync', 'grupo.js'), 'utf8');
  // a varredura mira o USO, não a prosa: o comentário do módulo explica por que o hash
  // está fora, e explicar não é usar
  for (const proibido of ['createHash(', 'createHmac(', './tags.js']) {
    assert.equal(fonte.includes(proibido), false, `${proibido} em grupo.js reabre a inferência que a spec recusa`);
  }
});

test('allowlist: chave desconhecida é descartada e o resto vale', () => {
  const g = grupo.sanearGrupo({ id: 'a'.repeat(32), nome: 'Casa', periodo: 'dia', tetoUsd: 12.5, ativar: true, bypass: 'x' });
  assert.deepEqual(Object.keys(g).sort(), ['id', 'nome', 'periodo', 'tetoUsd']);
  assert.equal(g.tetoUsd, 12.5);
});

// C4b: ativar é um campo booleano assinado. Verdade só com `true` literal.
test('ativo só vale como booleano, e o estado diz se o teto barra', () => {
  const id = 'd'.repeat(32);
  assert.equal(grupo.sanearGrupo({ id, ativo: 'sim' }).ativo, undefined);
  assert.equal(grupo.sanearGrupo({ id, ativo: 1 }).ativo, undefined);
  assert.equal(grupo.sanearGrupo({ id, ativo: false }).ativo, false);
  assert.equal(grupo.resumoDoGrupo(grupo.sanearGrupo({ id, tetoUsd: 5, ativo: true }), { vinculos: {} }).estado, 'ativo');
  assert.equal(grupo.resumoDoGrupo(grupo.sanearGrupo({ id, tetoUsd: 5, ativo: false }), { vinculos: {} }).estado, 'configurado');
  assert.equal(grupo.resumoDoGrupo(grupo.sanearGrupo({ id, ativo: true }), { vinculos: {} }).estado, 'sem-teto', 'ativo sem teto não barra nada');
});

test('requisitos da ativação: compartilhamento, teto e medição, cada um com código', () => {
  const g = { id: 'd'.repeat(32), tetoUsd: 5 };
  assert.deepEqual(grupo.requisitosDaAtivacao({ grupo: g, compartilhamento: true, medicaoFeita: true }), []);
  assert.deepEqual(grupo.requisitosDaAtivacao({ grupo: g, compartilhamento: false, medicaoFeita: true }), ['compartilhamento']);
  assert.deepEqual(grupo.requisitosDaAtivacao({ grupo: { id: g.id }, compartilhamento: true, medicaoFeita: true }), ['sem-teto']);
  assert.deepEqual(grupo.requisitosDaAtivacao({ grupo: g, compartilhamento: true, medicaoFeita: false }), ['medicao-pendente']);
  assert.deepEqual(grupo.requisitosDaAtivacao({ grupo: null, compartilhamento: true, medicaoFeita: true }), ['sem-grupo', 'sem-teto']);
});

test('teto inválido é descartado, nunca virado zero', () => {
  for (const v of [-1, 'muito', null, NaN, Infinity]) {
    assert.equal('tetoUsd' in grupo.sanearGrupo({ tetoUsd: v }), false, JSON.stringify(String(v)));
  }
  assert.equal(grupo.sanearGrupo({ tetoUsd: 0 }).tetoUsd, 0, 'zero explícito é uma escolha e vale');
});

test('período fora da lista é descartado', () => {
  assert.equal(grupo.sanearGrupo({ periodo: 'ano' }).periodo, undefined);
  for (const p of grupo.PERIODOS) assert.equal(grupo.sanearGrupo({ periodo: p }).periodo, p);
});

test('Codex é não controlado, e nunca aparece como consumo zero', () => {
  assert.equal(grupo.controlado('codex'), false);
  for (const t of ['assinatura', 'api', 'openrouter']) assert.equal(grupo.controlado(t), true);
  assert.equal(grupo.controlado('inventado'), false, 'tipo desconhecido não é controlado por otimismo');
});

test('o resumo separa as duas partes do grupo misto', () => {
  const g = grupo.sanearGrupo({ id: 'b'.repeat(32), nome: 'Casa', periodo: 'dia', tetoUsd: 10 });
  const vinculos = {
    p1: { grupo: g.id, tipo: 'assinatura' },
    p2: { grupo: g.id, tipo: 'codex' },
    p3: { grupo: 'outro', tipo: 'api' },
  };
  const r = grupo.resumoDoGrupo(g, { vinculos });
  assert.deepEqual(r.controlados, ['p1']);
  assert.deepEqual(r.naoControlados, ['p2'], 'o Codex aparece, e aparece do lado certo');
  assert.equal(r.estado, 'configurado');
});

test('grupo sem teto e perfil não identificado são estados diferentes', () => {
  const semTeto = grupo.resumoDoGrupo(grupo.sanearGrupo({ id: 'c'.repeat(32), nome: 'Casa' }), { vinculos: {} });
  assert.equal(semTeto.estado, 'sem-teto');
  assert.equal(grupo.resumoDoGrupo(null, { vinculos: {} }).estado, 'nao-identificado');
});
