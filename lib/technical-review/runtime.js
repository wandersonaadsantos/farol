// Orquestra a cópia privada e o avaliador; nunca instala ou executa o projeto revisado.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
export { technicalPrompt } from './prompt.js';

const WORKER = fileURLToPath(new URL('./worker.js', import.meta.url));
async function audit(context, assessments = []) {
  const request = { ...context, assessments };
  const file = path.join(context.snapshot, '..', `${path.basename(context.snapshot)}-request.json`);
  io.writeJsonAtomic(file, request);
  const childEnv = envSemRepositorioHerdado();
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS']) delete childEnv[name];
  childEnv.ELECTRON_RUN_AS_NODE = '1';
  const result = await io.run(process.execPath, [WORKER, file], {
    env: childEnv,
    timeout: TEMPOS.CONSTRUCAO_FERRAMENTA_MS,
  });
  if (!result.ok) throw new Error('a ferramenta não concluiu a avaliação técnica');
  const data = io.parseJson(result.stdout);
  if (!data?.catalogFingerprint || !Array.isArray(data.rules)) throw new Error('resultado técnico inválido');
  return data;
}

async function prepareTechnicalReview(engine, pr, head) {
  let snapshot;
  let failure = 'profile';
  try {
    const profile = profileFor(pr.repo);
    if (!profile && cadastroIlegivel()) throw new Error('cadastro de declarações técnicas ilegível');
    if (!profile) throw new Error('declaração técnica do repositório ausente');
    failure = 'tool';
    const toolHome = await requireTool();
    failure = 'target';
    const target = await targetFor(engine, pr, head);
    failure = 'material';
    snapshot = await snapshotFor(engine, pr, target);
    failure = 'objections';
    const objections = await reviewSnapshot(engine, pr);
    const context = { repo: pr.repo, ...target, profile, toolHome, snapshot, objections };
    failure = 'assessment';
    const initial = await audit(context);
    return { ...context, initial };
  } catch (error) {
    cleanup({ snapshot });
    return { repo: pr.repo, head, error: error.message, failure };
  }
}

async function finishTechnicalReview(context, assessments, comparisons) {
  if (context.error) return { schema: 1, verdict: 'not-run', error: context.error, failure: context.failure || 'assessment' };
  try {
    await requireTool(context.toolHome);
    const clean = await io.run('git', ['status', '--porcelain'], { cwd: context.snapshot, env: envSemRepositorioHerdado() });
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
  finally { cleanup(context); }
}


export { TOOL_HOME, requireTool, targetFor, audit, prepareTechnicalReview, finishTechnicalReview };
// Fronteiras substituíveis em testes de integração do engine, como io.run.
export const technicalRuntime = { requireTool, targetFor, prepareTechnicalReview, finishTechnicalReview, reviewSnapshot, cleanup };
