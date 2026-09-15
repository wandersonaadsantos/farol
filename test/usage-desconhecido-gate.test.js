// "Sem-base" entrava como zero no teto de orçamento (spec 4.1, buraco 4): uma leva de
// sessões interrompidas sem token passava pelo gate como se não tivesse gasto nada.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-gate-desconhecido-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
const usage = (await import('../lib/engine/usage.js')).default;

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ } });

const HOJE = usage.localDay();
const PERFIL = { id: 'p1', kind: 'apikey', label: 'P1', budgetDaily: 10 };

function cenario(desconhecidas, origem = 'desconhecido', perfil = 'p1') {
  const store = usage.defaultUsage();
  store.byProfileDay = { [`p1|${HOJE}`]: { sessions: 1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 5 } };
  const agora = Date.now();
  const sessions = [1, 2, 3].map(() => ({ kind: 'review', at: agora, day: HOJE, costUsd: 2, costSource: 'medido', profileId: 'outro' }));
  for (let i = 0; i < desconhecidas; i++) sessions.push({ kind: 'review', at: agora, day: HOJE, costUsd: 0, costSource: origem, profileId: perfil, status: 'interrompida' });
  return { usage: store, usageSessions: { sessions } };
}

test('sessão de custo desconhecido reserva o custo típico e o status diz parcialmente estimado', () => {
  const st = usage.budgetStatusFor(cenario(3), PERFIL);
  assert.equal(st.blocked, true, '5 medidos + 3 x 2 de reserva estoura o teto de 10');
  assert.equal(st.reason, 'diario');
  assert.equal(st.parcialmenteEstimado, true);
});

test('o mesmo gasto sem desconhecidas continua liberado e com o formato de sempre', () => {
  const st = usage.budgetStatusFor(cenario(0), PERFIL);
  assert.deepEqual(st, { blocked: false, today: 5, sinceCutoff: 5 });
});

test('linha antiga sem-base conta como desconhecida', () => {
  assert.equal(usage.budgetStatusFor(cenario(3, 'sem-base'), PERFIL).blocked, true);
});

test('desconhecida de outro perfil não pesa neste', () => {
  const st = usage.budgetStatusFor(cenario(3, 'desconhecido', 'p2'), PERFIL);
  assert.equal(st.blocked, false);
  assert.equal('parcialmenteEstimado' in st, false);
});

test('contarDesconhecidas separa hoje e desde o corte', () => {
  const sessions = [
    { profileId: 'p1', costSource: 'desconhecido', day: HOJE },
    { profileId: 'p1', costSource: 'desconhecido', day: '2026-01-01' },
    { profileId: 'p1', costSource: 'medido', day: HOJE },
  ];
  assert.deepEqual(usage.contarDesconhecidas(sessions, 'p1', '2026-01-01', HOJE), { hoje: 1, desde: 2 });
  assert.deepEqual(usage.contarDesconhecidas(sessions, 'p1', '2026-06-01', HOJE), { hoje: 1, desde: 1 });
  assert.deepEqual(usage.contarDesconhecidas(sessions, '', '', HOJE), { hoje: 0, desde: 0 });
});

test('a linha de orçamento da tela usa a mesma conta e leva a flag', () => {
  const eng = cenario(3);
  const tipico = usage.custoTipicoDeReview(eng.usageSessions.sessions);
  const [linha] = usage.budgetsFrom(eng.usage, [PERFIL], tipico, eng.usageSessions.sessions);
  assert.equal(linha.blocked, true);
  assert.equal(linha.parcialmenteEstimado, true);
});
