// Orquestração em Bash real, com npm e ferramentas Apple simulados e rotulados.
// A assinatura e o boot Apple reais são cobertos por native-bundle-mac.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const raiz = path.resolve(import.meta.dirname, '..');
const PRAZO_INSTALADOR_MS = 30000;
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const registro = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
const arquivos = ['main.js', 'server.js', 'package.json', 'README.md', 'CLAUDE.md'];
const diretorios = ['lib', 'ui', 'assets', 'workspace-template', 'installer', 'tools'];
const citar = (valor) => `'${valor.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`;
const posix = (valor) => valor.replaceAll('\\', '/').replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`);

function gravar(arquivo, texto) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.writeFileSync(arquivo, texto, { mode: 0o755 });
}

function bancada({ falha = '', nova = false, origem = '', mutar = (texto) => texto } = {}) {
  const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-instalar-mac-'));
  const home = path.join(temporario, 'home com espaco');
  const origens = {
    interna: path.join(home, '.farol/app/repo'),
    bundle: path.join(home, 'Applications/Farol.app/repo'),
    protocolo: path.join(home, '.farol/workspace/.claude/repo'),
    prompts: path.join(home, '.farol/workspace/prompts/repo'),
    vizinha: path.join(home, '.farol/app-vizinho'),
  };
  const fonte = origens[origem] || path.join(temporario, 'fonte');
  const ferramentas = path.join(temporario, 'ferramentas');
  const app = path.join(home, '.farol/app');
  const bundle = path.join(home, 'Applications/Farol.app');
  gravar(path.join(home, '.farol/config.json'), 'configuracao preservada');
  gravar(path.join(home, '.farol/workspace/state/chats.json'), 'historico preservado');
  gravar(path.join(home, '.farol/workspace/CLAUDE.md'), 'protocolo anterior');
  gravar(path.join(home, '.farol/workspace/.claude/anterior.txt'), 'comando anterior');
  gravar(path.join(home, '.farol/workspace/prompts/pessoal.txt'), 'prompt pessoal');
  if (!nova) {
    gravar(path.join(app, 'main.js'), 'codigo anterior');
    gravar(path.join(app, 'node_modules/antiga.txt'), 'dependencia anterior');
    gravar(path.join(bundle, 'Contents/codigo'), 'bundle anterior');
  }
  for (const arquivo of arquivos) gravar(path.join(fonte, arquivo), `novo ${arquivo}`);
  for (const diretorio of diretorios) gravar(path.join(fonte, diretorio, 'conteudo.txt'), `novo ${diretorio}`);
  for (const doc of ['CONFIGURATION.md', 'REVIEW-GATES.md', 'MACOS.md', 'RELEASE.md']) gravar(path.join(fonte, 'docs', doc), `guia ${doc}`);
  gravar(path.join(fonte, 'workspace-template/CLAUDE.md'), 'novo protocolo');
  gravar(path.join(fonte, 'workspace-template/.claude/novo.txt'), 'novo comando');
  gravar(path.join(fonte, 'workspace-template/prompts/novo.txt'), 'novo prompt');
  gravar(path.join(fonte, 'node_modules/nova.txt'), 'nova');
  gravar(path.join(fonte, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), '#!/bin/bash\n[ "$FALHA" != runtime ] || exit 29\nexit 0\n');
  fs.copyFileSync(path.join(raiz, 'installer/electron-runtime.sh'), path.join(fonte, 'installer/electron-runtime.sh'));
  const mocks = {
    uname: 'if [ "$1" = -s ]; then echo Darwin; else echo x86_64; fi',
    sw_vers: 'echo 13.0',
    node: 'exit 0',
    pkill: 'exit 1',
    sleep: 'exit 0',
    npm: 'exit 30',
    cp: '[ "$FALHA" != copia ] || [[ "$2" != */ui ]] || exit 24; [ "$FALHA" != dependencias ] || [[ "$2" != */node_modules ]] || exit 23; exec /bin/cp "$@"',
    lsregister: '[ "$FALHA" != registro ] || exit 25',
    mv: '[ "$FALHA" != workspace ] || [ "$2" != "$HOME/.farol/workspace/.claude" ] || [[ "$1" = */workspace-anterior/.claude ]] || exit 31; [ "$FALHA" != app ] || [ "$2" != "$HOME/.farol/app" ] || [[ "$1" = */anterior ]] || exit 28; [ "$FALHA" != troca ] || [ "$2" != "$HOME/Applications/Farol.app" ] || [[ "$1" = */anterior.app ]] || exit 26; exec /bin/mv "$@"',
  };
  for (const [nome, corpo] of Object.entries(mocks)) gravar(path.join(ferramentas, nome), `#!/bin/bash\n${corpo}\n`);
  gravar(path.join(fonte, 'installer/native-bundle-mac.sh'), `#!/bin/bash
set -euo pipefail
[ -f "$1/node_modules/nova.txt" ]
mkdir -p "$2/Contents"
echo parcial > "$2/Contents/codigo"
[ "$FALHA" != bundle ] || exit 27
cp "$1/main.js" "$2/Contents/codigo"
`);
  // Só os caminhos dos utilitários Apple são substituídos, mantendo a transação real.
  const codigo = mutar(fs.readFileSync(path.join(raiz, 'installer/install.sh'), 'utf8'))
    .replaceAll(registro, citar(posix(path.join(ferramentas, 'lsregister'))));
  const instalador = path.join(fonte, 'installer/install.sh');
  gravar(instalador, codigo);
  const comando = `export HOME=${citar(posix(home))}; export PATH=${citar(posix(ferramentas))}:"$PATH"; exec /bin/bash ${citar(posix(instalador))}`;
  const resultado = spawnSync(bash, ['-c', comando], {
    env: { ...process.env, FALHA: falha },
    encoding: 'utf8', timeout: PRAZO_INSTALADOR_MS,
  });
  return { temporario, home, fonte, app, bundle, resultado };
}

function dadosPreservados({ home }) {
  assert.equal(fs.readFileSync(path.join(home, '.farol/config.json'), 'utf8'), 'configuracao preservada');
  assert.equal(fs.readFileSync(path.join(home, '.farol/workspace/state/chats.json'), 'utf8'), 'historico preservado');
  assert.equal(fs.readFileSync(path.join(home, '.farol/workspace/prompts/pessoal.txt'), 'utf8'), 'prompt pessoal');
}

function anteriorPreservado(caso) {
  assert.equal(fs.readFileSync(path.join(caso.app, 'main.js'), 'utf8'), 'codigo anterior');
  assert.equal(fs.readFileSync(path.join(caso.app, 'node_modules/antiga.txt'), 'utf8'), 'dependencia anterior');
  assert.equal(fs.readFileSync(path.join(caso.bundle, 'Contents/codigo'), 'utf8'), 'bundle anterior');
  assert.equal(fs.readFileSync(path.join(caso.home, '.farol/workspace/CLAUDE.md'), 'utf8'), 'protocolo anterior');
  assert.equal(fs.readFileSync(path.join(caso.home, '.farol/workspace/.claude/anterior.txt'), 'utf8'), 'comando anterior');
  dadosPreservados(caso);
}

for (const falha of ['runtime', 'copia', 'dependencias', 'bundle', 'app', 'troca', 'workspace', 'registro']) {
  test(`instalador macOS preserva codigo, bundle e dados na falha de ${falha}`, { skip: !fs.existsSync(bash) }, () => {
    const caso = bancada({ falha });
    try {
      assert.equal(caso.resultado.status, { runtime: 1, copia: 24, dependencias: 23, bundle: 27, app: 28, troca: 26, workspace: 31, registro: 25 }[falha], caso.resultado.stdout + caso.resultado.stderr);
      assert.equal(caso.resultado.error, undefined);
      anteriorPreservado(caso);
      assert.equal(fs.readdirSync(path.join(caso.home, '.farol')).some((nome) => nome.startsWith('.farol-instalar.')), false);
      assert.equal(fs.readdirSync(path.join(caso.home, 'Applications')).some((nome) => nome.startsWith('.farol-instalar.')), false);
    } finally { fs.rmSync(caso.temporario, { recursive: true, force: true }); }
  });
}

test('instalador macOS troca codigo e bundle completos e preserva dados', { skip: !fs.existsSync(bash) }, () => {
  const caso = bancada();
  try {
    assert.equal(caso.resultado.status, 0, caso.resultado.stderr);
    assert.equal(fs.readFileSync(path.join(caso.app, 'main.js'), 'utf8'), 'novo main.js');
    assert.equal(fs.readFileSync(path.join(caso.bundle, 'Contents/codigo'), 'utf8'), 'novo main.js');
    assert.equal(fs.existsSync(path.join(caso.app, 'node_modules/antiga.txt')), false);
    assert.equal(fs.existsSync(path.join(caso.app, 'node_modules/nova.txt')), true);
    assert.equal(fs.readFileSync(path.join(caso.home, '.farol/workspace/CLAUDE.md'), 'utf8'), 'novo protocolo');
    assert.equal(fs.existsSync(path.join(caso.home, '.farol/workspace/.claude/anterior.txt')), false);
    assert.equal(fs.readFileSync(path.join(caso.home, '.farol/workspace/.claude/novo.txt'), 'utf8'), 'novo comando');
    dadosPreservados(caso);
  } finally { fs.rmSync(caso.temporario, { recursive: true, force: true }); }
});

test('instalacao macOS nova que falha nao deixa app parcial', { skip: !fs.existsSync(bash) }, () => {
  const caso = bancada({ nova: true, falha: 'registro' });
  try {
    assert.equal(caso.resultado.status, 25, caso.resultado.stderr);
    assert.equal(caso.resultado.error, undefined);
    assert.equal(fs.existsSync(caso.app), false);
    assert.equal(fs.existsSync(caso.bundle), false);
    dadosPreservados(caso);
  } finally { fs.rmSync(caso.temporario, { recursive: true, force: true }); }
});

test('contraprova: copiar codigo antes da preparacao rompe a preservacao', { skip: !fs.existsSync(bash) }, () => {
  const caso = bancada({ falha: 'bundle', mutar: (texto) => texto.replace('cp "$SRC/$f" "$APP/$f"', 'cp "$SRC/$f" "$LIVE_APP/$f"') });
  try {
    assert.equal(caso.resultado.status, 27, caso.resultado.stderr);
    assert.throws(() => anteriorPreservado(caso), assert.AssertionError);
  } finally { fs.rmSync(caso.temporario, { recursive: true, force: true }); }
});

for (const origem of ['interna', 'bundle', 'protocolo', 'prompts']) {
  test(`instalador macOS recusa clone em ${origem} e conserva a fonte`, { skip: !fs.existsSync(bash) }, () => {
    const caso = bancada({ origem });
    try {
      assert.equal(caso.resultado.status, 1, caso.resultado.stdout + caso.resultado.stderr);
      assert.match(caso.resultado.stdout, /fora da instalacao/);
      anteriorPreservado(caso);
      assert.equal(fs.readFileSync(path.join(caso.fonte, 'main.js'), 'utf8'), 'novo main.js');
    } finally { fs.rmSync(caso.temporario, { recursive: true, force: true }); }
  });
}

test('instalador macOS aceita clone vizinho sem confundir prefixo com descendencia', { skip: !fs.existsSync(bash) }, () => {
  const caso = bancada({ origem: 'vizinha' });
  try {
    assert.equal(caso.resultado.status, 0, caso.resultado.stdout + caso.resultado.stderr);
    assert.equal(fs.readFileSync(path.join(caso.fonte, 'main.js'), 'utf8'), 'novo main.js');
    dadosPreservados(caso);
  } finally { fs.rmSync(caso.temporario, { recursive: true, force: true }); }
});
