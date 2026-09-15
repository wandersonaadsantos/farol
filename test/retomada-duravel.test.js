// Retomada durável na Engine real (CT-RET, 7.A5 da spec
// docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md).
// FAROL_HOME temporário ANTES do import do server.js (const de nível de módulo) e
// import dinâmico, padrão de test/inflight-session-id.test.js. Sessão Claude nunca
// abre: runClaudeStream é stubado, e onde a fachada real precisa rodar (admissão da
// coordenação) o spawn do CLI é vigiado e recusado.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import childProcess from 'node:child_process';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-retomada-duravel-'));
process.env.FAROL_HOME = HOME;
delete process.env.FAROL_HEADLESS_CMD;

const spawnReal = childProcess.spawn;
let spawnsDoCli = 0;
childProcess.spawn = function spawnVigiado(cmd, args, opts) {
  if ((args || []).join(' ').includes('stream-json')) {
    spawnsDoCli++;
    throw new Error('spawn do CLI nesta suíte é defeito');
  }
  return spawnReal(cmd, args, opts);
};

import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
const { Engine } = await import('../server.js');
const fanout = (await import('../lib/engine/fanout.js')).default;
const retomada = await import('../lib/engine/retomada-duravel.js');
const { retomadaAposFalhaBlock } = await import('../lib/engine/review.js');

const prMetricsOriginal = fanout.prMetrics;
fanout.prMetrics = async () => null;

after(() => {
  childProcess.spawn = spawnReal;
  fanout.prMetrics = prMetricsOriginal;
  try { fs.rmSync(HOME, { recursive: true, force: true }); } catch { /* best-effort */ }
});

const INFLIGHT = path.join(HOME, 'workspace', 'state', 'inflight.json');
const HEAD = 'c0ffee1234ab';
const SID = 'abcd-1234-efgh';
const PR = {
  key: 'o/r#21', repo: 'o/r', number: 21, url: 'https://github.com/o/r/pull/21',
  requested: true, title: 'fix: algo', author: 'alguem'
};
const ENVELOPE = {
  analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision', cardMet: true,
  reasons: [], reportMarkdown: 'relatório', payloads: {}
};
const CONTEXTO = { provedor: 'dir', perfilId: '' };
const RESPOSTA = () => ({ text: JSON.stringify({ result: JSON.stringify(ENVELOPE) }), sessionId: 'sessao-nova-0001' });

beforeEach(() => {
  spawnsDoCli = 0;
  fs.mkdirSync(path.dirname(INFLIGHT), { recursive: true });
  fs.writeFileSync(INFLIGHT, '[]');
  // o estacionamento é persistido (G15): sem limpar, o PR estacionado por um teste
  // anterior chegaria estacionado na Engine nova do teste seguinte
  fs.rmSync(path.join(path.dirname(INFLIGHT), 'auto-review-parked.json'), { force: true });
});

function lerInflight() { return JSON.parse(fs.readFileSync(INFLIGHT, 'utf8')); }
function linha(key) { return lerInflight().find(i => i.key === key); }

// referência como a Engine deste teste a produziria: config sem claudeProfiles
// resolve { kind: 'dir', id: '' }
function semear(e, extra = {}) {
  return retomada.guardarRetomada(e, PR, { retomarSid: SID, knownHead: HEAD, ...CONTEXTO, sessionId: SID, headSha: HEAD, ...extra });
}

// Engine real com o mínimo stubado (mesmo recorte de test/retomada-apos-falha.test.js)
function motor() {
  const e = new Engine();
  e.log = () => { };
  e.accountForPr = () => 'trabalho';
  e.approvePolicyFor = () => 'wait';
  e.rejectPolicyFor = () => 'wait';
  e.scopeLabel = () => 'Conta Trabalho';
  e.writeMemory = () => { };
  e.headSha = async () => HEAD;
  e.myReviewsWithTime = async () => [];
  e.postReview = async () => ({ ok: true });
  e.chamadas = [];
  e.decididos = [];
  const decidirOriginal = e.recordDecision.bind(e);
  e.recordDecision = (pr, result, extra) => { e.decididos.push(result); return decidirOriginal(pr, result, extra); };
  e.runClaudeStream = async (prompt, opts) => {
    e.chamadas.push({
      prompt, extraArgs: [...(opts.extraArgs || [])], opcao: opts.resumeOutcome,
      registro: (e.activeReviews.get(opts.id) || {}).resumeOutcome, guardada: e.retomadas.has(PR.key),
    });
    return RESPOSTA();
  };
  return e;
}

/* ---------- Tarefa 2: persistência sem janela ---------- */

test('writeInflight grava execução, fila e pendente no formato exato', () => {
  const e = motor();
  semear(e);
  retomada.guardarRetomada(e, { key: 'o/r#22', url: 'u22', title: 't22', author: 'a' }, { retomarSid: 'sessao-fila-0022', knownHead: 'h22', ...CONTEXTO });
  e.headlessQueue.push({ key: 'o/r#22', url: 'u22', title: 't22', author: 'a' });
  e.activeReviews.set('a9', { mode: 'auto', pr: { key: 'o/r#23', url: 'u23', title: 't23', author: 'b' }, sessionId: 'sessao-exec-0023', headSha: 'h23' });
  e.writeInflight();
  const lista = lerInflight();
  for (const item of lista) assert.deepEqual(Object.keys(item), [...retomada.CAMPOS_INFLIGHT]);
  assert.equal(linha(PR.key).estado, 'pendente');
  assert.equal(linha(PR.key).retomarSid, SID);
  assert.equal(linha(PR.key).knownHead, HEAD);
  assert.equal(linha(PR.key).provedor, 'dir');
  assert.equal(linha('o/r#22').estado, 'fila');
  assert.equal(linha('o/r#22').retomarSid, 'sessao-fila-0022');
  assert.equal(linha('o/r#23').estado, 'execucao');
  assert.equal(linha('o/r#23').sessionId, 'sessao-exec-0023');
});

test('dois reinícios antes da retomada não perdem a referência', () => {
  const a = motor();
  semear(a);
  a.writeInflight();
  const b = new Engine();
  assert.equal(b.retomadas.get(PR.key).retomarSid, SID);
  assert.equal(linha(PR.key).estado, 'pendente', 'o boot regrava a referência em vez de esvaziar o arquivo');
  const c = new Engine();
  const entrada = c.retomadas.get(PR.key);
  assert.ok(entrada, 'o segundo reinício ainda encontra a referência');
  assert.equal(entrada.retomarSid, SID);
  assert.equal(entrada.knownHead, HEAD);
  assert.equal(entrada.provedor, 'dir');
  assert.equal(linha(PR.key).retomarSid, SID);
});

test('referência preservada enquanto espera vaga na fila, inclusive depois de reiniciar', () => {
  const a = motor();
  semear(a);
  a.processHeadless = () => { }; // conta sem vaga: o item fica na fila
  a.pushState = () => { };
  a.enqueueHeadless({ ...PR });
  assert.equal(a.headlessQueue.length, 1);
  assert.equal(a.headlessQueue[0].retomarSid, SID, 'o PR enfileirado carrega a referência');
  assert.equal(a.headlessQueue[0].knownHead, HEAD);
  assert.equal(a.retomadas.has(PR.key), true, 'enfileirar não consome');
  const item = linha(PR.key);
  assert.equal(item.estado, 'fila');
  assert.equal(item.retomarSid, SID);
  assert.equal(item.knownHead, HEAD);
  assert.equal(item.provedor, 'dir');
  const b = new Engine();
  assert.equal(b.retomadas.get(PR.key).retomarSid, SID, 'crash com o PR na fila não perde a referência');
});

test('boot com linha pendente não repete o aviso de revisão em andamento', () => {
  const a = motor();
  semear(a);
  a.writeInflight();
  const avisos = [];
  const b = new Engine();
  assert.deepEqual(b.inflightRecuperado, [], 'pendente não é revisão em andamento: nenhuma label a limpar');
  b.log = (nivel, msg) => avisos.push(`${nivel} ${msg}`);
  b.recoverInflight();
  assert.equal(avisos.some(t => /app reiniciado com revisão em andamento/.test(t)), false);
});

test('PR fechado enquanto aguardava o retry: a referência sai junto', async () => {
  const e = motor();
  semear(e);
  e.isMuted = () => false;
  e.tokens = { trabalho: 'tok' };
  e.budgetBlockedFor = () => false;
  e.prState = async () => 'CLOSED';
  e.retryAfterNet.set(PR.key, { tries: 1, pr: { ...PR }, notBefore: null });
  await e._repescarRetry([], new Set());
  assert.equal(e.retryAfterNet.has(PR.key), false);
  assert.equal(e.retomadas.has(PR.key), false);
});

/* ---------- Tarefa 3: a referência nasce durável e os desfechos a consomem ---------- */

test('o sid da sessão nova vai pro disco com head e contexto enquanto ela roda', async () => {
  const e = motor();
  let visto = null;
  e.runClaudeStream = async (prompt, opts) => {
    opts.onSession('sessao-viva-0001');
    visto = linha(PR.key);
    return RESPOSTA();
  };
  await e.runHeadlessReview({ ...PR });
  assert.ok(visto, 'linha gravada durante a sessão');
  assert.equal(visto.estado, 'execucao');
  assert.equal(visto.retomarSid, 'sessao-viva-0001');
  assert.equal(visto.sessionId, 'sessao-viva-0001');
  assert.equal(visto.knownHead, HEAD);
  assert.equal(visto.provedor, 'dir');
  assert.equal(visto.perfilId, '');
});

test('queda transitória: a referência vai pro disco com head e contexto e sobrevive ao reinício', async () => {
  const e = motor();
  e.prState = async () => 'OPEN';
  e.runClaudeStream = async () => { throw Object.assign(new Error('fetch failed'), { sessionId: SID }); };
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.ok(e.retryAfterNet.has(PR.key), 'falha de rede vira retry');
  const item = linha(PR.key);
  assert.equal(item.estado, 'pendente');
  assert.equal(item.retomarSid, SID);
  assert.equal(item.knownHead, HEAD);
  assert.equal(item.provedor, 'dir');
  assert.equal(item.perfilId, '');
  const b = new Engine();
  assert.equal(b.retomadas.get(PR.key).retomarSid, SID, 'o retry deixou de ser só memória');
});

test('orçamento estourado na boca da sessão: estaciona sem abrir sessão e sem consumir a retomada', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'OPEN';
  e.budgetBlockedFor = () => ({ id: 'p1', label: 'Perfil 1' });
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.chamadas.length, 0);
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.equal(e.retomadas.get(PR.key).retomarSid, SID);
  assert.equal(linha(PR.key).estado, 'pendente');
});

test('PR já mergeado na boca da sessão: a referência é consumida', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'MERGED';
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.chamadas.length, 0);
  assert.equal(e.retomadas.has(PR.key), false);
});

test('cancelada por você: a referência sai junto', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw Object.assign(new Error('cancelada por você'), { cancelled: true, sessionId: SID }); };
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.retomadas.has(PR.key), false);
});

test('falha permanente: a referência sai junto', async () => {
  const e = motor();
  semear(e);
  e.prState = async () => 'OPEN';
  e.runHeadlessReview = async () => { throw Object.assign(new Error('JSON da sessão fora do contrato'), { sessionId: SID }); };
  await e.runOneHeadless({ ...PR }, 'trabalho');
  assert.equal(e.autoReviewParked.has(PR.key), true);
  assert.equal(e.retomadas.has(PR.key), false);
});

/* ---------- Tarefa 4: validação antes de reutilizar ---------- */

function coordenado(e, admissao) {
  e.syncCoordenacaoAtiva = () => true;
  e.syncAdmit = async () => admissao;
  e.syncRegistrarEspera = () => { };
  delete e.runClaudeStream; // volta pra fachada real: admissão antes de qualquer provedor
}

test('retomada local válida depois de reiniciar: --resume com o bloco, e a referência é consumida pelo resultado', async () => {
  const a = motor();
  semear(a);
  a.writeInflight();
  const e = motor(); // reinício
  e.processHeadless = () => { };
  e.pushState = () => { };
  e.enqueueHeadless({ ...PR });
  const pr = e.headlessQueue.shift();
  await e.runHeadlessReview(pr);
  assert.equal(e.chamadas.length, 1);
  const args = e.chamadas[0].extraArgs;
  assert.equal(args[args.indexOf('--resume') + 1], SID);
  assert.ok(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()));
  assert.equal(e.retomadas.has(PR.key), false, 'sessão que devolveu resultado consome');
  assert.equal(lerInflight().some(i => i.key === PR.key), false);
});

test('HEAD alterado: sessão nova sem --resume e sem bloco, sem confirmação humana, referência consumida', async () => {
  const e = motor();
  semear(e, { knownHead: 'aaaaaaaaaaaa' });
  await e.runHeadlessReview({ ...PR, knownHead: 'aaaaaaaaaaaa' });
  assert.equal(e.chamadas.length, 1, 'a revisão segue sozinha pelas regras normais');
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), false, 'nenhuma prova herdada');
  assert.equal(e.chamadas[0].guardada, false, 'descartada antes de a sessão abrir');
  assert.equal(e.decididos.length, 1);
  assert.equal(e.autoReviewParked.has(PR.key), false);
});

for (const [nome, headSha] of [['vazio', async () => ''], ['exceção', async () => { throw new Error('gh fora do ar'); }]]) {
  test(`HEAD não confirmado (${nome}): o head salvo não vale como prova, nenhuma sessão abre e a referência espera`, async () => {
    const e = motor();
    semear(e);
    e.headSha = headSha;
    e.prState = async () => 'OPEN';
    await e.runOneHeadless({ ...PR, knownHead: HEAD }, 'trabalho');
    assert.equal(e.chamadas.length, 0, 'sem confirmação não injeta o bloco nem abre sessão');
    assert.equal(e.retomadas.get(PR.key).retomarSid, SID);
    const espera = e.retryAfterNet.get(PR.key);
    assert.ok(espera, 'revalida no próximo ciclo que funcionar');
    assert.equal(espera.tries, 0, 'aguardar confirmação não gasta tentativa');
    assert.equal(e.autoReviewParked.has(PR.key), false);
    assert.equal(linha(PR.key).estado, 'pendente');
  });
}

test('perfil diferente do que originou a sessão: não retoma, sessão nova sem bloco', async () => {
  const e = motor();
  e.config = { ...e.config, claudeProfiles: [{ id: 'p2', label: 'P2', kind: 'dir', dir: path.join(HOME, 'cfg-p2') }], claudeProfileId: 'p2' };
  semear(e); // originada no perfil legado ('')
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas.length, 1);
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), false);
  assert.equal(e.chamadas[0].guardada, false);
});

test('provedor diferente do que originou a sessão: não retoma', async () => {
  const e = motor();
  semear(e, { provedor: 'apikey', perfilId: '' });
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].guardada, false);
});

test('contexto local ausente (inflight legado sem provedor): não retoma', async () => {
  fs.writeFileSync(INFLIGHT, JSON.stringify([{ key: PR.key, url: PR.url, title: PR.title, sessionId: SID, headSha: HEAD }]));
  const e = motor();
  assert.equal(e.retomadas.get(PR.key).provedor, '');
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].prompt.includes(retomadaAposFalhaBlock()), false);
});

test('revisão equivalente já concluída depois da queda: não retoma', async () => {
  const e = motor();
  semear(e);
  e.retomadas.get(PR.key).atualizadoEm = new Date(Date.now() - 60000).toISOString();
  e.decisions.resolved.unshift({ key: PR.key, headSha: HEAD, createdAt: Date.now(), status: 'already_reviewed' });
  await e.runHeadlessReview({ ...PR });
  assert.equal(e.chamadas[0].extraArgs.includes('--resume'), false);
  assert.equal(e.chamadas[0].guardada, false);
});

test('recibo de outro aparelho na admissão: consome a referência sem abrir sessão', async () => {
  const e = motor();
  semear(e);
  coordenado(e, { admitted: false, reason: 'recibo', detail: { deviceName: 'notebook' } });
  await e.runHeadlessReview({ ...PR });
  assert.equal(spawnsDoCli, 0);
  assert.equal(e.decididos.length, 0);
  assert.equal(e.retomadas.has(PR.key), false);
});

for (const reason of ['alheio', 'indisponivel']) {
  test(`recusa da coordenação (${reason}) antes do provedor: sem sessão e sem consumir a retomada`, async () => {
    const e = motor();
    semear(e);
    coordenado(e, { admitted: false, reason, detail: { deviceName: 'notebook' } });
    await e.runHeadlessReview({ ...PR });
    assert.equal(spawnsDoCli, 0, 'nenhum spawn do CLI');
    assert.equal(e.decididos.length, 0);
    assert.equal(e.retomadas.get(PR.key).retomarSid, SID);
    assert.equal(linha(PR.key).estado, 'pendente', 'espera de lease sobrevive a reinício');
    const b = new Engine();
    assert.equal(b.retomadas.get(PR.key).retomarSid, SID);
  });
}
