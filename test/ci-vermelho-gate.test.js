// Check OBRIGATÓRIO vermelho no head nunca sai como APPROVE sozinho, em nenhuma
// política. Caso medido (biudtech/biud-frontend#896, 02/09/2026): a sessão devolveu
// needs_decision e escreveu no relatório que o merge estava travado pelo ruleset, e a
// política de "aprovável com ressalvas" aprovou por cima, porque a regra de CI só
// existia no prompt. Três minutos depois o PR foi mergeado por bypass de admin com o
// `audit` vermelho. O gate mora em shouldAutoApprove, no mesmo padrão de coverageGap e
// checkpointGap: PURO, só olha `result.checksObrigatorios`, que runHeadlessReview
// preenche com o `faltando` do bloqueadoPorChecks antes de chamar o gate.
//
// 30/09/2026: o gate continua NÃO aprovando com CI vermelho ou em andamento, mas o motivo
// deixou de mandar o card para a mesa. É espera automática (lib/engine/espera-ci.js, com a
// volta sozinha travada em test/espera-ci.test.js). A política da conta vem ANTES: conta que
// manda esperar você não espera CI nenhum. E dependência em aberto saiu daqui: é ressalva.
import os from 'node:os';
import path from 'node:path';
process.env.FAROL_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-ci-vermelho-'));

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const { Engine } = await import('../server.js');
const { checksVermelhos } = await import('../lib/engine/decision.js');

after(() => { try { fs.rmSync(process.env.FAROL_HOME, { recursive: true, force: true }); } catch { } });

const PR = { key: 'o/r#1', repo: 'o/r', number: 1, url: 'https://github.com/o/r/pull/1', requested: true };

function approvableResult(extra) {
  return {
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'approve', decision: 'auto_approve', cardMet: true, reasons: [],
    payloads: { approve: { event: 'APPROVE', body: 'ok' } },
    ...extra
  };
}

function engineWithPolicy(policy) {
  const e = new Engine();
  e.config.autoApproveAll = true;
  e.config.accounts = [];
  // a espera do CI é opt-in desde 02/10/2026: estes casos testam a chave LIGADA
  e.config.aguardarCiParaAprovar = true;
  e.approvePolicyFor = () => policy;
  e.rejectPolicyFor = () => 'request_changes';
  e.accountForPr = () => 'alguem';
  return e;
}

// 30/09/2026: a política da conta é a ÚNICA coisa que decide entre postar e esperar você, e
// ela responde por CLASSE (limpo = nenhum ponto de atenção; com ressalvas = um ou mais).
function enginePorClasse(limpo, comRessalvas) {
  const e = engineWithPolicy('approve');
  e.approvePolicyFor = (_conta, semPontos) => (semPontos ? limpo : comRessalvas);
  return e;
}

test('checksVermelhos: só o estado vermelho conta; rodando e ausente não provam reprovação', () => {
  assert.deepEqual(checksVermelhos({}), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: null }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [] }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [{ nome: 'lint', estado: 'rodando' }, { nome: 'build', estado: 'ausente' }] }), []);
  assert.deepEqual(checksVermelhos({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }, { nome: 'test', estado: 'rodando' }] }), ['audit']);
});

test('obrigatório vermelho segura o APPROVE mesmo com a política de ressalvas aprovando', () => {
  const e = engineWithPolicy('approve');
  // é o envelope real do #896: verdict approve, needs_decision, ressalvas, e audit vermelho
  const r = approvableResult({
    decision: 'needs_decision', cardMet: null,
    reasons: [{ text: 'audit obrigatório em FAILURE', kind: 'content' }],
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }],
  });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'ci_vermelho' });
});

test('obrigatório vermelho segura também o PR limpo (decision auto_approve, sem ressalva)', () => {
  const e = engineWithPolicy('approve');
  const r = approvableResult({ checksObrigatorios: [{ nome: 'build', estado: 'vermelho' }] });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'ci_vermelho' });
});

// 27/09/2026, decisão do dono sobre a auditoria de qualidade: CI ainda rodando (ou que nem
// começou) e dependência em aberto passavam como ressalva, e o APPROVE saía assinado por
// ele enquanto o próprio relatório pedia espera (biud-frontend#1187 com CI em andamento,
// engine-ai#266 com infra-k8s#189 ainda aberto). Até aqui este teste afirmava o contrário.
test('check ainda rodando ou que nem começou segura a aprovação automática, com motivo de ESPERA (não de mesa)', () => {
  const e = engineWithPolicy('approve');
  const rodando = approvableResult({ checksObrigatorios: [{ nome: 'test', estado: 'rodando' }] });
  assert.deepEqual(e.shouldAutoApprove(PR, rodando), { ok: false, motivo: 'ci_em_andamento' });
  const ausente = approvableResult({ checksObrigatorios: [{ nome: 'e2e', estado: 'ausente' }] });
  assert.deepEqual(e.shouldAutoApprove(PR, ausente), { ok: false, motivo: 'ci_em_andamento' });
  const misto = approvableResult({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }, { nome: 'test', estado: 'rodando' }] });
  assert.deepEqual(e.shouldAutoApprove(PR, misto), { ok: false, motivo: 'ci_vermelho' }, 'vermelho é o motivo mais forte');
});

// De 27 a 30/09/2026 a dependência em aberto devolvia { ok: false, motivo: 'dependencia' } em
// qualquer política. Agora é ressalva com o texto da dependência, e a política decide.
test('dependência em aberto declarada pela revisão é ressalva: a política da conta decide', () => {
  const r = approvableResult({ dependenciasAbertas: ['biudtech/infra-k8s#189 ainda aberto'] });
  assert.deepEqual(enginePorClasse('approve', 'approve').shouldAutoApprove(PR, r), { ok: true, motivo: null });
  assert.deepEqual(enginePorClasse('approve', 'wait').shouldAutoApprove(PR, r), { ok: false, motivo: 'politica' });
  const pts = enginePorClasse('approve', 'wait').attentionPoints(r);
  assert.equal(pts.length, 1);
  assert.match(pts[0].text, /depende de algo que estava em aberto na leitura: biudtech\/infra-k8s#189 ainda aberto/);
  const e = enginePorClasse('approve', 'wait');
  assert.equal(e.shouldAutoApprove(PR, approvableResult({ dependenciasAbertas: [] })).ok, true, 'lista vazia é limpo');
  assert.equal(e.shouldAutoApprove(PR, approvableResult({ dependenciasAbertas: ['', '   ', 7] })).ok, true, 'item vazio ou torto não conta');
});

test('o card diz que está esperando o CI e que a aprovação sai sozinha, com o nome do check', async () => {
  const { textoDaEspera, motivoDeEspera, avisoDoCi } = await import('../lib/engine/gate-espera.js');
  const andando = textoDaEspera('ci_em_andamento', { checksObrigatorios: [{ nome: 'test', estado: 'rodando' }, { nome: 'e2e', estado: 'ausente' }] });
  assert.match(andando, /test.*e2e.*esperando o CI e sai sozinha quando a pipe fechar verde neste commit/);
  const vermelho = textoDaEspera('ci_vermelho', { checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] });
  assert.match(vermelho, /check obrigatório vermelho no head \(audit\)/);
  assert.match(vermelho, /sai sozinha quando ele ficar verde neste commit; com CI reprovando ela nunca sai/);
  for (const t of [andando, vermelho]) assert.doesNotMatch(t, /aprove quando|não sai sozinha/, 'o texto não pede mais o clique');
  assert.equal(textoDaEspera('politica', {}), '', 'motivo que não é de espera não tem texto aqui');
  assert.equal(textoDaEspera('dependencia', { dependenciasAbertas: ['x'] }), '', 'dependência deixou de ser espera');
  assert.equal(motivoDeEspera({ dependenciasAbertas: ['x'] }), null);
  assert.deepEqual(avisoDoCi({ checksObrigatorios: [] }), []);
  assert.deepEqual(avisoDoCi({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] }), [{ text: 'check obrigatório vermelho no head (audit)', kind: 'gate' }]);
});

test('campo ausente (leitura que falhou, repo sem exigência) não inventa CI vermelho', () => {
  const e = engineWithPolicy('approve');
  assert.equal(e.shouldAutoApprove(PR, approvableResult()).ok, true);
  assert.equal(e.shouldAutoApprove(PR, approvableResult({ checksObrigatorios: [] })).ok, true);
});

// Até 30/09/2026 o CI vinha ANTES da política e este caso devolvia ci_vermelho. Agora a
// política vem primeiro: conta que manda esperar você vai para a mesa com o motivo da
// política (e o aviso do CI no card), sem espera automática que não daria em aprovação.
test('a política vem antes do CI: conta em wait vai para a mesa pela política, não entra em espera do CI', () => {
  const e = engineWithPolicy('wait');
  const r = approvableResult({ checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }] });
  assert.deepEqual(e.shouldAutoApprove(PR, r), { ok: false, motivo: 'politica' });
});

test('CI vermelho nunca vira ok, em nenhuma combinação de política e classe', () => {
  const vermelho = [{ nome: 'audit', estado: 'vermelho' }];
  const casos = [approvableResult({ checksObrigatorios: vermelho }), approvableResult({ checksObrigatorios: vermelho, reasons: ['ressalva'] })];
  for (const r of casos) {
    for (const [limpo, ressalvas] of [['approve', 'approve'], ['approve', 'wait'], ['wait', 'approve'], ['wait', 'wait']]) {
      assert.equal(enginePorClasse(limpo, ressalvas).shouldAutoApprove(PR, r).ok, false);
    }
  }
});

test('reprovar sozinho não é afetado: CI vermelho não impede REQUEST_CHANGES', () => {
  const e = engineWithPolicy('approve');
  const r = {
    analysisStatus: 'complete', coverage: { total: 1, reviewed: ['a.ts'], missing: [] }, alcance: [{ alterado: 'a.ts', chamadores: [], semChamador: 'fixture sintética sem consumidor' }], verdict: 'request_changes', decision: 'needs_decision', reasons: [],
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'bloqueio real' } },
    checksObrigatorios: [{ nome: 'audit', estado: 'vermelho' }],
  };
  assert.equal(e.shouldAutoReject(PR, r), true);
});
