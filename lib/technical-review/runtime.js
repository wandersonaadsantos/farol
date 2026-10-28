// Orquestra a cópia privada e o avaliador; nunca instala ou executa o projeto revisado.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import io from '../io.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { TEMPOS } from '../constants.js';
import { TOOL } from './verdict.js';
import { profileFor, cadastroIlegivel } from './profiles.js';
import { reviewSnapshot } from './reviews.js';
import { TOOL_HOME, requireTool } from './toolchain.js';
import { targetFor, snapshotFor } from './material.js';
import { debtVerdict } from './debt.js';
import { cleanup } from './cleanup.js';
import { readRecord, launchConsumer, releaseConsumer, consumerRecords, updateRecord } from './material-record.js';
import { enqueue, maintainMaterials } from './material-maintenance.js';
import { SHA } from '../review-source/contract.js';
import { pastasAusentes, textoDasAusentes, NOMEADAS, VERSAO_DA_CONFERENCIA } from './declaracao.js';
export { technicalPrompt } from './prompt.js';

const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));
// Repositório sem declaração no cadastro privado (17/10/2026): não há avaliação técnica
// configurada, o que não é violação. A marca `semDeclaracao` nasce SÓ aqui, no engine, e o
// review.js a grava em result.technicalReview por cima de qualquer coisa do envelope.
const SEM_DECLARACAO = 'declaração técnica do repositório ainda não cadastrada';
async function audit(context, assessments = []) {
  if (context.signal?.aborted) throw Object.assign(new Error('avaliação técnica cancelada'), { code: 'ABORT_ERR' });
  const consumerId = readRecord(context.snapshot) ? randomUUID() : null;
  if (consumerId) launchConsumer(context.snapshot, consumerId);
  try { return await runAudit(context, assessments, consumerId); }
  finally { if (consumerId) await finishAuditConsumer(context.snapshot, consumerId); }
}
async function finishAuditConsumer(snapshot, consumerId) {
  const record = readRecord(snapshot);
  const consumer = record && consumerRecords(snapshot, record).find(c => c?.id === consumerId);
  if (consumer?.ended === true) releaseConsumer(snapshot, consumerId);
  else updateRecord(snapshot, r => ({ ...r,
    lastFailure: { at: Date.now(), code: 'CONSUMER_TERMINATION_UNVERIFIED' } }));
  enqueue(snapshot);
  await maintainMaterials();
}
async function runAudit(context, assessments, materialConsumer) {
  const { signal, ...material } = context;
  const request = { ...material, assessments, materialConsumer };
  const file = path.join(context.snapshot, '..', `${path.basename(context.snapshot)}-request.json`);
  io.writeJsonAtomic(file, request);
  const childEnv = envSemRepositorioHerdado();
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS']) delete childEnv[name];
  childEnv.ELECTRON_RUN_AS_NODE = '1';
  const result = await io.run(process.execPath, [WORKER, file], {
    env: childEnv,
    signal,
    timeout: TEMPOS.CONSTRUCAO_FERRAMENTA_MS,
  });
  if (!result.ok) throw new Error('a ferramenta não concluiu a avaliação técnica');
  const data = io.parseJson(result.stdout);
  if (!data?.catalogFingerprint || !Array.isArray(data.rules)) throw new Error('resultado técnico inválido');
  return data;
}

async function prepareTechnicalReview(engine, pr, head, options = {}) {
  let snapshot;
  let failure = 'profile';
  try {
    const profile = profileFor(pr.repo);
    if (!profile && cadastroIlegivel()) throw new Error('cadastro de declarações técnicas ilegível');
    // sem declaração (decisão do dono de 19/10/2026, que supera #250 e #253): ressalva, sem
    // falha de execução e sem pausa de configuração; a política da conta decide
    if (!profile) return { repo: pr.repo, head, error: SEM_DECLARACAO, semDeclaracao: true };
    failure = 'tool';
    const toolHome = await requireTool();
    failure = 'target';
    const manifest = options.sources?.manifest;
    const target = manifest ? { head: manifest.H, base: manifest.B } : await targetFor(engine, pr, head);
    if (target.head !== head || !SHA.test(target.base || '')) throw new Error('base e head técnicos não confirmados');
    failure = 'material';
    snapshot = await snapshotFor(engine, pr, target, options);
    // erro de leitura na conferência é falha do material (passageira, texto fixo); só a pasta
    // comprovadamente ausente é configuração
    const ausentes = await pastasAusentes(profile.declaration, snapshot).catch(() => {
      throw new Error('não foi possível conferir as pastas da declaração técnica');
    });
    if (ausentes.length) {
      await cleanup({ snapshot });
      return { repo: pr.repo, head, error: textoDasAusentes(ausentes), failure: 'declaration',
        missingDirs: ausentes.slice(0, NOMEADAS), missingCount: ausentes.length, declarationProfile: profile.fingerprint,
        declarationCheck: VERSAO_DA_CONFERENCIA };
    }
    failure = 'objections';
    const objections = await reviewSnapshot(engine, pr);
    const context = { repo: pr.repo, ...target, profile, toolHome, snapshot, objections, signal: options.signal };
    failure = 'assessment';
    const initial = await audit(context);
    return { ...context, initial };
  } catch (error) {
    await cleanup({ snapshot });
    return { repo: pr.repo, head, error: error.message, failure };
  }
}

async function finishTechnicalReview(context, assessments, comparisons) {
  if (context.semDeclaracao === true) return { schema: 1, verdict: 'not-run', error: context.error, semDeclaracao: true };
  if (context.error && context.failure === 'declaration') {
    return { schema: 1, verdict: 'not-run', error: context.error, failure: 'declaration',
      missingDirs: context.missingDirs, missingCount: context.missingCount, declarationProfile: context.declarationProfile,
      declarationCheck: context.declarationCheck };
  }
  if (context.error) return { schema: 1, verdict: 'not-run', error: context.error, failure: context.failure || 'assessment' };
  try {
    await requireTool(context.toolHome);
    const clean = await io.run('git', ['status', '--porcelain'], { cwd: context.snapshot, env: envSemRepositorioHerdado(), signal: context.signal });
    if (!clean.ok || clean.stdout.trim()) throw new Error('material da revisão foi alterado');
    const result = await audit(context, Array.isArray(assessments) ? assessments : []);
    const debt = await debtVerdict(context, result, comparisons);
    if (result.verdict === 'pass' && debt !== 'pass') result.verdict = debt;
    let debtError;
    if (debt === 'fail') debtError = 'dívida anterior agravada pela entrega';
    if (debt === 'not-run') debtError = 'comparação com a dívida anterior não comprovada';
    const privateEvidence = path.join(context.snapshot, '..', `${path.basename(context.snapshot)}-result.json`);
    io.writeJsonAtomic(privateEvidence, { ...result, debtComparisons: comparisons || [] });
    return { schema: 1, version: TOOL.version, toolCommit: TOOL.commit, repo: context.repo,
      base: context.base, head: context.head, profile: context.profile.fingerprint,
      humanReviewFingerprint: context.objections.fingerprint,
      catalogFingerprint: result.catalogFingerprint, verdict: result.verdict,
      rules: result.rules.map(r => ({ rule: r.rule, verdict: r.verdict, causa: r.causa,
        materialFingerprint: r.materialFingerprint, conhecidos: r.conhecidos })),
      findings: result.findings.slice(0, 10), coverage: result.coverage, privateEvidence,
      error: debtError };
  } catch (error) { return { schema: 1, verdict: 'not-run', error: error.message, failure: 'assessment' }; }
  finally { await cleanup(context); }
}


export { TOOL_HOME, requireTool, targetFor, audit, prepareTechnicalReview, finishTechnicalReview };
// Fronteiras substituíveis em testes de integração do engine, como io.run.
export const technicalRuntime = { requireTool, targetFor, prepareTechnicalReview, finishTechnicalReview, reviewSnapshot, cleanup };
