// Plano 4 do Farol nativo, Task 4: o MSIX do Windows, a assinatura e o App Installer.
// A parte que dá para provar fora do Windows: o XML do `Farol.appinstaller`, gerado pela
// função pura `tools/release/appinstaller.js` (versão de quatro partes, `Uri` do manifesto
// apontando para `releases/latest/download/` e o do pacote para o asset da release
// versionada, atributos do `MainPackage`, `UpdateSettings`, escape de XML e recusas), e os
// três scripts PowerShell pelo `pwsh` em dry-run ou com entradas falsas. `dotnet publish`
// do Farol.App, o `Content` entrando no MSIX e o `signtool` só existem no Windows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { appinstallerXml } from '../tools/release/appinstaller.js';

const RAIZ = path.join(import.meta.dirname, '..');
const RELEASE = path.join(RAIZ, 'tools', 'release');
const existe = (cmd, args) => { const r = spawnSync(cmd, args); return !r.error && r.status === 0; };
const PWSH = ['/opt/homebrew/bin/pwsh', '/usr/local/bin/pwsh', '/usr/bin/pwsh'].find((p) => fs.existsSync(p))
  || (existe('pwsh', ['-v']) ? 'pwsh' : null);
const COM_PWSH = { skip: PWSH ? false : 'pwsh ausente nesta máquina' };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-appinstaller-'));
const BASE = { versao: '3.1.4.0', repo: 'wandersonaadsantos/farol', nomeDoMsix: 'Farol-3.1.4.msix', publisher: 'CN=BIUD', nome: 'BIUD.Farol' };

// o ambiente do pwsh: sem os segredos herdados de quem roda o teste, com o node no PATH
function ambiente(extra = {}) {
  const env = { ...process.env, PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH}` };
  delete env.WIN_SIGNING_CERT_PFX;
  delete env.WIN_SIGNING_CERT_PASSWORD;
  delete env.WIN_SIGNTOOL;
  return { ...env, ...extra };
}
const pwsh = (script, args, env = ambiente()) => spawnSync(PWSH,
  ['-NoProfile', '-NonInteractive', '-File', path.join(RELEASE, script), ...args], { encoding: 'utf8', env });

test('appinstallerXml: raiz, MainPackage e UpdateSettings com os valores do plano', () => {
  const xml = appinstallerXml(BASE);
  assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>\n/);
  assert.match(xml, /<AppInstaller xmlns="http:\/\/schemas\.microsoft\.com\/appx\/appinstaller\/2018"/);
  assert.match(xml, /Uri="https:\/\/github\.com\/wandersonaadsantos\/farol\/releases\/latest\/download\/Farol\.appinstaller"/);
  assert.match(xml, /<AppInstaller [^>]*Version="3\.1\.4\.0"/);
  const main = /<MainPackage ([^>]*)\/>/.exec(xml);
  assert.ok(main, 'sem MainPackage');
  assert.match(main[1], /Name="BIUD\.Farol"/);
  assert.match(main[1], /Publisher="CN=BIUD"/);
  assert.match(main[1], /Version="3\.1\.4\.0"/);
  assert.match(main[1], /ProcessorArchitecture="x64"/);
  // o pacote aponta para o asset da release VERSIONADA (X.Y.Z), não para a latest
  assert.match(main[1], /Uri="https:\/\/github\.com\/wandersonaadsantos\/farol\/releases\/download\/v3\.1\.4\/Farol-3\.1\.4\.msix"/);
  assert.match(xml, /<UpdateSettings>\s*<OnLaunch HoursBetweenUpdateChecks="0" ShowPrompt="false" UpdateBlocksActivation="false" \/>\s*<AutomaticBackgroundTask \/>\s*<\/UpdateSettings>/);
  assert.match(xml, /<\/AppInstaller>\n$/);
});

test('appinstallerXml: escapa & e aspas nos nomes', () => {
  const xml = appinstallerXml({ ...BASE, publisher: 'CN=BIUD & Cia, O="X"', nome: 'BIUD&Farol', nomeDoMsix: 'Farol&1.msix' });
  assert.match(xml, /Publisher="CN=BIUD &amp; Cia, O=&quot;X&quot;"/);
  assert.match(xml, /Name="BIUD&amp;Farol"/);
  assert.match(xml, /\/Farol&amp;1\.msix"/);
  assert.doesNotMatch(xml, /&(?!amp;|quot;|lt;|gt;|apos;)/, 'sobrou & sem escape');
});

test('appinstallerXml: recusa versão sem 4 partes numéricas, repo malformado e msix vazio', () => {
  for (const versao of ['3.1.4', '3.1.4.0.1', '3.1.4.x', 'v3.1.4.0', '', undefined]) {
    assert.throws(() => appinstallerXml({ ...BASE, versao }), /versao/, `aceitou a versão ${versao}`);
  }
  for (const repo of ['farol', 'a/b/c', '/farol', 'dono/', 'dono/re po', '']) {
    assert.throws(() => appinstallerXml({ ...BASE, repo }), /repo/, `aceitou o repo ${repo}`);
  }
  assert.throws(() => appinstallerXml({ ...BASE, nomeDoMsix: '' }), /msix/);
  assert.throws(() => appinstallerXml({ ...BASE, nomeDoMsix: '   ' }), /msix/);
  assert.throws(() => appinstallerXml({ ...BASE, publisher: '' }), /publisher/);
  assert.throws(() => appinstallerXml({ ...BASE, nome: '' }), /nome/);
});

const IDENTIDADE = /<Identity\b[^>]*>/.exec(fs.readFileSync(path.join(RAIZ, 'shell', 'win', 'Farol.App', 'Package.appxmanifest'), 'utf8'))[0];
const doManifesto = (attr) => new RegExp(`\\b${attr}="([^"]*)"`).exec(IDENTIDADE)[1];

test('appinstaller-win.ps1 grava o mesmo XML da função pura, com Name, Publisher e Version do manifesto', COM_PWSH, () => {
  const versao = doManifesto('Version');
  const msix = path.join(TMP, 'Farol-manifesto.msix');
  fs.writeFileSync(msix, 'msix falso');
  const saida = path.join(TMP, 'saida', 'Farol.appinstaller');
  const r = pwsh('appinstaller-win.ps1', ['--msix', msix, '--saida', saida, '--versao', versao, '--repo', 'wandersonaadsantos/farol']);
  assert.equal(r.status, 0, `appinstaller-win.ps1 falhou: ${r.stderr}`);
  const esperado = appinstallerXml({ versao, repo: 'wandersonaadsantos/farol', nomeDoMsix: 'Farol-manifesto.msix',
    publisher: doManifesto('Publisher'), nome: doManifesto('Name') });
  assert.equal(fs.readFileSync(saida, 'utf8'), esperado);
});

test('appinstaller-win.ps1 recusa versão diferente da Version do manifesto sem gravar nada', COM_PWSH, () => {
  const msix = path.join(TMP, 'Farol-manifesto.msix');
  fs.writeFileSync(msix, 'msix falso');
  const partes = doManifesto('Version').split('.').map(Number);
  partes[3] += 1;
  const saida = path.join(TMP, 'divergente', 'Farol.appinstaller');
  const r = pwsh('appinstaller-win.ps1', ['--msix', msix, '--saida', saida, '--versao', partes.join('.'), '--repo', 'wandersonaadsantos/farol']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /difere da Version do Package\.appxmanifest/);
  assert.ok(!fs.existsSync(saida), 'gravou o appinstaller mesmo recusando');
});

test('appinstaller-win.ps1 recusa versão de 3 partes sem gravar nada', COM_PWSH, () => {
  const msix = path.join(TMP, 'Farol-3.1.4.msix');
  fs.writeFileSync(msix, 'msix falso');
  const saida = path.join(TMP, 'recusa', 'Farol.appinstaller');
  const r = pwsh('appinstaller-win.ps1', ['--msix', msix, '--saida', saida, '--versao', '3.1.4', '--repo', 'wandersonaadsantos/farol']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /versao/);
  assert.ok(!fs.existsSync(saida), 'gravou o appinstaller mesmo recusando');
});

function entradasFalsas(nome) {
  const base = path.join(TMP, nome);
  const app = path.join(base, 'semente', 'engine', 'app');
  fs.mkdirSync(app, { recursive: true });
  fs.writeFileSync(path.join(app, 'server.js'), '// motor falso\n');
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"farol","version":"9.8.7"}\n');
  const node = path.join(base, 'node.exe');
  fs.writeFileSync(node, 'node falso');
  return { semente: path.join(base, 'semente'), node, saida: path.join(base, 'saida') };
}

test('montar-win.ps1 --dry-run imprime as cópias e o dotnet publish, sem rodar dotnet', COM_PWSH, () => {
  const { semente, node, saida } = entradasFalsas('montar');
  // um dotnet falso no PATH: se o dry-run o chamasse, o arquivo-marca apareceria
  const bin = path.join(TMP, 'montar', 'bin');
  const marca = path.join(TMP, 'montar', 'dotnet-chamado');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, 'dotnet'), `#!/bin/sh\ntouch '${marca}'\n`, { mode: 0o755 });
  const env = ambiente({ PATH: `${bin}${path.delimiter}${ambiente().PATH}` });
  const r = pwsh('montar-win.ps1', ['--dry-run', '--semente', semente, '--node', node, '--saida', saida], env);
  assert.equal(r.status, 0, `montar-win.ps1 --dry-run falhou: ${r.stderr}`);
  assert.ok(!fs.existsSync(marca), 'o dry-run chamou o dotnet');
  const app = path.join('shell', 'win', 'Farol.App', 'engine');
  assert.ok(r.stdout.includes(path.join(semente, 'engine', 'app')), 'faltou a cópia da semente');
  assert.ok(r.stdout.includes(node), 'faltou a cópia do node.exe');
  assert.ok(r.stdout.includes(app), 'faltou o destino dentro do Farol.App');
  const linha = r.stdout.split('\n').find((l) => l.startsWith('dotnet publish'));
  assert.ok(linha, `sem a linha do dotnet publish:\n${r.stdout}`);
  for (const parte of ['-c Release', '-r win-x64', '-p:Platform=x64', '-p:GenerateAppxPackageOnBuild=true',
    '-p:AppxBundle=Never', '-p:UapAppxPackageBuildMode=SideloadOnly', '-p:AppxPackageSigningEnabled=false']) {
    assert.ok(linha.includes(parte), `dotnet publish sem ${parte}: ${linha}`);
  }
  assert.ok(linha.includes(`-p:AppxPackageDir=${saida}`), `AppxPackageDir fora da saída: ${linha}`);
  assert.match(r.stdout, /Farol-3\.0\.0\.msix/, 'faltou o nome final do msix, da Version do manifesto');
  const encenado = path.join(RAIZ, app, 'node', 'node.exe');
  assert.ok(!fs.existsSync(encenado) || fs.readFileSync(encenado, 'utf8') !== 'node falso', 'o dry-run copiou o node.exe');
});

test('montar-win.ps1 aborta cedo com semente sem server.js', COM_PWSH, () => {
  const { node, saida } = entradasFalsas('montar-sem-semente');
  const vazia = path.join(TMP, 'montar-sem-semente', 'vazia');
  fs.mkdirSync(vazia, { recursive: true });
  const r = pwsh('montar-win.ps1', ['--dry-run', '--semente', vazia, '--node', node, '--saida', saida]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /server\.js/);
});

test('assinar-win.ps1 --dry-run mascara a senha e confere depois de assinar', COM_PWSH, () => {
  const msix = path.join(TMP, 'assinar', 'Farol-3.0.0.msix');
  const pfx = path.join(TMP, 'assinar', 'cert.pfx');
  fs.mkdirSync(path.dirname(msix), { recursive: true });
  fs.writeFileSync(msix, 'msix falso');
  fs.writeFileSync(pfx, 'pfx falso');
  const senha = 'senha-secreta-do-teste';
  const r = pwsh('assinar-win.ps1', ['--msix', msix, '--dry-run'],
    ambiente({ WIN_SIGNING_CERT_PFX: pfx, WIN_SIGNING_CERT_PASSWORD: senha }));
  assert.equal(r.status, 0, `assinar-win.ps1 --dry-run falhou: ${r.stderr}`);
  assert.ok(!`${r.stdout}${r.stderr}`.includes(senha), 'a senha vazou na saída');
  const sign = r.stdout.split('\n').find((l) => / sign /.test(l));
  assert.ok(sign, `sem a linha do signtool sign:\n${r.stdout}`);
  for (const parte of ['/fd SHA256', '/tr http://timestamp.digicert.com', '/td SHA256', `/f ${pfx}`, '/p ****', msix]) {
    assert.ok(sign.includes(parte), `signtool sign sem ${parte}: ${sign}`);
  }
  assert.match(r.stdout, /verify \/pa .*Farol-3\.0\.0\.msix/);
});

test('assinar-win.ps1 sem WIN_SIGNING_CERT_PFX falha nomeando a variável', COM_PWSH, () => {
  const msix = path.join(TMP, 'assinar', 'Farol-3.0.0.msix');
  fs.mkdirSync(path.dirname(msix), { recursive: true });
  fs.writeFileSync(msix, 'msix falso');
  const r = pwsh('assinar-win.ps1', ['--msix', msix, '--dry-run'], ambiente({ WIN_SIGNING_CERT_PASSWORD: 'x' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /WIN_SIGNING_CERT_PFX/);
  const semSenha = pwsh('assinar-win.ps1', ['--msix', msix, '--dry-run'],
    ambiente({ WIN_SIGNING_CERT_PFX: path.join(TMP, 'assinar', 'cert.pfx') }));
  assert.notEqual(semSenha.status, 0);
  assert.match(semSenha.stderr, /WIN_SIGNING_CERT_PASSWORD/);
});

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));
