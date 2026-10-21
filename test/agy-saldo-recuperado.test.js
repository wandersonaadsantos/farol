import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-agy-saldo-'));
process.env.FAROL_HOME = home;
const { aplicarLeitura } = await import('../lib/agy/cota.js');
const { registrarLimite, registroDaAssinatura } = await import('../lib/engine/limite-plano.js');
const { TEMPOS } = await import('../lib/constants.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));
const now = 1800000000000;
const auth = { kind: 'agy', id: 'google', grupo: 'gemini' };

function setup() {
  const engine = { config: { claudeProfiles: [{ id: auth.id, email: 'conta@example.com' }] }, limitesDePlano: new Map(), resolveClaudeAuth: () => auth, log() {} };
  registrarLimite(engine, '', now + TEMPOS.DIA_MS, now - 1000, { auth });
  const leitura = { ok: true, iniciadaEm: now - 500, em: now, conta: 'conta@example.com', arquivo: true,
    grupos: [{ grupo: 'gemini', buckets: [{ restante: 0.01, reset: now + TEMPOS.DIA_MS }] }] };
  return { engine, leitura };
}

test('saldo real recuperado libera perfil antes do reset antigo e preserva outro grupo', () => {
  const { engine, leitura } = setup();
  const other = { ...auth, grupo: '3p' };
  registrarLimite(engine, '', now + TEMPOS.DIA_MS, now - 1000, { auth: other });
  aplicarLeitura(engine, auth, leitura, now);
  assert.equal(registroDaAssinatura(engine, auth, now), null);
  assert.ok(registroDaAssinatura(engine, other, now));
});

for (const [name, patch] of Object.entries({
  'consulta anterior ao bloqueio': { iniciadaEm: now - 2000 },
  'cache vencido': { em: now - TEMPOS.AGY_COTA_CACHE_MS },
  'relógio futuro': { em: now + 1000 },
  'consulta futura': { iniciadaEm: now + 1000 },
  'outra conta': { conta: 'outra@example.com' },
  'identidade desconhecida': { conta: null },
  'token fora do perfil': { arquivo: false },
  'leitura sem sucesso': { ok: false },
  'consulta sem carimbo': { iniciadaEm: undefined },
  'grupo ausente': { grupos: [] },
})) test(`saldo não libera limite com ${name}`, () => {
  const { engine, leitura } = setup();
  aplicarLeitura(engine, auth, { ...leitura, ...patch }, now);
  assert.ok(registroDaAssinatura(engine, auth, now));
});
