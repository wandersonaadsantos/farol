// O update no modo casca (Farol nativo, Task 7): o bundle da casca é só leitura e assinado,
// então o pacote leve é instalado em ~/.farol/engine/<versão> (nunca no lugar), a casca é
// avisada da próxima versão e o motor sai de propósito com o código 75 para ela religá-lo.
// FAROL_HOME temporário antes do import; nenhum teste deixa o process.exit de verdade rodar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-update-casca-'));
process.env.FAROL_HOME = HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { aplicarNaCasca } = await import('../lib/engine/update-casca.js');
const update = (await import('../lib/engine/update.js')).default;
const { publicarCasca, lerCasca } = await import('../lib/engine/casca-arquivo.js');
const { CASCA, TEMPOS } = await import('../lib/constants.js');
const { APP_VERSION } = await import('../lib/paths.js');
const { Engine } = await import('../server.js');

const exitReal = process.exit;
let exitDeVerdade = 0;
process.exit = (codigo) => { exitDeVerdade += 1; throw new Error(`process.exit(${codigo}) chamado na suíte`); };
after(() => {
  process.exit = exitReal;
  delete process.env.FAROL_SHELL;
  fs.rmSync(HOME, { recursive: true, force: true });
});

let seq = 0;
function pasta(nome) {
  seq += 1;
  const dir = path.join(HOME, `${nome}-${seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function escrever(raiz, rel, conteudo) {
  const alvo = path.join(raiz, rel);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  fs.writeFileSync(alvo, conteudo);
}
function pacote(versao = '2.80.0') {
  const origem = pasta('pacote');
  escrever(origem, 'server.js', 'novo');
  escrever(origem, 'package.json', JSON.stringify({ name: 'farol', version: versao, engines: { node: '>=24.22.1 <25', farolShell: '>=3.0.0 <4' } }));
  escrever(origem, 'lib/algo.js', 'novo');
  for (const inst of ['install-linux.sh', 'install.sh', 'install.ps1']) escrever(origem, `installer/${inst}`, '#');
  return origem;
}
function motorFalso(origem, versao = '2.80.0') {
  const eventos = [];
  return {
    eventos,
    update: { source: origem, sourceVersion: versao },
    emit: (nome, p) => eventos.push([nome, p]),
  };
}
// relógio falso: guarda o callback e o atraso, roda quando o teste manda
function relogio() {
  const agendados = [];
  return { agendados, setTimeout: (fn, ms) => { agendados.push({ fn, ms }); } };
}
function deps() {
  const saidas = [];
  const reaberturas = [];
  const r = relogio();
  return {
    saidas, reaberturas, relogio: r,
    raiz: pasta('bundle'),
    pastaEngine: path.join(pasta('home'), 'engine'),
    exit: (codigo) => saidas.push(codigo),
    setTimeout: r.setTimeout,
    marcarReaberturaSilenciosa: (v) => reaberturas.push(v),
  };
}

beforeEach(() => { publicarCasca({ config: {} }, 47191); });

test('aplicarNaCasca instala em ~/.farol/engine/<versão> e sai com 75 depois de avisar', () => {
  const d = deps();
  const engine = motorFalso(pacote());
  const r = aplicarNaCasca(engine, d);
  assert.deepEqual(r, { ok: true, from: APP_VERSION, to: '2.80.0' });
  assert.equal(fs.readFileSync(path.join(d.pastaEngine, '2.80.0', 'server.js'), 'utf8'), 'novo');
  assert.equal(fs.readFileSync(path.join(d.pastaEngine, '2.80.0', 'lib/algo.js'), 'utf8'), 'novo');
  assert.equal(fs.existsSync(path.join(d.pastaEngine, '2.80.0.tmp')), false);
  assert.equal(lerCasca().proximaVersao, '2.80.0');
  assert.equal(lerCasca().porta, 47191, 'o resto do casca.json fica');
  assert.deepEqual(d.reaberturas, ['2.80.0']);
  assert.deepEqual(engine.eventos.find(([n]) => n === 'casca-saida'), ['casca-saida', { motivo: 'update', proximaVersao: '2.80.0' }]);
  assert.ok(engine.eventos.some(([n, p]) => n === 'toast' && p.kind === 'info' && /2\.80\.0/.test(p.text)));
  assert.deepEqual(d.saidas, [], 'não sai antes do atraso');
  assert.equal(d.relogio.agendados.length, 1);
  assert.equal(d.relogio.agendados[0].ms, TEMPOS.SAIDA_DEPOIS_DO_UPDATE_MS);
  d.relogio.agendados[0].fn();
  assert.deepEqual(d.saidas, [CASCA.CODIGO_SAIDA_DE_PROPOSITO]);
  assert.equal(CASCA.CODIGO_SAIDA_DE_PROPOSITO, 75);
  assert.deepEqual(fs.readdirSync(d.raiz), [], 'o bundle não é tocado');
});

test('recusa checkout git', () => {
  const d = deps();
  fs.mkdirSync(path.join(d.raiz, '.git'));
  const engine = motorFalso(pacote());
  const r = aplicarNaCasca(engine, d);
  assert.equal(r.ok, false);
  assert.match(r.error, /git pull/);
  assert.ok(engine.eventos.some(([n, p]) => n === 'toast' && p.kind === 'error' && /git pull/.test(p.text)));
  assert.equal(fs.existsSync(path.join(d.pastaEngine, '2.80.0')), false);
  assert.equal(lerCasca().proximaVersao, null);
  assert.deepEqual(d.relogio.agendados, []);
  assert.ok(!engine.eventos.some(([n]) => n === 'casca-saida'));
});

test('cópia que falha no meio não deixa pasta final', () => {
  const d = deps();
  const origem = pacote();
  fs.rmSync(path.join(origem, 'server.js'));
  const engine = motorFalso(origem);
  const r = aplicarNaCasca(engine, d);
  assert.equal(r.ok, false);
  assert.match(r.error, /server\.js/);
  assert.equal(fs.existsSync(path.join(d.pastaEngine, '2.80.0.tmp')), false);
  assert.equal(fs.existsSync(path.join(d.pastaEngine, '2.80.0')), false);
  assert.equal(lerCasca().proximaVersao, null);
  assert.deepEqual(d.reaberturas, []);
  assert.deepEqual(d.relogio.agendados, []);
});

test('sobra de tentativa anterior (.tmp e pasta final) é substituída pela cópia nova', () => {
  const d = deps();
  escrever(path.join(d.pastaEngine, '2.80.0.tmp'), 'lixo.js', 'x');
  escrever(path.join(d.pastaEngine, '2.80.0'), 'server.js', 'parcial antigo');
  const r = aplicarNaCasca(motorFalso(pacote()), d);
  assert.equal(r.ok, true, String(r.error));
  assert.equal(fs.readFileSync(path.join(d.pastaEngine, '2.80.0', 'server.js'), 'utf8'), 'novo');
  assert.equal(fs.existsSync(path.join(d.pastaEngine, '2.80.0', 'lixo.js')), false);
  assert.equal(fs.existsSync(path.join(d.pastaEngine, '2.80.0.tmp')), false);
});

test('versão fora do formato X.Y.Z é recusada sem tocar o disco', () => {
  const d = deps();
  const r = aplicarNaCasca(motorFalso(pacote(), '../fora'), d);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(d.pastaEngine), false);
  assert.deepEqual(d.relogio.agendados, []);
});

test('no modo casca o applyUpdate desvia para a pasta de versões, nunca para a troca no lugar', async () => {
  process.env.FAROL_SHELL = 'mac';
  try {
    const d = deps();
    const origem = pacote();
    const engine = new Engine();
    engine.config.updateRepo = '';
    engine.update = { current: APP_VERSION, channel: 'remote', repo: 'x/y', source: origem, sourceVersion: '2.80.0', available: true, checkedAt: Date.now() };
    const casca = [];
    engine.on('casca-saida', (p) => casca.push(p));
    const r = await update.applyUpdate(engine, {
      checkUpdate: async () => engine.update,
      downloadRemoteUpdate: async () => origem,
      electronVersion: '',
      religar: () => { throw new Error('a troca no lugar não pode rodar no modo casca'); },
      ...d,
    });
    assert.equal(r.ok, true, String(r.error));
    assert.equal(fs.readFileSync(path.join(d.pastaEngine, '2.80.0', 'server.js'), 'utf8'), 'novo');
    assert.deepEqual(casca, [{ motivo: 'update', proximaVersao: '2.80.0' }]);
    d.relogio.agendados[0].fn();
    assert.deepEqual(d.saidas, [75]);
  } finally { delete process.env.FAROL_SHELL; }
});

test('o process.exit de verdade nunca foi chamado', () => { assert.equal(exitDeVerdade, 0); });
