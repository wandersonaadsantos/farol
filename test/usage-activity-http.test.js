import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Engine } from '../server.js';
import { startServer } from '../lib/http-server.js';
import { emitirSessao } from '../lib/local-auth/sessoes.js';

test('rota real do consumo exige sessão e origem local e não altera o diário', async () => {
  const engine = new Engine();
  engine.config.port = 0;
  engine.config.localAuth = 'exigir';
  engine.usageSessions = { sessions: [{ id: 'a-00000000-0000-4000-8000-000000000001', kind: 'review', status: 'ok', at: Date.now(), ref: 'org/repo#1', account: 'dev', inputTokens: 3, outputTokens: 2 }] };
  const before = structuredClone(engine.usageSessions);
  const server = startServer(engine);
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/api/usage`;
  try {
    assert.equal((await fetch(url)).status, 401);
    const headers = { Authorization: `Bearer ${emitirSessao('teste consumo')}` };
    assert.equal((await fetch(url, { headers: { ...headers, Origin: 'https://externo.invalid' } })).status, 403);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200);
    const report = await response.json();
    assert.equal(report.completed.reviews, 1);
    assert.equal(report.totals.inputTokens + report.totals.outputTokens, 5);
    assert.deepEqual(engine.usageSessions, before);
    assert.equal((await (await fetch(`${url}?scope=all`, { headers })).json()).ok, false);
    const now = Date.now();
    engine.config.sync = { enabled: true, consolidation: { enabled: true } };
    Object.assign(engine.sync, { uid: 'teste', deviceId: 'd', status: 'conectado', agora: () => now, client: {
      get: async path => ({ ok: true, data: path.endsWith('usageEvents')
        ? { d: { hoje: { at: now, kind: 'review' }, antigo: { at: now - 2 * 86400000, kind: 'review' } } } : {} }),
    } });
    const today = await (await fetch(url.replace('/api/usage', '/api/sync/consolidated?days=1'), { headers })).json();
    assert.equal(today.ok, true);
    assert.equal(today.resumo.totals.sessions, 1, 'Hoje não usa o padrão de trinta dias no painel avançado');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('modalidade e provedor são registrados na execução e não seguem mudanças do perfil', () => {
  const engine = new Engine();
  engine.usageSessions = { sessions: [] };
  engine.config.claudeProfiles = [{ id: 'api-history', kind: 'apikey', label: 'Teste' }];
  engine.recordUsage('a-record', 'dev', { usage: { input_tokens: 3, output_tokens: 2 }, total_cost_usd: .1, farol_provider: 'claude', farol_billing_kind: 'apikey' }, 'Sonnet 5', 'api-history', 'org/repo#1');
  engine.config.claudeProfiles[0].kind = 'assinatura';
  assert.equal(engine.usageSessions.sessions[0].billingKind, 'apikey');
  assert.equal(engine.usageSessions.sessions[0].provider, 'claude');
});
