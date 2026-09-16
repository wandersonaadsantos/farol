// O contrato do diretório ui/telas: todo módulo de tela se registra, e nenhum importa o
// ui/app.js de volta. Import de volta é o ciclo que esta fase existe para evitar: em módulo
// ES ele não explode, o valor lido no topo vem undefined, e o sintoma é tela em branco com a
// suíte verde.
import test from 'node:test';
import assert from 'node:assert/strict';
import { arquivosDasTelas } from './helpers/fontes-ui.js';

test('nenhum modulo de ui/telas importa o ui/app.js', () => {
  const culpados = arquivosDasTelas()
    .filter((a) => a.nome !== 'app.js')
    .filter((a) => /from '\.\.\/app\.js'/.test(a.texto))
    .map((a) => a.nome);
  assert.deepEqual(culpados, [], 'modulo de tela importando o bootstrap de volta cria ciclo');
});

test('todo modulo de tela com aba se registra', () => {
  const semRegistro = arquivosDasTelas()
    .filter((a) => a.nome !== 'app.js' && /aoEntrar|aoEstado/.test(a.texto))
    .filter((a) => !/registrarTela\(/.test(a.texto))
    .map((a) => a.nome);
  assert.deepEqual(semRegistro, [], 'tela que declara aoEntrar/aoEstado precisa chamar registrarTela');
});
