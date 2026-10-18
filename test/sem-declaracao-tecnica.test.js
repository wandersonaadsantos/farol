import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sem-declaracao-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { PROFILE_FILE } = await import('../lib/technical-review/profiles.js');
const { prepareTechnicalReview, finishTechnicalReview, technicalPrompt } = await import('../lib/technical-review/runtime.js');
const { approvalGaps } = await import('../lib/technical-review/evidence.js');
const { technicalSummary } = await import('../lib/technical-review/verdict.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { attentionPoints } = await import('../lib/engine/ressalvas.js');
const { shouldAutoApprove } = await import('../lib/engine/approval-policy.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const head = 'a'.repeat(40);
const SEM_DECLARACAO = { schema: 1, verdict: 'not-run', error: 'declaração técnica do repositório ainda não cadastrada', semDeclaracao: true };
function result(extra = {}) {
  return { analysisStatus: 'complete', verdict: 'approve', decision: 'auto_approve', cardMet: true,
    headSha: head, checksVerifiedHead: head, checksObrigatorios: [], technicalReview: SEM_DECLARACAO, reasons: [],
    diffMedido: ['a.md'], coverage: { total: 1, reviewed: ['a.md'], missing: [] },
    verificationCheckpoint: { total: 0, conflicts: [] }, protocolo: { prReviewer: 'rodou' },
    payloads: { approve: { event: 'APPROVE', body: 'O comportamento foi conferido.' } }, ...extra };
}
function engineCom(onCaveats) {
  return { accountForPr: () => 'reviewer', attentionPoints: (r) => attentionPoints(null, r),
    approvePolicyFor: (_conta, limpo) => (limpo ? 'approve' : onCaveats) };
}
const PEDIDO = { requested: true };

test('o runtime registra ausência de declaração como avaliação não executada', async () => {
  const ctx = await prepareTechnicalReview({}, { repo: 'org/sem-declaracao' }, head);
  assert.equal(ctx.semDeclaracao, undefined);
  assert.match(ctx.error, /declaração técnica.*ausente/);
  const fim = await finishTechnicalReview(ctx, [{ semDeclaracao: false }]);
  assert.equal(fim.verdict, 'not-run');
  assert.equal(fim.semDeclaracao, undefined);
  // com declaração, a ferramenta ausente é outra falha e não ganha a marca
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { 'org/declarado': { declaration: { scopes: ['core'] } } } }));
  try {
    const comPerfil = await prepareTechnicalReview({}, { repo: 'org/declarado' }, head);
    assert.ok(comPerfil.error, 'a ferramenta não está instalada neste HOME');
    assert.equal(comPerfil.semDeclaracao, undefined);
    assert.equal((await finishTechnicalReview(comPerfil, [{ semDeclaracao: true }], [])).semDeclaracao, undefined,
      'o que a sessão escreve (avaliações) não vira a marca');
  } finally { fs.rmSync(PROFILE_FILE, { force: true }); }
});

test('sem declaração o prompt impede concluir pela aprovação', () => {
  assert.match(technicalPrompt({ error: 'x', semDeclaracao: true }), /não conclua pela aprovação/);
  assert.match(technicalPrompt({ error: 'ferramenta ausente' }), /não conclua pela aprovação/);
});

test('marca legada de sem declaração não dispensa prova', () => {
  assert.deepEqual(approvalGaps(result()), ['avaliação técnica atual ausente']);
  const comDeclaracao = result({ technicalReview: { schema: 1, verdict: 'not-run', error: 'ferramenta ausente' } });
  assert.deepEqual(approvalGaps(comDeclaracao), ['avaliação técnica atual ausente']);
  assert.deepEqual(approvalGaps(result({ technicalReview: { ...SEM_DECLARACAO, semDeclaracao: 'true' } })), ['avaliação técnica atual ausente'],
    'só o booleano verdadeiro vale');
  assert.ok(approvalGaps(result({ coverage: { total: 1, reviewed: [], missing: ['a.md'] } })).some((g) => /cobertura/.test(g)),
    'lacuna de leitura continua bloqueando sem declaração');
});

test('nenhuma política de ressalvas dispensa a avaliação técnica', () => {
  const textos = attentionPoints(null, result()).map((p) => p.text);
  assert.ok(textos.some((t) => /não tem declaração técnica cadastrada, então a avaliação técnica automática não rodou/.test(t)), textos.join(' | '));
  assert.deepEqual(shouldAutoApprove(engineCom('approve'), PEDIDO, result()), { ok: false, motivo: 'prova_tecnica_incompleta' });
  assert.deepEqual(shouldAutoApprove(engineCom('wait'), PEDIDO, result()), { ok: false, motivo: 'prova_tecnica_incompleta' });
  const vermelho = result({ checksObrigatorios: [{ nome: 'test', estado: 'vermelho' }] });
  assert.equal(shouldAutoApprove(engineCom('approve'), PEDIDO, vermelho).motivo, 'prova_tecnica_incompleta', 'a falta de prova já bloqueia antes do CI');
});

test('a tela mantém a aprovação pendente sem declaração', () => {
  const s = technicalSummary(SEM_DECLARACAO, []);
  assert.equal(s.state, 'pending');
  assert.match(s.message, /declaração técnica.*cadastrada/);
  assert.equal(technicalSummary(SEM_DECLARACAO, ['análise incompleta']).state, 'pending', 'outra lacuna continua pendente');
});

test('o envelope não escreve a marca: a única atribuição de technicalReview vem do runtime', () => {
  const fonte = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'engine', 'review.js'), 'utf8');
  const atribuicoes = fonte.match(/result\.technicalReview\s*=[^=]/g) || [];
  assert.equal(atribuicoes.length, 1);
  assert.match(fonte, /result\.technicalReview = await technicalRuntime\.finishTechnicalReview\(technicalContext,/);
});

function motorDaPublicacao(checks) {
  const evidencias = new Map([['org/sem-declaracao#1', { report: SEM_DECLARACAO, evidence: [] }]]);
  return { technicalApprovals: evidencias, decisions: { pending: [] }, bloqueadoPorChecks: async () => checks };
}
const PR = { key: 'org/sem-declaracao#1', repo: 'org/sem-declaracao' };

test('publicação sem declaração: recusa mesmo com checks verdes e commit confirmado', async () => {
  const e = motorDaPublicacao({ verifiedHead: head, faltando: [] });
  assert.equal((await approvalRefusal(e, PR, { event: 'APPROVE', commit_id: head })).error, 'declaração técnica do repositório ausente');
});

test('publicação sem declaração: checks pendentes esperam, commit ausente e prova com lacuna recusam', async () => {
  const pendente = await approvalRefusal(motorDaPublicacao({ verifiedHead: head, faltando: [{ nome: 'test', estado: 'rodando' }] }), PR, { event: 'APPROVE', commit_id: head });
  assert.equal(pendente.blocked, 'technical_review');
  assert.equal(pendente.waitForCi, false);
  const outroHead = await approvalRefusal(motorDaPublicacao({ verifiedHead: 'c'.repeat(40), faltando: [] }), PR, { event: 'APPROVE', commit_id: head });
  assert.equal(outroHead.waitForCi, false, 'ausência de declaração bloqueia antes dos checks');
  const semCommit = await approvalRefusal(motorDaPublicacao({ verifiedHead: head, faltando: [] }), PR, { event: 'APPROVE' });
  assert.equal(semCommit.error, 'declaração técnica do repositório ausente');
  const comLacuna = motorDaPublicacao({ verifiedHead: head, faltando: [] });
  comLacuna.technicalApprovals.get(PR.key).evidence = ['análise incompleta'];
  assert.equal((await approvalRefusal(comLacuna, PR, { event: 'APPROVE', commit_id: head })).error, 'declaração técnica do repositório ausente');
  const falhou = motorDaPublicacao(null);
  falhou.bloqueadoPorChecks = async () => { throw new Error('rede'); };
  assert.equal((await approvalRefusal(falhou, PR, { event: 'APPROVE', commit_id: head })).blocked, 'technical_review');
});

test('cadastro que existe e não abre não vira "sem declaração": segue lacuna e recusa', async () => {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, '{');
  try {
    const ctx = await prepareTechnicalReview({}, { repo: 'org/sem-declaracao' }, head);
    assert.match(ctx.error, /ilegível/);
    assert.equal(ctx.semDeclaracao, undefined);
    assert.equal((await finishTechnicalReview(ctx, [])).semDeclaracao, undefined);
    const recusa = await approvalRefusal(motorDaPublicacao({ verifiedHead: head, faltando: [] }), PR, { event: 'APPROVE', commit_id: head });
    assert.equal(recusa.error, 'declaração técnica do repositório ausente');
  } finally { fs.rmSync(PROFILE_FILE, { force: true }); }
});
