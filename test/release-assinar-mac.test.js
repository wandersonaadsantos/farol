// Plano 4 do Farol nativo, Task 3: assinatura Developer ID, notarização e `.dmg`.
// Esta máquina não tem certificado Apple nem credencial do notarytool, então a assinatura
// e a notarização são conferidas pelo `--dry-run` (as linhas de comando exatas que o script
// rodaria, sem rodar nada que precise de credencial): o node assinado ANTES do app, o
// runtime endurecido e os dois arquivos de entitlements, e nenhum segredo na saída. O
// `.dmg` SEM assinatura é criado de verdade com o `hdiutil` e montado só para leitura.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const RAIZ = path.join(import.meta.dirname, '..');
const ASSINAR = path.join(RAIZ, 'tools', 'release', 'assinar-mac.sh');
const DMG = path.join(RAIZ, 'tools', 'release', 'dmg-mac.sh');
const PULAR = process.platform !== 'darwin' ? 'assinatura, notarizacao e dmg so existem no macOS' : false;

const SENHA = 'segredo-falso';
const CHAVE_SPARKLE = 'chave-sparkle-falsa-NAO-PODE-APARECER';
const IDENTIDADE = 'Developer ID Application: Teste (ABCDE12345)';
const ENV_OK = {
  MAC_SIGNING_IDENTITY: IDENTIDADE,
  APPLE_ID: 'x@y',
  APPLE_TEAM_ID: 'ABCDE12345',
  APPLE_APP_PASSWORD: SENHA,
  SPARKLE_PRIVATE_KEY: CHAVE_SPARKLE,
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-assinar-mac-'));

// um Farol.app mínimo com o leiaute do montar-mac.sh; nada aqui precisa ser Mach-O,
// porque o dry-run não roda o codesign e o hdiutil empacota qualquer pasta
function appFalso(nome, versao = '3.1.4') {
  const app = path.join(TMP, nome, 'Farol.app');
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'engine', 'node', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'Farol'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(app, 'Contents', 'Resources', 'engine', 'node', 'bin', 'node'), '#!/bin/sh\n');
  fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Farol</string>
  <key>CFBundleIdentifier</key><string>com.biud.farol.teste</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${versao}</string>
</dict>
</plist>
`);
  return app;
}

function rodar(script, args, envExtra, semVariavel) {
  const env = { ...process.env, ...envExtra };
  for (const v of ['MAC_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_PASSWORD', 'NOTARY_PROFILE']) {
    if (!(v in envExtra)) delete env[v];
  }
  if (semVariavel) delete env[semVariavel];
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env });
}

const semSegredo = (r) => {
  const tudo = `${r.stdout}${r.stderr}`;
  assert.ok(!tudo.includes(SENHA), 'APPLE_APP_PASSWORD vazou na saida');
  assert.ok(!tudo.includes(CHAVE_SPARKLE), 'SPARKLE_PRIVATE_KEY vazou na saida');
};

test('assinar-mac.sh --dry-run: node antes do app, runtime endurecido e entitlements', { skip: PULAR }, () => {
  const app = appFalso('assinar');
  const r = rodar(ASSINAR, ['--app', app, '--dry-run'], ENV_OK);
  assert.equal(r.status, 0, r.stderr);
  const linhas = r.stdout.split('\n');
  const assinaturas = linhas.filter((l) => /^\+ codesign .*--sign/.test(l));
  assert.equal(assinaturas.length, 2, r.stdout);
  const [doNode, doApp] = assinaturas;
  assert.match(doNode, /Node\.entitlements/);
  assert.match(doNode, /engine\/node\/bin\/node$/);
  assert.match(doApp, /Farol\.entitlements/);
  assert.match(doApp, /--deep/);
  assert.match(doApp, /Farol\.app$/);
  for (const l of assinaturas) {
    assert.match(l, /--options runtime/);
    assert.match(l, /--timestamp/);
    assert.ok(l.includes('ABCDE12345'), `sem a identidade: ${l}`);
  }
  // ordem do ciclo inteiro: assinar, verificar, notarizar, grampear e so entao o spctl
  const idx = (re) => linhas.findIndex((l) => re.test(l));
  const ordem = [
    idx(/Node\.entitlements/), idx(/Farol\.entitlements/), idx(/codesign --verify --deep --strict/),
    idx(/ditto -c -k --keepParent/), idx(/notarytool submit/), idx(/stapler staple/), idx(/spctl --assess --type execute/),
  ];
  assert.ok(ordem.every((i) => i >= 0), `faltou passo:\n${r.stdout}`);
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, `ordem errada:\n${r.stdout}`);
  const submit = linhas[idx(/notarytool submit/)];
  assert.match(submit, /--wait/);
  assert.match(submit, /--output-format json/);
  assert.match(submit, /--apple-id x@y --team-id ABCDE12345 --password \*\*\*\*/);
  semSegredo(r);
});

test('assinar-mac.sh --dry-run com NOTARY_PROFILE usa o perfil do chaveiro e nao pede senha', { skip: PULAR }, () => {
  const app = appFalso('perfil');
  const r = rodar(ASSINAR, ['--app', app, '--dry-run'],
    { MAC_SIGNING_IDENTITY: IDENTIDADE, NOTARY_PROFILE: 'farol-notary' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /notarytool submit .*--keychain-profile farol-notary/);
  assert.doesNotMatch(r.stdout, /--password/);
});

for (const variavel of ['MAC_SIGNING_IDENTITY', 'APPLE_ID', 'APPLE_TEAM_ID', 'APPLE_APP_PASSWORD']) {
  test(`assinar-mac.sh sem ${variavel} falha nomeando a variavel`, { skip: PULAR }, () => {
    const app = appFalso(`sem-${variavel}`);
    const r = rodar(ASSINAR, ['--app', app, '--dry-run'], ENV_OK, variavel);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, new RegExp(variavel));
    assert.doesNotMatch(r.stdout, /codesign/, 'assinou antes de conferir as credenciais');
    semSegredo(r);
  });
}

test('assinar-mac.sh recusa app sem o node embutido', { skip: PULAR }, () => {
  const app = appFalso('sem-node');
  fs.rmSync(path.join(app, 'Contents', 'Resources', 'engine'), { recursive: true });
  const r = rodar(ASSINAR, ['--app', app, '--dry-run'], ENV_OK);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /node/);
});

test('dmg-mac.sh --dry-run: hdiutil, assinatura e notarizacao do dmg', { skip: PULAR }, () => {
  const app = appFalso('dmg-dry', '3.1.4');
  const saida = path.join(TMP, 'dmg-dry', 'Farol-3.1.4.dmg');
  const r = rodar(DMG, ['--app', app, '--saida', saida, '--dry-run'], ENV_OK);
  assert.equal(r.status, 0, r.stderr);
  const linhas = r.stdout.split('\n');
  const idx = (re) => linhas.findIndex((l) => re.test(l));
  const ordem = [idx(/ln -s \/Applications/), idx(/hdiutil create/), idx(/codesign .*--sign/),
    idx(/notarytool submit/), idx(/stapler staple/)];
  assert.ok(ordem.every((i) => i >= 0), `faltou passo:\n${r.stdout}`);
  assert.deepEqual([...ordem].sort((a, b) => a - b), ordem, `ordem errada:\n${r.stdout}`);
  assert.match(linhas[idx(/hdiutil create/)], /-volname Farol .*-format UDZO/);
  assert.match(linhas[idx(/codesign .*--sign/)], /--timestamp/);
  assert.ok(!fs.existsSync(saida), 'o dry-run criou o dmg');
  semSegredo(r);
});

test('dmg-mac.sh recusa saida cujo nome nao bate com a versao do app', { skip: PULAR }, () => {
  const app = appFalso('dmg-nome', '3.1.4');
  const r = rodar(DMG, ['--app', app, '--saida', path.join(TMP, 'dmg-nome', 'Farol-9.9.9.dmg'), '--dry-run'], {});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Farol-3\.1\.4\.dmg/);
});

test('dmg-mac.sh cria o dmg de verdade com o app e o atalho para Applications', { skip: PULAR }, (t) => {
  if (!fs.existsSync('/usr/bin/hdiutil')) { t.skip('hdiutil ausente'); return; }
  const app = appFalso('dmg-real', '1.2.3');
  const saida = path.join(TMP, 'dmg-real', 'Farol-1.2.3.dmg');
  const r = rodar(DMG, ['--app', app, '--saida', saida], {});
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').at(-1), saida);
  assert.ok(fs.existsSync(saida));
  const ponto = fs.mkdtempSync(path.join(TMP, 'montagem-'));
  const montar = spawnSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', ponto, saida],
    { encoding: 'utf8' });
  assert.equal(montar.status, 0, montar.stderr);
  try {
    assert.ok(fs.existsSync(path.join(ponto, 'Farol.app', 'Contents', 'Info.plist')), 'Farol.app fora do dmg');
    const atalho = path.join(ponto, 'Applications');
    assert.ok(fs.lstatSync(atalho).isSymbolicLink(), 'Applications nao e atalho');
    assert.equal(fs.readlinkSync(atalho), '/Applications');
  } finally {
    spawnSync('hdiutil', ['detach', ponto, '-force'], { encoding: 'utf8' });
  }
});

// notarytool falso primeiro no PATH (nada sai desta máquina): o caminho de recusa busca o
// log pelo id da submissão e o imprime antes de sair com erro (Review Focus 2); o aceito
// grampeia e devolve o caminho.
const NOTARIZAR = path.join(RAIZ, 'tools', 'release', 'notarizar-mac.sh');
function xcrunFalso(nome, status, saidaDoSubmit = 0) {
  const bin = path.join(TMP, nome, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const registro = path.join(TMP, nome, 'chamadas.txt');
  fs.writeFileSync(path.join(bin, 'xcrun'), `#!/bin/bash
printf '%s\\n' "$*" >> "${registro}"
case "$1 $2" in
  'notarytool submit') echo '{"id":"abc-123","status":"${status}","message":"Processing complete"}'; exit ${saidaDoSubmit} ;;
  'notarytool log') echo 'LOG DA APPLE: The binary is not signed with a valid Developer ID certificate.' ;;
  'stapler staple' | 'stapler validate') exit 0 ;;
  *) exit 99 ;;
esac
`, { mode: 0o755 });
  return { bin, registro };
}

for (const [caso, saidaDoSubmit] of [['status Invalid com saida 0', 0], ['saida diferente de zero', 1]]) {
  test(`notarizar-mac.sh recusado (${caso}) imprime o log da submissao e falha`, { skip: PULAR }, () => {
    const nome = `recusa-${saidaDoSubmit}`;
    const { bin, registro } = xcrunFalso(nome, 'Invalid', saidaDoSubmit);
    const dmg = path.join(TMP, nome, 'Farol-1.0.0.dmg');
    fs.writeFileSync(dmg, 'dmg falso\n');
    const r = rodar(NOTARIZAR, ['--arquivo', dmg], { ...ENV_OK, PATH: `${bin}:${process.env.PATH}` });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /abc-123/);
    assert.match(r.stderr, /LOG DA APPLE/);
    const chamadas = fs.readFileSync(registro, 'utf8');
    assert.match(chamadas, /notarytool log abc-123/);
    assert.doesNotMatch(chamadas, /stapler/, 'grampeou um envio recusado');
    semSegredo(r);
  });
}

test('notarizar-mac.sh aceito grampeia o app zipado e devolve o caminho', { skip: PULAR }, () => {
  const { bin, registro } = xcrunFalso('aceito', 'Accepted');
  const app = appFalso('aceito');
  const r = rodar(NOTARIZAR, ['--arquivo', app], { ...ENV_OK, PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), app);
  const chamadas = fs.readFileSync(registro, 'utf8').trim().split('\n');
  assert.match(chamadas[0], /^notarytool submit .*\/Farol\.zip .*--wait --output-format json$/);
  assert.equal(chamadas[1], `stapler staple ${app}`);
  assert.equal(chamadas[2], `stapler validate ${app}`);
});
