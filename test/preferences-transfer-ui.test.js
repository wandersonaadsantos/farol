import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { baseConfig, fieldCases, configForField } from './helpers/preferences-cases.js';
import { PREFERENCE_LABELS } from '../ui/pure/preferences.js';
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
engine.doctor = async () => {};
engine.syncAplicarConfig = () => {};
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
  assert.match($('#preferencesMessage').textContent, /Arquivo parcial/);
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


test('tela compara voz e estruturas com seus tipos, sem linhas de preferências iguais', async () => {
  engine.config.voiceEnabled = false; engine.config.voiceVolume = 50;
  const incoming = { type: 'farol-preferences', schema: 2, values: { voiceEnabled: true, voiceVolume: 75, defaultReviewers: { acme: ['alex'] } } };
  await inspect(incoming);
  assert.match(preview.innerHTML, /Avisos por voz/); assert.match(preview.innerHTML, /Ligado/);
  assert.match(preview.innerHTML, /75%/); assert.match(preview.innerHTML, /acme: alex/);
  assert.doesNotMatch(preview.innerHTML, /minutos|Tema|Toque sonoro/);
});

test('tela mostra dependência ausente com seleção indisponível, sem credenciais no HTML', async () => {
  engine.config.claudeProfiles = [];
  await inspect({ type: 'farol-preferences', schema: 2, values: { claudeProfiles: [{ id: 'api', label: 'API', kind: 'apikey', baseUrl: 'https://example.invalid' }] } });
  assert.match(preview.innerHTML, /data-preference-key="claudeProfiles" disabled/);
  assert.match(preview.innerHTML, /Cadastre neste aparelho as credenciais/);
  assert.equal($('#preferencesApply').disabled, true);
});


test('todos os 45 campos passam pelo seletor e aplicação do módulo da tela', async () => {
  let exercised = 0;
  for (const [key, candidates] of Object.entries(fieldCases())) {
    engine.config = configForField(key);
    if (key === 'accounts') engine.config.ghUser = '';
    let document;
    for (const value of candidates) {
      const candidate = { type: 'farol-preferences', schema: 2, values: { [key]: value } };
      const result = await command(engine, { action: 'preview', document: candidate });
      if (result.ok && result.changes.length && !result.changes[0].blocked) { document = candidate; break; }
    }
    assert.ok(document, `sem diferença para ${key}`);
    await inspect(document);
    assert.match(preview.innerHTML, new RegExp(`data-preference-key="${key}"`), key);
    assert.ok(preview.innerHTML.includes(PREFERENCE_LABELS[key]), key);
    assert.doesNotMatch(preview.innerHTML, /undefined|\[object Object\]/, key);
    selected = [{ dataset: { preferenceKey: key } }];
    preview.onchange(); assert.equal($('#preferencesApply').disabled, false, key);
    await $('#preferencesApply').onclick();
    assert.match($('#preferencesMessage').textContent, /salvas/, key);
    await inspect(document);
    assert.equal(preview.innerHTML, '', key);
    assert.equal($('#preferencesApply').disabled, true, key);
    exercised++;
  }
  assert.equal(exercised, 45);
});


test('a tela explica por que a última conta não pode ser removida pela importação', async () => {
  engine.config = baseConfig();
  const incoming = { type: 'farol-preferences', schema: 2, values: { accounts: [] } };
  await inspect(incoming);
  assert.match(preview.innerHTML, /última conta configurada/);
  assert.match(preview.innerHTML, /data-preference-key="accounts" disabled/);
  assert.equal($('#preferencesApply').disabled, true);
  assert.equal(engine.config.accounts.length, 1);
});

test('limpar o perfil padrão pela tela informa e desativa a cadeia', async () => {
  engine.config = baseConfig(); engine.config.claudeProfileId = 'p'; engine.config.cadeiaPerfis[0].ativo = true;
  const incoming = { type: 'farol-preferences', schema: 2, values: { claudeProfileId: '' } };
  await inspect(incoming);
  assert.match(preview.innerHTML, /desativa os perfis da cadeia/);
  selected = [{ dataset: { preferenceKey: 'claudeProfileId' } }]; preview.onchange();
  await $('#preferencesApply').onclick();
  assert.match($('#preferencesMessage').textContent, /salvas/); assert.equal(engine.config.claudeProfileId, '');
  assert.equal(engine.config.cadeiaPerfis.some(entry => entry.ativo), false);
  await inspect(incoming); assert.equal(preview.innerHTML, '');
});


test('a tela exige seleção explícita das contas quando usuário ou organização as afetam', async () => {
  engine.config = baseConfig();
  const partial = { type: 'farol-preferences', schema: 2, values: { ghUser: 'new' } };
  await inspect(partial); assert.match(preview.innerHTML, /também altera contas/);
  selected = [{ dataset: { preferenceKey: 'ghUser' } }]; preview.onchange();
  await $('#preferencesApply').onclick();
  assert.match($('#preferencesMessage').textContent, /também modifica contas/); assert.equal(engine.config.accounts[0].user, 'dev');
  const complete = { ...partial, values: { ghUser: 'new', accounts: [{ ...engine.config.accounts[0], user: 'new' }] } };
  await inspect(complete);
  selected = [{ dataset: { preferenceKey: 'ghUser' } }, { dataset: { preferenceKey: 'accounts' } }]; preview.onchange();
  await $('#preferencesApply').onclick(); assert.match($('#preferencesMessage').textContent, /salvas/);
  assert.equal(engine.config.accounts[0].user, 'new');
});

test('a tela bloqueia Jira com credencial vinculada a outro host', async () => {
  const { setCredential, removeCredential } = await import('../lib/jira/credentials.js');
  engine.config = baseConfig();
  const site = { id: 'work', label: 'Jira', baseUrl: 'https://original.atlassian.net', owners: ['acme'], projectKeys: [] };
  engine.config.jiraSites = [site];
  setCredential('work', { email: 'synthetic@example.invalid', token: 'synthetic-private-jira' });
  try {
    await inspect({ type: 'farol-preferences', schema: 2, values: { jiraSites: [{ ...site, baseUrl: 'https://other.example.invalid' }] } });
    assert.match(preview.innerHTML, /data-preference-key="jiraSites" disabled/);
    assert.match(preview.innerHTML, /credencial local do Jira/);
    assert.doesNotMatch(preview.innerHTML, /synthetic-private-jira|synthetic@example/);
    assert.equal($('#preferencesApply').disabled, true);
  } finally { removeCredential('work'); }
});
