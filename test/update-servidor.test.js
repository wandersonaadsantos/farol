// O update de quem roda só o motor (modo servidor, 15/10/2026): o celular (Termux) e a
// Hostinger rodam `node server.js` sem Electron, e o caminho de sempre recusava o update
// por falta do runtime da janela. Aqui: a troca no lugar preserva o que não vem no pacote,
// o pacote incompleto não muda nada, o checkout git não é sobrescrito, o script que religa
// espera o supervisor, e o applyUpdate sem Electron chega a esse caminho.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-update-servidor-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const update = (await import('../lib/engine/update.js')).default;
const servidor = (await import('../lib/engine/update-servidor.js')).default;
const { modoServidor } = await import('../lib/paths.js');
const { Engine } = await import('../server.js');
const P = await import('../ui/pure.js');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-update-servidor-src-'));
after(() => {
  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

let seq = 0;
function pasta(nome) {
  seq += 1;
  const dir = path.join(scratch, `${nome}-${seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function escrever(raiz, rel, conteudo) {
  const alvo = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo);
}

// o que o celular e a Hostinger têm na pasta do motor: o app, mais o que o pacote não traz
function instalacao() {
  const raiz = pasta('instalado');
  escrever(raiz, 'server.js', 'velho');
  escrever(raiz, 'package.json', JSON.stringify({ name: 'farol', version: '2.71.13' }));
  escrever(raiz, 'lib/so-no-velho.js', 'velho');
  escrever(raiz, 'node_modules/algum/index.js', 'dependencia');
  escrever(raiz, 'hostinger-entry.cjs', 'entrada da hostinger');
  return raiz;
}

function pacote() {
  const origem = pasta('pacote');
  escrever(origem, 'server.js', 'novo');
  escrever(origem, 'package.json', JSON.stringify({ name: 'farol', version: '2.71.15' }));
  escrever(origem, 'lib/so-no-novo.js', 'novo');
  // os três instaladores, como no pacote leve: a checagem de integridade procura o do SO
  for (const inst of ['install-linux.sh', 'install.sh', 'install.ps1']) escrever(origem, `installer/${inst}`, '#');
  return origem;
}

test('modoServidor: sem versão do Electron é o motor sozinho; com ela, a janela', () => {
  assert.equal(modoServidor(undefined), true);
  assert.equal(modoServidor('44.1.0'), false);
  assert.equal(modoServidor(''), false, 'versão vazia é runtime desconhecido, não ausência de Electron');
});

test('a troca no lugar põe o pacote novo e preserva o que ele não traz', () => {
  const raiz = instalacao();
  servidor.trocarArquivos(pacote(), raiz);
  assert.equal(fs.readFileSync(path.join(raiz, 'server.js'), 'utf8'), 'novo');
  assert.equal(JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version, '2.71.15');
  assert.equal(fs.existsSync(path.join(raiz, 'lib/so-no-novo.js')), true);
  assert.equal(fs.existsSync(path.join(raiz, 'lib/so-no-velho.js')), false, 'a pasta lib é trocada inteira, sem arquivo órfão da versão velha');
  assert.equal(fs.readFileSync(path.join(raiz, 'hostinger-entry.cjs'), 'utf8'), 'entrada da hostinger');
  assert.equal(fs.readFileSync(path.join(raiz, 'node_modules/algum/index.js'), 'utf8'), 'dependencia');
  assert.deepEqual(fs.readdirSync(raiz).filter((n) => /\.(novo|velho)-/.test(n)), [], 'nenhuma sobra da troca');
});

test('pacote sem server.js não toca na instalação', () => {
  const raiz = instalacao();
  const origem = pacote();
  fs.rmSync(path.join(origem, 'server.js'));
  assert.throws(() => servidor.trocarArquivos(origem, raiz), /server\.js/);
  assert.equal(fs.readFileSync(path.join(raiz, 'server.js'), 'utf8'), 'velho');
  assert.equal(fs.existsSync(path.join(raiz, 'lib/so-no-velho.js')), true);
});

test('o script que religa espera o processo sair e dá a vez ao supervisor antes de subir outro', () => {
  const s = servidor.scriptDeReligar({ pid: 4242, porta: 18731, raiz: "/home/o'brien/app", comando: ['/usr/bin/node', 'hostinger-private.mjs'] });
  assert.match(s, /kill -0 4242/);
  const espera = s.indexOf('/dev/tcp/127.0.0.1/18731');
  const sobe = s.indexOf('setsid');
  assert.ok(espera > 0 && sobe > espera, 'confere a porta ANTES de subir: supervisor que religou vence');
  assert.match(s, /exit 0/);
  assert.match(s, /cd '\/home\/o'\\''brien\/app'/, 'apóstrofo no caminho escapado');
  assert.match(s, /setsid '\/usr\/bin\/node' 'hostinger-private\.mjs'/, 'religa com o mesmo comando');
});

function motorComUpdate(origem) {
  const engine = new Engine();
  engine.config.updateRepo = '';
  engine.update = { current: '2.71.13', channel: 'remote', repo: 'x/y', source: origem, sourceVersion: '2.71.15', available: true, checkedAt: Date.now() };
  return engine;
}

test('sem Electron, o applyUpdate troca no lugar e religa, sem exigir o runtime da janela', async () => {
  const raiz = instalacao();
  const origem = pacote();
  const engine = motorComUpdate(origem);
  let religou = null;
  const r = await update.applyUpdate(engine, {
    checkUpdate: async () => engine.update,
    downloadRemoteUpdate: async () => origem,
    raiz, ehWindows: false,
    religar: (_e, onde) => { religou = onde; },
  });
  assert.equal(r.ok, true, String(r.error));
  assert.equal(r.to, '2.71.15');
  assert.equal(religou, raiz, 'religa a partir da pasta onde o motor roda');
  assert.equal(fs.readFileSync(path.join(raiz, 'server.js'), 'utf8'), 'novo');
});

test('checkout git não é sobrescrito, e a recusa diz o que fazer', async () => {
  const raiz = instalacao();
  fs.mkdirSync(path.join(raiz, '.git'));
  const origem = pacote();
  const engine = motorComUpdate(origem);
  let religou = false;
  const r = await update.applyUpdate(engine, {
    checkUpdate: async () => engine.update,
    downloadRemoteUpdate: async () => origem,
    raiz, ehWindows: false,
    religar: () => { religou = true; },
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /git pull/);
  assert.equal(religou, false);
  assert.equal(fs.readFileSync(path.join(raiz, 'server.js'), 'utf8'), 'velho');
});

test('no Windows sem a janela, recusa com a instrução do instalador', async () => {
  const raiz = instalacao();
  const origem = pacote();
  const engine = motorComUpdate(origem);
  const r = await update.applyUpdate(engine, {
    checkUpdate: async () => engine.update,
    downloadRemoteUpdate: async () => origem,
    raiz, ehWindows: true,
    religar: () => { throw new Error('não deveria religar'); },
  });
  assert.equal(r.ok, false);
  assert.match(String(r.error), /não se atualiza sozinho: rode o instalador/);
  assert.equal(fs.readFileSync(path.join(raiz, 'server.js'), 'utf8'), 'velho');
});

const AP = { deviceId: 'd1', nome: 'Celular', platform: 'linux', versao: '2.71.13', vistoEm: Date.now(), abriu: true, pausado: false, paralelismo: 2, ocupadas: 0, iaPronta: true, aceitarAdmin: true, contas: [], falhas: [], publicadoEm: Date.now() };

test('o painel do aparelho só diz "em dia" quando a versão alcança a última release', () => {
  const atrasado = P.painelDoAparelhoHtml(AP, { ultimaVersao: '2.71.14' });
  assert.doesNotMatch(atrasado, /em dia/);
  assert.match(atrasado, /a 2\.71\.14 já saiu/);
  assert.match(P.painelDoAparelhoHtml(AP, { ultimaVersao: '2.71.13' }), /em dia/);
  const semReferencia = P.painelDoAparelhoHtml(AP, {});
  assert.doesNotMatch(semReferencia, /em dia/, 'sem a última release não há como afirmar');
});
