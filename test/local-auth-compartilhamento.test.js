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

test('no celular sem autenticação exigida, o compartilhamento e a distribuição ficam desligados, com motivo', () => {
  fs.mkdirSync(process.env.FAROL_HOME, { recursive: true });
  fs.writeFileSync(path.join(process.env.FAROL_HOME, 'config.json'), JSON.stringify({ sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  assert.equal(e.config.sync.shared.enabled, false, 'config.json editado à mão também é barrado no boot');
  e.updateSettings({ sync: ligado() });
  assert.equal(e.config.sync.shared.enabled, false);
  assert.equal(e.config.sync.distribution.enabled, false);
  assert.equal(syncMod.statusForUi(e).bloqueioCompartilhamento, 'autenticacao-local');
});

// `localAuth` não passa pela rota de configurações: ele é escrito no config.json pelo dono,
// e é assim que o teste o liga, antes do boot.
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
test('o pedido de compartilhamento sobrevive ao disco: o Farol desliga o efeito, não a escolha', () => {
  const arquivo = path.join(process.env.FAROL_HOME, 'config.json');
  fs.mkdirSync(process.env.FAROL_HOME, { recursive: true });
  fs.writeFileSync(arquivo, JSON.stringify({ sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  assert.equal(e.config.sync.shared.enabled, false, 'o efeito continua desligado aqui');
  e.saveConfig();
  const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.equal(gravado.sync.shared.enabled, true, 'o disco guarda o que foi pedido');
  assert.equal(gravado.sync.distribution.enabled, true);
  const outro = new Engine();
  outro.pushState = () => { };
  assert.equal(outro.config.sync.shared.enabled, false, 'no boot seguinte o efeito segue desligado');
  assert.equal(outro.syncBloqueioCompartilhamento, 'autenticacao-local', 'e o motivo continua visível');
});

// A tela edita a configuração que recebe e devolve o objeto INTEIRO de sync. Se ela
// recebesse a config já zerada pela guarda, qualquer salvamento (renomear o aparelho, por
// exemplo) mandaria `shared: false` de volta e apagaria o pedido, contornando a correção
// acima. A tela recebe o PEDIDO; o engine segue aplicando o bloqueio.
test('a tela recebe o pedido, e salvar pela tela não apaga a escolha nem liga o efeito', () => {
  const arquivo = path.join(process.env.FAROL_HOME, 'config.json');
  fs.writeFileSync(arquivo, JSON.stringify({ sync: ligado() }));
  const e = new Engine();
  e.pushState = () => { };
  const vista = e.snapshot().config.sync;
  assert.equal(vista.shared.enabled, true, 'a tela mostra o que foi pedido');
  assert.equal(vista.distribution.enabled, true);
  assert.equal(e.config.sync.shared.enabled, false, 'o efeito segue desligado');
  // o que a tela faz ao renomear o aparelho: devolve o objeto que recebeu, com um campo mudado
  e.updateSettings({ sync: { ...vista, deviceName: 'Celular de teste' } });
  assert.equal(e.config.sync.shared.enabled, false, 'salvar não liga o efeito');
  assert.equal(syncMod.statusForUi(e).bloqueioCompartilhamento, 'autenticacao-local');
  const gravado = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  assert.equal(gravado.sync.shared.enabled, true, 'o pedido continua no disco');
  assert.equal(gravado.sync.deviceName, 'Celular de teste');
  assert.equal(e.snapshot().capacidades.compartilhamento.aplicado, false);
});
