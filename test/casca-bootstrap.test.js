// Bootstrap de versão da casca nativa: o motor semeado no bundle procura em ~/.farol/engine
// a maior versão instalada compatível com a casca e se reexecuta a partir dela.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-casca-bootstrap-'));
process.env.FAROL_HOME = path.join(TMP, 'home');

let mod;
let paths;
before(async () => {
  mod = await import('../lib/engine/casca-bootstrap.js');
  paths = await import('../lib/paths.js');
});

function motor(pastaEngine, nome, manifesto, { semServer = false } = {}) {
  const raiz = path.join(pastaEngine, nome);
  fs.mkdirSync(raiz, { recursive: true });
  if (manifesto !== undefined) fs.writeFileSync(path.join(raiz, 'package.json'), typeof manifesto === 'string' ? manifesto : JSON.stringify(manifesto));
  if (!semServer) fs.writeFileSync(path.join(raiz, 'server.js'), '');
  return raiz;
}

function pastaNova() {
  return fs.mkdtempSync(path.join(TMP, 'engine-'));
}

const COMPATIVEL = { farolShell: '>=3.0.0 <4' };

test('ENGINE_DIR mora no HOME do Farol e bootstrapFeito lê FAROL_BOOTSTRAP_FEITO', () => {
  assert.equal(paths.ENGINE_DIR, path.join(paths.HOME, 'engine'));
  assert.equal(paths.bootstrapFeito({ FAROL_BOOTSTRAP_FEITO: '1' }), true);
  assert.equal(paths.bootstrapFeito({}), false);
  assert.equal(paths.bootstrapFeito({ FAROL_BOOTSTRAP_FEITO: '' }), false);
  assert.equal(paths.ambienteDoBootstrap({ A: 'b' }).FAROL_BOOTSTRAP_FEITO, '1');
  assert.equal(paths.ambienteDoBootstrap({ A: 'b' }).A, 'b');
});

test('package.json declara engines.farolShell e mantém o contrato do Node', () => {
  const manifesto = JSON.parse(fs.readFileSync(path.join(paths.APP_ROOT, 'package.json'), 'utf8'));
  assert.equal(manifesto.engines.farolShell, '>=3.0.0 <4');
  assert.match(manifesto.engines.node, /^>=\d+\.\d+\.\d+ <\d+$/);
});

test('sem FAROL_SHELL o bootstrap não roda', () => {
  let chamou = false;
  const r = mod.bootstrapDaCasca({ env: {}, reexec: () => { chamou = true; } });
  assert.equal(r, false);
  assert.equal(chamou, false);
});

test('com o bootstrap já feito não roda de novo (sem laço)', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, '9.0.0', { version: '9.0.0', engines: COMPATIVEL });
  let chamou = false;
  const r = mod.bootstrapDaCasca({
    env: { FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0', FAROL_BOOTSTRAP_FEITO: '1' }, pastaEngine,
    reexec: () => { chamou = true; },
  });
  assert.equal(r, false);
  assert.equal(chamou, false);
});

test('escolhe a maior versão compatível acima da semeada', () => {
  const pastaEngine = pastaNova();
  const r280 = motor(pastaEngine, '2.80.0', { version: '2.80.0', engines: COMPATIVEL });
  motor(pastaEngine, '2.81.0', { version: '2.81.0', engines: { farolShell: '>=4.0.0 <5' } });
  motor(pastaEngine, '2.79.0', { version: '2.79.0', engines: COMPATIVEL });
  const r = mod.escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine, versaoCasca: '3.0.0' });
  assert.equal(r.versao, '2.80.0');
  assert.equal(r.raiz, r280);
  assert.equal(r.motivo, 'instalada');
  assert.deepEqual(r.ignoradas.map(i => i.motivo).sort(), ['abaixo-da-semeada', 'casca-incompativel']);
});

test('entre duas compatíveis ganha a maior, comparando por número', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.9.0', { version: '2.9.0', engines: COMPATIVEL });
  const r10 = motor(pastaEngine, '2.10.0', { version: '2.10.0', engines: COMPATIVEL });
  const r = mod.escolherMotor({ semeada: '2.8.0', raizSemeada: '/bundle', pastaEngine, versaoCasca: '3.2.1' });
  assert.equal(r.raiz, r10);
});

test('pasta corrompida ou sem package.json é ignorada e a semeada ganha', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.90.0', '{ isto não é json');
  motor(pastaEngine, '2.91.0', undefined);
  motor(pastaEngine, '2.92.0', { version: '2.93.0', engines: COMPATIVEL });
  motor(pastaEngine, '2.94.0', { version: '2.94.0', engines: COMPATIVEL }, { semServer: true });
  const r = mod.escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine, versaoCasca: '3.0.0' });
  assert.equal(r.raiz, '/bundle');
  assert.equal(r.versao, '2.79.5');
  assert.equal(r.motivo, 'nenhuma-compativel');
  assert.deepEqual(r.ignoradas.map(i => i.motivo), Array(4).fill('manifesto-invalido'));
});

test('package.json sem engines.farolShell é incompatível', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.80.0', { version: '2.80.0', engines: { node: '>=24.22.1 <25' } });
  const r = mod.escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine, versaoCasca: '3.0.0' });
  assert.equal(r.raiz, '/bundle');
  assert.deepEqual(r.ignoradas.map(i => i.motivo), ['sem-farolShell']);
});

test('sem a pasta engine, vazia, ou sem a versão da casca, a semeada ganha', () => {
  const r = mod.escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine: path.join(TMP, 'nao-existe'), versaoCasca: '3.0.0' });
  assert.deepEqual([r.raiz, r.versao, r.motivo], ['/bundle', '2.79.5', 'sem-pasta']);
  const vazia = pastaNova();
  assert.equal(mod.escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine: vazia, versaoCasca: '3.0.0' }).motivo, 'semeada');
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.80.0', { version: '2.80.0', engines: COMPATIVEL });
  const r2 = mod.escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine, versaoCasca: '' });
  assert.equal(r2.raiz, '/bundle');
  assert.deepEqual(r2.ignoradas.map(i => i.motivo), ['casca-incompativel']);
});

test('nome de pasta que não é X.Y.Z fica de fora', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, 'tmp-download', { version: '9.0.0', engines: COMPATIVEL });
  const r = mod.escolherMotor({ semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine, versaoCasca: '3.0.0' });
  assert.equal(r.raiz, '/bundle');
  assert.deepEqual(r.ignoradas, []);
});

test('podarMotores apaga só o que está abaixo das duas', () => {
  const pastaEngine = pastaNova();
  for (const v of ['2.70.0', '2.79.4', '2.79.5', '2.79.9', '2.80.0', '2.81.0']) motor(pastaEngine, v, { version: v });
  motor(pastaEngine, 'nao-versao', { version: '1.0.0' });
  fs.writeFileSync(path.join(pastaEngine, '1.0.0'), 'arquivo solto, não pasta');
  const removidas = mod.podarMotores({ pastaEngine, manter: ['2.80.0', '2.79.5'] });
  assert.deepEqual(removidas.sort(), ['2.70.0', '2.79.4']);
  assert.deepEqual(fs.readdirSync(pastaEngine).sort(), ['1.0.0', '2.79.5', '2.79.9', '2.80.0', '2.81.0', 'nao-versao']);
  assert.deepEqual(mod.podarMotores({ pastaEngine: path.join(TMP, 'nao-existe'), manter: ['2.80.0'] }), []);
});

test('bootstrap em modo casca poda e reexecuta a escolhida', () => {
  const pastaEngine = pastaNova();
  const r280 = motor(pastaEngine, '2.80.0', { version: '2.80.0', engines: COMPATIVEL });
  motor(pastaEngine, '2.70.0', { version: '2.70.0', engines: COMPATIVEL });
  const avisos = [];
  let reexecutada = null;
  const r = mod.bootstrapDaCasca({
    env: { FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0' }, semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine,
    reexec: (raiz) => { reexecutada = raiz; }, avisar: (m) => avisos.push(m),
  });
  assert.equal(r, true);
  assert.equal(reexecutada, r280);
  assert.deepEqual(fs.readdirSync(pastaEngine), ['2.80.0']);
  assert.deepEqual(avisos, [], 'abaixo-da-semeada não é aviso');
});

test('bootstrap avisa só manifesto inválido e fica na semeada', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.90.0', '{ corrompido');
  motor(pastaEngine, '2.91.0', { version: '2.91.0', engines: { farolShell: '>=4.0.0 <5' } });
  const avisos = [];
  let chamou = false;
  const r = mod.bootstrapDaCasca({
    env: { FAROL_SHELL: 'win', FAROL_SHELL_VERSION: '3.0.0' }, semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine,
    reexec: () => { chamou = true; }, avisar: (m) => avisos.push(m),
  });
  assert.equal(r, false);
  assert.equal(chamou, false);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /2\.90\.0/);
  assert.ok(fs.existsSync(path.join(pastaEngine, '2.90.0')), 'sem reexecução nada é podado');
});

function scriptQueReexecuta(raiz) {
  const script = path.join(fs.mkdtempSync(path.join(TMP, 'script-')), 'chama.mjs');
  const url = pathToFileURL(path.join(paths.APP_ROOT, 'lib/engine/casca-bootstrap.js')).href;
  fs.writeFileSync(script, `import { reexecutar } from ${JSON.stringify(url)};\nreexecutar(${JSON.stringify(raiz)});\n`);
  return script;
}

test('reexecutar sobe o server.js escolhido e repassa o código de saída', () => {
  const raiz = fs.mkdtempSync(path.join(TMP, 'raiz-'));
  fs.writeFileSync(path.join(raiz, 'server.js'),
    'process.stdout.write(JSON.stringify({ feito: process.env.FAROL_BOOTSTRAP_FEITO, argv: process.argv.slice(2) }));\nprocess.exit(75);\n');
  const r = spawnSync(process.execPath, [scriptQueReexecuta(raiz), 'a', '--b'], { encoding: 'utf8' });
  assert.equal(r.status, 75, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { feito: '1', argv: ['a', '--b'] });
});

test('reexecutar: filho morto por sinal vira código 1', () => {
  const raiz = fs.mkdtempSync(path.join(TMP, 'raiz-'));
  fs.writeFileSync(path.join(raiz, 'server.js'), "process.kill(process.pid, 'SIGKILL');\n");
  const r = spawnSync(process.execPath, [scriptQueReexecuta(raiz)], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
});
