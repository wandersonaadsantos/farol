import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-interventions-'));
process.env.FAROL_HOME = home;
const { observe, candidates, pushState } = await import('../lib/engine/interventions.js');
const { Engine } = await import('../server.js');
const { interventionEvent, quietNow, voiceAllowed } = await import('../ui/pure/interventions.js');
const { sanear } = await import('../lib/settings.js');
after(() => fs.rmSync(home, { recursive: true, force: true }));

let seq = 0;
function fixture() {
  const engine = new EventEmitter(); engine.log = () => {};
  const file = path.join(home, `receipts-${++seq}.json`);
  const decision = { id: 'd1', createdAt: 100, headSha: 'h1', verdict: 'manual', account: 'eu',
    reasons: [{ text: 'Confirmar regra', kind: 'produto' }], pr: { url: 'https://github.com/o/r/pull/1' } };
  const snapshot = { status: 'idle', config: {}, decisions: { pending: [decision] }, accounts: [], parked: {}, reRounds: {} };
  return { engine, file, snapshot, decision };
}

test('polling, novo id e ordem dos motivos não repetem; head ou motivo novo avisam', () => {
  const { engine, file, snapshot, decision } = fixture();
  const options = { file, now: 1000 };
  const first = observe(engine, snapshot, options);
  assert.equal(first.length, 1);
  decision.id = 'd2'; decision.createdAt = 500;
  assert.equal(observe(engine, snapshot, options).length, 0);
  decision.headSha = 'h2';
  const changed = observe(engine, snapshot, options);
  assert.equal(changed.length, 1);
  assert.notEqual(changed[0].revision, first[0].revision, 'mudança no mesmo milissegundo chega à UI');
  decision.reasons.push({ text: 'Evidência nova' });
  assert.equal(observe(engine, snapshot, options).length, 1);
  decision.reasons.reverse();
  assert.equal(observe(engine, snapshot, options).length, 0);
});

test('recibos sobrevivem a reinício; resolução permite um incidente posterior', () => {
  const { engine, file, snapshot } = fixture();
  observe(engine, snapshot, { file, now: 1 });
  const restarted = new EventEmitter(); restarted.log = () => {};
  assert.equal(observe(restarted, { ...snapshot, status: 'starting' }, { file, now: 2 }).length, 0);
  assert.equal(observe(restarted, snapshot, { file, now: 3 }).length, 0);
  observe(restarted, { ...snapshot, decisions: { pending: [] } }, { file, now: 4 });
  assert.equal(observe(restarted, snapshot, { file, now: 5 }).length, 1);
  const data = fs.readFileSync(file, 'utf8');
  assert.ok(!data.includes('github.com')); assert.ok(!data.includes('Confirmar regra'));
});

test('lembrete é opt-in, respeita intervalo e não cresce a cada polling', () => {
  const { engine, file, snapshot } = fixture();
  observe(engine, snapshot, { file, now: 1 });
  assert.equal(observe(engine, snapshot, { file, now: 9999999 }).length, 0);
  snapshot.config.interventionReminderMinutes = 5;
  const events = observe(engine, snapshot, { file, now: 300001 });
  assert.equal(events.length, 1); assert.equal(events[0].reminder, true);
  assert.equal(observe(engine, snapshot, { file, now: 300002 }).length, 0);
});

test('esperas com recuperação automática não pedem intervenção', () => {
  const { snapshot, decision } = fixture();
  snapshot.reRounds['o/r#1'] = { estado: 'aguardando' };
  for (const marker of [{ esperaCi: {} }, { esperaProva: {} }, { postRetry: { exhausted: false } },
    { blockedKind: 'stale_head', key: 'o/r#1' }]) {
    snapshot.decisions.pending = [{ ...decision, ...marker }];
    assert.equal(candidates(snapshot).length, 0);
  }
  snapshot.decisions.pending = [{ ...decision, blockedKind: 'stale_head', key: 'o/r#1' }];
  snapshot.reRounds['o/r#1'] = { estado: 'parado', motivo: 'ancora' };
  assert.equal(candidates(snapshot).length, 1);
  snapshot.decisions.pending = [{ ...decision, postRetry: { exhausted: true } }];
  assert.equal(candidates(snapshot).length, 1);
});

test('eventos operacionais são explícitos; áudio e conteúdo não nascem do stderr', () => {
  const { snapshot } = fixture();
  snapshot.decisions.pending = [];
  snapshot.accounts = [{ user: 'a', tokenOk: false }, { user: 'b', tokenOk: false, muted: true }];
  snapshot.parked = { a: { tipo: 'falha', motivo: 'SECRET', at: '2026-10-23' }, b: { tipo: 'autenticacao', motivo: 'PRIVATE' },
    c: { tipo: 'cancelado' }, d: { tipo: 'orcamento' } };
  snapshot.sync = { enabled: true, status: 'sem-credencial' };
  const events = candidates(snapshot, false, new Set(['a']));
  assert.deepEqual(events.map(e => e.kind).sort(), ['access', 'access', 'failure', 'operational']);
  const publicEvents = events.map(({ fingerprint, ...e }) => e);
  assert.ok(!JSON.stringify(publicEvents).includes('SECRET'));
  assert.ok(publicEvents.every(e => !e.speech.includes('github.com')));
  assert.ok(publicEvents.every(interventionEvent));
});

test('token ainda não coletado no boot não vira alerta de acesso vencido', () => {
  const { engine, snapshot, file } = fixture();
  snapshot.decisions.pending = [];
  snapshot.accounts = [{ user: 'conta', tokenOk: false }];
  assert.equal(observe(engine, snapshot, { file }).length, 0);
  engine.semTokenAvisado = new Set(['conta']);
  assert.equal(observe(engine, snapshot, { file }).length, 1);
  assert.equal(observe(engine, snapshot, { file }).length, 0);
  engine.semTokenAvisado.clear(); snapshot.accounts[0].tokenOk = true;
  observe(engine, snapshot, { file });
  engine.semTokenAvisado.add('conta'); snapshot.accounts[0].tokenOk = false;
  assert.equal(observe(engine, snapshot, { file }).length, 1);
});

test('falha de persistência não derruba o estado nem fica silenciosa', () => {
  const { engine, snapshot } = fixture(); const warnings = [];
  engine.log = (...args) => warnings.push(args);
  assert.equal(observe(engine, snapshot, { file: path.join(home, 'absent', 'r.json') }).length, 1);
  assert.equal(warnings.length, 1);
});

test('Engine real emite uma intervenção e mantém snapshot recuperável pelo cliente', () => {
  const engine = new Engine(); engine.status = 'idle'; engine.config.accounts = [];
  engine.decisions.pending = [fixture().decision];
  const events = [], states = [];
  engine.on('intervention', event => events.push(event)); engine.on('state', s => states.push(s));
  engine.pushState(); engine.pushState();
  assert.equal(events.filter(e => e.kind === 'decision').length, 1);
  assert.ok(states.at(-1).interventions.some(e => e.id === events[0].id));
  assert.ok(engine.snapshot().interventions.length);
});

test('despacho preserva state antes do evento, inclusive sem cliente de áudio', () => {
  const { engine, snapshot } = fixture();
  snapshot.decisions.pending[0].pr.url = 'https://github.com/o/r/pull/2';
  engine.snapshot = () => snapshot;
  const order = []; engine.on('state', () => order.push('state')); engine.on('intervention', () => order.push('intervention'));
  pushState(engine);
  assert.equal(order[0], 'state'); assert.ok(order.includes('intervention'));
});

test('horário silencioso atravessa meia-noite, permite intervalos diurnos e protege voz', () => {
  const config = { voiceEnabled: true, voiceEvents: ['decision'], voiceQuietEnabled: true, voiceQuietStart: '22:00', voiceQuietEnd: '08:00' };
  const at = hour => new Date(2026, 9, 23, hour);
  for (const hour of [0, 7, 22, 23]) assert.equal(quietNow(config, at(hour)), true);
  for (const hour of [8, 12, 21]) assert.equal(quietNow(config, at(hour)), false);
  assert.equal(voiceAllowed(config, { kind: 'decision' }, at(23)), false);
  assert.equal(voiceAllowed(config, { kind: 'decision' }, at(12)), true);
  assert.equal(voiceAllowed(config, { kind: 'access' }, at(12)), false);
  assert.equal(quietNow({ ...config, voiceQuietStart: '10:00', voiceQuietEnd: '12:00' }, at(11)), true);
  assert.equal(quietNow({ ...config, voiceQuietEnd: '22:00' }, at(23)), false);
});

test('entrada inválida nunca navega e configuração numérica não aceita infinito', () => {
  assert.equal(interventionEvent({ id: 'a'.repeat(64), kind: 'decision', title: 'a', body: 'b', speech: 'c', target: { type: 'pr', url: 'javascript:alert(1)' } }), null);
  assert.equal(sanear('voiceEnabled', 'true', {}, {}), false);
  assert.equal(sanear('voiceVolume', Infinity, {}, {}), 50);
  assert.equal(sanear('voiceVolume', -1, {}, {}), 0);
  assert.equal(sanear('voiceQuietStart', '25:00', {}, {}), '22:00');
  assert.equal(sanear('voiceQuietStart', { toString: null }, {}, {}), '22:00');
  assert.equal(sanear('voiceVolume', { toString: null }, {}, {}), 50);
  assert.deepEqual(sanear('voiceEvents', ['decision', 'bad', 'decision'], {}, {}), ['decision']);
});
