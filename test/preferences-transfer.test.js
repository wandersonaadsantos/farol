import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS, defaults } from '../lib/settings.js';
import { PREFERENCE_LABELS, preferenceValue } from '../ui/pure/preferences.js';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-all-preferences-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { command, MAX_BYTES } = await import('../lib/preferences/transfer.js');
const { CONFIG_FILE, POLITICA_HISTORICO_FILE } = await import('../lib/paths.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
function fixture() {
  const engine = new Engine();
  engine.config = structuredClone(defaults(0));
  engine.log = () => {};
  engine.pushState = () => {};
  engine.checkNow = () => {};
  engine.doctor = async () => {};
  engine.syncAplicarConfig = () => {};
  return engine;
}
const doc = values => ({ type: 'farol-preferences', schema: 2, values });
const snapshot = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
function choices(engine) {
  const patch = Object.fromEntries(SETTINGS.filter(s => s.ui && typeof s.def === 'boolean').map(s => [s.key, !s.def]));
  Object.assign(patch, {
    ghUser: 'reviewer', owners: ['acme'],
    accounts: [{ user: 'reviewer', owners: ['acme'], label: 'Trabalho', muted: true, autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait', claudeProfileId: 'p', padroesRevisao: 'Cobrir regras do domínio', reviewRules: { acme: { mode: 'manual', authors: {} } } }],
    jiraSites: [{ id: 'work', label: 'Trabalho', baseUrl: 'https://example.atlassian.net', owners: ['acme'], projectKeys: ['PROJ'] }],
    sync: { enabled: true, coordination: { enabled: true }, consolidation: { enabled: true }, shared: { enabled: true }, distribution: { enabled: true }, aceitarAdmin: true, deviceName: 'Notebook', apiKey: 'synthetic-web-key', databaseUrl: 'https://demo.firebaseio.com', projectId: 'demo' },
    intervalSeconds: 180, parallelReviews: 2, globalParallelReviews: 2, voiceEvents: ['decision'], voiceVolume: 75,
    voiceQuietStart: '21:00', voiceQuietEnd: '09:00', interventionReminderMinutes: 5, theme: 'light',
    updateSource: 'https://example.invalid/releases', updateRepo: 'acme/farol', mergeBlockedRepos: ['acme/app'],
    defaultReviewers: { acme: ['alex'] }, projectReviewers: { 'acme/app': ['alex'] }, people: { alex: { papel: 'senior' } },
    reviewModel: 'sonnet', reviewEffort: 'high', codexReviewModel: 'gpt-5.6-terra', codexReviewEffort: 'high',
    agyReviewModel: 'gemini-3.8-flash-medium', agyReviewEffort: 'high', claudeConfigDir: 'C:/farol/test-profile',
    claudeProfiles: [{ id: 'p', label: 'Codex', kind: 'codex', budgetDaily: 10, budgetTotal: 50 }],
    claudeProfileId: 'p', cadeiaPerfis: [{ id: 'p', ativo: true }],
  });
  engine.updateSettings(patch, 'teste');
}

test('exporta todas as preferências do Sistema, sem depender de allowlist manual', async () => {
  const engine = fixture(); choices(engine);
  const before = snapshot(CONFIG_FILE);
  const result = await command(engine, { action: 'export' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.document.schema, 2);
  assert.deepEqual(Object.keys(result.document.values), SETTINGS.filter(s => s.ui).map(s => s.key));
  for (const key of Object.keys(result.document.values)) assert.ok(PREFERENCE_LABELS[key], `rótulo ausente: ${key}`);
  const imported = JSON.parse(JSON.stringify(result.document));
  assert.deepEqual((await command(engine, { action: 'preview', document: imported })).changes, []);
  assert.equal(snapshot(CONFIG_FILE), before);
});

test('cada preferência exportada é comparada, selecionada e gravada pelo fluxo real', async () => {
  const source = fixture(); choices(source);
  const exported = await command(source, { action: 'export' });
  assert.equal(exported.ok, true, exported.error);
  for (const setting of SETTINGS.filter(s => s.ui)) {
    const target = fixture(); target.config = structuredClone(source.config);
    target.config[setting.key] = structuredClone(setting.def);
    if (setting.key === 'sync') target.config.sync = { ...source.config.sync, enabled: false };
    const preview = await command(target, { action: 'preview', document: exported.document });
    assert.equal(preview.ok, true, `${setting.key}: ${preview.error}`);
    assert.deepEqual(preview.changes.map(change => change.key), [setting.key], setting.key);
    assert.equal(preview.changes[0].blocked, undefined, setting.key);
    const result = await command(target, { action: 'apply', document: exported.document, token: preview.token, keys: [setting.key] });
    assert.equal(result.ok, true, `${setting.key}: ${result.error}`);
    assert.deepEqual(result.values[setting.key], exported.document.values[setting.key], setting.key);
    assert.deepEqual((await command(target, { action: 'preview', document: exported.document })).changes, [], setting.key);
    assert.deepEqual(JSON.parse(snapshot(CONFIG_FILE))[setting.key], target.config[setting.key], setting.key);
  }
});

test('objetos iguais com chaves em ordem diferente não criam diferenças', async () => {
  const engine = fixture(); engine.config.defaultReviewers = { acme: ['alex'], other: ['bia'] };
  assert.deepEqual((await command(engine, { action: 'preview', document: doc({ defaultReviewers: { other: ['bia'], acme: ['alex'] } }) })).changes, []);
});

test('credenciais não saem na exportação/prévia e são preservadas somente no destino correspondente', async () => {
  const engine = fixture();
  engine.config.claudeProfiles = [{ id: 'api', label: 'API', kind: 'apikey', apiKey: 'synthetic-private-key', baseUrl: 'https://example.invalid', budgetDaily: 3 }];
  engine.config.sync.apiKey = 'synthetic-sync-key';
  const exported = await command(engine, { action: 'export' });
  assert.equal(exported.ok, true, exported.error);
  assert.doesNotMatch(JSON.stringify(exported), /synthetic-private-key|synthetic-sync-key|apiKey/);
  const document = doc({ claudeProfiles: [{ ...exported.document.values.claudeProfiles[0], budgetDaily: 8 }] });
  const preview = await command(engine, { action: 'preview', document });
  assert.equal(preview.changes[0].blocked, undefined);
  assert.doesNotMatch(JSON.stringify(preview), /synthetic-private-key/);
  assert.equal((await command(engine, { action: 'apply', document, token: preview.token, keys: ['claudeProfiles'] })).ok, true);
  assert.equal(engine.config.claudeProfiles[0].apiKey, 'synthetic-private-key');
  assert.equal(engine.config.claudeProfiles[0].budgetDaily, 8);
  document.values.claudeProfiles[0].baseUrl = 'https://other.invalid';
  const blocked = await command(engine, { action: 'preview', document });
  assert.match(blocked.changes[0].blocked, /credenciais/);
  assert.equal((await command(engine, { action: 'apply', document, token: blocked.token, keys: ['claudeProfiles'] })).ok, false);
  assert.equal(engine.config.claudeProfiles[0].baseUrl, 'https://example.invalid');
});

test('campos internos, segredos injetados e valores inválidos são recusados antes dos efeitos', async () => {
  const engine = fixture(); let writes = 0; engine.saveConfig = () => { writes++; };
  const invalid = [
    { localAuth: '' }, { port: 12345 }, { esquemaConfig: 0 }, { voiceVolume: 101 }, { voiceEnabled: 'true' },
    { voiceQuietStart: '25:00' }, { reviewModel: 'invalid model !' }, { accounts: [{ user: 'dev', owners: [], token: 'private' }] },
    { claudeProfiles: [{ id: 'api', label: 'API', kind: 'apikey', apiKey: 'private', baseUrl: '' }] },
    { sync: { ...engine.config.sync, apiKey: 'private' } }, { people: { dev: { papel: 'invalid' } } },
  ];
  for (const values of invalid) assert.equal((await command(engine, { action: 'preview', document: doc(values) })).ok, false, JSON.stringify(Object.keys(values)));
  assert.equal(writes, 0);
});

test('falha ao salvar restaura configuração antes de histórico, voz, autostart, polling ou sincronização', async () => {
  const engine = fixture(); choices(engine);
  const before = engine.config, stored = snapshot(CONFIG_FILE), history = snapshot(POLITICA_HISTORICO_FILE);
  let effects = 0;
  engine.on('settings-changed', () => { effects++; });
  engine.checkNow = () => { effects++; }; engine.syncAplicarConfig = () => { effects++; };
  engine.saveConfig = () => { throw Error('synthetic disk failure'); };
  const document = doc({ voiceEnabled: false, autostart: false, intervalSeconds: 300, accounts: [{ ...engine.config.accounts[0], autoReview: true }] });
  const preview = await command(engine, { action: 'preview', document });
  const result = await command(engine, { action: 'apply', document, token: preview.token, keys: preview.changes.map(change => change.key) });
  assert.equal(result.ok, false); assert.equal(engine.config, before); assert.equal(effects, 0);
  assert.equal(snapshot(CONFIG_FILE), stored); assert.equal(snapshot(POLITICA_HISTORICO_FILE), history);
});

test('aplicação emite configuração e reprograma efeitos; seleção preserva as demais preferências', async () => {
  const engine = fixture(); let events = 0, checks = 0;
  engine.on('settings-changed', () => { events++; }); engine.checkNow = () => { checks++; };
  const document = doc({ voiceEnabled: true, autostart: true, intervalSeconds: 180 });
  const preview = await command(engine, { action: 'preview', document });
  const result = await command(engine, { action: 'apply', document, token: preview.token, keys: ['voiceEnabled', 'intervalSeconds'] });
  assert.equal(result.ok, true); assert.equal(engine.config.voiceEnabled, true); assert.equal(engine.config.autostart, false);
  assert.equal(events, 1); assert.equal(checks, 1);
});

test('arquivos maiores que 16 KiB são portáveis e limite absoluto é respeitado', async () => {
  const engine = fixture(); engine.config.accounts = [{ user: 'dev', owners: [], padroesRevisao: 'a'.repeat(18000) }];
  const exported = await command(engine, { action: 'export' });
  assert.equal(exported.ok, true, exported.error); assert.ok(Buffer.byteLength(JSON.stringify(exported.document)) > 16 * 1024);
  assert.equal((await command(engine, { action: 'preview', document: exported.document })).ok, true);
  assert.equal((await command(engine, { action: 'preview', document: doc({ updateSource: 'a'.repeat(MAX_BYTES) }) })).ok, false);
});

test('comparação estruturada tem rótulos legíveis e voz não é formatada como minutos', () => {
  assert.equal(preferenceValue('voiceEnabled', true), 'Ligado');
  assert.equal(preferenceValue('voiceVolume', 75), '75%');
  assert.equal(preferenceValue('voiceQuietStart', '21:00'), '21:00');
  assert.match(preferenceValue('accounts', [{ user: 'dev', onClean: 'wait' }]), /Sem ressalvas: Esperar você/);
});


test('dependência ausente não é descartada nem aplicada silenciosamente', async () => {
  const engine = fixture();
  const document = doc({ claudeProfiles: [{ id: 'external', label: 'API', kind: 'apikey', baseUrl: 'https://example.invalid' }], voiceVolume: 70 });
  const preview = await command(engine, { action: 'preview', document });
  assert.equal(preview.ok, true); assert.match(preview.changes.find(c => c.key === 'claudeProfiles').blocked, /credenciais/);
  const result = await command(engine, { action: 'apply', document, token: preview.token, keys: ['voiceVolume'] });
  assert.equal(result.ok, true); assert.equal(engine.config.voiceVolume, 70); assert.deepEqual(engine.config.claudeProfiles, []);
  const reference = doc({ cadeiaPerfis: [{ id: 'external', ativo: true }] });
  const pending = await command(engine, { action: 'preview', document: reference });
  assert.equal((await command(engine, { action: 'apply', document: reference, token: pending.token, keys: ['cadeiaPerfis'] })).ok, false);
});

test('sincronização não reutiliza chave em outro projeto e preserva credencial do destino', async () => {
  const engine = fixture();
  engine.config.sync = { ...engine.config.sync, apiKey: 'synthetic-local-key', databaseUrl: 'https://local.firebaseio.com', projectId: 'local' };
  const { apiKey, ...portable } = engine.config.sync;
  const document = doc({ sync: { ...portable, databaseUrl: 'https://other.firebaseio.com', projectId: 'other' } });
  const preview = await command(engine, { action: 'preview', document });
  assert.match(preview.changes[0].blocked, /chave da sincronização/);
  assert.equal((await command(engine, { action: 'apply', document, token: preview.token, keys: ['sync'] })).ok, false);
  assert.equal(engine.config.sync.apiKey, apiKey);
});


test('políticas de conta são explícitas no arquivo e entrada parcial não ativa padrões implícitos', async () => {
  const engine = fixture(); engine.config.accounts = [{ user: 'dev', owners: [] }];
  const exported = await command(engine, { action: 'export' });
  assert.equal(exported.ok, true, exported.error);
  const account = exported.document.values.accounts[0];
  assert.equal(typeof account.autoReview, 'boolean');
  for (const key of ['onClean', 'onCaveats', 'onReject']) assert.equal(typeof account[key], 'string');
  const document = doc({ accounts: [{ user: 'dev', owners: [] }] });
  assert.equal((await command(engine, { action: 'preview', document })).ok, false);
  const invalid = doc({ accounts: [{ ...account, onClean: 'wait', onCaveats: 'approve' }] });
  assert.equal((await command(engine, { action: 'preview', document: invalid })).ok, false);
});
