// O modo celular é simulado pelo sinal do Termux, ANTES de qualquer import: o porteiro lê
// os sinais do processo uma vez só. Pasta de dados isolada, sem rede.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-a4b-celular-'));
process.env.FAROL_HOME = path.join(BASE, 'farol');
process.env.TERMUX_VERSION = '0.118.0-teste';

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { Engine } = await import('../server.js');
const syncMod = (await import('../lib/engine/sync.js')).default;

after(() => { try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best-effort */ } });

function ligado() {
  return { enabled: true, coordination: { enabled: true }, shared: { enabled: true }, distribution: { enabled: true }, databaseUrl: '', apiKey: '' };
}

// Com a ativação automática LIGADA (17/09/2026), o celular passa a exigir autenticação
// sozinho, e o compartilhamento deixa de ser bloqueado por falta dela. A regra que
// desliga o efeito quando a autenticação NÃO é exigida continua provada onde ela mora,
// em test/local-auth-modo.test.js (`compartilhamentoPermitido` com a ativação desligada):
// aqui, no engine, esse caminho só volta a existir se a ativação for desligada de novo.
test('no celular, a autenticação passa a ser exigida sozinha e o compartilhamento vale', () => {
  fs.mkdirSync(process.env.FAROL_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({ sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  assert.equal(e.config.sync.shared.enabled, true, 'nada mais barra no boot');
  e.updateSettings({ sync: ligado() });
  assert.equal(e.config.sync.distribution.enabled, true);
  assert.equal(syncMod.statusForUi(e).bloqueioCompartilhamento, '');
  assert.equal(e.snapshot().capacidades.autenticacaoLocal.exigida, true, 'e a tela diz que o celular pede login');
});

// O pedido da pessoa continua sendo o que vai ao disco: o Farol nunca grava por cima da
// escolha dela, e é isso que faz o bloqueio (quando ele existir) ser reversível.
test('o pedido de compartilhamento continua indo ao disco como foi pedido', () => {
  const arquivo = path.join(process.env.FAROL_HOME, 'config.json');
  fs.mkdirSync(process.env.FAROL_HOME, { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify({ sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  e.saveConfig();
  const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.equal(gravado.sync.shared.enabled, true);
  assert.equal(gravado.sync.distribution.enabled, true);
});

// A tela edita a configuração que recebe e devolve o objeto INTEIRO de sync: salvar um
// campo qualquer não pode mexer no resto.
test('salvar pela tela não apaga a escolha', () => {
  const arquivo = path.join(process.env.FAROL_HOME, 'config.json');
  fs.writeFileSync(arquivo, JSON.stringify({ sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  const vista = e.snapshot().config.sync;
  assert.equal(vista.shared.enabled, true);
  e.updateSettings({ sync: { ...vista, deviceName: 'Celular de teste' } });
  assert.equal(e.config.sync.shared.enabled, true);
  const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.equal(gravado.sync.shared.enabled, true);
  assert.equal(gravado.sync.deviceName, 'Celular de teste');
});

test('com a autenticação exigida, o compartilhamento liga', () => {
  fs.mkdirSync(process.env.FAROL_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({ localAuth: 'exigir', sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  assert.equal(e.config.sync.shared.enabled, true, 'vale no boot');
  e.updateSettings({ sync: ligado() });
  assert.equal(e.config.sync.shared.enabled, true);
  assert.equal(syncMod.statusForUi(e).bloqueioCompartilhamento, '');
});

// Achado da jornada integrada (16/09/2026, instância isolada em modo celular): a guarda
// zerava `shared`/`distribution` e esse valor forçado ia parar NO DISCO no primeiro
// salvamento. Efeito: o que a pessoa ligou some para sempre, sem aviso, e não volta nem
// quando a autenticação passar a ser exigida. Pior, o motivo do bloqueio também some no boot
// seguinte, porque não há mais pedido nenhum para bloquear.
