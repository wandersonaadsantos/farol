import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { queueGroups, groupedQueue } from '../ui/pure/queue-groups.js';
import { setupSteps } from '../ui/pure/setup.js';
import { roundSummaryHtml } from '../ui/pure/round-summary.js';
import { resolvedRow } from '../ui/pure/review.js';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-interface-'));
process.env.FAROL_HOME = home;
const { Engine } = await import('../server.js');
const { command } = await import('../lib/preferences/transfer.js');
const { CONFIG_FILE } = await import('../lib/paths.js');
after(() => { assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(home, { recursive: true, force: true }); });
function fixture() { const e = new Engine(); e.pushState = () => {}; e.log = () => {}; e.config.theme = 'dark'; e.config.soundEnabled = true; e.config.voiceEnabled = false; return e; }
const document = values => ({ type: 'farol-preferences', schema: 1, values });
test('prévia e exportação não gravam; aplicação seleciona só diferenças e protege voz/contas', async () => {
  const e = fixture(); e.config.accounts = [{ user: 'dev', autoReview: false }]; e.config.voiceEnabled = false;
  const doc = document({ theme: 'light', soundEnabled: false });
  const before = fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf8') : null;
  const exported = await command(e, { action: 'export' }); const preview = await command(e, { action: 'preview', document: doc });
  assert.equal(preview.ok, true); assert.deepEqual(Object.keys(exported.document.values), ['theme', 'soundEnabled', 'interventionReminderMinutes']);
  assert.equal(fs.existsSync(CONFIG_FILE) ? fs.readFileSync(CONFIG_FILE, 'utf8') : null, before);
  const accounts = e.config.accounts;
  const applied = await command(e, { action: 'apply', document: doc, token: preview.token, keys: ['theme'] });
  assert.equal(applied.ok, true); assert.equal(e.config.theme, 'light'); assert.equal(e.config.soundEnabled, true);
  assert.equal(e.config.voiceEnabled, false); assert.equal(e.config.accounts, accounts);
  assert.equal(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')).theme, 'light');
  assert.equal((await command(e, { action: 'apply', document: doc, token: preview.token, keys: ['soundEnabled'] })).ok, false);
});
test('arquivo incompatível, segredo, voz, caminho local e seleção indevida são recusados antes de efeitos', async () => {
  const e = fixture(); let writes = 0; e.saveConfig = () => { writes++; };
  for (const doc of [{ ...document({ theme: 'light' }), schema: 2 }, document({ apiKey: 'synthetic-secret' }), document({ voiceEnabled: true }), document({ dir: 'C:/outro' }), document({ interventionReminderMinutes: -1 }), document({ theme: 'light', soundEnabled: 'false' }), document({}), { ...document({ theme: 'light' }), extra: 'x' }]) {
    const r = await command(e, { action: 'preview', document: doc }); assert.equal(r.ok, false); assert.doesNotMatch(r.error, /synthetic-secret|C:\//);
  }
  const doc = document({ theme: 'light' }), preview = await command(e, { action: 'preview', document: doc });
  for (const keys of [[], ['accounts'], ['theme', 'theme']]) assert.equal((await command(e, { action: 'apply', document: doc, token: preview.token, keys })).ok, false);
  assert.equal(writes, 0);
});
test('CAS vincula prévia ao arquivo e ao destino; falha de disco restaura memória', async () => {
  const e = fixture(), doc = document({ theme: 'light' });
  const preview = await command(e, { action: 'preview', document: doc });
  assert.equal((await command(e, { action: 'apply', document: document({ theme: 'dark' }), token: preview.token, keys: ['theme'] })).ok, false);
  e.config.soundEnabled = false;
  assert.equal((await command(e, { action: 'apply', document: doc, token: preview.token, keys: ['theme'] })).ok, false);
  const current = await command(e, { action: 'preview', document: doc }); const original = e.config;
  let writes = 0; e.saveConfig = () => { writes++; throw Error('synthetic-path-and-secret'); };
  const r = await command(e, { action: 'apply', document: doc, token: current.token, keys: ['theme'] });
  assert.equal(r.ok, false); assert.equal(e.config, original); assert.equal(writes, 1); assert.doesNotMatch(r.error, /synthetic/);
});
test('grupos preservam todos os itens, ordem interna, escape e recolhimento', () => {
  const rows = [{ account: 'a', repo: '<repo>', html: '<b>1</b>' }, { account: 'b', repo: 'outro', html: '<b>2</b>' }, { account: 'a', repo: '<repo>', html: '<b>3</b>' }];
  assert.deepEqual(queueGroups(rows, 'account').map(g => g.rows.length), [2, 1]);
  const html = groupedQueue(rows, 'repo', new Set(['repo:<repo>']));
  assert.match(html, /&lt;repo&gt;/); assert.doesNotMatch(html, /<repo>/); assert.match(html, /data-queue-group="repo:&lt;repo&gt;">/);
  for (const n of [1, 2, 3]) assert.equal(html.split(`<b>${n}</b>`).length, 2);
  assert.equal(groupedQueue(rows, 'none'), '<b>1</b><b>2</b><b>3</b>');
});
test('roteiro não confunde configuração com autenticação e não aceita política sozinho', () => {
  assert.deepEqual(setupSteps({ config: { claudeProfiles: [{ id: 'p' }] } }).map(s => s.checked), [false, false, false]);
  const steps = setupSteps({ accounts: [{ tokenOk: true, owners: ['org'] }], doctor: { claudeAuth: [{ ready: true }] } });
  assert.deepEqual(steps.map(s => s.checked), [true, true, false]);
  assert.equal(setupSteps({ accounts: [{ tokenOk: true, muted: true, owners: ['org'] }] })[0].checked, false);
});
test('resumo da rodada distingue dado ausente e informação interna neutralizada', () => {
  assert.equal(roundSummaryHtml({ schema: 2 }), '');
  const html = roundSummaryHtml({ schema: 1, ordinal: 2, id: '<img>', unverified: true, droppedCount: 3 });
  assert.match(html, /Rodada 2/); assert.match(html, /Memória não verificada/); assert.match(html, /não informado pendência/);
  assert.doesNotMatch(html, /<img>/); assert.match(html, /sem resposta: 3/);
  const row = resolvedRow({ key: 'org/repo#1', status: 'posted', rounds: { schema: 1, ordinal: 2, unresolvedCount: 2 } });
  assert.match(row, /<details class="round-summary(?:\s|")/); assert.match(row, /2 pendência\(s\) rastreada\(s\)/);
  assert.doesNotMatch(row, /&lt;details/);
});
test('rota de transferência exige autenticação local e origem correta', async () => {
  const e = fixture(); e.config.port = 0; e.config.localAuth = 'exigir';
  const { startServer } = await import('../lib/http-server.js'); const { emitirSessao } = await import('../lib/local-auth/sessoes.js');
  const server = startServer(e); await once(server, 'listening');
  const send = headers => new Promise((resolve, reject) => {
    const body = JSON.stringify({ action: 'export' });
    const req = request(`http://127.0.0.1:${server.address().port}/api/preferences/transfer`, { method: 'POST', agent: false, headers: { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(body);
  });
  try {
    assert.equal(await send({}), 401);
    const token = emitirSessao('interface-fixture');
    assert.equal(await send({ authorization: `Bearer ${token}`, origin: 'https://externo.invalid' }), 403);
    assert.equal(await send({ authorization: `Bearer ${token}` }), 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
