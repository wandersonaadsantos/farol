import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { instalarDom } from './helpers/dom-stub.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-preferences-ui-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { command } = await import('../lib/preferences/transfer.js');
after(() => { fs.rmSync(home, { recursive: true, force: true }); });

const { doc } = instalarDom();
const $ = selector => doc.querySelector(selector);
const preview = $('#preferencesPreview');
preview.replaceChildren = () => { preview.innerHTML = ''; };
let selected = [];
const query = doc.querySelector.bind(doc);
doc.querySelector = selector => selector === '[data-preference-key]:checked' ? selected[0] || null : query(selector);
doc.querySelectorAll = selector => selector === '[data-preference-key]:checked' ? selected : [];
const engine = new Engine();
engine.checks = 0;
engine.pushState = () => {};
engine.checkNow = () => { engine.checks++; };
globalThis.fetch = async (_url, init) => ({ json: () => command(engine, JSON.parse(init.body)) });
const { initPreferencesTransfer } = await import('../ui/telas/preferences-transfer.js');
initPreferencesTransfer();
const old = { type: 'farol-preferences', schema: 1, values: { theme: 'dark', soundEnabled: true, interventionReminderMinutes: 0 } };
async function inspect(document) {
  selected = [];
  $('#preferencesFile').files = [{ size: 200, text: async () => JSON.stringify(document) }];
  $('#preferencesFile').onchange();
  await $('#preferencesInspect').onclick();
}

test('tela oculta tabela quando igual e explica intervalo ausente no arquivo antigo', async () => {
  engine.config = { ...engine.config, ...old.values, intervalSeconds: 300 };
  const before = fs.readFileSync(path.join(home, 'config.json'), 'utf8');
  await inspect(old);
  assert.equal(preview.innerHTML, '');
  assert.match($('#preferencesMessage').textContent, /Nenhuma diferença encontrada/);
  assert.match($('#preferencesMessage').textContent, /não contém o intervalo de checagem/);
  assert.equal($('#preferencesApply').disabled, true);
  assert.equal(fs.readFileSync(path.join(home, 'config.json'), 'utf8'), before);
});

test('tela mostra só checagem, em minutos, e aplica seleção pela API de produção', async () => {
  engine.config = { ...engine.config, ...old.values, intervalSeconds: 180 };
  const exported = await command(engine, { action: 'export' });
  engine.config.intervalSeconds = 300;
  await inspect(exported.document);
  assert.match(preview.innerHTML, /Intervalo de checagem/);
  assert.match(preview.innerHTML, /5 minutos/);
  assert.match(preview.innerHTML, /3 minutos/);
  assert.doesNotMatch(preview.innerHTML, /Tema|Toque sonoro|Lembrete|igual/);
  assert.equal($('#preferencesApply').disabled, true);
  selected = [{ dataset: { preferenceKey: 'intervalSeconds' } }];
  preview.onchange();
  assert.equal($('#preferencesApply').disabled, false);
  await $('#preferencesApply').onclick();
  assert.equal(engine.config.intervalSeconds, 180);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8')).intervalSeconds, 180);
  assert.equal(engine.checks, 1);
  assert.equal(preview.innerHTML, '');
  selected = [];
  await inspect(exported.document);
  assert.match($('#preferencesMessage').textContent, /Nenhuma diferença encontrada/);
  assert.doesNotMatch($('#preferencesMessage').textContent, /não contém/);
});
