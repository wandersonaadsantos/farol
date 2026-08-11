'use strict';
// Versionamento: as TRES fontes de versao do repo tem que concordar SEMPRE
// (package.json, CHANGELOG.md e RELEASE_NOTES do ui/app.js). Historico real de
// erro que motivou esta trava (pedido do Wanderson, 10/08/2026): fonte bumpado
// sem publicar (v2.28.0 no fonte com v2.26.1 instalada), spec citando uma
// versao e a release saindo com outra (releitura do Consumo: escrita como
// v2.38.0, publicada como v2.39.0), e sessoes paralelas colidindo no mesmo
// numero. A referencia de SEQUENCIA e a ultima release publicada no GitHub
// (checada pelo tools/publish-release.ps1, que recusa numero repetido ou
// menor); aqui trava-se o que da pra travar OFFLINE: consistencia interna.
// Ver CLAUDE.md, secao "Versionamento (regras firmes)".
const path = require('node:path');
const fs = require('node:fs');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const changelog = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
const appjs = fs.readFileSync(path.join(ROOT, 'ui', 'app.js'), 'utf8');

const SEMVER = /^\d+\.\d+\.\d+$/;

function releaseNotesVersions() {
  const m = appjs.match(/const RELEASE_NOTES = \[([\s\S]*?)\n\];/);
  assert.ok(m, 'RELEASE_NOTES existe no ui/app.js');
  const versions = [];
  const re = /^\s*\['(\d+\.\d+\.\d+)',/gm;
  let x;
  while ((x = re.exec(m[1]))) versions.push(x[1]);
  assert.ok(versions.length > 0, 'RELEASE_NOTES tem ao menos uma entrada');
  return versions;
}

const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
};

test('package.json tem versao semver valida', () => {
  assert.match(pkg.version, SEMVER, `versao "${pkg.version}" nao e X.Y.Z`);
});

test('CHANGELOG.md tem a secao da versao do package.json, com corpo', () => {
  const re = new RegExp(`^## v${pkg.version.replace(/\./g, '\\.')}\\s*$`, 'm');
  assert.match(changelog, re,
    `CHANGELOG.md sem "## v${pkg.version}": bump de versao anda SEMPRE junto do changelog (e a secao vira o corpo da release no publish)`);
  const start = changelog.search(re);
  const rest = changelog.slice(start).split('\n').slice(1);
  const end = rest.findIndex(l => /^## /.test(l));
  const body = rest.slice(0, end < 0 ? undefined : end).join('\n').trim();
  assert.ok(body.length > 40, `a secao v${pkg.version} do CHANGELOG esta vazia ou rala demais pra virar corpo de release`);
});

test('RELEASE_NOTES (ui/app.js) abre com a MESMA versao do package.json', () => {
  const versions = releaseNotesVersions();
  assert.equal(versions[0], pkg.version,
    `RELEASE_NOTES[0] e ${versions[0]} mas package.json e ${pkg.version}: as Novidades da aba Sistema mentiriam a versao. Bump sempre atualiza os DOIS.`);
});

test('RELEASE_NOTES e estritamente decrescente, sem versao repetida', () => {
  const versions = releaseNotesVersions();
  for (const v of versions) assert.match(v, SEMVER, `entrada "${v}" nao e semver`);
  for (let i = 1; i < versions.length; i++) {
    assert.ok(cmp(versions[i - 1], versions[i]) > 0,
      `RELEASE_NOTES fora de ordem: ${versions[i - 1]} vem antes de ${versions[i]} (tem que ser estritamente decrescente; repetida = colisao de sessoes paralelas)`);
  }
});

test('CHANGELOG nao tem versao DEPOIS da atual (secao fantasma acima do bump)', () => {
  const all = [...changelog.matchAll(/^## v(\d+\.\d+\.\d+)\s*$/gm)].map(x => x[1]);
  assert.ok(all.length > 0, 'CHANGELOG tem secoes de versao');
  for (const v of all) {
    assert.ok(cmp(v, pkg.version) <= 0,
      `CHANGELOG tem secao v${v} MAIOR que o package.json (${pkg.version}): ou faltou bump, ou a secao e de uma versao que nao existe`);
  }
  assert.equal(all[0], pkg.version, 'a secao mais recente do CHANGELOG e a versao atual');
});
