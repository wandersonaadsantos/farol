// Plano 4 do Farol nativo, Task 2: `tools/release/montar-mac.sh` monta o Farol.app com o
// motor e o Node dentro. Aqui só a parte determinística: um `.app` falso (`--app`, sem
// xcodebuild), uma semente falsa e dois "node" que são binários Mach-O de verdade, um de
// cada arquitetura, compilados na hora. Confere o leiaute do índice
// (`Contents/Resources/engine/{app/server.js,node/bin/node,VERSAO}`), o node universal
// feito pelo `lipo`, a assinatura ad hoc quando não há identidade, a ausência dela quando
// há, e a `SUPublicEDKey` gravada no Info.plist do bundle montado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RAIZ = path.join(import.meta.dirname, '..');
const SH = path.join(RAIZ, 'tools', 'release', 'montar-mac.sh');
const existe = (cmd) => { const r = spawnSync('sh', ['-c', `command -v ${cmd}`]); return !r.error && r.status === 0; };

function motivoParaPular() {
  if (process.platform !== 'darwin') return 'montar-mac.sh monta o bundle do macOS: só roda no macOS';
  const faltando = ['cc', 'lipo', 'codesign'].filter((c) => !existe(c));
  if (!fs.existsSync('/usr/libexec/PlistBuddy')) faltando.push('PlistBuddy');
  return faltando.length ? `ferramenta ausente: ${faltando.join(', ')}` : false;
}
const SO_MAC = { skip: motivoParaPular() };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-montar-mac-'));
const VERSAO_DO_MOTOR = '9.8.7';
const CHAVE = 'Y2hhdmUtcHVibGljYS1mYWxzYS1kby10ZXN0ZQ==';

function compilar(arch, saida) {
  const fonte = path.join(TMP, 'main.c');
  fs.writeFileSync(fonte, 'int main(void) { return 0; }\n');
  const r = spawnSync('cc', ['-arch', arch, '-o', saida, fonte], { encoding: 'utf8' });
  assert.equal(r.status, 0, `cc -arch ${arch} falhou: ${r.stderr}`);
}

// o .app que o `xcodebuild archive` entregaria, com o mínimo para o codesign aceitar
function appFalso(dir) {
  const app = path.join(dir, 'Farol.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources'), { recursive: true });
  compilar('arm64', path.join(app, 'Contents', 'MacOS', 'Farol'));
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Farol</string>
  <key>CFBundleIdentifier</key><string>com.biud.farol.teste</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>SUPublicEDKey</key><string></string>
</dict>
</plist>
`);
  return app;
}

function sementeFalsa(dir) {
  const app = path.join(dir, 'engine', 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'server.js'), '// motor falso\n');
  fs.writeFileSync(path.join(app, 'package.json'), `${JSON.stringify({ name: 'farol', version: VERSAO_DO_MOTOR })}\n`);
  return dir;
}

function montar(nome, extras = []) {
  const base = path.join(TMP, nome);
  fs.mkdirSync(base, { recursive: true });
  const nodeArm = path.join(base, 'node-arm64');
  const nodeX64 = path.join(base, 'node-x64');
  compilar('arm64', nodeArm);
  compilar('x86_64', nodeX64);
  const saida = path.join(base, 'saida');
  const r = spawnSync('bash', [SH,
    '--app', appFalso(base),
    '--semente', sementeFalsa(path.join(base, 'semente')),
    '--node-arm64', nodeArm,
    '--node-x64', nodeX64,
    '--saida', saida,
    ...extras,
  ], { encoding: 'utf8' });
  return { r, app: path.join(saida, 'Farol.app') };
}

const engineDe = (app) => path.join(app, 'Contents', 'Resources', 'engine');
const plist = (app, chave) => spawnSync('/usr/libexec/PlistBuddy',
  ['-c', `Print :${chave}`, path.join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' }).stdout.trim();
const assinado = (alvo) => spawnSync('codesign', ['--verify', '--strict', alvo], { encoding: 'utf8' });

test('sem identidade: leiaute do índice, node universal e assinatura ad hoc', SO_MAC, () => {
  const { r, app } = montar('adhoc');
  assert.equal(r.status, 0, `montar-mac.sh falhou: ${r.stderr}`);
  const engine = engineDe(app);
  assert.equal(fs.readFileSync(path.join(engine, 'app', 'server.js'), 'utf8'), '// motor falso\n');
  assert.equal(fs.readFileSync(path.join(engine, 'VERSAO'), 'utf8').trim(), VERSAO_DO_MOTOR);

  const node = path.join(engine, 'node', 'bin', 'node');
  assert.ok(fs.statSync(node).mode & 0o111, 'node sem bit de execução');
  const archs = spawnSync('lipo', ['-archs', node], { encoding: 'utf8' }).stdout.trim().split(/\s+/).sort();
  assert.deepEqual(archs, ['arm64', 'x86_64']);

  assert.equal(assinado(node).status, 0, `node sem assinatura válida: ${assinado(node).stderr}`);
  assert.equal(assinado(app).status, 0, `app sem assinatura válida: ${assinado(app).stderr}`);
  const ent = spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', node], { encoding: 'utf8' }).stdout;
  assert.match(ent, /com\.apple\.security\.cs\.allow-jit/, 'node assinado sem os entitlements do Node');
  assert.match(r.stderr, /ad hoc/i, 'faltou o aviso de que o bundle ad hoc nunca é artefato de release');
});

test('com identidade: o bundle sai montado e SEM assinatura (quem assina é o assinar-mac.sh)', SO_MAC, () => {
  const { r, app } = montar('identidade', ['--identidade', 'Developer ID Application: Teste (XXXXXXXXXX)']);
  assert.equal(r.status, 0, `montar-mac.sh falhou: ${r.stderr}`);
  assert.ok(fs.existsSync(path.join(engineDe(app), 'node', 'bin', 'node')));
  assert.notEqual(assinado(path.join(engineDe(app), 'node', 'bin', 'node')).status, 0, 'node não deveria estar assinado');
});

test('--chave-publica grava a SUPublicEDKey no Info.plist do bundle montado', SO_MAC, () => {
  const { r, app } = montar('chave', ['--chave-publica', CHAVE]);
  assert.equal(r.status, 0, `montar-mac.sh falhou: ${r.stderr}`);
  assert.equal(plist(app, 'SUPublicEDKey'), CHAVE);
  assert.equal(assinado(app).status, 0, 'a chave tem de entrar ANTES da assinatura');
});

test('semente sem engine/app/server.js aborta sem montar nada', SO_MAC, () => {
  const base = path.join(TMP, 'sem-semente');
  fs.mkdirSync(path.join(base, 'vazia'), { recursive: true });
  const nodeArm = path.join(base, 'node-arm64');
  compilar('arm64', nodeArm);
  const r = spawnSync('bash', [SH, '--app', appFalso(base), '--semente', path.join(base, 'vazia'),
    '--node-arm64', nodeArm, '--node-x64', nodeArm, '--saida', path.join(base, 'saida')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /server\.js/);
  assert.ok(!fs.existsSync(path.join(base, 'saida', 'Farol.app')), 'bundle meio montado ficou na saída');
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
