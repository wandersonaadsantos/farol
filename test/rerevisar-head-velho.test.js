// O beco sem saída do biud-frontend#796 (23/08/2026). A trava de head velho (v2.51.2)
// para de postar quando o autor empurra commit durante a revisão, e o card manda pedir
// uma revisão nova. Só que não existia de onde pedir: o card de pendência tem Aprovar,
// Pedir mudanças, Só comentar, Conversar e Pular, e nenhum deles funciona nesse estado.
//
// E o caminho automático também não cobria: reReviewTargets (review.js) só relança quando
// o último review MEU foi CHANGES_REQUESTED (aqui nada foi postado) e se recusa a relançar
// com pendência do PR na mesa, de propósito, pra não empilhar dois cards do mesmo PR.
//
// Este arquivo trava a saída: o TIPO do bloqueio vira dado (blockedKind), a tela recebe
// esse dado, e o round novo SUBSTITUI o card morto em vez de empilhar.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-rerevisar-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
io.run = function runEspiao(cmd, args, opts) {
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = await import('../server.js');
const { decisionForUi } = await import('../lib/engine/public-review.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const HEAD_LIDO = '61bc8d2ea27dbc554d76672efcd56d06fa98d669';
const HEAD_NOVO = '135fa0b4da5fadb9fda260565f166c977eb5d992';

const PR = {
  key: 'acme/app#796', repo: 'acme/app', number: 796,
  url: 'https://github.com/acme/app/pull/796',
  requested: true, title: 'feat: jornada de entrada', author: 'gabriel'
};

function novoEngine() {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.saveDecisions = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };
  engine.on('toast', () => { });
  return engine;
}

function pendenciaBloqueada(extra) {
  return {
    id: 'd-velha', createdAt: Date.now() - 60000, status: 'pending', verdict: 'approve',
    key: PR.key, pr: { ...PR }, headSha: HEAD_LIDO,
    blockedReason: 'o autor empurrou commit novo durante a revisão; este texto fala do código anterior.',
    blockedKind: 'stale_head',
    payloads: { approve: { event: 'APPROVE', body: 'texto do round anterior' } },
    ...extra
  };
}

function resultado(extra) {
  return {
    analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'texto do round novo' } },
    reportMarkdown: '# ok', headSha: HEAD_NOVO, ...extra
  };
}

/* ---------- 1. o tipo do bloqueio é dado, não frase ---------- */

test('decide grava o TIPO do bloqueio, não só a frase em português', async () => {
  const engine = novoEngine();
  engine.headSha = async () => HEAD_NOVO;
  engine.myReviewStates = async () => [];
  engine.decisions = { pending: [pendenciaBloqueada({ blockedReason: undefined, blockedKind: undefined })], resolved: [] };
  const r = await engine.decide('d-velha', 'approve');
  assert.equal(r.blocked, 'stale_head');
  const item = engine.decisions.pending[0];
  assert.equal(item.blockedKind, 'stale_head', 'sem o tipo, a tela teria que farejar o texto em português');
  assert.match(item.blockedReason, /commit novo/i, 'e a frase continua lá, pra quem lê');
});

test('a tela RECEBE o tipo do bloqueio (allowlist da projeção)', () => {
  const projetado = decisionForUi(pendenciaBloqueada());
  assert.equal(projetado.blockedKind, 'stale_head', 'fora da allowlist, o botão nunca apareceria');
  assert.equal(projetado.payloads, undefined, 'e a projeção segue sem entregar o payload cru');
});

/* ---------- 2. o round novo substitui o card morto ---------- */

test('round novo do MESMO PR substitui a pendência travada em head velho', () => {
  const engine = novoEngine();
  engine.decisions = { pending: [pendenciaBloqueada()], resolved: [] };
  engine.recordDecision(PR, resultado(), { status: 'pending' });
  assert.equal(engine.decisions.pending.length, 1, 'um card por PR: o morto sai, o novo entra');
  assert.equal(engine.decisions.pending[0].headSha, HEAD_NOVO, 'e o que fica é o do head atual');
  assert.equal(engine.decisions.resolved.length, 1, 'a substituída não some, vai pro histórico');
  assert.equal(engine.decisions.resolved[0].status, 'superseded');
  assert.equal(engine.decisions.resolved[0].id, 'd-velha');
});

test('pendência VIVA do mesmo PR não é substituída (só a bloqueada por head velho)', () => {
  const engine = novoEngine();
  const viva = pendenciaBloqueada({ blockedReason: undefined, blockedKind: undefined });
  engine.decisions = { pending: [viva], resolved: [] };
  engine.recordDecision(PR, resultado(), { status: 'pending' });
  assert.equal(engine.decisions.pending.length, 2, 'gate que barrou por regra ou conteúdo continua sendo sua pra decidir');
  assert.equal(engine.decisions.resolved.length, 0);
});

test('pendência bloqueada de OUTRO PR não é tocada', () => {
  const engine = novoEngine();
  const outro = pendenciaBloqueada({ id: 'd-outro', key: 'acme/app#42', pr: { ...PR, key: 'acme/app#42', number: 42 } });
  engine.decisions = { pending: [outro], resolved: [] };
  engine.recordDecision(PR, resultado(), { status: 'pending' });
  assert.equal(engine.decisions.pending.length, 2);
  assert.ok(engine.decisions.pending.some(d => d.id === 'd-outro'), 'a substituição é por PR, nunca varredura');
});

test('decisão que já nasce resolvida não mexe em pendência nenhuma', () => {
  const engine = novoEngine();
  engine.decisions = { pending: [pendenciaBloqueada()], resolved: [] };
  engine.recordDecision(PR, resultado(), { status: 'auto_approved', action: 'approve' });
  assert.equal(engine.decisions.pending.length, 1, 'o card bloqueado só sai quando um round NOVO ocupa o lugar dele');
  assert.equal(engine.decisions.pending[0].id, 'd-velha');
});

/* ---------- 3. a tela oferece a saída ---------- */

const appJs = fs.readFileSync(new URL('../ui/app.js', import.meta.url), 'utf8');

test('o card de pendência oferece Revisar de novo, e SÓ no bloqueio por head velho', () => {
  const i = appJs.indexOf('<div class="dec-actions">');
  assert.ok(i > 0, 'o bloco de ações do card tem que existir');
  const bloco = appJs.slice(i, i + 1200);
  assert.match(bloco, /act-review/, 'sem o botão, o card manda pedir revisão nova e não dá como pedir');
  assert.match(bloco, /blockedKind === 'stale_head'[\s\S]{0,200}act-review/, 'e ele é gateado pelo tipo do bloqueio');
});

test('o clique em Revisar de novo é escutado pela seção de decisões', () => {
  const i = appJs.indexOf("$('#decisions').addEventListener('click'");
  assert.ok(i > 0, 'a seção precisa ter listener próprio');
  const listener = appJs.slice(i, i + 900);
  assert.match(listener, /act-review/, 'o .act-review não tem listener global: cada seção escuta o seu');
  assert.match(listener, /\/api\/review/, 'e usa a MESMA rota do Revisar da fila');
});
