import { criteriaFixture } from './helpers/criteria-fixture.js';
// O review sai no GitHub com a conta da pessoa: credencial reconhecida no corpo ou num comentário
// inline não sai por via nenhuma, e o valor não fica no motivo, no log nem no estado. A outra metade
// importa tanto quanto: texto normal de review que fala de token e senha passa, porque falso
// positivo aqui trava revisão boa.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-credencial-'));
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Montados em tempo de execução para o arquivo não carregar nada com forma de credencial inteira.
const CORPO = 'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0iL3oR6';
const GH = `${'gh'}p_${CORPO}`;
const CREDENCIAIS = [GH, `${'gh'}s_${CORPO}`, `github_${'pat'}_11${CORPO}_${CORPO}`, `sk-${'ant'}-api03-${CORPO}-${CORPO}`, `sk-${'proj'}-${CORPO}`, `sk-${CORPO}`, `${'AI'}za${CORPO}`];
const HEAD = '706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c';
const check = (name, conclusion, status = 'COMPLETED') => ({ name, status, conclusion, startedAt: '2026-10-18T12:00:00Z' });

const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let envios = [];
let gh;
io.run = async (_cmd, args) => {
  const sub = (args || []).join(' ');
  if (/pulls\/\d+\/reviews --input/.test(sub)) {
    envios.push(JSON.parse(fs.readFileSync(args[args.indexOf('--input') + 1], 'utf8')));
    return { ok: true, code: 0, stdout: '{"id":1}', stderr: '' };
  }
  if (/pulls\/\d+\/reviews/.test(sub) && sub.includes('--jq')) return { ok: true, code: 0, stdout: '[]', stderr: '' };
  if (sub.includes('--json state,headRefOid,baseRefName,statusCheckRollup')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, baseRefName: 'main', statusCheckRollup: gh.rollup }) };
  }
  if (sub.includes('--json state,headRefOid,author')) {
    return { ok: true, code: 0, stderr: '', stdout: JSON.stringify({ state: 'OPEN', headRefOid: HEAD, author: { login: 'dev' } }) };
  }
  if (sub.includes('rules/branches/main')) return { ok: true, code: 0, stdout: JSON.stringify(['test', 'audit']), stderr: '' };
  if (sub.includes('--json headRefOid')) return { ok: true, code: 0, stdout: HEAD, stderr: '' };
  if (sub.includes('--json state')) return { ok: true, code: 0, stdout: JSON.stringify({ state: 'OPEN' }), stderr: '' };
  return { ok: true, code: 0, stdout: '', stderr: '' };
};

const { Engine } = await import('../server.js');
const { isolateTechnicalTool } = await import('./helpers/technical-proof.js');
isolateTechnicalTool();
const { hasCredential, replaceCredentials, maskSecrets } = await import('../lib/sensitive-text.js');
const { BLOQUEIO_CREDENCIAL, MARCA_RETIRADA, camposComCredencial, retirarCredenciais } = await import('../lib/engine/credencial-no-texto.js');
const { classify } = await import('../lib/log-taxonomy.js');
const { postRetryFor } = await import('../lib/engine/desfecho-da-revisao.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* limpeza best-effort do temporário */ }
});
beforeEach(() => {
  envios = [];
  gh = { rollup: [check('test', 'SUCCESS'), check('audit', 'SUCCESS')] };
});

function motor({ checks = [], reprova = 'request_changes' } = {}) {
  const e = new Engine();
  e.token = 'token-falso';
  e.tokens = { eu: 'token-falso' };
  e.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  e.config.aguardarCiParaAprovar = true;
  e.approvePolicyFor = () => 'approve';
  e.rejectPolicyFor = () => reprova;
  e.autoReviewFor = () => true;
  e.decisions = { pending: [], resolved: [] };
  e.saveDecisions = () => { };
  e.saveReReviewLaunched = () => { };
  e.pushState = () => { };
  e.refreshTokens = async () => { };
  e.writeMemory = () => { };
  e.linhasDeLog = [];
  e.log = (nivel, texto) => e.linhasDeLog.push(`${nivel} ${texto}`);
  e.toasts = [];
  e.on('toast', (t) => e.toasts.push(t.text));
  e.on('needs-decision', () => { });
  e.bloqueadoPorChecks = async () => ({ faltando: checks });
  return e;
}

const PR = (n) => ({ key: `acme/app#${n}`, repo: 'acme/app', number: n, url: `https://github.com/acme/app/pull/${n}`, title: 'PR', author: 'dev', account: 'eu', requested: true });
const REVISAO = { analysisStatus: 'complete', cardMet: true, reasons: [], coverage: { total: 0, reviewed: [], missing: [] }, reportMarkdown: '# ok', protocolo: { prReviewer: 'rodou' } };

function sessaoQueAprova(e, body) {
  e.runClaudeStream = async () => ({
    sessionId: 's1',
    text: JSON.stringify({
      ...REVISAO, ...criteriaFixture('approve'), verdict: 'approve', decision: 'auto_approve',
      payloads: { approve: { event: 'APPROVE', body }, request_changes: { event: 'REQUEST_CHANGES', body: 'Revise o tratamento de erro antes do merge.' }, comment: { event: 'COMMENT', body: 'Leitura completa.' } },
    }),
  });
}

function semValor(e, ...extras) {
  const tudo = JSON.stringify([e.decisions, e.linhasDeLog, e.toasts, ...extras]);
  assert.equal(tudo.includes(CORPO), false, 'o valor não fica no estado, no log, nos avisos nem no retorno');
}

test('reconhece os formatos emitidos, em qualquer posição do texto', () => {
  for (const credencial of CREDENCIAIS) {
    assert.equal(hasCredential(credencial), true, credencial.slice(0, 8));
    assert.equal(hasCredential(`Na linha 12: \`const x = "${credencial}";\`, troque por variável.`), true, credencial.slice(0, 8));
    assert.equal(replaceCredentials(credencial, '[x]'), '[x]', credencial.slice(0, 8));
  }
});

test('texto normal de review passa, inclusive o que a máscara dos logs pegaria', () => {
  const normais = [
    'O `token` de sessão não é renovado, e `password` chega sem validação no handler.',
    'A variável `accessToken` vaza para o log em `src/auth.ts:41`; prefira `maskToken(token)`.',
    '```diff\n-const password = "";\n+const password = process.env.DB_PASSWORD;\n```',
    'Use `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}` no workflow, e `GH_TOKEN=$(gh auth token)` no script.',
    'GITHUB_TOKEN: precisa de permissão de escrita aqui.',
    'A rota aceita `?token=abc123&auth=true`, e isso expõe o valor no histórico do navegador.',
    'O cabeçalho é `Authorization: Bearer <token>`, e a Bearer authentication falha sem ele.',
    'O diff trocou [segredo mascarado] na linha 3, então a chave precisa ser rotacionada.',
    'Commit 706cc81f09f3cef5043ec47e5eebbc5e8c44eb9c mudou a classe `sk-fading-circle-container-big`.',
    `Exemplo do README: ${'gh'}p_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx e ${'gh'}p_000000000000000000000000.`,
    `Placeholder: sk-${'ant'}-api03-your-key-here, sk-${'or'}-your-key-goes-here, sk-your-key-goes-here-please.`,
    'Função `ghs_someLongIdentifierNameHere` e `AIzaFakeKeyNameUsedOnlyInTheDocumentationPage`.',
  ];
  for (const texto of normais) assert.equal(hasCredential(texto), false, texto);
  assert.notEqual(maskSecrets(normais[3]), normais[3], 'a régua dos logs é mais larga de propósito');
});

test('o motivo não vira falha transitória: nada de reenvio automático', () => {
  const erro = 'o texto do review tem o que parece uma credencial, então nada foi postado; confira no card e redija pelo chat deste PR';
  assert.notEqual(classify(erro).kind, 'transitorio');
  assert.equal(postRetryFor('approve', erro, { ok: false, blocked: BLOQUEIO_CREDENCIAL, attempted: false }), null);
});

for (const event of ['APPROVE', 'REQUEST_CHANGES', 'COMMENT']) {
  test(`${event}: corpo com credencial não chega ao token, ao disco nem ao gh`, async () => {
    const e = motor();
    let refresh = false;
    e.token = null;
    e.refreshTokens = async () => { refresh = true; };
    const r = await e.postReview(PR(1), { event, body: `Troque ${GH} por variável de ambiente e proteja o fluxo.`, comments: [] });
    assert.equal(r.ok, false);
    assert.equal(r.blocked, BLOQUEIO_CREDENCIAL);
    assert.equal(r.attempted, false);
    assert.deepEqual(r.campos, ['body']);
    assert.equal(refresh, false);
    assert.deepEqual(envios, []);
    semValor(e, r);
    assert.ok(e.linhasDeLog.some((l) => l.includes('credencial (body)')));
  });
}

test('comentário inline com credencial recusa e aponta o campo, não o trecho', async () => {
  const e = motor();
  const comments = [
    { path: 'a.js', line: 1, side: 'RIGHT', body: 'O `token` aqui deveria vir do cofre.' },
    { path: 'b.js', line: 2, side: 'RIGHT', body: `Valor exposto: ${CREDENCIAIS[3]}` },
  ];
  const r = await e.postReview(PR(2), { event: 'COMMENT', body: 'Dois pontos.', comments });
  assert.equal(r.blocked, BLOQUEIO_CREDENCIAL);
  assert.deepEqual(r.campos, ['comments[1]']);
  assert.deepEqual(envios, []);
  semValor(e, r);
  assert.deepEqual(camposComCredencial({ body: 'ok', comments }), ['comments[1]']);
});

test('review normal falando de token e senha sai pelo mesmo funil', async () => {
  const e = motor();
  const body = 'O `token` e o `password` chegam sem validação; `GITHUB_TOKEN: ${{ secrets.X }}` está certo.';
  const r = await e.postReview(PR(3), { event: 'COMMENT', body, comments: [{ path: 'a.js', line: 1, side: 'RIGHT', body: 'Valide `password` aqui.' }] });
  assert.equal(r.ok, true);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].body, body);
});

test('a trava vem antes da de linguagem: a reconstrução não publica o resto do texto sozinha', async () => {
  const e = motor();
  sessaoQueAprova(e, `Não auto-aprovei porque a política interna bloqueou.\n\nToken exposto: ${GH}.\n\nO resto da leitura está correto.`);
  await e.runHeadlessReview(PR(4));
  assert.deepEqual(envios, []);
  const d = e.decisions.pending.find((x) => x.key === 'acme/app#4');
  assert.ok(d, 'fica com a pessoa');
  assert.equal(d.postRetry, null);
  assert.ok(d.reasons.some((m) => /parece uma credencial/.test(m.text || m)));
  semValor(e);
});

test('controle: a mesma aprovação automática, sem credencial, sai', async () => {
  const e = motor();
  sessaoQueAprova(e, 'Leitura completa, sem bloqueios. O `token` está certo.');
  await e.runHeadlessReview(PR(50));
  assert.equal(envios.length, 1, JSON.stringify(e.decisions.pending.map((d) => d.reasons)));
});

test('aprovação automática com credencial não sai e o estado não guarda o valor', async () => {
  const e = motor();
  sessaoQueAprova(e, `Leitura completa, sem bloqueios. Chave em uso: ${GH}.`);
  await e.runHeadlessReview(PR(5));
  assert.deepEqual(envios, []);
  const d = e.decisions.pending.find((x) => x.key === 'acme/app#5');
  assert.ok(d);
  assert.equal(d.postRetry, null);
  assert.ok(d.payloads.approve.body.includes(MARCA_RETIRADA));
  semValor(e);
  assert.equal(await e.retryFailedPosts(), 0, 'o reenvio não pega este item');
  assert.deepEqual(envios, []);
});

function sessaoQueReprova(e, comentario) {
  e.runClaudeStream = async () => ({
    sessionId: 's1',
    text: JSON.stringify({
      ...REVISAO, ...criteriaFixture('request_changes'), verdict: 'request_changes', decision: 'needs_decision',
      coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }],
      reasons: ['Open redirect ainda ativo no head novo'],
      payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'o redirect não fechou', comments: [{ path: 'a.ts', line: 1, side: 'RIGHT', body: comentario }] } },
    }),
  });
}

test('reprovação automática com credencial no comentário inline não sai; sem ela, sai', async () => {
  const controle = motor();
  sessaoQueReprova(controle, 'Valide o `token` aqui.');
  await controle.runHeadlessReview(PR(60));
  assert.deepEqual(envios.map((p) => p.event), ['REQUEST_CHANGES'], JSON.stringify(controle.decisions.pending.map((d) => d.reasons)));
  envios = [];
  const e = motor();
  sessaoQueReprova(e, `Rotacione ${GH}.`);
  await e.runHeadlessReview(PR(6));
  assert.deepEqual(envios, []);
  const d = e.decisions.pending.find((x) => x.key === 'acme/app#6');
  assert.ok(d.reasons.some((m) => /parece uma credencial/.test(m.text || m)));
  semValor(e);
});

test('clique: o texto gravado com a marca não sai, e o card diz o motivo', async () => {
  const e = motor();
  const item = e.recordDecision(PR(7), { verdict: 'approve', headSha: HEAD, reasons: [], reportMarkdown: `# ${GH}`, memory: { bullets: [`vi ${GH}`] }, payloads: { approve: { event: 'APPROVE', body: `Corpo com ${GH}.` } } }, { status: 'pending' });
  assert.ok(item.payloads.approve.body.includes(MARCA_RETIRADA));
  semValor(e);
  const r = await e.decide(item.id, 'approve');
  assert.equal(r.blocked, BLOQUEIO_CREDENCIAL);
  assert.deepEqual(envios, []);
  assert.match(e.decisions.pending[0].blockedReason, /parece uma credencial/);
  assert.ok(e.toasts.some((t) => /parece uma credencial/.test(t)));
  semValor(e, r);
});

test('reenvio: pendência gravada antes da trava para de tentar e perde o valor', async () => {
  const e = motor();
  e.decisions.pending.push({
    id: 'd-antiga', key: 'acme/app#8', pr: PR(8), headSha: HEAD, status: 'pending', reasons: [],
    postRetry: { event: 'approve', attempts: 0 },
    payloads: { approve: { event: 'APPROVE', body: `Corpo com ${GH}.` } },
  });
  assert.equal(await e.retryFailedPosts(), 0);
  assert.deepEqual(envios, []);
  const d = e.decisions.pending[0];
  assert.equal(d.postRetry, null);
  assert.match(d.blockedReason, /parece uma credencial/);
  semValor(e);
});

test('espera do CI: CI verde não publica o texto recortado, e a pendência vai para a pessoa', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }], reprova: 'wait' });
  sessaoQueAprova(e, `Leitura completa, sem bloqueios. Chave em uso: ${GH}.`);
  gh.rollup = [check('test', null, 'IN_PROGRESS'), check('audit', 'SUCCESS')];
  await e.runHeadlessReview(PR(9));
  const antes = e.decisions.pending.find((x) => x.key === 'acme/app#9');
  assert.ok(antes.esperaCi, 'esperando o CI');
  semValor(e);
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  await e.varrerEsperas();
  assert.deepEqual(envios, []);
  const d = e.decisions.pending.find((x) => x.key === 'acme/app#9');
  assert.equal(d.esperaCi, null, 'a recusa não fica presa na espera');
  assert.equal(d.postRetry, null);
  assert.ok(d.reasons.some((m) => /parece uma credencial/.test(m.text || m)));
  semValor(e);
});

test('espera do CI com coordenação: `nao_enviada` da credencial também vai para a pessoa', async () => {
  const e = motor({ checks: [{ nome: 'test', estado: 'rodando' }], reprova: 'wait' });
  sessaoQueAprova(e, 'Leitura completa, sem bloqueios.');
  gh.rollup = [check('test', null, 'IN_PROGRESS'), check('audit', 'SUCCESS')];
  await e.runHeadlessReview(PR(10));
  gh.rollup = [check('test', 'SUCCESS'), check('audit', 'SUCCESS')];
  e.postReview = async () => ({ ok: false, blocked: BLOQUEIO_CREDENCIAL, estado: 'nao_enviada', motivo: BLOQUEIO_CREDENCIAL, attempted: false, error: 'o texto do review tem o que parece uma credencial' });
  await e.varrerEsperas();
  assert.equal(e.decisions.pending.find((x) => x.key === 'acme/app#10').esperaCi, null);
});

test('sessão interativa e co-assinatura passam pela mesma boca, e a sessão pode tentar de novo', async () => {
  const e = motor();
  for (const via of ['sessao', 'coassinatura', 'reenvio', 'espera-ci', 'clique']) {
    const r = await e.postReview(PR(11), { event: 'COMMENT', body: `Valor: ${GH}.` }, { via });
    assert.equal(r.blocked, BLOQUEIO_CREDENCIAL, via);
    assert.notEqual(r.attempted, true, `${via}: a capability da sessão não é consumida`);
  }
  assert.deepEqual(envios, []);
});

test('retirarCredenciais preserva a referência quando não há o que tirar', () => {
  const item = { a: 'texto com token', b: [{ c: 1, d: null }], e: new Date(0) };
  assert.equal(retirarCredenciais(item), item);
  const sujo = { a: 'ok', b: [{ c: GH }], e: item.e };
  const limpo = retirarCredenciais(sujo);
  assert.deepEqual(limpo, { a: 'ok', b: [{ c: MARCA_RETIRADA }], e: item.e });
  assert.ok(sujo.b[0].c.includes(CORPO), 'o original não é alterado');
  assert.equal(limpo.e, item.e);
});
