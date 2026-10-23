import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-capacity-'));
process.env.FAROL_HOME = home;
process.env.FAROL_AGY_CMD = path.join(import.meta.dirname, 'helpers', 'agy-falso.js');
process.env.AGY_FALSO_REGISTRO = path.join(home, 'provider.jsonl');
process.env.AGY_FALSO_CONTA = 'eu@exemplo.com';
process.env.AGY_FALSO_RESET = new Date(Date.now() + 86400000).toISOString();
const { Engine } = await import('../server.js');
const quota = await import('../lib/capacity/quota.js');
const { command, view } = await import('../lib/capacity/commands.js');
const { history, ROOT } = await import('../lib/capacity/history.js');
const { resources, processUsage } = await import('../lib/capacity/resources.js');
const proc = await import('../lib/capacity/processes.js');
const { fonteCompletaParaReserva, resumirCota } = await import('../lib/agy/cota.js');
const { garantirPasta } = await import('../lib/agy/home.js');
const { quotaProfile, resourceReport } = await import('../ui/pure/capacity.js');
const { request: httpRequest } = await import('node:http');
let serial = 0;
const originalEnv = new Map(['FAROL_HEADLESS_CMD', 'AGY_FALSO_COTA', 'AGY_FALSO_ZERA_APOS', 'AGY_FALSO_CHAVEIRO'].map(k => [k, process.env[k]]));
after(() => {
  for (const [k, v] of originalEnv) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(home, { recursive: true, force: true });
});
function fixture() {
  const e = new Engine(), id = `agy${++serial}`;
  e.config.accounts = [{ user: 'dev', owners: ['org'] }]; e.config.ghUser = 'dev';
  e.tokens = { dev: 'synthetic-fixture' }; e.accountForPr = () => 'dev'; e.log = () => {}; e.pushState = () => {};
  e.config.claudeProfiles = [{ id, label: 'Perfil de teste', kind: 'agy', email: 'eu@exemplo.com' }, { id: 'backup', label: 'Reserva', kind: 'maquina' }];
  e.config.cadeiaPerfis = [{ id, ativo: true }, { id: 'backup', ativo: true }]; e.config.claudeProfileId = id;
  e.config.quotaReservations = { [id]: { mode: 'observe', maxUsedPercent: 70 } };
  const dir = path.join(garantirPasta(id), '.gemini', 'antigravity-cli'); fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'antigravity-oauth-token'), '{"fixture":true}');
  return { e, id, auth: { id, kind: 'agy', grupo: 'gemini' }, profile: e.config.claudeProfiles[0] };
}
function reading(remaining = 0.3, now = Date.now()) {
  const raw = { command: { data: { groups: [{ buckets: [{ id: 'gemini-five_hour', window: 'five_hour', remaining_fraction: remaining, reset_time: new Date(now + 3600000).toISOString() }] }] } } };
  return { ok: true, em: now, conta: 'eu@exemplo.com', arquivo: true, reservaVerificada: fonteCompletaParaReserva(raw), grupos: resumirCota(raw) };
}

test('fonte exige todos os buckets, identidade e atualidade; ausência nunca é zero usado', () => {
  const f = fixture(), valid = reading(); f.e.agyCotas = new Map([[f.id, { leitura: valid }]]);
  assert.equal(quota.quotaFor(f.e, f.auth).wouldReserve, true);
  for (const patch of [{ em: Date.now() - 61000 }, { em: Date.now() + 10000 }, { conta: 'outro@example.invalid' }, { arquivo: false }, { reservaVerificada: false }]) {
    f.e.agyCotas.set(f.id, { leitura: { ...valid, ...patch } }); assert.equal(quota.quotaFor(f.e, f.auth).known, false);
  }
  assert.equal(quota.quotaFor(f.e, { id: 'backup', kind: 'dir' }).windows.length, 0);
  const raw = { command: { data: { groups: [{ buckets: [{ id: 'gemini-weekly', window: 'weekly', remaining_fraction: null, reset_time: new Date(Date.now() + 1000).toISOString() }] }] } } };
  assert.equal(fonteCompletaParaReserva(raw), false);
});

test('observação não bloqueia; reserva segue apenas alternativas ligadas e não transborda perfil fixo', () => {
  const f = fixture(); f.e.agyCotas = new Map([[f.id, { leitura: reading(0.2) }]]);
  assert.equal(f.e.resolveClaudeAuth('dev').id, f.id);
  f.e.config.quotaReservations[f.id].mode = 'enforce'; assert.equal(f.e.resolveClaudeAuth('dev').id, 'backup');
  f.e.config.accounts[0].claudeProfileId = f.id; assert.equal(f.e.resolveClaudeAuth('dev').id, f.id);
  assert.equal(quota.blockFor(f.e, f.e.resolveClaudeAuth('dev')).blocked, true);
  delete f.e.config.accounts[0].claudeProfileId; f.e.config.cadeiaPerfis[1].ativo = false;
  assert.equal(f.e.resolveClaudeAuth('dev').id, f.id); assert.equal(quota.blockFor(f.e, f.e.resolveClaudeAuth('dev')).blocked, true);
});

test('reserva desconhecida não usa login legado e não contorna orçamento do perfil', () => {
  const f = fixture(); f.e.config.claudeProfiles[0] = { id: f.id, label: 'Principal', kind: 'apikey', apiKey: 'synthetic-only', budgetDaily: 0 };
  f.e.config.quotaReservations[f.id].mode = 'enforce';
  assert.equal(f.e.resolveClaudeAuth('dev').id, f.id); assert.equal(f.e.budgetBlockedFor('dev').id, f.id);
  f.e.config.cadeiaPerfis[1].ativo = false; f.e.config.claudeProfiles[0].budgetDaily = undefined;
  assert.equal(f.e.resolveClaudeAuth('dev').id, f.id);
});

test('aliases conhecidos da assinatura compartilham reserva sem vazar identidade', () => {
  const f = fixture(); f.e.config.claudeProfiles.push({ ...f.profile, id: 'alias' });
  f.e.config.quotaReservations[f.id].mode = 'enforce';
  const policy = quota.policyFor(f.e, { id: 'alias', kind: 'agy', grupo: 'gemini' });
  assert.equal(policy.mode, 'enforce'); assert.equal(policy.maxUsedPercent, 70);
  assert.doesNotMatch(JSON.stringify(policy), /exemplo.com/);
  f.e.config.claudeProfiles = [{ id: 'one', kind: 'codex' }, { id: 'two', kind: 'codex' }];
  f.e.config.quotaReservations = { one: { mode: 'enforce', maxUsedPercent: 70 } };
  assert.equal(quota.blockFor(f.e, { id: 'two', kind: 'codex' }).blocked, true);
});

test('prepare usa /usage real em processo sintético e recusa antes de abrir a sessão do perfil exclusivo', async () => {
  const f = fixture(); f.e.config.accounts[0].claudeProfileId = f.id; f.e.config.quotaReservations[f.id].mode = 'enforce';
  process.env.AGY_FALSO_COTA = '0.2';
  const before = f.e.usageSessions.sessions.length;
  await assert.rejects(f.e.runClaudeStream('não executar', { id: 'f-blocked', account: 'dev', operationKind: 'tool' }), error => !!error.quotaReservation);
  assert.equal(f.e.usageSessions.sessions.length, before);
  assert.equal(quota.quotaFor(f.e, f.auth).known, true);
  const lines = fs.readFileSync(process.env.AGY_FALSO_REGISTRO, 'utf8').trim().split('\n').map(s => JSON.parse(s));
  assert.ok(lines.filter(l => l.home.endsWith(f.id)).every(l => l.modo === 'usage'));
});

test('sessão iniciada termina apesar de ultrapassar o teto; diário e consumo são preservados', async () => {
  const f = fixture(); f.e.config.accounts[0].claudeProfileId = f.id; f.e.config.quotaReservations[f.id].mode = 'enforce';
  fs.writeFileSync(process.env.AGY_FALSO_REGISTRO, '');
  process.env.AGY_FALSO_COTA = '0.8'; process.env.AGY_FALSO_ZERA_APOS = '1';
  const result = await f.e.runClaudeStream('revisão sintética', { id: 'f-running', account: 'dev', operationKind: 'tool' });
  assert.ok(result.text); const record = history().items.find(v => v.start.sessionId === 'f-running');
  assert.equal(record.end.outcome, 'finished'); assert.equal(record.end.aboveMax, true);
  assert.ok(f.e.usageSessions.sessions.some(s => s.id === 'f-running'));
  delete process.env.AGY_FALSO_ZERA_APOS;
});

test('revisão bloqueada volta à fila sem gastar tentativa e sem publicar', async () => {
  const f = fixture(); f.e.config.accounts[0].claudeProfileId = f.id; f.e.config.quotaReservations[f.id].mode = 'enforce';
  process.env.AGY_FALSO_COTA = '0.2';
  const pr = { repo: 'org/repo', number: 1, key: 'org/repo#1', url: 'https://github.com/org/repo/pull/1', author: 'other', manual: true };
  f.e.prState = async () => 'OPEN'; f.e.runHeadlessReview = () => assert.fail('sessão bloqueada não começa'); f.e.processHeadless = () => {};
  f.e.retryAfterNet.set(pr.key, { tries: 2, pr });
  await f.e.runOneHeadless(pr, 'dev');
  assert.ok(f.e.queue.some(p => p.key === pr.key)); assert.equal(f.e.retryAfterNet.get(pr.key).tries, 2); assert.equal(f.e.autoReviewParked.has(pr.key), false);
});

test('política valida limites, tem CAS e não fica ativa só na memória se falhar o disco', async () => {
  const f = fixture(); const current = view(f.e);
  assert.throws(() => quota.policies({ bad: { mode: 'enforce', maxUsedPercent: 100 } }));
  assert.equal((await command(f.e, { action: 'configure', profileId: f.id, expected: 'wrong', mode: 'enforce', maxUsedPercent: 70 })).ok, false);
  f.e.saveConfig = () => { throw Error('fixture disk'); };
  assert.equal((await command(f.e, { action: 'configure', profileId: f.id, expected: current.version, mode: 'enforce', maxUsedPercent: 70 })).ok, false);
  assert.equal(f.e.config.quotaReservations[f.id].mode, 'observe');
});

test('avisos só se repetem com transição material, não a cada leitura', () => {
  const f = fixture(), notices = []; f.e.emit = (_kind, value) => notices.push(value);
  const unknown = quota.quotaFor(f.e, f.auth); quota.notify(f.e, [unknown]); quota.notify(f.e, [unknown]);
  assert.equal(notices.length, 1); f.e.agyCotas = new Map([[f.id, { leitura: reading(0.9) }]]);
  quota.notify(f.e, [quota.quotaFor(f.e, f.auth)]); quota.notify(f.e, [unknown]); assert.equal(notices.length, 2);
});

test('árvore de processos separa Farol e CLIs, ignora PID reciclado e não traz comandos', () => {
  const rows = [{ pid: 1, parent: 0, born: 10, rss: 100, cpuMs: 2 }, { pid: 2, parent: 1, born: 20, rss: 200, cpuMs: 3 },
    { pid: 3, parent: 2, born: 30, rss: 300, cpuMs: 4 }, { pid: 4, parent: 1, born: 40, rss: 400, cpuMs: 5 }, { pid: 9, parent: 0, born: 50, rss: 500, cpuMs: 6 }];
  const groups = proc.classifyProcesses(rows, 1, [{ id: 'a', pid: 2, startedAt: 20 }, { id: 'bad', pid: 9, startedAt: 50 }]);
  assert.deepEqual(groups.farol.map(r => r.pid), [1, 4]); assert.deepEqual(groups.clis.map(r => r.pid), [2, 3]); assert.deepEqual(groups.missing, ['bad']);
  assert.equal(proc.classifyProcesses(rows, 1, [{ id: 'recycled', pid: 2, startedAt: 10000 }]).clis.length, 0);
  assert.equal(processUsage(rows, null, 1000, 2).cpuPercent, null);
  assert.equal(processUsage([{ ...rows[0], cpuMs: 1002 }], rows, 1000, 2).cpuPercent, 50);
  assert.equal(proc.cpuTime('1-02:03:04'), ((26 * 3600) + 184) * 1000);
  assert.equal(proc.posixProcesses('1 0 100 00:01:00 Fri Oct 23 12:00:00 2026')[0].rss, 102400);
  assert.equal(proc.windowsProcesses('[{"ProcessId":1}]'), null);
});

test('recursos reais incluem um filho Node da sessão e a coleta não muda concorrência', async () => {
  const f = fixture(), limits = [f.e.config.parallelReviews, f.e.config.globalParallelReviews];
  const startedAt = Date.now(), child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
  await once(child, 'spawn'); f.e.running.set('child', { child }); f.e.activeReviews.set('child', { startedAt });
  try {
    let one;
    // A mesma atualização manual que o painel oferece: não transforma indisponível em prova.
    for (let attempt = 0; attempt < 3; attempt++) {
      const pair = await Promise.all([resources(f.e), resources(f.e)]);
      [one] = pair; assert.equal(one, pair[1]);
      if (one.farol.status !== 'unavailable') break;
      assert.equal(one.farol.count, null); assert.equal(one.clis.cpuPercent, null);
      assert.ok(one.alerts.some(a => a.includes('indisponíveis')));
      if (attempt < 2) await delay(5100);
    }
    assert.ok(one.farol.count >= 1); assert.ok(one.clis.count >= 1, 'CLI filho deve estar no snapshot real');
    assert.equal(one.clis.cpuPercent, null); assert.equal(one.cliSessions[0].id, 'child');
    assert.deepEqual([f.e.config.parallelReviews, f.e.config.globalParallelReviews], limits);
    assert.doesNotMatch(JSON.stringify(one), /CommandLine|synthetic-fixture|antigravity-oauth-token/);
  } finally { child.kill(); await once(child, 'exit'); }
});

test('rota real exige sessão e origem local; renderização neutraliza HTML', async () => {
  const f = fixture(); const html = quotaProfile({ id: 'p', label: '<img src=x>', kind: 'dir', quota: quota.quotaFor(f.e, { kind: 'dir' }) }); assert.doesNotMatch(html, /<img/);
  const { startServer } = await import('../lib/http-server.js'), { emitirSessao } = await import('../lib/local-auth/sessoes.js');
  f.e.config.port = 0; f.e.config.localAuth = 'exigir'; const server = startServer(f.e); await once(server, 'listening');
  const send = (method = 'POST', headers = {}) => new Promise((resolve, reject) => {
    const body = JSON.stringify({ action: 'view' });
    const req = httpRequest(`http://127.0.0.1:${server.address().port}/api/capacity`, { method, agent: false, headers: { 'x-farol': '1', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(body);
  });
  try {
    assert.equal(await send(), 401); const headers = { Authorization: `Bearer ${emitirSessao('fixture')}` };
    assert.equal(await send('POST', headers), 200); assert.equal(await send('GET', headers), 405);
    assert.equal(await send('POST', { ...headers, Origin: 'https://foreign.invalid' }), 403);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});

test('histórico corrompido não é apagado ou tratado como zero ultrapassagens', () => {
  const current = history().items[0]; assert.ok(current);
  const file = path.join(ROOT, current.id, 'start.json'), original = fs.readFileSync(file, 'utf8'); fs.writeFileSync(file, '{broken');
  try { assert.equal(history().ok, false); assert.equal(fs.readFileSync(file, 'utf8'), '{broken'); }
  finally { fs.writeFileSync(file, original); }
});
