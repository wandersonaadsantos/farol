// Um bump de Electron precisa executar o binário nos três desktops.
// A suíte de Node sozinha continuava verde mesmo sem instalar a dependência.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

function exigirSmoke(texto) {
  const runtime = /^  electron:\r?\n([\s\S]*?)(?=^  [\w-]+:|$(?![\s\S]))/m.exec(texto)?.[1];
  assert.ok(runtime, 'matriz Electron ausente');
  assert.match(runtime, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(runtime, /node lib\/electron-runtime.js required package.json/);
  assert.match(runtime, /npm install[^\n]+"electron@\$version"/);
  assert.match(runtime, /node node_modules\/electron\/install.js/);
  assert.match(runtime, /node lib\/electron-runtime.js check-installed \./);
  assert.equal((runtime.match(/node tools\/electron-smoke.js --output/g) || []).length, 2);
  assert.doesNotMatch(runtime, /continue-on-error:\s*true/);
  assert.match(texto, /needs: \[gate, electron\]/);
  assert.match(texto, /if \[ "\$\{\{ needs\.electron\.result \}\}" != "success" \]; then\s*echo[^\n]+\s*exit 1/);
}

test('CI executa o Electron declarado nos três sistemas e exige seu resultado', () => {
  exigirSmoke(workflow);
});

test('contraprovas: remover desktop, execução ou gate do runtime reprova', () => {
  for (const alterado of [
    workflow.replace('  electron:', '  sem-runtime:'),
    workflow.replaceAll('ubuntu-latest, windows-latest, macos-latest', 'ubuntu-latest, windows-latest'),
    workflow.replaceAll('node tools/electron-smoke.js --output', 'echo smoke --output'),
    workflow.replace('node node_modules/electron/install.js', 'echo binario'),
    workflow.replace('needs: [gate, electron]', 'needs: [gate]'),
    workflow.replace('needs.electron.result', 'needs.gate.result'),
  ]) assert.throws(() => exigirSmoke(alterado));
});
