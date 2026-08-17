// Gates de segurança do mergeSelfPR: o ÚNICO caminho do Farol que mergeia um PR no
// GitHub. Até aqui tinha zero teste, num arquivo de 487 linhas.
//
// O que está em jogo: o CLAUDE.md promete que o botão Merge "só o autor mergeia o
// próprio PR, só quando a autoanálise marcou approvable === true, só em repo fora de
// mergeBlockedRepos, e nunca em rascunho/PR com conflito", e que "nem admin mergeia repo
// bloqueado". Nada disso estava travado por teste: qualquer refatoração podia afrouxar um
// gate e a suíte continuaria verde.
//
// Estratégia: `run` (o executor do gh) é trocado por um espião ANTES do require do
// server.js, porque lib/engine/selfpr.js faz `const { run } = require('../io')` no load e
// a desestruturação captura a referência ali. Assim nenhum `gh` de verdade roda, e dá pra
// afirmar não só o retorno mas O QUE FOI CHAMADO (ou, no caso dos gates, que nada foi).
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const FAROL_HOME = path.join(os.tmpdir(), 'farol-test-merge-' + process.pid);
process.env.FAROL_HOME = FAROL_HOME;

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// espião no lugar do run, instalado antes do primeiro require de selfpr
const io = (await import('../lib/io.js')).default;
const runReal = io.run;
let runImpl = null;
const chamadas = [];
io.run = function runEspiao(cmd, args, opts) {
  chamadas.push({ cmd, args: args || [] });
  if (runImpl) return runImpl(cmd, args || [], opts);
  return runReal(cmd, args, opts);
};

const { Engine } = await import('../server.js');

after(() => {
  io.run = runReal;
  try { fs.rmSync(FAROL_HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const URL_PR = 'https://github.com/acme/app/pull/42';
const CHAVE = 'acme/app#42';

// resposta padrão do `gh pr view`: PR meu, aberto, pronto, sem conflito
function prView(over = {}) {
  return JSON.stringify({
    state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE',
    author: { login: 'eu' }, headRefName: 'feature/x', baseRefName: 'develop',
    title: 'PR de teste', ...over
  });
}

// roteia por comando: `gh pr view` devolve o JSON, o resto devolve ok
function roteador({ view = prView(), mergeOk = true, mergeErr = '' } = {}) {
  return (cmd, args) => {
    const sub = args.join(' ');
    if (sub.startsWith('pr view')) return Promise.resolve({ ok: true, stdout: view, stderr: '' });
    if (sub.startsWith('pr merge')) return Promise.resolve({ ok: mergeOk, stdout: '', stderr: mergeErr });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
}

function novoEngine({ approvable = true, blocked = [] } = {}) {
  const engine = new Engine();
  engine.token = 'token-falso';
  engine.tokens = { eu: 'token-falso' };
  engine.config.accounts = [{ user: 'eu', owners: ['acme'] }];
  engine.config.mergeBlockedRepos = blocked;
  engine.selfAnalyses = approvable === null ? {} : { [CHAVE]: { approvable } };
  engine.myPRs = [{ key: CHAVE }];
  engine.saveSelfAnalyses = () => { };
  engine.pushState = () => { };
  engine.refreshTokens = async () => { };
  engine.log = () => { };            // não sujar o farol.log do temp
  engine.on('toast', () => { });     // EventEmitter sem listener não guarda nada
  return engine;
}

const mergeChamado = () => chamadas.filter(c => c.args.join(' ').startsWith('pr merge'));

beforeEach(() => { chamadas.length = 0; runImpl = null; });

/* ---------- entradas inválidas ---------- */

test('sem URL não mergeia', async () => {
  const r = await novoEngine().mergeSelfPR('');
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0);
});

test('URL que não é de PR não mergeia', async () => {
  const r = await novoEngine().mergeSelfPR('https://github.com/acme/app');
  assert.equal(r.ok, false);
  assert.match(r.error, /não reconheci a URL/);
  assert.equal(mergeChamado().length, 0);
});

/* ---------- gate 1: autoanálise ---------- */

test('sem autoanálise, recusa e NÃO chama o gh', async () => {
  runImpl = roteador();
  const r = await novoEngine({ approvable: null }).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /autoanálise marca o PR como aprovável/);
  assert.equal(mergeChamado().length, 0, 'nenhum merge tentado');
});

test('autoanálise que não marcou aprovável recusa', async () => {
  runImpl = roteador();
  for (const valor of [false, undefined, 'true', 1, null]) {
    chamadas.length = 0;
    const engine = novoEngine();
    engine.selfAnalyses = { [CHAVE]: { approvable: valor } };
    const r = await engine.mergeSelfPR(URL_PR);
    assert.equal(r.ok, false, `approvable=${JSON.stringify(valor)} não pode mergear`);
    assert.equal(mergeChamado().length, 0);
  }
});

/* ---------- gate 2: repo bloqueado ---------- */

test('repo na lista de bloqueados recusa e NÃO chama o gh', async () => {
  runImpl = roteador();
  const r = await novoEngine({ blocked: ['acme/app'] }).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /repo bloqueado/);
  assert.equal(mergeChamado().length, 0);
});

test('a lista de bloqueados não diferencia maiúscula de minúscula', async () => {
  runImpl = roteador();
  const r = await novoEngine({ blocked: ['ACME/App'] }).mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /repo bloqueado/);
});

test('NEM ADMIN mergeia repo bloqueado', async () => {
  // é a promessa mais forte do CLAUDE.md sobre o botão Merge: os modos auto e admin
  // passam pelos MESMOS gates, então nem admin fura a lista (ex.: biud-frontend)
  runImpl = roteador();
  for (const mode of ['admin', 'auto', 'normal']) {
    chamadas.length = 0;
    const r = await novoEngine({ blocked: ['acme/app'] }).mergeSelfPR(URL_PR, { mode });
    assert.equal(r.ok, false, `modo ${mode} não pode furar a lista`);
    assert.equal(mergeChamado().length, 0, `modo ${mode} não pode nem tentar`);
  }
});

test('o default de fábrica bloqueia o repo que o time não deixa self-mergear', async () => {
  const engine = new Engine();
  assert.ok((engine.config.mergeBlockedRepos || []).includes('biudtech/biud-frontend'));
});

/* ---------- gate 3: estado fresco do PR ---------- */

test('PR de outro autor recusa', async () => {
  runImpl = roteador({ view: prView({ author: { login: 'outra-pessoa' } }) });
  const r = await novoEngine().mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /não é o autor/);
  assert.equal(mergeChamado().length, 0);
});

test('PR fechado ou já mergeado recusa', async () => {
  for (const state of ['CLOSED', 'MERGED']) {
    chamadas.length = 0;
    runImpl = roteador({ view: prView({ state }) });
    const r = await novoEngine().mergeSelfPR(URL_PR);
    assert.equal(r.ok, false, `estado ${state}`);
    assert.match(r.error, /não está aberto/);
    assert.equal(mergeChamado().length, 0);
  }
});

test('rascunho recusa', async () => {
  runImpl = roteador({ view: prView({ isDraft: true }) });
  const r = await novoEngine().mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /rascunho/);
  assert.equal(mergeChamado().length, 0);
});

test('PR com conflito recusa', async () => {
  runImpl = roteador({ view: prView({ mergeable: 'CONFLICTING' }) });
  const r = await novoEngine().mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /conflito/);
  assert.equal(mergeChamado().length, 0);
});

test('gh pr view falhando aborta em vez de mergear no escuro', async () => {
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (sub.startsWith('pr view')) return Promise.resolve({ ok: false, stdout: '', stderr: 'rede caiu' });
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  const r = await novoEngine().mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'sem estado fresco, não mergeia');
});

/* ---------- gate 3 (G3): head não pode ter mudado desde a autoanálise ---------- */

test('mergeSelfPR: recusa quando o head atual difere do headSha da autoanálise', async () => {
  runImpl = roteador({ view: prView({ headRefOid: 'b'.repeat(40) }) });
  const engine = novoEngine();
  engine.selfAnalyses[CHAVE] = { approvable: true, headSha: 'a'.repeat(40) };
  const r = await engine.mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.match(r.error, /commit depois da sua análise/);
  assert.equal(mergeChamado().length, 0, 'divergência barra ANTES de qualquer pr merge');
});

test('mergeSelfPR: análise sem headSha registrado não bloqueia (comportamento atual preservado)', async () => {
  runImpl = roteador({ view: prView({ headRefOid: 'b'.repeat(40) }) });
  const engine = novoEngine();
  engine.selfAnalyses[CHAVE] = { approvable: true };
  const r = await engine.mergeSelfPR(URL_PR);
  assert.equal(r.ok, true);
  assert.equal(mergeChamado().length, 1);
});

/* ---------- caminho feliz e a proteção de branch ---------- */

test('caminho feliz: merge commit, e a branch descartável é deletada', async () => {
  runImpl = roteador();
  const r = await novoEngine().mergeSelfPR(URL_PR);
  assert.equal(r.ok, true);
  const args = mergeChamado()[0].args.join(' ');
  assert.match(args, /pr merge .* --merge/, 'merge commit, nunca squash nem rebase');
  assert.doesNotMatch(args, /--squash|--rebase/);
  assert.match(args, /--delete-branch/);
  assert.equal(r.deletedBranch, true);
});

test('branch PERMANENTE nunca é deletada', async () => {
  // deletar a develop num merge release->develop apagaria a branch do fluxo
  for (const branch of ['develop', 'main', 'master', 'release/1.2', 'hml', 'homolog', 'staging']) {
    chamadas.length = 0;
    runImpl = roteador({ view: prView({ headRefName: branch }) });
    const r = await novoEngine().mergeSelfPR(URL_PR);
    assert.equal(r.ok, true, `merge de ${branch} deve funcionar`);
    assert.doesNotMatch(mergeChamado()[0].args.join(' '), /--delete-branch/, `${branch} não pode ser deletada`);
    assert.equal(r.deletedBranch, false);
  }
});

test('modo auto pede --auto e não limpa nada (o GitHub mergeia depois)', async () => {
  runImpl = roteador();
  const engine = novoEngine();
  const r = await engine.mergeSelfPR(URL_PR, { mode: 'auto' });
  assert.equal(r.ok, true);
  assert.equal(r.auto, true);
  assert.match(mergeChamado()[0].args.join(' '), /--auto/);
  assert.equal(engine.myPRs.length, 1, 'o PR continua em Meus PRs até fechar de verdade');
  assert.ok(engine.selfAnalyses[CHAVE], 'a autoanálise continua');
});

test('modo admin pede --admin e limpa, porque mergeou agora', async () => {
  runImpl = roteador();
  const engine = novoEngine();
  const r = await engine.mergeSelfPR(URL_PR, { mode: 'admin' });
  assert.equal(r.ok, true);
  assert.equal(r.admin, true);
  assert.match(mergeChamado()[0].args.join(' '), /--admin/);
  assert.equal(engine.myPRs.length, 0, 'saiu de Meus PRs');
  assert.equal(engine.selfAnalyses[CHAVE], undefined, 'autoanálise limpa');
});

test('modo desconhecido cai em normal, não em admin', async () => {
  runImpl = roteador();
  const r = await novoEngine().mergeSelfPR(URL_PR, { mode: 'sudo' });
  assert.equal(r.ok, true);
  const args = mergeChamado()[0].args.join(' ');
  assert.doesNotMatch(args, /--admin|--auto/, 'modo inválido nunca escala privilégio');
});

/* ---------- falhas conhecidas do merge ---------- */

test('bloqueio por proteção de branch devolve blocked:policy (a UI oferece auto/admin)', async () => {
  runImpl = roteador({ mergeOk: false, mergeErr: 'Base branch policy prohibits the merge' });
  const r = await novoEngine().mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'policy');
});

test('auto-merge desligado no repo devolve blocked:autoUnavailable com saída acionável', async () => {
  runImpl = roteador({ mergeOk: false, mergeErr: 'Auto-merge is not allowed for this repository' });
  const r = await novoEngine().mergeSelfPR(URL_PR, { mode: 'auto' });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'autoUnavailable');
  assert.match(r.error, /Allow auto-merge/);
});

test('conta do PR sem token não mergeia, mesmo com token primário presente', async () => {
  const engine = novoEngine();
  engine.tokens = {}; // 'eu' perdeu o token no ciclo; engine.token (primário) segue setado
  runImpl = roteador();
  const r = await engine.mergeSelfPR(URL_PR);
  assert.equal(r.ok, false);
  assert.equal(mergeChamado().length, 0, 'o gate barra ANTES de qualquer pr merge');
});

test('ruleset devolve blocked:rule e marca o repo (admin não fura ruleset)', async () => {
  runImpl = roteador({ mergeOk: false, mergeErr: 'Repository rule violations found: Changes must be made through a pull request' });
  const engine = novoEngine();
  const r = await engine.mergeSelfPR(URL_PR, { mode: 'admin' });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'rule');
  assert.equal(engine.adminBlockedRepos['acme/app'], true, 'a UI para de oferecer admin nesse repo');
});

/* ---------- G19: guarda de merge em andamento (double-click) ---------- */

test('mergeSelfPR: segunda chamada concorrente da mesma key é recusada sem tocar o gh (G19)', async () => {
  let resolveMerge;
  let mergeCalls = 0;
  runImpl = (cmd, args) => {
    const sub = args.join(' ');
    if (sub.startsWith('pr view')) return Promise.resolve({ ok: true, stdout: prView(), stderr: '' });
    if (sub.startsWith('pr merge')) {
      mergeCalls++;
      return new Promise(resolve => { resolveMerge = resolve; }); // fica pendente de propósito
    }
    return Promise.resolve({ ok: true, stdout: '', stderr: '' });
  };
  const engine = novoEngine();

  const p1 = engine.mergeSelfPR(URL_PR); // dispara e fica pendurada no pr merge
  await new Promise(r => setImmediate(r)); // deixa a 1a chamada avançar até o merge pendente
  const chamadasAntes = chamadas.length;

  const r2 = await engine.mergeSelfPR(URL_PR);
  assert.equal(r2.ok, false);
  assert.equal(r2.error, 'merge já em andamento');
  assert.equal(chamadas.length, chamadasAntes, 'a segunda chamada não tocou o gh de novo');
  assert.equal(mergeCalls, 1, 'só a primeira chamada tentou o pr merge');

  resolveMerge({ ok: true, stdout: '', stderr: '' });
  const r1 = await p1;
  assert.equal(r1.ok, true, 'a primeira chamada segue e conclui normalmente');
});
