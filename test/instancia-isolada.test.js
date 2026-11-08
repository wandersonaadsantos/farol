// Instância isolada (FAROL_HOME fora do ~/.farol) não escreve no GitHub sem opt-in por arquivo.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-instancia-isolada-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const { recusaDeIsolada } = await import('../lib/engine/instancia-isolada.js');
const { rearmarPostagensRecusadas } = await import('../lib/engine/postagem-recusada.js');

const RAIZ = path.join(import.meta.dirname, '..');
// URL file:// para os imports dos processos filhos: no Windows o ESM recusa caminho absoluto cru
const RAIZ_URL = pathToFileURL(RAIZ).href;
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-isolada-filhos-'));
after(() => {
  fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true });
  fs.rmSync(BASE, { recursive: true, force: true });
});

// ambiente de um processo FORA do executor de testes (senão a instância nunca é isolada)
function envLimpo(extra) {
  const env = { ...process.env, ...extra };
  delete env.NODE_TEST_CONTEXT;
  return env;
}

test('isolada e sem opt-in recusa, com o motivo dito', () => {
  const r = recusaDeIsolada({ config: {} }, 'postar review', { isolada: true });
  assert.equal(r.blocked, 'instancia_isolada');
  assert.match(r.error, /instanciaIsoladaPosta/);
});

test('opt-in por arquivo libera; instância normal não recusa', () => {
  assert.equal(recusaDeIsolada({ config: { instanciaIsoladaPosta: true } }, 'postar review', { isolada: true }), null);
  assert.equal(recusaDeIsolada({ config: {} }, 'postar review', { isolada: false }), null);
});

test('postReview em isolada não chama gh', () => {
  const home = fs.mkdtempSync(path.join(BASE, 'home-'));
  const script = `
    const io = (await import('${RAIZ_URL}/lib/io.js')).default;
    const chamadas = [];
    io.run = async (...a) => { chamadas.push(a); return { ok: true, code: 0, stdout: '', stderr: '' }; };
    io.runShell = io.run;
    const { postReview } = await import('${RAIZ_URL}/lib/engine/decision.js');
    const logs = [];
    const engine = { config: {}, log: (n, m) => logs.push(n + ' ' + m), accountForPr: () => 'eu', ghEnv: () => ({}), tokenFor: () => 'tok', emit() {}, activeReviews: new Map() };
    const pr = { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7', repo: 'acme/app', number: 7 };
    const r = await postReview(engine, pr, { event: 'COMMENT', body: 'oi' });
    console.log(JSON.stringify({ blocked: r && r.blocked, chamadas: chamadas.length }));
  `;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: envLimpo({ FAROL_HOME: home }), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(saida.trim().split('\n').pop()), { blocked: 'instancia_isolada', chamadas: 0 });
});

// Roda `corpo` num processo filho isolado, com todo `gh` contado e respondendo ok. `corpo` devolve
// o que o caso quer conferir; volta { r, chamadas, cancelados }.
function rodarIsolada(corpo) {
  const home = fs.mkdtempSync(path.join(BASE, 'home-'));
  const script = `
    const io = (await import('${RAIZ_URL}/lib/io.js')).default;
    const chamadas = [], cancelados = [];
    io.run = async (...a) => { chamadas.push(a); return { ok: true, code: 0, stdout: '{"labels":[{"name":"eu:revisando"}]}', stderr: '' }; };
    io.runShell = io.run;
    const engine = {
      config: { accounts: [{ user: 'eu', owners: ['acme'] }] }, token: 'tok', myPRs: [], queue: [], panorama: [],
      activeReviews: new Map([['s1', { id: 's1', mode: 'auto', keys: ['acme/app#7'] }]]),
      log() {}, emit() {}, pushState() {}, ghEnv: () => ({}), tokenFor: () => 'tok', refreshTokens: async () => {},
      accountForPr: () => 'eu', accountForOwner: () => 'eu', accountList() { return this.config.accounts; },
      reviewersForRepo: () => ['ana'], cancelSession: (id) => { cancelados.push(id); return { ok: true }; },
    };
    const r = await (async () => { ${corpo} })();
    console.log(JSON.stringify({ r, chamadas: chamadas.length, cancelados }));
  `;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: envLimpo({ FAROL_HOME: home }), encoding: 'utf8' });
  return JSON.parse(saida.trim().split('\n').pop());
}

test('gcSignals em isolada não apaga ref no GitHub', () => {
  const r = rodarIsolada(`
    const { gcSignals } = await import('${RAIZ_URL}/lib/engine/review-signal.js');
    await gcSignals(engine, 'acme/app', 'eu', [{ ref: 'refs/farol/revisando/7/ana/1', number: 7, login: 'ana', epochMs: 1 }], Date.now());
  `);
  assert.equal(r.chamadas, 0);
});

test('addInProgressLabel em isolada não chama gh nem devolve label', () => {
  const r = rodarIsolada(`
    const { addInProgressLabel } = await import('${RAIZ_URL}/lib/engine/review.js');
    return await addInProgressLabel(engine, { key: 'acme/app#7', url: 'https://github.com/acme/app/pull/7' });
  `);
  assert.deepEqual({ r: r.r, chamadas: r.chamadas }, { r: '', chamadas: 0 });
});

test('setReviewers em isolada recusa com instancia_isolada, sem gh', () => {
  const r = rodarIsolada(`
    const { setReviewers } = await import('${RAIZ_URL}/lib/engine/selfpr.js');
    return await setReviewers(engine, 'https://github.com/acme/app/pull/7');
  `);
  assert.equal(r.r.blocked, 'instancia_isolada');
  assert.equal(r.r.ok, false);
  assert.equal(r.chamadas, 0);
});

test('executarMerge em isolada recusa com instancia_isolada, sem gh', () => {
  const r = rodarIsolada(`
    const { executarMerge } = await import('${RAIZ_URL}/lib/engine/self-merge.js');
    return await executarMerge(engine, { url: 'https://github.com/acme/app/pull/7', key: 'acme/app#7', repo: 'acme/app', acc: 'eu', me: 'eu', env: {}, analysis: {}, mode: 'squash' }, {});
  `);
  assert.equal(r.r.blocked, 'instancia_isolada');
  assert.equal(r.r.ok, false);
  assert.equal(r.chamadas, 0);
});

test('remover a label pela tela em isolada recusa antes de cancelar a sessão', () => {
  const r = rodarIsolada(`
    const { command } = await import('${RAIZ_URL}/lib/engine/review-label-control.js');
    return await command(engine, { url: 'https://github.com/acme/app/pull/7', action: 'remove', label: 'eu:revisando' });
  `);
  assert.equal(r.r.ok, false);
  assert.equal(r.r.blocked, 'instancia_isolada');
  assert.match(r.r.error, /instanciaIsoladaPosta/);
  assert.deepEqual(r.cancelados, [], 'nenhuma sessão é cancelada por uma remoção que não vai acontecer');
  assert.equal(r.chamadas, 0);
});

test('FAROL_HOME igual ao ~/.farol (com barra final) não é isolada', () => {
  const script = `const p = await import('${RAIZ_URL}/lib/paths.js'); console.log(String(p.instanciaIsolada));`;
  const home = `${os.homedir()}/.farol/`;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: envLimpo({ FAROL_HOME: home }), encoding: 'utf8' });
  assert.equal(saida.trim(), 'false');
});

// 08/11/2026: a Hostinger usa pasta própria e atualização administrada por fora; a trava recusava
// toda postagem dela (18 das 30 últimas revisões) e o PR caía na mesa com a conta decidindo sozinha.
test('FAROL_HOME próprio com atualização administrada por fora é hospedagem, não instância isolada', () => {
  const script = `const p = await import('${RAIZ_URL}/lib/paths.js'); console.log(String(p.instanciaIsolada));`;
  const rodar = (extra) => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: envLimpo({ FAROL_HOME: path.join(BASE, 'hospedada'), ...extra }), encoding: 'utf8' }).trim();
  assert.equal(rodar({ FAROL_UPDATE_MANAGER: 'external' }), 'false');
  assert.equal(rodar({ FAROL_UPDATE_MANAGER: '' }), 'true', 'sem o sinal, continua sendo instância de teste');
  assert.equal(rodar({ FAROL_UPDATE_MANAGER: 'outra-coisa' }), 'true');
});

const HEAD_REV = 'a'.repeat(40);
const recusada = (evento) => ({ text: `falha ao postar o ${evento}: instância isolada (FAROL_HOME fora de ~/.farol) não posta review no GitHub; para permitir, grave "instanciaIsoladaPosta": true no config.json`, kind: 'infra' });
const pendente = (evento, extra = {}) => ({ id: `d-${evento}`, key: 'o/r#1', headSha: HEAD_REV, pr: { url: 'u' }, verdict: 'approve', reasons: [recusada(evento)],
  payloads: { approve: { event: 'APPROVE', body: 'a' }, request_changes: { event: 'REQUEST_CHANGES', body: 'r' }, comment: { event: 'COMMENT', body: 'c' } }, ...extra });
function comPendentes(pending, { config = {}, aprova = 'approve', reprova = 'request_changes', hist = { head: HEAD_REV, decidido: false } } = {}) {
  const e = { config, decisions: { pending }, gravou: 0, historico: [], eventos: [],
    saveDecisions() { this.gravou += 1; }, accountForPr: () => 'eu', approvePolicyFor: () => aprova, rejectPolicyFor: () => reprova,
    bloqueadoPorHistorico: async () => hist, resolveIntoHistory(x) { this.historico.push(x); }, emit() { } };
  return e;
}
test('a postagem recusada volta ao reenvio pelo evento que foi recusado, não pelo veredito', async () => {
  const e = comPendentes([pendente('REQUEST_CHANGES'), pendente('APPROVE'), pendente('COMMENT')]);
  assert.equal(await rearmarPostagensRecusadas(e, { isolada: false }), 3);
  assert.deepEqual(e.decisions.pending.map((d) => d.postRetry.event), ['request_changes', 'approve', 'comment']);
  assert.equal(e.gravou, 1);
  assert.equal(await rearmarPostagensRecusadas(e, { isolada: false }), 0, 'não rearma o que já está no reenvio');
});
test('a trava ativa não rearma, e o opt-in por arquivo libera', async () => {
  const presa = comPendentes([pendente('APPROVE')]);
  assert.equal(await rearmarPostagensRecusadas(presa, { isolada: true }), 0);
  assert.equal(presa.decisions.pending[0].postRetry, undefined);
  assert.equal(await rearmarPostagensRecusadas(comPendentes([pendente('APPROVE')], { config: { instanciaIsoladaPosta: true } }), { isolada: true }), 1);
});
test('não rearma recusa de outro motivo, sem payload, em espera ou com bloqueio próprio', async () => {
  const e = comPendentes([
    pendente('APPROVE', { reasons: [{ text: 'a política manda aguardar', kind: 'gate' }] }),
    pendente('APPROVE', { reasons: [{ ...recusada('APPROVE'), kind: 'content' }] }),
    pendente('APPROVE', { payloads: {} }),
    pendente('APPROVE', { blockedReason: 'credencial no texto' }),
    pendente('APPROVE', { esperaProva: { tentativas: 1 } }),
    pendente('APPROVE', { esperaCi: { checks: [] } }),
  ]);
  assert.equal(await rearmarPostagensRecusadas(e, { isolada: false }), 0);
  assert.equal(e.decisions.pending.every((d) => !d.postRetry), true);
});
test('a conta que passou a esperar você segura o que ficou preso', async () => {
  assert.equal(await rearmarPostagensRecusadas(comPendentes([pendente('APPROVE')], { aprova: 'wait' }), { isolada: false }), 0);
  assert.equal(await rearmarPostagensRecusadas(comPendentes([pendente('REQUEST_CHANGES')], { reprova: 'wait' }), { isolada: false }), 0);
});
test('sem confirmar o commit, o próximo ciclo decide', async () => {
  for (const hist of [null, { head: 'b'.repeat(40), decidido: false }]) {
    const e = comPendentes([pendente('APPROVE')], { hist });
    assert.equal(await rearmarPostagensRecusadas(e, { isolada: false }), 0);
    assert.equal(e.decisions.pending.length, 1);
  }
});
test('gente decidiu o mesmo commit: dispensa sem postar e sai da mesa', async () => {
  const e = comPendentes([pendente('APPROVE')], { hist: { head: HEAD_REV, decidido: true, quem: ['ana'] } });
  assert.equal(await rearmarPostagensRecusadas(e, { isolada: false }), 0);
  assert.equal(e.decisions.pending.length, 0);
  assert.equal(e.historico[0].status, 'approval_not_needed');
  assert.match(e.historico[0].reasons[0].text, /@ana/);
  assert.equal(e.historico[0].reasons.some((r) => r.kind === 'infra'), false);
});

function portaLivre() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function pegar(porta, rota) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${porta}${rota}`, { headers: { 'x-farol': '1' } }, (res) => {
      let corpo = '';
      res.on('data', (d) => { corpo += d; });
      res.on('end', () => resolve(JSON.parse(corpo)));
    }).on('error', reject);
  });
}

test('servidor filho com FAROL_HOME temporário expõe doctor.instanciaIsolada=true', { skip: process.platform === 'win32', timeout: 60000 }, async () => {
  const home = fs.mkdtempSync(path.join(BASE, 'srv-'));
  const porta = await portaLivre();
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ port: porta, autoReview: false }));
  const filho = spawn(process.execPath, [path.join(RAIZ, 'server.js')], { env: envLimpo({ FAROL_HOME: home }), stdio: ['pipe', 'pipe', 'pipe'] });
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  try {
    const inicio = Date.now();
    while (!saida.includes('monitorando')) {
      if (Date.now() - inicio > 30000) throw new Error(`o motor não subiu: ${saida}`);
      if (filho.exitCode !== null) throw new Error(`o motor saiu antes de subir: ${saida}`);
      await new Promise(r => setTimeout(r, 50));
    }
    const doctor = await pegar(porta, '/api/doctor');
    assert.equal(doctor.instanciaIsolada, true);
  } finally {
    filho.kill('SIGKILL');
  }
});
