// Plano 4 do Farol nativo, Task 3: o appcast da Sparkle nunca recebe versão que não seja
// maior que a última publicada (Review Focus 3). A regra é PURA em
// `tools/release/versao-maior.js` (reusa o `cmpVersion` do update do motor) e o
// `tools/release/appcast-mac.sh` a consulta antes de rodar o `generate_appcast`. Aqui: a
// função pura, e o caminho de recusa do script de verdade (com `--dry-run`, que não roda o
// `generate_appcast` nem grava a chave em disco).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { versaoMaior, ultimaVersaoDoAppcast } from '../tools/release/versao-maior.js';

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
  assert.equal(ultimaVersaoDoAppcast(xml), '1.10.0');
});

test('ultimaVersaoDoAppcast: le o formato antigo em atributo do enclosure', () => {
  const xml = appcast(`    <item>
      <enclosure url="https://exemplo/a.dmg" sparkle:version="7" sparkle:shortVersionString="2.3.4" length="1"/>
    </item>`);
  assert.equal(ultimaVersaoDoAppcast(xml), '2.3.4');
});

test('ultimaVersaoDoAppcast: sem shortVersionString usa sparkle:version', () => {
  const xml = appcast(`    <item>
      <sparkle:version>1.4.0</sparkle:version>
    </item>`);
  assert.equal(ultimaVersaoDoAppcast(xml), '1.4.0');
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

function rodar(nomeDoDmg, versaoPublicada) {
  const base = fs.mkdtempSync(path.join(TMP, 'caso-'));
  const dmg = path.join(base, nomeDoDmg);
  fs.writeFileSync(dmg, 'dmg falso\n');
  const anterior = path.join(base, 'appcast-publicado.xml');
  fs.writeFileSync(anterior, appcast(item(versaoPublicada, '1')));
  return spawnSync('bash', [SH, '--dmg', dmg, '--saida', path.join(base, 'saida'),
    '--appcast-anterior', anterior, '--dry-run'], {
    encoding: 'utf8',
    env: { ...process.env, SPARKLE_PRIVATE_KEY: CHAVE_FALSA, SPARKLE_BIN: '' },
  });
}

test('appcast-mac.sh recusa versao igual a ultima publicada', { skip: PULAR }, () => {
  const r = rodar('Farol-1.0.0.dmg', '1.0.0');
  assert.notEqual(r.status, 0, 'deveria recusar');
  assert.match(r.stderr, /1\.0\.0 nao e maior que a ultima publicada no appcast \(1\.0\.0\)/);
  assert.doesNotMatch(r.stdout, /generate_appcast/);
});

test('appcast-mac.sh com versao maior imprime o generate_appcast sem a chave', { skip: PULAR }, () => {
  const r = rodar('Farol-1.0.1.dmg', '1.0.0');
  assert.equal(r.status, 0, r.stderr);
  const linha = r.stdout.split('\n').find((l) => l.includes('generate_appcast'));
  assert.ok(linha, `sem linha do generate_appcast:\n${r.stdout}`);
  assert.match(linha, /--ed-key-file/);
  assert.match(linha, /--download-url-prefix https:\/\/github\.com\/wandersonaadsantos\/farol\/releases\/download\/v1\.0\.1\//);
  assert.ok(!`${r.stdout}${r.stderr}`.includes(CHAVE_FALSA), 'a chave privada vazou na saida');
});

test('appcast-mac.sh sem SPARKLE_PRIVATE_KEY falha nomeando a variavel', { skip: PULAR }, () => {
  const base = fs.mkdtempSync(path.join(TMP, 'sem-chave-'));
  const dmg = path.join(base, 'Farol-1.0.1.dmg');
  fs.writeFileSync(dmg, 'dmg falso\n');
  const env = { ...process.env };
  delete env.SPARKLE_PRIVATE_KEY;
  const r = spawnSync('bash', [SH, '--dmg', dmg, '--saida', path.join(base, 'saida'), '--dry-run'],
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
    --ed-key-file) stat -f '%Lp' "$2" >> "${registro}"; cat "$2" >> "${registro}"; printf '\\n%s\\n' "$2" >> "${registro}"; shift 2 ;;
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
  const r = spawnSync('bash', [SH, '--dmg', dmg, '--saida', saida, '--appcast-anterior', anterior], {
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
