// Plano 4 do Farol nativo, Task 5 (decisão R-F): as versões das duas cascas e do motor
// andam juntas. A casca do macOS (MARKETING_VERSION e CURRENT_PROJECT_VERSION, que a
// Sparkle usa para ordenar) e a do Windows (Identity/@Version, quarto campo 0) têm a MESMA
// versão; essa versão cabe no engines.farolShell do motor; e quando o motor chega ao mesmo
// major das cascas, a versão dele é a mesma (hoje 2.x contra 3.0.0, depois do salto, igual).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nodeVersionSatisfies } from '../lib/node-runtime.js';

const RAIZ = path.join(import.meta.dirname, '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

function extrair(texto, regex, onde) {
  const m = regex.exec(texto);
  assert.ok(m, `${onde}: linha de versao ausente`);
  return m[1];
}

function versoes() {
  const yml = ler('shell/mac/project.yml');
  const marketing = extrair(yml, /^\s*MARKETING_VERSION:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m, 'project.yml MARKETING_VERSION');
  const build = extrair(yml, /^\s*CURRENT_PROJECT_VERSION:\s*["']?(\d+\.\d+\.\d+)["']?\s*$/m, 'project.yml CURRENT_PROJECT_VERSION');
  const identidade = extrair(ler('shell/win/Farol.App/Package.appxmanifest'), /<Identity\b([^>]*)>/, 'Package.appxmanifest Identity');
  const win = extrair(identidade, /\bVersion="(\d+\.\d+\.\d+\.\d+)"/, 'Package.appxmanifest Identity/@Version');
  const pkg = JSON.parse(ler('package.json'));
  return { marketing, build, win, motor: pkg.version, faixa: pkg.engines?.farolShell };
}

test('as duas cascas tem a mesma versao, e o quarto campo do Windows e 0', () => {
  const v = versoes();
  assert.equal(v.marketing, v.build, 'MARKETING_VERSION e CURRENT_PROJECT_VERSION andam juntas');
  const [a, b, c, d] = v.win.split('.');
  assert.equal(`${a}.${b}.${c}`, v.marketing, 'Package.appxmanifest e project.yml divergem');
  assert.equal(d, '0', 'o quarto campo da Version do MSIX e sempre 0');
});

test('a versao das cascas cabe no engines.farolShell do motor', () => {
  const v = versoes();
  assert.ok(v.faixa, 'package.json sem engines.farolShell');
  assert.ok(nodeVersionSatisfies(v.marketing, v.faixa), `casca ${v.marketing} fora de ${v.faixa}`);
});

test('motor no mesmo major das cascas tem a mesma versao delas', () => {
  const v = versoes();
  if (v.motor.split('.')[0] === v.marketing.split('.')[0]) {
    assert.equal(v.motor, v.marketing, 'motor e cascas no mesmo major com versoes diferentes');
  }
});
