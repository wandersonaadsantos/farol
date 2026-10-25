import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-parser-distribuido-'));
process.env.FAROL_HOME = path.join(scratch, 'home');
const raiz = path.resolve(import.meta.dirname, '..');
const { validarParserDistribuido, carregarParserDistribuido } = await import('../lib/parser-runtime.js');
const { packageElectronRequirement } = await import('../lib/electron-runtime.js');
const { trocarArquivos, aplicarNoServidor } = await import('../lib/engine/update-servidor.js');
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

function novaPasta(nome) { return fs.mkdtempSync(path.join(scratch, nome)); }
function escrever(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), text);
}
function pacote() {
  const dir = novaPasta('pacote-');
  const engines = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).engines;
  escrever(dir, 'package.json', JSON.stringify({ name: 'farol', type: 'module', version: '9.9.9', engines, dependencies: { electron: '^44.1.0' } }));
  escrever(dir, 'server.js', '// entrada sintética');
  fs.cpSync(path.join(raiz, 'lib'), path.join(dir, 'lib'), { recursive: true });
  fs.cpSync(path.join(raiz, 'assets/third-party'), path.join(dir, 'assets/third-party'), { recursive: true });
  return dir;
}
function instalado() {
  const dir = novaPasta('instalado-');
  escrever(dir, 'package.json', '{"name":"farol","version":"2.77.2"}');
  escrever(dir, 'server.js', '// entrada anterior');
  escrever(dir, 'node_modules/electron/package.json', '{"name":"electron","version":"44.1.0"}');
  escrever(dir, 'node_modules/electron/dist/marcador', 'runtime preservado');
  return dir;
}

test('artefato oficial tem versão, bytes, hash e licença fixados, sem dependência npm de runtime', () => {
  const manifest = validarParserDistribuido(raiz, true);
  assert.equal(manifest.version, '7.28.5');
  assert.equal(manifest.files['dist/parser.cjs'].bytes, 512279);
  assert.equal(manifest.files['dist/parser.cjs'].sha256, '4fad5d076afb8c346159a06bb942d6e14c6167d590082b7c3bdebd4c108af201');
  assert.equal(manifest.files.LICENSE.sha256, '2e97627cb278aa7556fb9e8817368302301a595b6c7582512b8d74c57b773652');
  const parser = carregarParserDistribuido();
  const ast = parser.parse("import type { Props } from './props'; export const View = (p: Props) => <div>{p.label}</div>",
    { sourceType: 'module', plugins: ['typescript', 'jsx'] });
  assert.equal(ast.program.body[0].importKind, 'type');
  assert.equal(ast.program.body.length, 2);
});

test('upgrade do servidor com node_modules somente Electron recebe parser funcional sem npm, rede ou reinício', () => {
  const dir = instalado(), source = pacote();
  let restarts = 0;
  const engine = { update: { source, sourceVersion: '9.9.9' }, emit() {} };
  const result = aplicarNoServidor(engine, { raiz: dir, ehWindows: false, religar() { restarts++; } });
  assert.equal(result.ok, true); assert.equal(restarts, 1, 'somente callback interceptado');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'node_modules')), ['electron']);
  assert.equal(fs.readFileSync(path.join(dir, 'node_modules/electron/dist/marcador'), 'utf8'), 'runtime preservado');
  const url = pathToFileURL(path.join(dir, 'lib/review-context/syntax.js')).href;
  const code = `import(${JSON.stringify(url)}).then(m=>{const r=m.parseFile({path:'View.tsx',text:"import type {P} from './p'; export const View=()=> <div/>"});if(r.backend!=='babel-parser-7.28.5'||r.imports[0].kind!=='type')process.exit(1)})`;
  const env = { ...process.env, NODE_PATH: '', FAROL_HOME: path.join(scratch, 'child-home') };
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, cwd: dir, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(child.status, 0, child.stderr);
  const artifact = path.join(dir, 'assets/third-party/babel-parser/dist/parser.cjs');
  const syntax = spawnSync(process.execPath, ['--check', artifact], { env, encoding: 'utf8', timeout: 10000, windowsHide: true });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test('artefato ausente, alterado ou de versão incorreta é recusado antes de desktop ou servidor alterar instalação', () => {
  for (const defect of ['ausente', 'alterado', 'versao']) {
    const source = pacote(), dir = instalado();
    const artifact = path.join(source, 'assets/third-party/babel-parser/dist/parser.cjs');
    if (defect === 'ausente') fs.unlinkSync(artifact);
    if (defect === 'alterado') fs.appendFileSync(artifact, '\n// corrupção sintética');
    if (defect === 'versao') {
      const file = path.join(source, 'assets/third-party/babel-parser/manifest.json');
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8')); manifest.version = '0.0.0';
      fs.writeFileSync(file, JSON.stringify(manifest));
    }
    assert.throws(() => packageElectronRequirement(path.join(source, 'package.json')), /Parser distribuído ausente ou inválido/);
    assert.throws(() => trocarArquivos(source, dir), /Parser distribuído ausente ou inválido/);
    assert.equal(fs.readFileSync(path.join(dir, 'server.js'), 'utf8'), '// entrada anterior');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '2.77.2');
    assert.deepEqual(fs.readdirSync(path.join(dir, 'node_modules')), ['electron']);
    assert.equal(fs.existsSync(path.join(dir, 'assets')), false);
    assert.equal(fs.readdirSync(dir).some(name => /\.(novo|velho)-/.test(name)), false);
  }
});

test('migração preserva a cópia anterior quando preparar arquivos falha', () => {
  const dir = instalado(), source = pacote();
  // O pacote está íntegro, mas o destino do staging é ocupado por diretório incompatível.
  escrever(dir, 'assets.novo-123', 'impede staging');
  assert.throws(() => trocarArquivos(source, dir, 123));
  assert.equal(fs.readFileSync(path.join(dir, 'server.js'), 'utf8'), '// entrada anterior');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version, '2.77.2');
  const bytes = fs.readFileSync(path.join(source, 'assets/third-party/babel-parser/dist/parser.cjs'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '4fad5d076afb8c346159a06bb942d6e14c6167d590082b7c3bdebd4c108af201');
});
