// Plano 4 do Farol nativo, Task 5: o tools/publish-release.ps1 no modo da pipeline
// (FAROL_SO_ANEXAR=1), que não constrói nada e anexa o que está no dist. Roda numa CÓPIA
// do que o script precisa, numa pasta temporária, com um `gh` falso primeiro no PATH que
// só grava os argumentos: nada aqui alcança o GitHub. Confere que o `gh release create`
// recebe exatamente o que o anexosDaRelease devolve e que a nota da release não leva
// rodapé de ferramenta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { anexosDaRelease } from '../tools/release/anexos-da-release.js';

const RAIZ = path.join(import.meta.dirname, '..');
const existe = (cmd, args) => { const r = spawnSync(cmd, args); return !r.error && r.status === 0; };
const PWSH = ['/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh', '/usr/bin/pwsh'].find((p) => fs.existsSync(p))
  || (existe('pwsh', ['-v']) ? 'pwsh' : null);
const COM_PWSH = { skip: PWSH ? false : 'pwsh ausente nesta máquina' };
const V = '3.1.4';

function montarArvore() {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-publish-'));
  const copiar = (rel) => fs.cpSync(path.join(RAIZ, rel), path.join(raiz, rel), { recursive: true });
  for (const rel of ['lib', 'tools/publish-release.ps1', 'tools/release-footer.md', 'tools/release/anexos-da-release.js']) copiar(rel);
  fs.writeFileSync(path.join(raiz, 'package.json'), `{ "name": "farol", "version": "${V}", "type": "module" }\n`);
  fs.writeFileSync(path.join(raiz, 'CHANGELOG.md'), `# Changelog\n\n## v${V}\n\n- casca nativa nos dois sistemas\n\n## v3.1.3\n\n- antiga\n`);
  const dist = path.join(raiz, 'dist');
  for (const rel of [`farol-v${V}.zip`, `mac/Farol-${V}.dmg`, 'mac/appcast.xml', 'win/Farol.appinstaller']) {
    fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
    fs.writeFileSync(path.join(dist, rel), 'x');
  }
  // o gh falso: um script node que grava os argumentos (uma linha JSON por chamada) e
  // responde "não existe" a todo `release view`, sucesso ao resto
  const bin = path.join(raiz, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(raiz, 'gh.log');
  const falso = path.join(bin, 'gh-falso.mjs');
  fs.writeFileSync(falso, `import fs from 'node:fs';
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
process.exitCode = args[0] === 'release' && args[1] === 'view' ? 1 : 0;
`);
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nexec "${process.execPath}" "${falso}" "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'gh.cmd'), `@"${process.execPath}" "${falso}" %*\r\n`);
  return { raiz, dist, bin, log };
}

test('FAROL_SO_ANEXAR=1: anexa o que o anexosDaRelease devolve, sem construir nada', COM_PWSH, () => {
  const { raiz, dist, bin, log } = montarArvore();
  try {
    const env = { ...process.env, FAROL_SO_ANEXAR: '1',
      PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter) };
    delete env.FAROL_REPUBLISH;
    delete env.GH_TOKEN;
    const r = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-File', path.join(raiz, 'tools', 'publish-release.ps1')],
      { encoding: 'utf8', env });
    assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
    const chamadas = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const create = chamadas.find((a) => a[0] === 'release' && a[1] === 'create');
    assert.ok(create, `sem gh release create: ${JSON.stringify(chamadas)}`);
    assert.equal(create[2], `v${V}`);
    const arquivos = create.slice(3, create.indexOf('--repo'));
    const existentes = [`farol-v${V}.zip`, `mac/Farol-${V}.dmg`, 'mac/appcast.xml', 'win/Farol.appinstaller'];
    const esperado = anexosDaRelease({ versao: V, existentes }).anexar.map((rel) => path.join(dist, rel));
    assert.deepEqual(arquivos.map((a) => path.normalize(a)), esperado.map((a) => path.normalize(a)));
    // o appinstaller sem o msix fica de fora, e o aviso nomeia os ausentes
    assert.ok(!arquivos.some((a) => a.endsWith('Farol.appinstaller')));
    assert.match(r.stdout, /Farol-3\.1\.4\.msix/);
    assert.match(r.stdout, /Farol-Setup-v3\.1\.4\.exe/);
    // nada foi construído: o modo da pipeline não chama o make-package (que nem existe aqui)
    assert.ok(!fs.existsSync(path.join(dist, `Farol-Setup-v${V}.exe`)));
    const notas = fs.readFileSync(create[create.indexOf('--notes-file') + 1], 'utf8');
    assert.match(notas, /casca nativa nos dois sistemas/);
    assert.match(notas, new RegExp(`Farol-${V.replace(/\./g, '\\.')}\\.dmg`));
    assert.doesNotMatch(notas, /Generated with|Co-Authored|Anthropic|🤖/i);
    // "Claude" só aparece como o CLI que o Farol orquestra (pré-requisito), nunca como autoria
    const semPreRequisito = notas.split('\n').filter((l) => !/Pré-requisitos/.test(l)).join('\n');
    assert.doesNotMatch(semPreRequisito, /Claude/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});

test('FAROL_SO_ANEXAR=1 sem o pacote leve: falha sem criar a release', COM_PWSH, () => {
  const { raiz, dist, bin, log } = montarArvore();
  try {
    fs.rmSync(path.join(dist, `farol-v${V}.zip`));
    const env = { ...process.env, FAROL_SO_ANEXAR: '1',
      PATH: [bin, path.dirname(process.execPath), process.env.PATH].join(path.delimiter) };
    delete env.FAROL_REPUBLISH;
    const r = spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-File', path.join(raiz, 'tools', 'publish-release.ps1')],
      { encoding: 'utf8', env });
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /pacote leve ausente/);
    const chamadas = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    assert.doesNotMatch(chamadas, /"create"|"upload"|"edit"/);
  } finally {
    fs.rmSync(raiz, { recursive: true, force: true });
  }
});
