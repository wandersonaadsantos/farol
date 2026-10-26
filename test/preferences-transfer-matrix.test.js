import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS } from '../lib/settings.js';
import { baseConfig, fieldCases, account, profiles, configForField } from './helpers/preferences-cases.js';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-preferences-matrix-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { command } = await import('../lib/preferences/transfer.js');
const { CONFIG_FILE } = await import('../lib/paths.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const documentFor = values => ({ type: 'farol-preferences', schema: 2, values });
let scenarioCount = 0;
function engineFor(config = baseConfig()) {
  const engine = new Engine();
  engine.config = structuredClone(config);
  engine.log = () => {}; engine.pushState = () => {}; engine.checkNow = () => {};
  engine.doctor = async () => {}; engine.syncAplicarConfig = () => {};
  return engine;
}
const cases = fieldCases();
test('a matriz contém casos para cada um dos campos editáveis do Sistema', () => {
  assert.deepEqual(Object.keys(cases).sort(), SETTINGS.filter(s => s.ui).map(s => s.key).sort());
});
for (const [key, values] of Object.entries(cases)) {
  test(`matriz: ${key}, ${values.length} valores e recarga do disco`, async () => {
    for (const value of values) {
      scenarioCount++;
      const engine = engineFor(configForField(key));
      if (key === 'accounts' && value.length === 0) { engine.config.ghUser = ''; engine.config.accounts = []; }
      const document = documentFor({ [key]: value });
      const context = `${key}: ${JSON.stringify(value)}`;
      const preview = await command(engine, { action: 'preview', document });
      assert.equal(preview.ok, true, `${context}: ${preview.error}`);
      assert.equal(preview.changes.length <= 1, true, context);
      if (!preview.changes.length) continue;
      assert.equal(preview.changes[0].blocked, undefined, context);
      const result = await command(engine, { action: 'apply', document, token: preview.token, keys: [key] });
      assert.equal(result.ok, true, `${context}: ${result.error}`);
      const expected = key === 'cadeiaPerfis' ? preview.changes[0].incoming : value;
      assert.deepEqual(result.values[key], expected, `${context}: valor aplicado difere da prévia`);
      const next = await command(engine, { action: 'preview', document });
      assert.deepEqual(next.changes, [], `${context}: a mesma diferença continua após aplicar`);
      const reloaded = new Engine(); reloaded.log = () => {};
      const exported = await command(reloaded, { action: 'export' });
      assert.equal(exported.ok, true, `${context}: ${exported.error}`);
      assert.deepEqual(exported.document.values[key], expected, `${context}: valor mudou ao recarregar`);
    }
  });
}

test('tipos inválidos em cada campo são recusados sem gravação nem eventos', async () => {
  const engine = engineFor();
  let writes = 0, events = 0;
  engine.saveConfig = () => { writes++; };
  engine.on('settings-changed', () => { events++; });
  for (const setting of SETTINGS.filter(s => s.ui)) {
    let invalid = [null, false, 0, 'wrong-type', [], {}];
    if (typeof setting.def === 'boolean') invalid = [null, 0, 1, 'true', 'false', [], {}];
    else if (typeof setting.def === 'string') invalid = [null, false, 0, [], {}];
    else if (typeof setting.def === 'number') invalid = [null, false, '1', [], {}, -1, 1.5];
    else if (Array.isArray(setting.def) || setting.key === 'cadeiaPerfis') invalid = [null, false, 0, 'wrong-type', {}];
    else invalid = [null, false, 0, 'wrong-type', []];
    for (const value of invalid) {
      scenarioCount++;
      const before = engine.config;
      const result = await command(engine, { action: 'preview', document: documentFor({ [setting.key]: value }) });
      assert.equal(result.ok, false, `${setting.key} aceitou ${JSON.stringify(value)}`);
      assert.equal(engine.config, before);
    }
  }
  assert.equal(writes, 0); assert.equal(events, 0);
});

test('todos os valores inteiros dos intervalos, volume e relógios são reconhecidos', async () => {
  const engine = engineFor(); let writes = 0; engine.saveConfig = () => { writes++; };
  const numbers = { intervalSeconds: [180, 3600], voiceVolume: [0, 100], interventionReminderMinutes: [0, 1440], parallelReviews: [1, 4], globalParallelReviews: [0, 8] };
  for (const [key, [min, max]] of Object.entries(numbers)) {
    for (let value = min; value <= max; value++) {
      scenarioCount++;
      const result = await command(engine, { action: 'preview', document: documentFor({ [key]: value }) });
      assert.equal(result.ok, true, `${key}: ${value}`);
    }
    for (const value of [min - 1, max + 1, min + 0.5]) {
      scenarioCount++;
      assert.equal((await command(engine, { action: 'preview', document: documentFor({ [key]: value }) })).ok, false, `${key}: ${value}`);
    }
  }
  for (let minute = 0; minute < 1440; minute++) {
    const clock = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    for (const key of ['voiceQuietStart', 'voiceQuietEnd']) {
      scenarioCount++;
      assert.equal((await command(engine, { action: 'preview', document: documentFor({ [key]: clock }) })).ok, true, `${key}: ${clock}`);
    }
  }
  for (const key of ['voiceQuietStart', 'voiceQuietEnd']) for (const value of ['24:00', '23:60', '-1:00', '0:00', '12:0', '12:00:00', ' 12:00', 'abc']) {
    scenarioCount++;
    assert.equal((await command(engine, { action: 'preview', document: documentFor({ [key]: value }) })).ok, false, `${key}: ${value}`);
  }
  assert.equal(writes, 0);
});

test('perfil padrão vazio pode ser restaurado mesmo com um perfil ativo no destino', async () => {
  const engine = engineFor(); engine.config.claudeProfileId = 'p'; engine.config.cadeiaPerfis[0].ativo = true;
  const document = documentFor({ claudeProfileId: '' });
  const preview = await command(engine, { action: 'preview', document });
  const result = await command(engine, { action: 'apply', document, token: preview.token, keys: ['claudeProfileId'] });
  assert.equal(result.ok, true, result.error); assert.equal(result.values.claudeProfileId, '');
});

test('identificadores duplicados não deixam a seleção ambígua', async () => {
  const engine = engineFor();
  for (const values of [
    { accounts: [account, { ...account, label: 'Duplicada' }] },
    { accounts: [account, { ...account, user: 'DEV' }] },
    { claudeProfiles: [profiles[0], { ...profiles[0], label: 'Duplicado' }] },
    { cadeiaPerfis: [{ id: 'p', ativo: true }, { id: 'p', ativo: false }] },
  ]) {
    scenarioCount++;
    assert.equal((await command(engine, { action: 'preview', document: documentFor(values) })).ok, false, JSON.stringify(Object.keys(values)));
  }
});

after(() => console.log(`Matriz de preferências: ${scenarioCount} cenários executados em ${Object.keys(cases).length} campos.`));


test('importação respeita a proibição de remover a última conta configurada', async () => {
  const engine = engineFor();
  const document = documentFor({ accounts: [], ghUser: '' });
  const preview = await command(engine, { action: 'preview', document });
  assert.match(preview.changes.find(c => c.key === 'accounts').blocked, /última conta/);
  const before = engine.config;
  assert.equal((await command(engine, { action: 'apply', document, token: preview.token, keys: ['accounts', 'ghUser'] })).ok, false);
  assert.equal(engine.config, before);
  assert.deepEqual(engine.config.accounts, [account]);
});

test('perfis e cadeia podem ser importados juntos sem reativar perfis não selecionados', async () => {
  const engine = engineFor();
  const document = documentFor({ claudeProfiles: [{ id: 'new', label: 'Novo Codex', kind: 'codex' }], cadeiaPerfis: [{ id: 'new', ativo: true }], claudeProfileId: 'new' });
  const preview = await command(engine, { action: 'preview', document });
  const before = engine.config;
  assert.equal((await command(engine, { action: 'apply', document, token: preview.token, keys: ['cadeiaPerfis'] })).ok, false);
  assert.equal(engine.config, before);
  const result = await command(engine, { action: 'apply', document, token: preview.token, keys: ['claudeProfiles', 'cadeiaPerfis', 'claudeProfileId'] });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.values.cadeiaPerfis, [{ id: 'new', ativo: true }]);
  assert.deepEqual((await command(engine, { action: 'preview', document })).changes, []);
});

test('perfil padrão e cadeia contraditórios são recusados antes de salvar', async () => {
  const engine = engineFor();
  const document = documentFor({ cadeiaPerfis: [{ id: 'p', ativo: true }], claudeProfileId: 'q' });
  const preview = await command(engine, { action: 'preview', document });
  const before = engine.config;
  const result = await command(engine, { action: 'apply', document, token: preview.token, keys: ['cadeiaPerfis', 'claudeProfileId'] });
  assert.equal(result.ok, false); assert.match(result.error, /incompatíveis/); assert.equal(engine.config, before);
});

test('calendário dos orçamentos rejeita datas que não existem e aceita anos bissextos', async () => {
  const engine = engineFor();
  for (const field of ['budgetSince', 'budgetDates']) {
    for (const date of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '0000-01-01']) {
      scenarioCount++;
      const budget = field === 'budgetSince' ? { budgetSince: date } : { budgetDates: { [date]: 10 } };
      const document = documentFor({ claudeProfiles: [{ ...profiles[0], ...budget }] });
      assert.equal((await command(engine, { action: 'preview', document })).ok, false, `${field}: ${date}`);
    }
  }
  const document = documentFor({ claudeProfiles: [{ ...profiles[0], budgetSince: '2024-02-29', budgetByWeekday: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [day, day])), budgetDates: { '2024-02-29': 0, '2028-02-29': 10.25 } }] });
  const preview = await command(engine, { action: 'preview', document });
  assert.equal(preview.ok, true, preview.error);
  const applied = await command(engine, { action: 'apply', document, token: preview.token, keys: ['claudeProfiles'] });
  assert.equal(applied.ok, true, applied.error); assert.deepEqual(applied.values.claudeProfiles, document.values.claudeProfiles);
});

test('um valor inválido invalida o arquivo inteiro, mesmo com outras diferenças válidas', async () => {
  const engine = engineFor(); let writes = 0; engine.saveConfig = () => { writes++; };
  const result = await command(engine, { action: 'preview', document: documentFor({ theme: 'light', voiceEnabled: true, voiceVolume: 101 }) });
  assert.equal(result.ok, false); assert.equal(writes, 0);
});


test('IDs de perfil são sensíveis a maiúsculas, enquanto logins de conta não são', async () => {
  const engine = engineFor();
  const document = documentFor({ claudeProfiles: [{ id: 'p', label: 'Minúsculo', kind: 'codex' }, { id: 'P', label: 'Maiúsculo', kind: 'codex' }] });
  const preview = await command(engine, { action: 'preview', document });
  assert.equal(preview.ok, true, preview.error);
  const result = await command(engine, { action: 'apply', document, token: preview.token, keys: ['claudeProfiles'] });
  assert.equal(result.ok, true, result.error); assert.deepEqual(result.values.claudeProfiles, document.values.claudeProfiles);
});

test('prévia integral de arquivo igual não grava nem dispara efeitos', async () => {
  const engine = engineFor(); let writes = 0, events = 0;
  engine.saveConfig = () => { writes++; }; engine.on('settings-changed', () => { events++; });
  const exported = await command(engine, { action: 'export' });
  const preview = await command(engine, { action: 'preview', document: JSON.parse(JSON.stringify(exported.document)) });
  assert.deepEqual(preview.changes, []);
  assert.equal((await command(engine, { action: 'apply', document: exported.document, token: preview.token, keys: [] })).ok, false);
  assert.equal(writes, 0); assert.equal(events, 0);
});

test('falha ao salvar alterações dependentes preserva a cadeia ativa original', async () => {
  const engine = engineFor(); engine.config.claudeProfileId = 'p'; engine.config.cadeiaPerfis[0].ativo = true;
  const before = engine.config; let events = 0;
  engine.on('settings-changed', () => { events++; }); engine.saveConfig = () => { throw Error('disk'); };
  const document = documentFor({ claudeProfileId: '' });
  const preview = await command(engine, { action: 'preview', document });
  assert.equal((await command(engine, { action: 'apply', document, token: preview.token, keys: ['claudeProfileId'] })).ok, false);
  assert.equal(engine.config, before); assert.equal(engine.config.claudeProfileId, 'p'); assert.equal(engine.config.cadeiaPerfis[0].ativo, true); assert.equal(events, 0);
});


test('trocar host Jira com credencial local é bloqueado, inclusive para ID órfão', async () => {
  const { setCredential, removeCredential, credentialFor } = await import('../lib/jira/credentials.js');
  const { createJiraClient } = await import('../lib/jira/client.js');
  const engine = engineFor();
  const local = { id: 'work', label: 'Jira original', baseUrl: 'https://original.atlassian.net', owners: ['acme'], projectKeys: ['PROJ'] };
  engine.config.jiraSites = [local];
  assert.equal(setCredential('work', { email: 'synthetic@example.invalid', token: 'synthetic-private-jira' }), true);
  try {
    for (const sites of [[local], []]) {
      engine.config.jiraSites = sites;
      const before = engine.config;
      const document = documentFor({ jiraSites: [{ ...local, baseUrl: 'https://other.example.invalid' }] });
      const preview = await command(engine, { action: 'preview', document });
      assert.equal(preview.ok, true, preview.error); assert.match(preview.changes[0].blocked, /credencial local do Jira/);
      assert.doesNotMatch(JSON.stringify(preview), /synthetic-private-jira|synthetic@example/);
      const result = await command(engine, { action: 'apply', document, token: preview.token, keys: ['jiraSites'] });
      assert.equal(result.ok, false); assert.equal(engine.config, before);
    }
    engine.config.jiraSites = [local];
    const seen = [];
    const client = createJiraClient({ baseUrl: engine.config.jiraSites[0].baseUrl, ...credentialFor('work'), fetchImpl: async (url, options) => {
      seen.push(new URL(url).origin); assert.ok(options.headers.Authorization);
      return { ok: true, text: async () => '{"accountId":"synthetic"}' };
    } });
    await client.myself(); assert.deepEqual(seen, ['https://original.atlassian.net']);
  } finally { removeCredential('work'); }
});

test('Jira mantém credencial no mesmo endereço e permite cadastrar destino sem credencial', async () => {
  const { setCredential, removeCredential, credentialFor } = await import('../lib/jira/credentials.js');
  const engine = engineFor();
  const site = { id: 'work', label: 'Jira', baseUrl: 'https://original.atlassian.net', owners: ['acme'], projectKeys: ['PROJ'] };
  engine.config.jiraSites = [site];
  setCredential('work', { email: 'synthetic@example.invalid', token: 'synthetic-private-jira' });
  try {
    const document = documentFor({ jiraSites: [{ ...site, label: 'Novo nome', projectKeys: ['APP'] }] });
    const preview = await command(engine, { action: 'preview', document });
    assert.equal(preview.changes[0].blocked, undefined);
    assert.equal((await command(engine, { action: 'apply', document, token: preview.token, keys: ['jiraSites'] })).ok, true);
    assert.equal(credentialFor('work').token, 'synthetic-private-jira');
  } finally { removeCredential('work'); }
  const document = documentFor({ jiraSites: [{ ...site, baseUrl: 'https://other.example.invalid' }] });
  const preview = await command(engine, { action: 'preview', document });
  assert.equal(preview.changes[0].blocked, undefined);
  assert.equal((await command(engine, { action: 'apply', document, token: preview.token, keys: ['jiraSites'] })).ok, true);
});

test('remover perfil fixo exige selecionar também a alteração das contas afetadas', async () => {
  const engine = engineFor();
  engine.config.accounts[0].claudeProfileId = 'p';
  engine.config.claudeProfileId = 'q'; engine.config.cadeiaPerfis[1].ativo = true;
  const current = engine.config;
  const incomingProfiles = [profiles[1]];
  const partial = documentFor({ claudeProfiles: incomingProfiles });
  const preview = await command(engine, { action: 'preview', document: partial });
  assert.deepEqual(preview.changes.map(c => c.key), ['claudeProfiles']); assert.match(preview.changes[0].note, /também altera contas/);
  assert.equal((await command(engine, { action: 'apply', document: partial, token: preview.token, keys: ['claudeProfiles'] })).ok, false);
  assert.equal(engine.config, current); assert.equal(engine.config.accounts[0].claudeProfileId, 'p');
  const { claudeProfileId: _old, ...unbound } = engine.config.accounts[0];
  const document = documentFor({ claudeProfiles: incomingProfiles, accounts: [unbound] });
  const complete = await command(engine, { action: 'preview', document });
  assert.equal((await command(engine, { action: 'apply', document, token: complete.token, keys: ['claudeProfiles'] })).ok, false);
  const applied = await command(engine, { action: 'apply', document, token: complete.token, keys: ['claudeProfiles', 'accounts'] });
  assert.equal(applied.ok, true, applied.error); assert.equal(engine.config.accounts[0].claudeProfileId, undefined); assert.equal(engine.config.claudeProfileId, 'q');
});

test('usuário e organizações não renomeiam nem redirecionam a conta única fora da seleção', async () => {
  for (const [key, value, accountPatch] of [['ghUser', 'new', { user: 'new' }], ['owners', ['other'], { owners: ['other'] }]]) {
    const engine = engineFor();
    engine.config.accounts = [{ ...account, autoReview: true, onClean: 'approve', onCaveats: 'approve', onReject: 'request_changes' }];
    const before = engine.config;
    const partial = documentFor({ [key]: value });
    const preview = await command(engine, { action: 'preview', document: partial });
    assert.match(preview.changes[0].note, /também altera contas/);
    assert.equal((await command(engine, { action: 'apply', document: partial, token: preview.token, keys: [key] })).ok, false);
    assert.equal(engine.config, before); assert.equal(engine.config.accounts[0].user, 'dev'); assert.deepEqual(engine.config.accounts[0].owners, ['acme']);
    const selectedAccount = { ...account, ...accountPatch };
    const document = documentFor({ [key]: value, accounts: [selectedAccount] });
    const complete = await command(engine, { action: 'preview', document });
    assert.equal((await command(engine, { action: 'apply', document, token: complete.token, keys: [key] })).ok, false);
    const applied = await command(engine, { action: 'apply', document, token: complete.token, keys: [key, 'accounts'] });
    assert.equal(applied.ok, true, applied.error); assert.deepEqual(engine.config.accounts, [selectedAccount]); assert.equal(engine.config.accounts[0].autoReview, false);
  }
});
