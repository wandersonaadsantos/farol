// Declaração técnica que cita pasta inexistente (27/10/2026).
//
// Um PR do biud-frontend apagou duas das 1206 pastas de teste da declaração, a ferramenta
// passou a recusar a declaração inteira, e o worker devolvia só "a ferramenta não concluiu":
// toda avaliação do repositório virava falha de execução, tentada de novo duas vezes e depois
// ressalva genérica. A pasta ausente é configuração: tem nome, não é tentada de novo e não vira
// ressalva.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-declaracao-'));
process.env.FAROL_HOME = path.join(root, 'home');
const { PROFILE_FILE, profileFor } = await import('../lib/technical-review/profiles.js');
const { pastasAusentes, textoDasAusentes, VERSAO_DA_CONFERENCIA } = await import('../lib/technical-review/declaracao.js');
const { finishTechnicalReview } = await import('../lib/technical-review/runtime.js');
const { technicalGap, technicalSummary, ehLacunaDura, LACUNA_DE_DECLARACAO } = await import('../lib/technical-review/verdict.js');
const { pausaDaRecuperacao } = await import('../lib/engine/recuperacao-prova.js');
const { lacunasExigidas } = await import('../lib/engine/busca-da-prova.js');
const { defeitosDoPr } = await import('../lib/engine/desfecho-automatico.js');
const { codigoDaRecusaDecisao } = await import('../lib/sync/recusa-decisao.js');
const { technicalPrompt } = await import('../lib/technical-review/prompt.js');
const { shouldAutoReject } = await import('../lib/engine/approval-policy.js');
after(() => fs.rmSync(root, { recursive: true, force: true }));

const REPO = 'org/front';
function declarar(declaration) {
  fs.mkdirSync(path.dirname(PROFILE_FILE), { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify({ repositories: { [REPO]: { declaration } } }));
  return profileFor(REPO).fingerprint;
}
function relatorio(fingerprint, error = 'a declaração técnica cita pasta que não existe neste commit: testDirs "src/sumiu"') {
  return { schema: 1, verdict: 'not-run', error, failure: 'declaration', missingDirs: [{ campo: 'testDirs', dir: 'src/sumiu' }], declarationProfile: fingerprint,
    declarationCheck: VERSAO_DA_CONFERENCIA };
}

test('as pastas ausentes são listadas em todos os campos de diretório, e o texto nomeia até cinco', async () => {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src', 'existe'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'arquivo'), '');
  const ausentes = await pastasAusentes({ scopes: ['core'], testDirs: ['src', 'src/existe', 'src/sumiu'], e2eDirs: ['e2e'],
    sourceDirs: ['arquivo'], componentDirs: ['src'] }, repo);
  assert.deepEqual(ausentes, [{ campo: 'testDirs', dir: 'src/sumiu', motivo: 'ausente' }, { campo: 'e2eDirs', dir: 'e2e', motivo: 'ausente' },
    { campo: 'sourceDirs', dir: 'arquivo', motivo: 'não é pasta' }]);
  const muitas = Array.from({ length: 7 }, (_, i) => ({ campo: 'testDirs', dir: `p${i}` }));
  const texto = textoDasAusentes(muitas);
  assert.match(texto, /testDirs "p0"/);
  assert.match(texto, /testDirs "p4"/);
  assert.doesNotMatch(texto, /p5/);
  assert.match(texto, /e mais 2$/);
});

test('a falha de declaração sai do runtime com as pastas e a impressão da declaração que falhou', async () => {
  const fim = await finishTechnicalReview({ repo: REPO, head: 'a'.repeat(40), error: 'texto', failure: 'declaration',
    missingDirs: [{ campo: 'testDirs', dir: 'x' }], missingCount: 1, declarationProfile: 'f1', declarationCheck: 2 });
  assert.deepEqual(fim, { schema: 1, verdict: 'not-run', error: 'texto', failure: 'declaration', missingDirs: [{ campo: 'testDirs', dir: 'x' }], missingCount: 1, declarationProfile: 'f1', declarationCheck: 2 });
});

test('é lacuna dura com texto próprio: nunca vira ressalva, nem "tentará novamente"', () => {
  const report = relatorio('f1');
  assert.equal(technicalGap(report), LACUNA_DE_DECLARACAO);
  assert.equal(ehLacunaDura(LACUNA_DE_DECLARACAO), true);
  const resumo = technicalSummary(report, undefined, { provaEsgotada: true, evidenceVersion: 5 });
  assert.equal(resumo.state, 'pending');
  assert.match(resumo.message, /src\/sumiu/);
  assert.match(resumo.message, /aprovar manualmente não resolve/);
  assert.doesNotMatch(resumo.message, /tentará novamente/);
  const exigidas = lacunasExigidas({ provaEsgotada: true, headSha: 'a'.repeat(40), technicalReview: report });
  assert.ok(exigidas.includes(LACUNA_DE_DECLARACAO), exigidas.join(' | '));
});

test('configuração do aparelho nunca vira pedido de mudanças no PR', () => {
  assert.deepEqual(defeitosDoPr({ approvalEvidence: [LACUNA_DE_DECLARACAO] }), []);
  assert.equal(codigoDaRecusaDecisao({ blocked: 'technical_review', error: LACUNA_DE_DECLARACAO }), 'technical_review:declaracao-desatualizada');
  const engine = { rejectPolicyFor: () => 'request_changes', accountForPr: () => 'eu', config: {}, myLogins: () => [] };
  const reprovado = { analysisStatus: 'complete', verdict: 'request_changes', technicalReview: relatorio('f1'),
    payloads: { request_changes: { event: 'REQUEST_CHANGES', body: 'Os testes foram apagados.' } } };
  assert.equal(shouldAutoReject(engine, { requested: true, author: 'outro' }, reprovado), false);
  assert.match(technicalPrompt({ error: 'x', failure: 'declaration' }), /não reprove nem peça mudanças/);
  assert.doesNotMatch(technicalPrompt({ error: 'testDirs "src/x/__tests__"', failure: 'declaration' }), /__tests__/);
});

test('a recuperação fica parada até a declaração mudar, sem novas tentativas', async () => {
  const engine = { accountForPr: () => 'eu', autoReviewFor: () => true, isMuted: () => false, tokenFor: () => 't', autoReviewParked: new Set() };
  const antes = declarar({ scopes: ['core'], testDirs: ['src', 'src/sumiu'] });
  const item = { key: `${REPO}#1`, pr: { repo: REPO }, technicalReview: relatorio(antes) };
  assert.match(await pausaDaRecuperacao(engine, item), /cita pasta que não existe mais/);
  declarar({ scopes: ['core'], testDirs: ['src'] });
  assert.equal(await pausaDaRecuperacao(engine, item), '');
  fs.rmSync(PROFILE_FILE, { force: true });
});

test('a conferência segue as exigências da ferramenta: caixa exata, raiz, espaço e lista inválida', async () => {
  const repo = path.join(root, 'repo-caixa');
  fs.mkdirSync(path.join(repo, 'src', 'Components'), { recursive: true });
  const ausentes = await pastasAusentes({ testDirs: ['src/components', ' src ', '..', 7], e2eDirs: [] }, repo);
  assert.deepEqual(ausentes.map(a => [a.campo, a.dir, a.motivo]), [
    ['testDirs', 'src/components', 'outra caixa'], ['testDirs', '..', 'fora da raiz'], ['testDirs', '', 'entrada inválida'], ['e2eDirs', '', 'lista inválida']]);
});

test('o texto do card sai das pastas conferidas, nunca do erro gravado', () => {
  const report = { ...relatorio('f1', String.raw`C:\Users\alguem\.farol\snap`), missingCount: 7 };
  const { message } = technicalSummary(report);
  assert.doesNotMatch(message, /Users|\.farol/);
  assert.match(message, /testDirs "src\/sumiu" e mais 2/);
});

test('registro sem a impressão da declaração não prende a recuperação', async () => {
  const engine = { accountForPr: () => 'eu', autoReviewFor: () => true, isMuted: () => false, tokenFor: () => 't', autoReviewParked: new Set() };
  const item = { key: 'org/fora#1', pr: { repo: 'org/fora' }, technicalReview: { ...relatorio(undefined), declarationProfile: undefined } };
  assert.equal(await pausaDaRecuperacao(engine, item), '');
});

// v2.78.9 acusava `null` como lista inválida (28/10/2026): 25 dos 27 repositórios do cadastro
// respondem algum campo de pasta com null, e o engine-ai#703 ficou pausado sem defeito nenhum.
test('null é resposta válida (o repositório não tem aquele material); só lista vazia é recusada', async () => {
  const repo = path.join(root, 'repo-null');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  assert.deepEqual(await pastasAusentes({ testDirs: ['src'], e2eDirs: null, componentDirs: null, sourceDirs: ['src'] }, repo), []);
  assert.deepEqual((await pastasAusentes({ testDirs: [] }, repo)).map(a => a.motivo), ['lista inválida']);
});

test('o card diz o motivo quando a pasta não está simplesmente ausente', () => {
  const report = { ...relatorio('f1'), missingDirs: [{ campo: 'testDirs', dir: 'src/Comp', motivo: 'outra caixa' }, { campo: 'e2eDirs', dir: '', motivo: 'invente' }] };
  const { message } = technicalSummary(report);
  assert.ok(message.includes('testDirs "src/Comp" (outra caixa)'), message);
  assert.doesNotMatch(message, /invente/);
});

test('falha gravada pela conferência anterior não segura a recuperação: volta a ser conferida', async () => {
  const engine = { accountForPr: () => 'eu', autoReviewFor: () => true, isMuted: () => false, tokenFor: () => 't', autoReviewParked: new Set() };
  const fp = declarar({ scopes: ['core'], testDirs: ['src'], e2eDirs: null });
  const antiga = { ...relatorio(fp), declarationCheck: undefined };
  assert.equal(await pausaDaRecuperacao(engine, { key: `${REPO}#9`, pr: { repo: REPO }, technicalReview: antiga }), '');
  assert.match(await pausaDaRecuperacao(engine, { key: `${REPO}#9`, pr: { repo: REPO }, technicalReview: relatorio(fp) }), /cita pasta/);
  fs.rmSync(PROFILE_FILE, { force: true });
});
