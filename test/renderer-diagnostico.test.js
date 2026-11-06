import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, EDITAVEIS, paraGravar, sanear } from '../lib/settings.js';
import { quedaInesperada, recarregarJanela } from '../lib/renderer-recovery.js';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-renderer-diagnostico-'));
process.env.FAROL_HOME = home;
const { iniciarDiagnosticoQuedas } = await import('../lib/diagnostico-quedas.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('coletor de dumps nasce desligado, sem diretório ou chamada ao Electron', () => {
  const inesperado = () => { throw new Error('não deve iniciar'); };
  for (const config of [{}, null, { diagnosticoQuedas: false }, { diagnosticoQuedas: 'true' }]) {
    assert.deepEqual(iniciarDiagnosticoQuedas({ setPath: inesperado }, { start: inesperado }, config), { ativo: false });
  }
  assert.equal(fs.existsSync(path.join(home, 'diagnostico-quedas')), false);
  assert.equal(defaults(0).diagnosticoQuedas, false);
  assert.equal(EDITAVEIS.has('diagnosticoQuedas'), false);
  assert.equal('diagnosticoQuedas' in paraGravar(defaults(0)), false);
  assert.equal(sanear('diagnosticoQuedas', 'true'), false);
  assert.equal(sanear('diagnosticoQuedas', true), true);
});

test('opt-in explícito fixa pasta privada antes de iniciar, sem envio nem URL remota', () => {
  const chamadas = [];
  const app = { setPath: (key, value) => chamadas.push({ key, value }) };
  const reporter = { start: options => chamadas.push({ options }) };
  fs.writeFileSync(path.join(home, 'config.json'), '{"diagnosticoQuedas":true}');
  assert.deepEqual(iniciarDiagnosticoQuedas(app, reporter), { ativo: true });
  assert.deepEqual(chamadas, [
    { key: 'crashDumps', value: path.join(home, 'diagnostico-quedas') },
    { options: { uploadToServer: false, ignoreSystemCrashHandler: true } },
  ]);
  assert.equal(Object.hasOwn(chamadas[1].options, 'submitURL'), false);
  if (process.platform !== 'win32') assert.equal(fs.statSync(chamadas[0].value).mode & 0o777, 0o700);
});

test('não inicia com pasta recusada e a falha de diagnóstico não derruba o boot', () => {
  let iniciou = false;
  const result = iniciarDiagnosticoQuedas({ setPath: () => { throw new Error('pasta indisponível'); } },
    { start: () => { iniciou = true; } }, { diagnosticoQuedas: true });
  assert.equal(result.ativo, false);
  assert.equal(iniciou, false);
  assert.match(result.erro, /pasta indisponível/);
});

test('saída limpa e encerramento do app não causam recuperação nem registro de queda', () => {
  assert.equal(quedaInesperada({ reason: 'clean-exit' }, false), false);
  assert.equal(quedaInesperada({ reason: 'crashed' }, true), false);
  assert.equal(quedaInesperada({ reason: 'oom' }, false), true);
  assert.equal(quedaInesperada(undefined, false), true);
});

test('recuperação da janela observa a conclusão e a rejeição assíncrona de loadURL', async () => {
  const carregadas = [], falhas = [];
  const window = { isDestroyed: () => false, loadURL: async url => { carregadas.push(url); } };
  assert.equal(await recarregarJanela(window, 'http://127.0.0.1:1234', msg => falhas.push(msg)), true);
  assert.deepEqual(carregadas, ['http://127.0.0.1:1234']);
  window.loadURL = async () => { throw new Error('servidor temporariamente indisponível'); };
  assert.equal(await recarregarJanela(window, 'http://127.0.0.1:1234', msg => falhas.push(msg)), false);
  assert.deepEqual(falhas, ['não foi possível recarregar a janela após a queda: servidor temporariamente indisponível']);
  window.isDestroyed = () => true;
  assert.equal(await recarregarJanela(window, 'http://127.0.0.1:1234', msg => falhas.push(msg)), false);
  assert.equal(falhas.length, 1);
});
