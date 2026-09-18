// Autostart no macOS por LaunchAgent. O login item do Electron registra o PRÓPRIO bundle
// (o Electron.app de dentro de node_modules) e ignora os argumentos, então abriria o
// Electron pelado, sem o app. O LaunchAgent abre o lançador ~/Applications/Farol.app que o
// instalador cria, pelo `open`, que é como o Finder abriria.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const am = (await import('../lib/autostart-mac.js')).default;

function casaTemporaria({ comLancador = true } = {}) {
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-autostart-mac-'));
  if (comLancador) fs.mkdirSync(path.join(casa, 'Applications', 'Farol.app', 'Contents', 'MacOS'), { recursive: true });
  return casa;
}

function limpar(casa) {
  try { fs.rmSync(casa, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
}

test('o plist abre o lançador pelo open, só no login, e sem manter vivo', () => {
  const xml = am.plistDoAgente('/Users/fulano/Applications/Farol.app');
  assert.match(xml, /<key>Label<\/key>\s*<string>com\.biud\.farol\.autostart<\/string>/);
  assert.match(xml, /<string>\/usr\/bin\/open<\/string>\s*<string>-a<\/string>\s*<string>\/Users\/fulano\/Applications\/Farol\.app<\/string>/);
  assert.match(xml, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.doesNotMatch(xml, /KeepAlive/, 'fechar o Farol não pode fazer o launchd reabrir');
});

test('caminho com caractere de XML sai escapado, nunca quebra o plist', () => {
  const xml = am.plistDoAgente('/Users/a&b<c>/Applications/Farol.app');
  assert.match(xml, /\/Users\/a&amp;b&lt;c&gt;\/Applications\/Farol\.app/);
});

test('ligar grava o agente em ~/Library/LaunchAgents; desligar remove', () => {
  const casa = casaTemporaria();
  try {
    const alvo = path.join(casa, 'Library', 'LaunchAgents', 'com.biud.farol.autostart.plist');
    const ligado = am.aplicarAutostartMac({ ligado: true, casa });
    assert.equal(ligado.ok, true);
    assert.ok(fs.existsSync(alvo));
    assert.match(fs.readFileSync(alvo, 'utf8'), new RegExp(path.join(casa, 'Applications', 'Farol.app').replace(/[\\.]/g, '\\$&')));
    const desligado = am.aplicarAutostartMac({ ligado: false, casa });
    assert.equal(desligado.ok, true);
    assert.equal(fs.existsSync(alvo), false);
  } finally { limpar(casa); }
});

test('desligar sem agente gravado não é erro', () => {
  const casa = casaTemporaria();
  try {
    assert.equal(am.aplicarAutostartMac({ ligado: false, casa }).ok, true);
  } finally { limpar(casa); }
});

test('sem o lançador instalado, ligar recusa em vez de gravar agente que abriria nada', () => {
  const casa = casaTemporaria({ comLancador: false });
  try {
    const r = am.aplicarAutostartMac({ ligado: true, casa });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'sem-lancador');
    assert.equal(fs.existsSync(path.join(casa, 'Library', 'LaunchAgents', 'com.biud.farol.autostart.plist')), false);
  } finally { limpar(casa); }
});

test('regravar com o mesmo conteúdo não toca o arquivo', () => {
  const casa = casaTemporaria();
  try {
    am.aplicarAutostartMac({ ligado: true, casa });
    const alvo = path.join(casa, 'Library', 'LaunchAgents', 'com.biud.farol.autostart.plist');
    const antes = fs.statSync(alvo).mtimeMs;
    const r = am.aplicarAutostartMac({ ligado: true, casa });
    assert.equal(r.ok, true);
    assert.equal(r.mudou, false);
    assert.equal(fs.statSync(alvo).mtimeMs, antes);
  } finally { limpar(casa); }
});

test('o desinstalador apaga o mesmo agente que o app grava', () => {
  const desinstalador = fs.readFileSync(path.join(import.meta.dirname, '..', 'installer', 'uninstall.sh'), 'utf8');
  assert.ok(desinstalador.includes(`Library/LaunchAgents/${am.ROTULO}.plist`), 'nome divergente deixaria o agente abrindo um lançador apagado');
});
