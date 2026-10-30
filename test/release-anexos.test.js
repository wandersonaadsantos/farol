// Plano 4 do Farol nativo, Task 5: o que sobe na release. Os dois modos do
// tools/publish-release.ps1 (local e FAROL_SO_ANEXAR=1) pedem a lista a UMA função pura,
// tools/release/anexos-da-release.js, para não divergirem.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { anexosDaRelease } from '../tools/release/anexos-da-release.js';

const V = '3.1.4';
const TODOS = [
  'farol-v3.1.4.zip',
  'mac/Farol-3.1.4.dmg',
  'mac/appcast.xml',
  'win/Farol-3.1.4.msix',
  'win/Farol.appinstaller',
  'Farol-Setup-v3.1.4.exe',
  'Farol-Instalar-mac.command',
  'Farol-Instalar-mac-x64.command',
];

test('sem o pacote leve: erro e nada a anexar', () => {
  const r = anexosDaRelease({ versao: V, existentes: TODOS.slice(1) });
  assert.equal(r.erro, 'pacote leve ausente');
  assert.deepEqual(r.anexar, []);
});

test('tudo presente: a lista inteira, na ordem fixa', () => {
  const embaralhado = [...TODOS].reverse();
  const r = anexosDaRelease({ versao: V, existentes: embaralhado });
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.anexar, TODOS);
  assert.deepEqual(r.faltando, []);
});

test('os artefatos nativos também valem na raiz do dist', () => {
  const r = anexosDaRelease({ versao: V, existentes: ['farol-v3.1.4.zip', 'Farol-3.1.4.dmg', 'appcast.xml', 'Farol-3.1.4.msix', 'Farol.appinstaller'] });
  assert.deepEqual(r.anexar, ['farol-v3.1.4.zip', 'Farol-3.1.4.dmg', 'appcast.xml', 'Farol-3.1.4.msix', 'Farol.appinstaller']);
});

// abaixo da 3.0.0 (as releases de ponte do Electron) os nativos continuam opcionais
const V2 = '2.80.0';

test('2.x parcial: faltando nomeia cada ausente, sem erro', () => {
  const r = anexosDaRelease({ versao: V2, existentes: ['farol-v2.80.0.zip', 'mac/Farol-2.80.0.dmg', 'mac/appcast.xml'] });
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.anexar, ['farol-v2.80.0.zip', 'mac/Farol-2.80.0.dmg', 'mac/appcast.xml']);
  assert.deepEqual(r.faltando, ['Farol-2.80.0.msix', 'Farol.appinstaller', 'Farol-Setup-v2.80.0.exe',
    'Farol-Instalar-mac.command', 'Farol-Instalar-mac-x64.command']);
});

test('2.x sem nenhum nativo: só aviso, o pacote leve sobe', () => {
  const r = anexosDaRelease({ versao: V2, existentes: ['farol-v2.80.0.zip', 'Farol-Setup-v2.80.0.exe'] });
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.anexar, ['farol-v2.80.0.zip', 'Farol-Setup-v2.80.0.exe']);
  for (const nome of ['Farol-2.80.0.dmg', 'appcast.xml', 'Farol-2.80.0.msix', 'Farol.appinstaller']) {
    assert.ok(r.faltando.includes(nome), `${nome} devia constar em faltando`);
  }
});

test('appcast e appinstaller só sobem com o dmg e o msix que eles apontam', () => {
  const r = anexosDaRelease({ versao: V2, existentes: ['farol-v2.80.0.zip', 'mac/appcast.xml', 'win/Farol.appinstaller'] });
  assert.deepEqual(r.anexar, ['farol-v2.80.0.zip']);
  for (const nome of ['Farol-2.80.0.dmg', 'appcast.xml', 'Farol-2.80.0.msix', 'Farol.appinstaller']) {
    assert.ok(r.faltando.includes(nome), `${nome} devia constar em faltando`);
  }
  assert.equal(r.retidos.length, 2);
  assert.match(r.retidos[0], /appcast\.xml.*Farol-2\.80\.0\.dmg/);
  assert.match(r.retidos[1], /Farol\.appinstaller.*Farol-2\.80\.0\.msix/);
});

test('dmg de outra versão não conta', () => {
  const r = anexosDaRelease({ versao: V2, existentes: ['farol-v2.80.0.zip', 'mac/Farol-2.79.0.dmg', 'mac/appcast.xml'] });
  assert.deepEqual(r.anexar, ['farol-v2.80.0.zip']);
});

test('3.x com os quatro nativos e sem os do Electron: passa, Electron só como aviso', () => {
  const nativos = ['farol-v3.1.4.zip', 'mac/Farol-3.1.4.dmg', 'mac/appcast.xml', 'win/Farol-3.1.4.msix', 'win/Farol.appinstaller'];
  const r = anexosDaRelease({ versao: V, existentes: nativos });
  assert.equal(r.erro, undefined);
  assert.deepEqual(r.anexar, nativos);
  assert.deepEqual(r.faltando, ['Farol-Setup-v3.1.4.exe', 'Farol-Instalar-mac.command', 'Farol-Instalar-mac-x64.command']);
});

for (const ausente of ['mac/Farol-3.1.4.dmg', 'mac/appcast.xml', 'win/Farol-3.1.4.msix', 'win/Farol.appinstaller']) {
  test(`3.x sem ${ausente}: erro nomeando o arquivo e nada a anexar`, () => {
    const r = anexosDaRelease({ versao: V, existentes: TODOS.filter((p) => p !== ausente) });
    assert.match(r.erro ?? '', /artefato nativo ausente na release 3\.1\.4/);
    assert.ok(r.erro.includes(path.basename(ausente)), r.erro);
    assert.deepEqual(r.anexar, []);
  });
}

test('3.x sem o dmg: o appcast retido também entra no erro', () => {
  const r = anexosDaRelease({ versao: V, existentes: TODOS.filter((p) => p !== 'mac/Farol-3.1.4.dmg') });
  assert.match(r.erro, /Farol-3\.1\.4\.dmg, appcast\.xml/);
});

test('3.0.0 já exige os nativos', () => {
  const r = anexosDaRelease({ versao: '3.0.0', existentes: ['farol-v3.0.0.zip'] });
  assert.match(r.erro ?? '', /artefato nativo ausente/);
});

test('versão malformada lança', () => {
  assert.throws(() => anexosDaRelease({ versao: '3.1', existentes: [] }), /versao malformada/);
});

test('linha de comando lê o dist e imprime JSON', () => {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-anexos-'));
  fs.mkdirSync(path.join(dist, 'mac'));
  fs.writeFileSync(path.join(dist, 'farol-v2.80.0.zip'), 'x');
  fs.writeFileSync(path.join(dist, 'mac', 'Farol-2.80.0.dmg'), 'x');
  const r = spawnSync(process.execPath, [path.join(import.meta.dirname, '..', 'tools', 'release', 'anexos-da-release.js'), V2, dist], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const saida = JSON.parse(r.stdout);
  assert.deepEqual(saida.anexar, ['farol-v2.80.0.zip', 'mac/Farol-2.80.0.dmg']);
  fs.rmSync(dist, { recursive: true, force: true });
});
