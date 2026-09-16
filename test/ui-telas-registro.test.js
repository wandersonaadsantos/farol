// O registro de telas (ui/telas/registro.js) é puro, sem DOM: roda direto no node --test,
// sem o stub do dom-stub.js. Cobre o contrato que switchTab e connect() passaram a confiar:
// achar tela por id, preservar ordem de registro e recusar id duplicado ou ausente.
//
// O módulo guarda estado no próprio módulo (um Map), então cada teste usa ids próprios
// para não colidir com os outros testes deste arquivo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registrarTela, telasRegistradas, telaPorId } from '../ui/telas/registro.js';

test('tela registrada aparece em telaPorId e em telasRegistradas', () => {
  const tela = { id: 'teste-achar', aoEntrar: () => {} };
  registrarTela(tela);
  assert.equal(telaPorId('teste-achar'), tela);
  assert.ok(telasRegistradas().includes(tela));
});

test('telasRegistradas devolve na ordem de registro', () => {
  const a = { id: 'teste-ordem-a' };
  const b = { id: 'teste-ordem-b' };
  const c = { id: 'teste-ordem-c' };
  registrarTela(a);
  registrarTela(b);
  registrarTela(c);
  const registradas = telasRegistradas();
  const ia = registradas.indexOf(a);
  const ib = registradas.indexOf(b);
  const ic = registradas.indexOf(c);
  assert.ok(ia < ib && ib < ic, 'a ordem de registro precisa ser preservada, e é isso que mantém a ordem de render igual à de antes');
});

test('registrar o mesmo id duas vezes lança, e a mensagem cita o id', () => {
  registrarTela({ id: 'teste-duplicado' });
  assert.throws(
    () => registrarTela({ id: 'teste-duplicado' }),
    /teste-duplicado/,
    'dois registros do mesmo id renderizariam a aba duas vezes por evento',
  );
});

test('registrar sem id lança', () => {
  assert.throws(() => registrarTela({}), /sem id/);
  assert.throws(() => registrarTela(null), /sem id/);
});

test('telaPorId de id desconhecido devolve null, não undefined disfarçado', () => {
  const resultado = telaPorId('teste-nunca-registrado');
  assert.equal(resultado, null);
  assert.notEqual(resultado, undefined);
});
