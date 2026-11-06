// A ressalva da rodada não atravessa troca de regra (06/11/2026, revisão independente da decisão
// na 1ª rodada). Com `provaEsgotada` em toda rodada, o desvio da publicação para a ressalva
// (provaEsgotadaRefusal, que só confere checks, base e objeções) passou a valer para toda
// pendência. Cenário: rodada 1 limpa no head H, a aprovação espera o CI (ou fica na mesa); o dono
// troca a declaração técnica do repositório ou o Farol atualiza a ferramenta; o CI fecha e saía
// APPROVE com a avaliação da regra antiga. Só a lacuna que a própria rodada dispensou vira
// ressalva; perfil, ferramenta ou versão trocados pedem revisão nova.
//
// A espera do CI (no mesmo processo, pelo technicalApprovals) e o Aprovar da mesa (pela pendência
// gravada, publicationEvidence) chegam ao GitHub pelo mesmo approvalRefusal: os dois são testados.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-test-publicacao-prova-atual-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { TOOL } = await import('../lib/technical-review/verdict.js');
const { PROFILE_FILE, profileFor } = await import('../lib/technical-review/profiles.js');
const { approvalRefusal } = await import('../lib/technical-review/publication.js');
const { technicalRuntime, prepareTechnicalReview, finishTechnicalReview } = await import('../lib/technical-review/runtime.js');
const { VERSAO_DAS_REGRAS } = await import('../lib/technical-review/evidence.js');

const REPO = 'org/declarado';
const HEAD = 'a'.repeat(40);
const PR = { key: `${REPO}#1`, repo: REPO, number: 1 };
const PAYLOAD = { event: 'APPROVE', commit_id: HEAD };
const runtimeOriginal = { ...technicalRuntime };
const toolOriginal = { commit: TOOL.commit, version: TOOL.version };

function declarar(scopes) {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { [REPO]: { declaration: { scopes } } } }));
  return profileFor(REPO).fingerprint;
}
function relatorio(extra = {}) {
  return { schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: REPO, base: 'b'.repeat(40), head: HEAD,
    profile: profileFor(REPO).fingerprint, catalogFingerprint: 'catalogo', humanReviewFingerprint: 'humano',
    verdict: 'pass', rules: [{ rule: 'x', verdict: 'pass' }], findings: [], ...extra };
}
// as duas fontes da prova: a espera do CI no mesmo processo e a pendência na mesa
const FONTES = {
  'espera do CI': (report) => ({ technicalApprovals: new Map([[PR.key, { report, evidence: [], provaEsgotada: true, evidenceVersion: VERSAO_DAS_REGRAS }]]),
    decisions: { pending: [] } }),
  'Aprovar da mesa': (report) => ({ decisions: { pending: [{ id: 'd1', key: PR.key, status: 'pending', verdict: 'approve', headSha: HEAD,
    technicalReview: report, approvalEvidence: [], approvalEvidenceVersion: VERSAO_DAS_REGRAS, provaEsgotada: true }] } }),
};
function motor(fonte, report) {
  return { ...FONTES[fonte](report), saveDecisions: () => { }, technicalRecheckRequested: new Set(),
    bloqueadoPorChecks: async () => ({ verifiedHead: HEAD, faltando: [] }) };
}

async function relatorioDaFalha() {
  const contexto = await prepareTechnicalReview({}, { repo: REPO, key: PR.key, number: 1 }, HEAD);
  assert.ok(contexto.error, 'a ferramenta ausente faz o prepare falhar');
  return finishTechnicalReview(contexto);
}

beforeEach(() => {
  declarar(['core']);
  technicalRuntime.requireTool = async () => 'tool';
  technicalRuntime.targetFor = async () => ({ head: HEAD, base: 'b'.repeat(40) });
  technicalRuntime.reviewSnapshot = async () => ({ fingerprint: 'humano' });
});
afterEach(() => {
  Object.assign(technicalRuntime, runtimeOriginal);
  Object.assign(TOOL, toolOriginal);
  fs.rmSync(PROFILE_FILE, { force: true });
});
after(() => fs.rmSync(root, { recursive: true, force: true }));

for (const fonte of Object.keys(FONTES)) {
  test(`${fonte}: controle, a avaliação da rodada ainda vale e a aprovação sai`, async () => {
    assert.equal(await approvalRefusal(motor(fonte, relatorio()), PR, PAYLOAD), null);
  });

  test(`${fonte}: o dono troca a declaração técnica depois da rodada limpa, a aprovação pede revisão nova`, async () => {
    const report = relatorio();
    declarar(['core', 'frontend']);
    const r = await approvalRefusal(motor(fonte, report), PR, PAYLOAD);
    assert.ok(r, 'não sai APPROVE com a avaliação da declaração antiga');
    assert.equal(r.blocked, 'technical_review');
    assert.equal(r.error, 'declaração técnica mudou');
    assert.equal(r.needsReview, true);
  });

  test(`${fonte}: o Farol atualiza a ferramenta depois da rodada limpa, a aprovação pede revisão nova`, async () => {
    const report = relatorio();
    TOOL.commit = 'f'.repeat(40);
    const r = await approvalRefusal(motor(fonte, report), PR, PAYLOAD);
    assert.ok(r, 'não sai APPROVE com a avaliação da ferramenta antiga');
    assert.equal(r.blocked, 'technical_review');
    assert.equal(r.needsReview, true);
  });

  test(`${fonte}: versão da ferramenta trocada também pede revisão nova`, async () => {
    const report = relatorio();
    TOOL.version = `${TOOL.version}-nova`;
    const r = await approvalRefusal(motor(fonte, report), PR, PAYLOAD);
    assert.ok(r);
    assert.equal(r.needsReview, true);
  });

  // O relatório da falha de execução exatamente como o runtime grava (segunda revisão independente,
  // 06/11/2026): a ferramenta não está instalada nesta máquina de teste, e o prepare devolve a falha.
  for (const [troca, aplicar] of [
    ['a declaração técnica', () => declarar(['core', 'frontend'])],
    ['o commit da ferramenta', () => { TOOL.commit = 'f'.repeat(40); }],
    ['a versão da ferramenta', () => { TOOL.version = `${TOOL.version}-nova`; }],
  ]) {
    test(`${fonte}: avaliação técnica que falhou na rodada, depois troca ${troca}: pede revisão nova`, async () => {
      const report = await relatorioDaFalha();
      assert.equal(report.verdict, 'not-run');
      assert.equal(await approvalRefusal(motor(fonte, report), PR, PAYLOAD), null, 'controle: a falha que a rodada dispensou segue ressalva');
      aplicar();
      const r = await approvalRefusal(motor(fonte, report), PR, PAYLOAD);
      assert.ok(r, 'não sai APPROVE sobre a falha registrada com a regra antiga');
      assert.equal(r.blocked, 'technical_review');
      assert.equal(r.needsReview, true);
    });
  }

  test(`${fonte}: falha de execução gravada antes desta versão (sem perfil nem ferramenta) pede revisão nova`, async () => {
    const r = await approvalRefusal(motor(fonte, { schema: 1, verdict: 'not-run', error: 'x', failure: 'assessment' }), PR, PAYLOAD);
    assert.ok(r);
    assert.equal(r.needsReview, true);
  });
}
