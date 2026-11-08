// Critério do card só na parte deste PR, e dependência aberta como ressalva (17/10/2026).
//
// Decisão do dono: "critério do card só na parte deste PR e dependência aberta viram
// ressalva; CI vermelho, violação técnica e lacuna de leitura seguem bloqueando."
// Medido no admin: card BIUD costuma ser multi-repo (waba#52 provado no código,
// messaging-api#349 e tenant-company#186/#187 ainda abertos). Com o card inteiro e a
// dependência aberta como lacuna obrigatória (PR #244, v2.72.2), um PR irmão esperava o
// outro e nenhum era aprovado sozinho. Aqui fica travado o desenho novo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-card-parte-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { TOOL } = await import('../lib/technical-review/verdict.js');
const { approvalGaps } = await import('../lib/technical-review/evidence.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { shouldAutoApprove, textoDaRecusa } = await import('../lib/engine/approval-policy.js');
const { acaoAoAprovar } = await import('../lib/engine/contas-config.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
const GAP_DA_PARTE = 'a parte do card que cabe a este PR não foi comprovada';
function report(extra = {}) {
  return { schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: 'org/repo',
    base: 'b'.repeat(40), head, profile: 'profile', catalogFingerprint: 'catalog',
    humanReviewFingerprint: 'human', verdict: 'pass', rules: [{ rule: 'core.file.single-responsibility', verdict: 'pass' }], findings: [], ...extra };
}
// o caso medido: card lido, a parte deste PR provada, o card inteiro não, irmãos abertos
function multiRepo(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'needs_decision',
    card: 'CARD-1', cardMet: null, cardParteDestePr: true,
    dependenciasAbertas: ['biudtech/biud-messaging-api#349 ainda aberto', 'biudtech/tenant-company#186 ainda aberto'],
    headSha: head, checksVerifiedHead: head, checksObrigatorios: [], technicalReview: report(), reasons: [],
    diffMedido: ['a.md'], coverage: { total: 1, reviewed: ['a.md'], missing: [] },
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' },
    payloads: { approve: { event: 'APPROVE', body: 'O comportamento foi conferido.' } }, ...extra };
}
// A política vem da conta gravada por extenso e é lida pela função real do motor (acaoAoAprovar,
// contas-config.js); só a lista de contas e o resto do engine são mínimos, porque aqui a unidade
// é o shouldAutoApprove e não o Engine.
function engineCom(onCaveats) {
  const e = { accountForPr: () => 'reviewer', attentionPoints: (r) => attentionPoints(null, r),
    accountList: () => [{ user: 'reviewer', onClean: 'approve', onCaveats }] };
  e.approvePolicyFor = (user, limpo) => acaoAoAprovar(e, user, limpo);
  return e;
}
const PEDIDO = { requested: true };

test('card inteiro não provado e dependência aberta não são lacuna obrigatória quando a parte deste PR está provada', () => {
  assert.deepEqual(approvalGaps(multiRepo()), []);
  assert.deepEqual(approvalGaps(multiRepo({ cardMet: false })), []);
});

test('parte deste PR sem declaração (null ou ausente) não bloqueia', () => {
  assert.deepEqual(approvalGaps(multiRepo({ cardParteDestePr: null })), []);
  const semCampo = multiRepo();
  delete semCampo.cardParteDestePr;
  assert.deepEqual(approvalGaps(semCampo), []);
});

test('card ilegível no Jira (cardMet false forçado pelo app, sem card) segue ressalva, não lacuna', () => {
  const r = multiRepo({ card: undefined, cardMet: false, cardParteDestePr: null, dependenciasAbertas: [] });
  assert.deepEqual(approvalGaps(r), []);
  assert.ok(attentionPoints(null, r).some((p) => /card não foi totalmente comprovado/.test(p.text)));
});

test('a sessão dizendo que a parte DESTE PR não foi entregue bloqueia o APPROVE', () => {
  const r = multiRepo({ cardParteDestePr: false });
  assert.deepEqual(approvalGaps(r), [GAP_DA_PARTE]);
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, r).motivo, 'prova_tecnica_incompleta');
  assert.deepEqual(approvalGaps(multiRepo({ cardParteDestePr: 'false' })), [], 'só o booleano falso bloqueia, como o cardMet');
});

test('as ressalvas nomeiam o card e a dependência', () => {
  const textos = attentionPoints(null, multiRepo()).map((p) => p.text);
  assert.ok(textos.some((t) => /parte deste PR no card foi comprovada/.test(t)), textos.join(' | '));
  assert.ok(textos.some((t) => /biud-messaging-api#349 ainda aberto/.test(t)), textos.join(' | '));
  const semParte = attentionPoints(null, multiRepo({ cardMet: false })).map((p) => p.text);
  assert.ok(semParte.some((t) => /card não foi totalmente comprovado/.test(t)), semParte.join(' | '));
  assert.equal(attentionPoints(null, multiRepo({ cardMet: true, dependenciasAbertas: [], decision: 'auto_approve' })).length, 0, 'card provado e nada aberto é limpo');
});

test('a política de ressalvas da conta decide: aprova sozinho com "aprovar", espera com "esperar"', () => {
  assert.deepEqual(shouldAutoApprove(engineCom('approve'), PEDIDO, multiRepo()), { ok: true, motivo: null });
  assert.deepEqual(shouldAutoApprove(engineCom('wait'), PEDIDO, multiRepo()), { ok: false, motivo: 'politica' });
});

test('CI vermelho e violação técnica continuam bloqueando o mesmo caso multi-repo', () => {
  const ci = multiRepo({ checksObrigatorios: [{ nome: 'test', estado: 'vermelho' }] });
  // o CI só bloqueia com "CI obrigatório antes da aprovação" ligado (06/11/2026); desligado, a política decide
  assert.equal(shouldAutoApprove({ ...engineCom('approve'), config: { aguardarCiParaAprovar: true } }, PEDIDO, ci).motivo, 'ci_vermelho');
  assert.deepEqual(shouldAutoApprove(engineCom('approve'), PEDIDO, ci), { ok: true, motivo: null });
  const violacao = multiRepo({ technicalReview: report({ verdict: 'fail', findings: [{ file: 'a.ts', message: 'regra duplicada' }] }) });
  assert.ok(approvalGaps(violacao).includes('violação técnica confirmada'));
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, violacao).motivo, 'prova_tecnica_incompleta');
  const leitura = multiRepo({ coverage: { total: 1, reviewed: [], missing: ['a.md'] } });
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, leitura).motivo, 'prova_tecnica_incompleta');
});

// Arquivo de ambiente e caminho protegido (08/11/2026, ordem do dono: "se eu deixei pra aprovar
// sozinho ele deve aprovar sozinho"): o que a revisão não leu vira ressalva, nunca mesa, seja
// quem for o autor; a política de ressalvas da conta decide. Supera as regras de 03 e 06/11/2026.
function comAmbiente(hiddenValues) {
  return multiRepo({ inventarioDiff: { status: 'complete', reason: '', headSha: head, baseSha: 'b'.repeat(40), changedFiles: 1,
    files: [{ path: 'a.md', representation: { kind: 'env-changes', hiddenValues, redactions: [] } }] } });
}
function engineComPapel(papel, onCaveats = 'approve') {
  return { ...engineCom(onCaveats), config: { people: papel ? { 'ana-dev': { papel } } : {} } };
}
const DA_ANA = { requested: true, author: 'Ana-Dev' };
const textos = (r) => attentionPoints(null, r).map((p) => p.text);

test('arquivo de ambiente sem valor oculto aprova sozinho, sem ressalva própria', () => {
  assert.deepEqual(shouldAutoApprove(engineComPapel('junior'), DA_ANA, comAmbiente(0)), { ok: true, motivo: null });
  assert.ok(!textos(comAmbiente(0)).some((t) => /Arquivo de ambiente/.test(t)));
});
test('valor oculto de ambiente aprova sozinho com ressalva, seja quem for o autor', () => {
  for (const papel of ['junior', 'senior', 'arquiteto', 'techlead', null]) {
    assert.deepEqual(shouldAutoApprove(engineComPapel(papel), DA_ANA, comAmbiente(1)), { ok: true, motivo: null }, String(papel));
  }
  assert.ok(textos(comAmbiente(1)).some((t) => /Arquivo de ambiente com valor que pode ser credencial .*\(a\.md\)/.test(t)));
});
test('valor oculto de ambiente com a conta em "espera você" nas ressalvas vai à mesa pela política', () => {
  assert.deepEqual(shouldAutoApprove(engineComPapel('junior', 'wait'), DA_ANA, comAmbiente(1)), { ok: false, motivo: 'politica' });
});
test('patch truncado de arquivo de ambiente também é ressalva', () => {
  const r = comAmbiente(0);
  r.inventarioDiff.files[0].representation.partial = true;
  assert.deepEqual(shouldAutoApprove(engineComPapel(null), DA_ANA, r), { ok: true, motivo: null });
  assert.ok(textos(r).some((t) => /Arquivo de ambiente/.test(t)));
});
test('o valor oculto não dispensa as outras provas', () => {
  const semAnalise = { ...comAmbiente(1), analysisStatus: 'incomplete' };
  assert.equal(shouldAutoApprove(engineComPapel('techlead'), DA_ANA, semAnalise).motivo, 'analise_incompleta');
});
test('caminho protegido sem a projeção aprova sozinho com ressalva que cita o arquivo', () => {
  for (const arquivo of [{ path: '.env.prod' }, { path: '.env.prod', representation: null }, { path: 'deploy/prod.env' },
    { path: 'secrets/a.json' }, { path: 'notas.txt', previousPath: '.env.prod' }]) {
    const r = comAmbiente(0);
    r.inventarioDiff.files = [arquivo];
    assert.deepEqual(shouldAutoApprove(engineComPapel('junior'), DA_ANA, r), { ok: true, motivo: null }, arquivo.path);
    assert.ok(textos(r).some((t) => t.startsWith('Arquivo protegido que a revisão não pôde ler') && t.includes(arquivo.path)), arquivo.path);
  }
  const comum = comAmbiente(0);
  comum.inventarioDiff.files = [{ path: 'src/env.test.ts' }];
  assert.ok(!textos(comum).some((t) => /Arquivo protegido/.test(t)));
});
test('protegido que a cobertura já aponta não aparece duas vezes no card', () => {
  const r = { ...comAmbiente(0), protegidosSemLeitura: ['secrets/a.json'] };
  r.inventarioDiff.files = [{ path: 'secrets/a.json' }];
  assert.ok(!textos(r).some((t) => t.startsWith('Arquivo protegido')));
});
test('análise incompleta com protegido sem projeção diz que tentar de novo não muda isso', () => {
  const r = { ...comAmbiente(0), analysisStatus: 'incomplete' };
  r.inventarioDiff.files = [{ path: 'secrets/a.json' }];
  assert.equal(shouldAutoApprove(engineComPapel('junior'), DA_ANA, r).motivo, 'analise_incompleta');
  assert.match(textoDaRecusa(engineComPapel('junior'), DA_ANA, 'analise_incompleta', r), /secrets\/a\.json não pode ser lido, então tentar de novo não muda isso/);
  assert.doesNotMatch(textoDaRecusa(engineComPapel('junior'), DA_ANA, 'analise_incompleta', comAmbiente(0)), /protegido/);
});
