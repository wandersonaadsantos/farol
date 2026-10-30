// Plano 4 do Farol nativo, Task 3: o appcast da Sparkle nunca recebe versão que não seja
// maior que a última publicada (Review Focus 3). A regra é PURA em
// `tools/release/versao-maior.js` (reusa o `cmpVersion` do update do motor) e o
// `tools/release/appcast-mac.sh` a consulta antes de rodar o `generate_appcast`. Aqui: a
// função pura, e o caminho de recusa do script de verdade (com `--dry-run`, que não roda o
// `generate_appcast` nem grava a chave em disco).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { versaoMaior, ultimaVersaoDoAppcast, motivoDaRecusa } from '../tools/release/versao-maior.js';

const RAIZ = path.join(import.meta.dirname, '..');
const SH = path.join(RAIZ, 'tools', 'release', 'appcast-mac.sh');
const CHAVE_FALSA = 'chave-privada-falsa-do-teste-NAO-PODE-APARECER';

function appcast(...itens) {
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Farol</title>
${itens.join('\n')}
  </channel>
</rss>
`;
}
const item = (curta, longa = '1') => `    <item>
      <title>${curta}</title>
      <sparkle:version>${longa}</sparkle:version>
      <sparkle:shortVersionString>${curta}</sparkle:shortVersionString>
      <enclosure url="https://exemplo/Farol-${curta}.dmg" length="1" type="application/octet-stream" sparkle:edSignature="x"/>
    </item>`;

test('versaoMaior: maior passa, igual e menor nao', () => {
  assert.equal(versaoMaior('1.0.1', '1.0.0'), true);
  assert.equal(versaoMaior('1.10.0', '1.9.9'), true);
  assert.equal(versaoMaior('2.0.0', '1.99.99'), true);
  assert.equal(versaoMaior('1.0.0', '1.0.0'), false);
  assert.equal(versaoMaior('0.9.9', '1.0.0'), false);
});

test('versaoMaior: sem versao anterior qualquer versao bem formada passa', () => {
  assert.equal(versaoMaior('1.0.0', null), true);
  assert.equal(versaoMaior('0.0.1', undefined), true);
  assert.equal(versaoMaior('3.0.0', ''), true);
});

test('versaoMaior: versao malformada e recusada', () => {
  for (const ruim of ['1.0', 'v1.0.0', '1.0.0-beta', '', 'abc', '1..0', null]) {
    assert.throws(() => versaoMaior(ruim, '1.0.0'), /malformada/, `aceitou ${ruim}`);
  }
});

test('ultimaVersaoDoAppcast: varios itens devolvem a maior, fora de ordem', () => {
  const xml = appcast(item('1.2.0', '120'), item('1.10.0', '1100'), item('1.9.3', '193'));
  assert.deepEqual(ultimaVersaoDoAppcast(xml), { curta: '1.10.0', build: '1100' });
});

test('ultimaVersaoDoAppcast: le o formato antigo em atributo do enclosure', () => {
  const xml = appcast(`    <item>
      <enclosure url="https://exemplo/a.dmg" sparkle:version="7" sparkle:shortVersionString="2.3.4" length="1"/>
    </item>`);
  assert.deepEqual(ultimaVersaoDoAppcast(xml), { curta: '2.3.4', build: '7' });
});

test('ultimaVersaoDoAppcast: sem shortVersionString usa sparkle:version', () => {
  const xml = appcast(`    <item>
      <sparkle:version>1.4.0</sparkle:version>
    </item>`);
  assert.deepEqual(ultimaVersaoDoAppcast(xml), { curta: '1.4.0', build: '1.4.0' });
});

test('ultimaVersaoDoAppcast: item sem sparkle:version deixa o build null', () => {
  const xml = appcast(`    <item>
      <sparkle:shortVersionString>2.0.0</sparkle:shortVersionString>
    </item>`);
  assert.deepEqual(ultimaVersaoDoAppcast(xml), { curta: '2.0.0', build: null });
});

test('ultimaVersaoDoAppcast: curta e build maximos sao tirados cada um por si', () => {
  const xml = appcast(item('1.2.0', '9'), item('1.3.0', '5'));
  assert.deepEqual(ultimaVersaoDoAppcast(xml), { curta: '1.3.0', build: '9' });
});

test('motivoDaRecusa: curta e build maiores passam', () => {
  assert.equal(motivoDaRecusa({ curta: '3.0.1', build: '3.0.1' }, { curta: '3.0.0', build: '3.0.0' }), null);
  assert.equal(motivoDaRecusa({ curta: '1.0.0', build: '1' }, null), null);
});

test('motivoDaRecusa: curta maior com build igual e recusada (a Sparkle ordena pelo build)', () => {
  assert.match(motivoDaRecusa({ curta: '3.0.1', build: '1' }, { curta: '3.0.0', build: '1' }),
    /build 1 nao e maior que o ultimo publicado no appcast \(1\)/);
  assert.match(motivoDaRecusa({ curta: '3.0.1', build: '3.0.0' }, { curta: '3.0.0', build: '3.0.0' }), /build/);
});

test('motivoDaRecusa: curta igual e recusada mesmo com build maior', () => {
  assert.match(motivoDaRecusa({ curta: '3.0.0', build: '4' }, { curta: '3.0.0', build: '3' }), /versao 3\.0\.0 nao e maior/);
});

test('motivoDaRecusa: appcast anterior sem build passa so pela curta', () => {
  assert.equal(motivoDaRecusa({ curta: '2.0.1', build: '1' }, { curta: '2.0.0', build: null }), null);
});

test('motivoDaRecusa: build malformado lanca', () => {
  for (const ruim of ['', '1.0-beta', 'abc', undefined]) {
    assert.throws(() => motivoDaRecusa({ curta: '1.0.0', build: ruim }, null), /malformado/, `aceitou ${ruim}`);
  }
});

test('ultimaVersaoDoAppcast: appcast vazio ou ausente nao tem versao', () => {
  assert.equal(ultimaVersaoDoAppcast(''), null);
  assert.equal(ultimaVersaoDoAppcast(null), null);
  assert.equal(ultimaVersaoDoAppcast(undefined), null);
  assert.equal(ultimaVersaoDoAppcast(appcast()), null);
});

test('ultimaVersaoDoAppcast: versao malformada no appcast e recusada', () => {
  assert.throws(() => ultimaVersaoDoAppcast(appcast(item('1.0.0-rc1'))), /malformada/);
});

// --- o script, de verdade, no caminho de recusa e no dry-run ---------------------------
const PULAR = process.platform === 'win32' ? 'appcast-mac.sh e bash: nao roda no Windows' : false;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-appcast-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function rodar(nomeDoDmg, versaoPublicada, build, buildPublicado = '1') {
  const base = fs.mkdtempSync(path.join(TMP, 'caso-'));
  const dmg = path.join(base, nomeDoDmg);
  fs.writeFileSync(dmg, 'dmg falso\n');
  const anterior = path.join(base, 'appcast-publicado.xml');
  fs.writeFileSync(anterior, appcast(item(versaoPublicada, buildPublicado)));
  return spawnSync('bash', [SH, '--dmg', dmg, '--saida', path.join(base, 'saida'),
    '--appcast-anterior', anterior, '--versao-build', build, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, SPARKLE_PRIVATE_KEY: CHAVE_FALSA, SPARKLE_BIN: '' },
  });
}

test('appcast-mac.sh recusa versao igual a ultima publicada', { skip: PULAR }, () => {
  const r = rodar('Farol-1.0.0.dmg', '1.0.0', '1.0.0');
  assert.notEqual(r.status, 0, 'deveria recusar');
  assert.match(r.stderr, /1\.0\.0 nao e maior que a ultima publicada no appcast \(1\.0\.0\)/);
  assert.doesNotMatch(r.stdout, /generate_appcast/);
});

test('appcast-mac.sh com versao maior imprime o generate_appcast sem a chave', { skip: PULAR }, () => {
  const r = rodar('Farol-1.0.1.dmg', '1.0.0', '1.0.1');
  assert.equal(r.status, 0, r.stderr);
  const linha = r.stdout.split('\n').find((l) => l.includes('generate_appcast'));
  assert.ok(linha, `sem linha do generate_appcast:\n${r.stdout}`);
  assert.match(linha, /--ed-key-file/);
  assert.match(linha, /--download-url-prefix https:\/\/github\.com\/wandersonaadsantos\/farol\/releases\/download\/v1\.0\.1\//);
  assert.ok(!`${r.stdout}${r.stderr}`.includes(CHAVE_FALSA), 'a chave privada vazou na saida');
});

test('appcast-mac.sh recusa curta maior com build igual ao publicado', { skip: PULAR }, () => {
  const r = rodar('Farol-1.0.1.dmg', '1.0.0', '7', '7');
  assert.notEqual(r.status, 0, 'deveria recusar');
  assert.match(r.stderr, /build 7 nao e maior que o ultimo publicado no appcast \(7\)/);
  assert.doesNotMatch(r.stdout, /generate_appcast/);
});

// sem --versao-build o script monta o dmg (de verdade, só leitura) e lê o build do app
const PULAR_DMG = process.platform !== 'darwin' || !fs.existsSync('/usr/bin/hdiutil') ? 'hdiutil so existe no macOS' : false;
function dmgDeVerdade(curta, build) {
  const base = fs.mkdtempSync(path.join(TMP, 'dmg-'));
  const app = path.join(base, 'Farol.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Farol'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Farol</string>
  <key>CFBundleShortVersionString</key><string>${curta}</string>
  <key>CFBundleVersion</key><string>${build}</string>
</dict>
</plist>
`);
  const dmg = path.join(base, `Farol-${curta}.dmg`);
  const env = { ...process.env };
  delete env.MAC_SIGNING_IDENTITY;
  const r = spawnSync('bash', [path.join(RAIZ, 'tools', 'release', 'dmg-mac.sh'), '--app', app, '--saida', dmg],
    { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  return { base, dmg };
}

test('appcast-mac.sh le o build do app dentro do dmg e recusa build que nao sobe', { skip: PULAR_DMG }, () => {
  const { base, dmg } = dmgDeVerdade('3.0.1', '3.0.0');
  const anterior = path.join(base, 'publicado.xml');
  fs.writeFileSync(anterior, appcast(item('3.0.0', '3.0.0')));
  const env = { ...process.env, SPARKLE_PRIVATE_KEY: CHAVE_FALSA };
  const recusa = spawnSync('bash', [SH, '--dmg', dmg, '--saida', path.join(base, 'saida'),
    '--appcast-anterior', anterior, '--dry-run'], { encoding: 'utf8', env });
  assert.notEqual(recusa.status, 0);
  assert.match(recusa.stderr, /build 3\.0\.0 nao e maior/);
  fs.writeFileSync(anterior, appcast(item('3.0.0', '2.9.9')));
  const passa = spawnSync('bash', [SH, '--dmg', dmg, '--saida', path.join(base, 'saida'),
    '--appcast-anterior', anterior, '--dry-run'], { encoding: 'utf8', env });
  assert.equal(passa.status, 0, passa.stderr);
  assert.match(passa.stdout, /generate_appcast/);
});

test('appcast-mac.sh sem SPARKLE_PRIVATE_KEY falha nomeando a variavel', { skip: PULAR }, () => {
  const base = fs.mkdtempSync(path.join(TMP, 'sem-chave-'));
  const dmg = path.join(base, 'Farol-1.0.1.dmg');
  fs.writeFileSync(dmg, 'dmg falso\n');
  const env = { ...process.env };
  delete env.SPARKLE_PRIVATE_KEY;
  const r = spawnSync('bash', [SH, '--dmg', dmg, '--saida', path.join(base, 'saida'), '--versao-build', '1.0.1', '--dry-run'],
    { encoding: 'utf8', env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /SPARKLE_PRIVATE_KEY/);
});

test('appcast-mac.sh recusa dmg com nome fora do padrao Farol-X.Y.Z.dmg', { skip: PULAR }, () => {
  const base = fs.mkdtempSync(path.join(TMP, 'nome-'));
  const dmg = path.join(base, 'Farol.dmg');
  fs.writeFileSync(dmg, 'dmg falso\n');
  const r = spawnSync('bash', [SH, '--dmg', dmg, '--saida', path.join(base, 'saida'), '--dry-run'],
    { encoding: 'utf8', env: { ...process.env, SPARKLE_PRIVATE_KEY: CHAVE_FALSA } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Farol-X\.Y\.Z\.dmg/);
});

// de verdade, sem --dry-run, com um generate_appcast falso em SPARKLE_BIN: a chave chega
// por arquivo 0600 (nunca na linha de comando) e o arquivo some depois
test('appcast-mac.sh passa a chave por arquivo privado e apaga depois', { skip: PULAR }, () => {
  const base = fs.mkdtempSync(path.join(TMP, 'real-'));
  const bin = path.join(base, 'bin');
  fs.mkdirSync(bin);
  const registro = path.join(base, 'registro.txt');
  fs.writeFileSync(path.join(bin, 'generate_appcast'), `#!/bin/bash
set -e
printf '%s\\n' "$*" > "${registro}"
while [ $# -gt 0 ]; do
  case "$1" in
    --ed-key-file) node -e "process.stdout.write((require('fs').statSync(process.argv[1]).mode & 0o777).toString(8) + '\\\\n')" "$2" >> "${registro}"; cat "$2" >> "${registro}"; printf '\\n%s\\n' "$2" >> "${registro}"; shift 2 ;;
    --download-url-prefix) shift 2 ;;
    *) dir="$1"; shift ;;
  esac
done
ls "$dir" >> "${registro}"
echo '<rss/>' > "$dir/appcast.xml"
`, { mode: 0o755 });
  const dmg = path.join(base, 'Farol-2.0.0.dmg');
  fs.writeFileSync(dmg, 'dmg falso\n');
  const anterior = path.join(base, 'publicado.xml');
  fs.writeFileSync(anterior, appcast(item('1.9.0')));
  const saida = path.join(base, 'saida');
  const r = spawnSync('bash', [SH, '--dmg', dmg, '--saida', saida, '--appcast-anterior', anterior, '--versao-build', '2.0.0'], {
    encoding: 'utf8',
    env: { ...process.env, SPARKLE_PRIVATE_KEY: CHAVE_FALSA, SPARKLE_BIN: bin },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), path.join(saida, 'appcast.xml'));
  const [argv, modo, conteudo, arquivoDaChave, ...listagem] = fs.readFileSync(registro, 'utf8').trim().split('\n');
  assert.ok(!argv.includes(CHAVE_FALSA), 'a chave foi na linha de comando');
  assert.match(argv, /--download-url-prefix https:\/\/github\.com\/wandersonaadsantos\/farol\/releases\/download\/v2\.0\.0\//);
  assert.equal(modo, '600');
  assert.equal(conteudo, CHAVE_FALSA);
  assert.ok(!fs.existsSync(arquivoDaChave), 'o arquivo da chave sobreviveu');
  assert.deepEqual(listagem.sort(), ['Farol-2.0.0.dmg', 'appcast.xml']);
  assert.ok(!`${r.stdout}${r.stderr}`.includes(CHAVE_FALSA));
});
