// Release de ponte (plano 4 do Farol nativo, desenho 4.7): a última 2.x da casca Electron
// avisa que a 3.x é o Farol nativo e aponta o instalador, e NUNCA tenta aplicar o pacote
// 3.x (a checagem do runtime do Electron o recusaria para sempre). Fora do Electron (modo
// servidor ou casca nativa) a 3.x é um update comum.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-ponte-'));
process.env.FAROL_HOME = scratch;
const { checkUpdate, checkUpdateRemote, maybeAutoUpdate } = await import('../lib/engine/update.js');
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const REPO = 'owner/farol';
const url = (v, nome) => `https://github.com/${REPO}/releases/download/v${v}/${nome}`;
const release = (v, nomes) => ({
  ok: true,
  stdout: JSON.stringify({ tagName: 'v' + v, assets: nomes.map(name => ({ name, url: url(v, name) })) })
});

function engineFalso() {
  const emitidos = [];
  return {
    emitidos,
    config: { updateRepo: REPO },
    ghEnv: () => ({}),
    pushState() {},
    emit(evento, dado) { emitidos.push({ evento, dado }); },
  };
}

test('com Electron e release 3.0.0: não oferece o pacote, aponta dmg e msix e avisa uma vez só', async () => {
  const engine = engineFalso();
  const run = async () => release('3.0.0', ['farol-v3.0.0.zip', 'Farol-3.0.0.dmg', 'Farol-3.0.0.msix', 'Farol.appinstaller', 'appcast.xml']);
  const deps = { run, electronVersion: '39.0.0', casca: '' };
  await checkUpdateRemote(engine, REPO, deps);
  assert.equal(engine.update.available, false);
  assert.equal(engine.update.sourceVersion, '3.0.0');
  assert.deepEqual(engine.update.ponte, {
    versao: '3.0.0',
    dmg: url('3.0.0', 'Farol-3.0.0.dmg'),
    msix: url('3.0.0', 'Farol-3.0.0.msix'),
    appinstaller: url('3.0.0', 'Farol.appinstaller'),
  });
  await checkUpdateRemote(engine, REPO, deps);
  const avisos = engine.emitidos.filter(e => e.evento === 'update-ponte');
  assert.equal(avisos.length, 1, 'a notificação da ponte sai uma vez por processo e versão');
  assert.equal(avisos[0].dado.versao, '3.0.0');
  // o auto-update lê `available`: nada é baixado
  const r = await maybeAutoUpdate(engine, { electronVersion: '39.0.0' });
  assert.notEqual(r && r.ok, true);
});

test('com Electron e release 3.1.0 sem msix: o link do Windows fica nulo, nunca morto', async () => {
  const engine = engineFalso();
  const run = async () => release('3.1.0', ['farol-v3.1.0.zip', 'Farol-3.1.0.dmg']);
  await checkUpdateRemote(engine, REPO, { run, electronVersion: '39.0.0', casca: '' });
  assert.equal(engine.update.available, false);
  assert.equal(engine.update.ponte.dmg, url('3.1.0', 'Farol-3.1.0.dmg'));
  assert.equal(engine.update.ponte.msix, null);
  assert.equal(engine.update.ponte.appinstaller, null);
});

test('com Electron e release 2.x: update comum, sem ponte', async () => {
  const engine = engineFalso();
  const run = async () => release('2.999.0', ['farol-v2.999.0.zip']);
  await checkUpdateRemote(engine, REPO, { run, electronVersion: '39.0.0', casca: '' });
  assert.equal(engine.update.available, true);
  assert.equal(engine.update.ponte, undefined);
  assert.equal(engine.emitidos.length, 0);
});

test('em modo servidor (sem Electron) a 3.x é o pacote leve de sempre', async () => {
  const engine = engineFalso();
  const run = async () => release('3.0.0', ['farol-v3.0.0.zip', 'Farol-3.0.0.dmg']);
  await checkUpdateRemote(engine, REPO, { run, electronVersion: undefined, casca: '' });
  assert.equal(engine.update.available, true);
  assert.equal(engine.update.ponte, undefined);
  assert.equal(engine.emitidos.length, 0);
});

test('sob a casca nativa a 3.x também é update comum, mesmo com versão de Electron', async () => {
  const engine = engineFalso();
  const run = async () => release('3.0.0', ['farol-v3.0.0.zip', 'Farol-3.0.0.dmg']);
  await checkUpdateRemote(engine, REPO, { run, electronVersion: '39.0.0', casca: 'mac' });
  assert.equal(engine.update.available, true);
  assert.equal(engine.update.ponte, undefined);
});

// o canal local (updateSource apontando uma árvore) passa pela MESMA guarda: sem ela, o
// mantenedor com Electron e uma árvore 3.x veria o update disponível e falharia em laço
function arvore(versao) {
  const dir = fs.mkdtempSync(path.join(scratch, 'arvore-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'farol', version: versao }));
  return dir;
}

test('canal local com Electron e árvore 3.x: indisponível, com a ponte sem links', async () => {
  const engine = engineFalso();
  engine.config = { updateSource: arvore('3.2.0') };
  await checkUpdate(engine, { electronVersion: '39.0.0', casca: '' });
  assert.equal(engine.update.channel, 'local');
  assert.equal(engine.update.available, false);
  assert.deepEqual(engine.update.ponte, { versao: '3.2.0', dmg: null, msix: null, appinstaller: null });
  assert.equal(engine.emitidos.filter(e => e.evento === 'update-ponte').length, 1);
});

test('canal local sem Electron: a árvore 3.x é update comum', async () => {
  const engine = engineFalso();
  engine.config = { updateSource: arvore('3.2.1') };
  await checkUpdate(engine, { electronVersion: undefined, casca: '' });
  assert.equal(engine.update.channel, 'local');
  assert.equal(engine.update.available, true);
  assert.equal(engine.update.ponte, undefined);
});
