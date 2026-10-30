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
  assert.equal(paths.ambienteDoBootstrap({}, 4321).FAROL_PAI_PID, '4321');
  assert.equal(paths.ambienteDoBootstrap({}).FAROL_PAI_PID, String(process.pid));
});

test('pidDoPai lê FAROL_PAI_PID e só aceita inteiro positivo', () => {
  assert.equal(paths.pidDoPai({ FAROL_PAI_PID: '4321' }), 4321);
  for (const v of ['0', '-1', 'abc', '12a', '', undefined]) assert.equal(paths.pidDoPai({ FAROL_PAI_PID: v }), 0, `recusa ${JSON.stringify(v)}`);
});

function pidMorto() {
  // pid de um processo que acabou de sair: não existe mais
  return spawnSync(process.execPath, ['-e', '']).pid;
}

test('vigiarPai chama aoMorrer quando o pai não existe mais, uma vez só', async () => {
  let vezes = 0;
  const parar = mod.vigiarPai({ pid: pidMorto(), intervaloMs: 5, aoMorrer: () => { vezes++; } });
  await new Promise(r => setTimeout(r, 60));
  parar();
  assert.equal(vezes, 1);
});

test('vigiarPai com agora confere na hora', () => {
  let vezes = 0;
  const parar = mod.vigiarPai({ pid: pidMorto(), intervaloMs: 60000, aoMorrer: () => { vezes++; }, agora: true });
  parar();
  assert.equal(vezes, 1);
});

test('vigiarPai com o pai vivo não chama aoMorrer', async () => {
  let vezes = 0;
  const parar = mod.vigiarPai({ pid: process.pid, intervaloMs: 5, aoMorrer: () => { vezes++; }, agora: true });
  await new Promise(r => setTimeout(r, 40));
  parar();
  assert.equal(vezes, 0);
});

test('o filho reexecutado em modo casca liga a vigia do pai', () => {
  const vigias = [];
  const env = { FAROL_SHELL: 'mac', FAROL_BOOTSTRAP_FEITO: '1', FAROL_PAI_PID: '4321' };
  assert.equal(mod.bootstrapDaCasca({ env, vigiar: (o) => { vigias.push(o); return () => {}; }, vigiarFim: () => {} }), false);
  assert.equal(vigias.length, 1);
  assert.equal(vigias[0].pid, 4321);
  assert.equal(typeof vigias[0].aoMorrer, 'function');
  const semPai = [];
  mod.bootstrapDaCasca({ env: { FAROL_SHELL: 'mac', FAROL_BOOTSTRAP_FEITO: '1' }, vigiar: (o) => { semPai.push(o); }, vigiarFim: () => {} });
  mod.bootstrapDaCasca({ env: { FAROL_BOOTSTRAP_FEITO: '1', FAROL_PAI_PID: '4321' }, vigiar: (o) => { semPai.push(o); } });
  assert.equal(semPai.length, 0, 'sem pid do pai, ou fora da casca, não há vigia');
});

test('o aviso padrão de manifesto inválido vai para o farol.log', () => {
  fs.mkdirSync(paths.STATE_DIR, { recursive: true });
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.95.0', '{ corrompido');
  mod.bootstrapDaCasca({ env: { FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0' }, semeada: '2.79.5', raizSemeada: '/bundle', pastaEngine, reexec: () => {}, vigiarFim: () => {} });
  const log = fs.readFileSync(paths.LOG_FILE, 'utf8');
  assert.match(log, /\[WARN\].*manifesto inválido.*2\.95\.0/);
});

test('package.json declara engines.farolShell e mantém o contrato do Node', () => {
  const manifesto = JSON.parse(fs.readFileSync(path.join(paths.APP_ROOT, 'package.json'), 'utf8'));
  assert.equal(manifesto.engines.farolShell, '>=3.0.0 <4');
  assert.match(manifesto.engines.node, /^>=\d+\.\d+\.\d+ <\d+$/);
});

// Item A da onda de pendências das cascas: o motor que vai escutar (o semeado que fica, ou o
// filho reexecutado) liga a vigia do fim do stdin; quem reexecuta não (a vigia dele mora no
// `reexecutar`), e fora do modo casca ninguém liga.
test('em modo casca, o motor que fica liga a vigia do fim do stdin', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.80.0', { version: '2.80.0', engines: COMPATIVEL });
  let vigias = 0;
  const vigiarFim = () => { vigias += 1; };
  const base = { semeada: '2.79.5', raizSemeada: '/bundle', reexec: () => {}, vigiar: () => () => {}, vigiarFim };
  assert.equal(mod.bootstrapDaCasca({ ...base, env: { FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0' }, pastaEngine: pastaNova() }), false);
  assert.equal(vigias, 1, 'semeado que fica');
  assert.equal(mod.bootstrapDaCasca({ ...base, env: { FAROL_SHELL: 'mac', FAROL_BOOTSTRAP_FEITO: '1', FAROL_PAI_PID: '4321' }, pastaEngine }), false);
  assert.equal(vigias, 2, 'filho reexecutado');
  assert.equal(mod.bootstrapDaCasca({ ...base, env: { FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0' }, pastaEngine }), true);
  assert.equal(vigias, 2, 'quem reexecuta não liga aqui');
  assert.equal(mod.bootstrapDaCasca({ ...base, env: {}, pastaEngine }), false);
  assert.equal(vigias, 2, 'fora do modo casca nada muda');
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
    reexec: () => { chamou = true; }, vigiarFim: () => {},
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

test('podarMotores apaga toda sobra X.Y.Z.tmp de update interrompido, e nada parecido', () => {
  const pastaEngine = pastaNova();
  motor(pastaEngine, '2.80.0', { version: '2.80.0' });
  for (const nome of ['2.81.0.tmp', '2.70.0.tmp', '9.9.9.tmp']) fs.mkdirSync(path.join(pastaEngine, nome, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(pastaEngine, 'x.tmp'));
  fs.mkdirSync(path.join(pastaEngine, '2.81.0.tmp.bak'));
  fs.writeFileSync(path.join(pastaEngine, '3.0.0.tmp'), 'arquivo solto, não pasta');
  const removidas = mod.podarMotores({ pastaEngine, manter: ['2.80.0'] });
  assert.deepEqual(removidas.sort(), ['2.70.0.tmp', '2.81.0.tmp', '9.9.9.tmp']);
  assert.deepEqual(fs.readdirSync(pastaEngine).sort(), ['2.80.0', '2.81.0.tmp.bak', '3.0.0.tmp', 'x.tmp']);
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
    reexec: () => { chamou = true; }, avisar: (m) => avisos.push(m), vigiarFim: () => {},
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
    'process.stdout.write(JSON.stringify({ feito: process.env.FAROL_BOOTSTRAP_FEITO, pai: process.env.FAROL_PAI_PID, argv: process.argv.slice(2) }));\nprocess.exit(75);\n');
  const r = spawnSync(process.execPath, [scriptQueReexecuta(raiz), 'a', '--b'], { encoding: 'utf8' });
  assert.equal(r.status, 75, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { feito: '1', pai: String(r.pid), argv: ['a', '--b'] });
});

test('reexecutar: filho morto por sinal vira código 1', () => {
  const raiz = fs.mkdtempSync(path.join(TMP, 'raiz-'));
  fs.writeFileSync(path.join(raiz, 'server.js'), "process.kill(process.pid, 'SIGKILL');\n");
  const r = spawnSync(process.execPath, [scriptQueReexecuta(raiz)], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);
});

// O repasse de sinal é o que impede o motor órfão segurando a porta quando a casca fecha: o
// pai recebe SIGTERM, o filho reexecutado recebe o mesmo SIGTERM, e o pai sai com o código
// do filho.
test('reexecutar repassa o SIGTERM do pai ao filho e sai com o código dele', { skip: process.platform === 'win32' }, async () => {
  const raiz = fs.mkdtempSync(path.join(TMP, 'raiz-'));
  const marca = path.join(raiz, 'marca.txt');
  fs.writeFileSync(path.join(raiz, 'server.js'), [
    `const fs = require('node:fs');`,
    `process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(marca)}, 'recebi SIGTERM ' + process.pid + '\\n'); process.exit(0); });`,
    `fs.writeFileSync(${JSON.stringify(marca)}, 'pronto ' + process.pid + '\\n');`,
    `setInterval(() => {}, 1000);`,
  ].join('\n'));
  fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const { spawn } = await import('node:child_process');
  const pai = spawn(process.execPath, [scriptQueReexecuta(raiz)], { stdio: 'ignore' });
  const saida = new Promise((resolve) => pai.on('exit', (code, signal) => resolve({ code, signal })));
  const inicio = Date.now();
  while (!(fs.existsSync(marca) && fs.readFileSync(marca, 'utf8').startsWith('pronto'))) {
    if (Date.now() - inicio > 10000) { pai.kill('SIGKILL'); throw new Error('o filho não subiu'); }
    await new Promise(r => setTimeout(r, 25));
  }
  const pidDoFilho = fs.readFileSync(marca, 'utf8').split(/\s+/)[1];
  pai.kill('SIGTERM');
  const r = await saida;
  assert.deepEqual(r, { code: 0, signal: null }, 'o pai sai pelo código do filho, não morto pelo sinal');
  assert.match(fs.readFileSync(marca, 'utf8'), new RegExp(`recebi SIGTERM ${pidDoFilho}`), 'o filho recebeu o SIGTERM');
});

// Item A da onda de pendências das cascas: quando a casca morre sem repassar sinal, o pipe que
// ela segura como stdin fecha. O pai do bootstrap vê o EOF, repassa como SIGTERM ao filho e
// sai com o código dele. O filho daqui não vigia o stdin, então só o repasse do pai o encerra.
test('reexecutar em modo casca: o EOF do stdin vira SIGTERM no filho', { skip: process.platform === 'win32' }, async () => {
  const raiz = fs.mkdtempSync(path.join(TMP, 'raiz-'));
  const marca = path.join(raiz, 'marca.txt');
  fs.writeFileSync(path.join(raiz, 'server.js'), [
    `const fs = require('node:fs');`,
    `process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(marca)}, 'recebi SIGTERM\\n'); process.exit(0); });`,
    `fs.writeFileSync(${JSON.stringify(marca)}, 'pronto\\n');`,
    `setInterval(() => {}, 1000);`,
  ].join('\n'));
  fs.writeFileSync(path.join(raiz, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  const { spawn } = await import('node:child_process');
  const env = { ...process.env, FAROL_SHELL: 'mac', FAROL_SHELL_VERSION: '3.0.0' };
  const pai = spawn(process.execPath, [scriptQueReexecuta(raiz)], { env, stdio: ['pipe', 'ignore', 'ignore'] });
  const saida = new Promise((resolve) => pai.on('exit', (code, signal) => resolve({ code, signal })));
  const inicio = Date.now();
  while (!(fs.existsSync(marca) && fs.readFileSync(marca, 'utf8').startsWith('pronto'))) {
    if (Date.now() - inicio > 10000) { pai.kill('SIGKILL'); throw new Error('o filho não subiu'); }
    await new Promise(r => setTimeout(r, 25));
  }
  pai.stdin.end();
  const r = await saida;
  assert.deepEqual(r, { code: 0, signal: null });
  assert.match(fs.readFileSync(marca, 'utf8'), /recebi SIGTERM/);
});
