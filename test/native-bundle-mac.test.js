// Integração nativa: montagem, assinatura, identidade e boot real no macOS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const PRAZO_BUNDLE_MS = 120000;
const raiz = path.resolve(import.meta.dirname, '..');
const temRuntime = fs.existsSync(path.join(raiz, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'));
test('bundle macOS assinado abre com identidade própria', {
  skip: process.platform !== 'darwin' || !temRuntime, timeout: PRAZO_BUNDLE_MS,
}, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-bundle-'));
  const appDir = path.join(home, '.farol', 'app');
  try {
    fs.mkdirSync(path.join(appDir, 'node_modules'), { recursive: true });
    fs.symlinkSync(path.join(raiz, 'node_modules/electron'), path.join(appDir, 'node_modules/electron'));
    fs.mkdirSync(path.join(appDir, 'assets/png'), { recursive: true });
    fs.copyFileSync(path.join(raiz, 'assets/png/farol-256.png'), path.join(appDir, 'assets/png/farol-256.png'));
    fs.writeFileSync(path.join(appDir, 'package.json'), '{"type":"module","version":"9.9.9"}');
    const helper = pathToFileURL(path.join(raiz, 'lib/desktop-identity.js')).href;
    fs.writeFileSync(path.join(appDir, 'main.js'), `
import { app, Menu } from 'electron';
import fs from 'node:fs';
import { identificarAplicativo, instalarMenuMac } from '${helper}';
identificarAplicativo(app);
app.whenReady().then(() => {
  instalarMenuMac(Menu);
  fs.writeFileSync(new URL('./ready.txt', import.meta.url),
    [app.getName(), String(app.isPackaged), app.getAppPath(), Menu.getApplicationMenu().items[0].label].join('\\n'));
  app.quit();
});
`);
    const env = { ...process.env, HOME: home };
    delete env.ELECTRON_RUN_AS_NODE;
    execFileSync('/bin/bash', [path.join(raiz, 'installer/native-bundle-mac.sh')], {
      env, timeout: PRAZO_BUNDLE_MS, stdio: 'pipe',
    });
    const bundle = path.join(home, 'Applications/Farol.app');
    const plist = path.join(bundle, 'Contents/Info.plist');
    const lerPlist = (key) => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { encoding: 'utf8' }).trim();
    assert.equal(lerPlist('CFBundleIdentifier'), 'com.biud.farol');
    assert.equal(lerPlist('CFBundleName'), 'Farol');
    assert.equal(lerPlist('CFBundleVersion'), '9.9.9');
    execFileSync(path.join(bundle, 'Contents/MacOS/Electron'), [], { env, timeout: PRAZO_BUNDLE_MS });
    const [nome, packaged, appPath, menu] = fs.readFileSync(path.join(appDir, 'ready.txt'), 'utf8').split('\n');
    assert.equal(nome, 'Farol');
    assert.equal(packaged, 'true');
    assert.equal(fs.realpathSync(appPath), fs.realpathSync(path.join(bundle, 'Contents/Resources/app')));
    assert.equal(menu, 'Farol');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
