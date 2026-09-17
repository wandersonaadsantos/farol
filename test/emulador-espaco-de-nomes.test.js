// O executor do roteiro de regras (tools/emuladores/regras-v2.js) mede as regras no
// emulador, e o espaço de nomes é onde ele erraria calado.
//
// MEDIDO em 16/09/2026, no emulador do banco 4.11.2: `firebase emulators:start --project
// demo-farol` carrega as regras em `demo-farol-default-rtdb` e serve `demo-farol` como um
// banco SEM REGRA NENHUMA. Uma escrita anônima na árvore de outra pessoa responde 200 em
// `ns=demo-farol` e 401 em `ns=demo-farol-default-rtdb`. Um roteiro apontado para o id do
// projeto cru ficaria inteiro verde sem medir uma regra sequer.
//
// Este caso NÃO sobe emulador: ele trava a decisão pura (o sufixo) e a leitura do
// auth_time, que são as duas coisas de que o resto do executor depende para não mentir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { espacoDeNomes, authTimeDe } from '../tools/emuladores/regras-contexto.js';

test('o espaço de nomes do emulador é o projeto com o sufixo -default-rtdb', () => {
  assert.equal(espacoDeNomes('demo-farol'), 'demo-farol-default-rtdb');
  assert.notEqual(espacoDeNomes('demo-farol'), 'demo-farol');
});

test('o auth_time sai do ID token em segundos, que é a unidade que as regras comparam', () => {
  const carga = Buffer.from(JSON.stringify({ auth_time: 1789000000 })).toString('base64url');
  assert.equal(authTimeDe(`cabecalho.${carga}.assinatura`), 1789000000);
});

test('token ilegível não vira auth_time inventado', () => {
  assert.equal(authTimeDe(''), 0);
  assert.equal(authTimeDe('nao-e-um-jwt'), 0);
});
