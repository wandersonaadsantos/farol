// Entrada offline: a curadoria fica separada da resposta do modelo e ligada ao seu hash.
import { createHash } from 'node:crypto';
import { check, SHA, sourceRef, digest } from '../../lib/specialists/contract.js';

const CHECKS = ['coverage', 'evidence', 'classification', 'publication', 'claims'];
const STATES = ['verified', 'violated', 'unverified'];
const id = value => typeof value === 'string' && /^[a-z0-9][a-z0-9.-]{0,99}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const reviewHash = text => createHash('sha256').update(text).digest('hex');
const corpusHash = raw => digest(suiteInput(raw));
function unique(values, label) { check(new Set(values).size === values.length, `${label} repetido.`); }
function list(value, max, label) { check(Array.isArray(value) && value.length <= max, `${label} inválido.`); return value; }
function target(raw) {
  check(raw && typeof raw.repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(raw.repo)
    && SHA.test(raw.base) && SHA.test(raw.head), 'Identidade congelada inválida.');
  return { repo: raw.repo.toLowerCase(), base: raw.base, head: raw.head };
}
function sameTarget(a, b) { return a.repo === b.repo && a.base === b.base && a.head === b.head; }

function suiteInput(raw) {
  check(raw?.schema === 1 && Number.isInteger(raw.repetitions) && raw.repetitions >= 3 && raw.repetitions <= 20,
    'O corpus exige de três a vinte repetições por caso.');
  const cases = list(raw.cases, 100, 'Casos').map(value => {
    check(id(value.id) && hash(value.oracleSha256), 'Caso sem identidade ou hash das definições e provas.');
    const controls = list(value.controls, 100, 'Controles');
    check(controls.length && controls.every(id), 'Informe controles curados, inclusive os que a referência perdeu.');
    unique(controls, 'Controle');
    return { id: value.id, target: target(value.target), oracleSha256: value.oracleSha256, controls: [...controls] };
  });
  check(cases.length, 'Corpus vazio não verifica qualidade.'); unique(cases.map(c => c.id), 'Caso');
  return { schema: 1, repetitions: raw.repetitions, cases };
}

function controlInput(raw, run, expected) {
  check(expected.controls.includes(raw.id) && ['detected', 'missed', 'inconclusive'].includes(raw.status), 'Controle sem curadoria ou estado válido.');
  const evidence = list(raw.evidence, 20, 'Evidências');
  if (raw.status === 'detected') check(evidence.length, 'Detecção sem evidência não é prova.');
  for (const item of evidence) {
    const ref = sourceRef(item.source);
    check(!ref.path.includes(':') && [run.target.head, run.target.base].includes(item.source.commit), 'Fonte de outro commit.');
    check(typeof item.quote === 'string' && item.quote.trim().length >= 12 && item.quote.length <= 4000
      && run.review.includes(item.quote), 'Evidência não aparece na review consolidada.');
  }
  return { id: raw.id, status: raw.status };
}

function assessmentInput(raw, run, expected, corpusSha256) {
  if (raw === null || raw === undefined) return null;
  check(raw.method === 'source-and-reproduction' && hash(raw.reviewSha256) && raw.reviewSha256 === reviewHash(run.review),
    'Curadoria ausente, de outro resultado ou sem conferência independente.');
  check(raw.corpusSha256 === corpusSha256, 'Curadoria de outro corpus.');
  check(raw.status === 'complete' || raw.status === 'incomplete', 'Estado da curadoria inválido.');
  const controls = list(raw.controls, 100, 'Controles avaliados').map(c => controlInput(c, run, expected));
  unique(controls.map(c => c.id), 'Controle avaliado');
  check(CHECKS.every(k => STATES.includes(raw.checks?.[k])), 'Informe também as verificações não concluídas.');
  check(Number.isSafeInteger(raw.falsePositives) && raw.falsePositives >= 0
    && Number.isSafeInteger(raw.unsupportedClaims) && raw.unsupportedClaims >= 0, 'Contagem de alegações inválida.');
  return { status: raw.status, controls, checks: { ...raw.checks }, falsePositives: raw.falsePositives, unsupportedClaims: raw.unsupportedClaims };
}

function tokensInput(raw) {
  if (raw === null || raw === undefined) return null;
  const values = ['input', 'output', 'cacheRead', 'cacheCreation'].map(k => raw[k]);
  check(raw.source === 'result.modelUsage' && raw.scope === 'tree'
    && values.every(v => Number.isSafeInteger(v) && v >= 0), 'Tokens exigem agregado completo do provedor.');
  const total = values.reduce((sum, v) => sum + v, 0);
  check(Number.isSafeInteger(total) && total > 0, 'Consumo não medido ou fora do limite.');
  return { ...raw, total };
}

function batchInput(raw, suite) {
  check(raw?.schema === 1 && id(raw.variant), 'Variante inválida.');
  const runs = list(raw.runs, 2000, 'Execuções').map(value => {
    const expected = suite.cases.find(c => c.id === value.caseId);
    check(expected && id(value.id) && id(value.executionId), 'Execução ou caso desconhecido.');
    check(Number.isInteger(value.repetition) && value.repetition >= 1 && value.repetition <= 20, 'Repetição inválida.');
    const identity = target(value.target);
    check(sameTarget(identity, expected.target), 'Execução de outro repositório, base ou head.');
    check(typeof value.review === 'string' && value.review.length <= 2 * 1024 * 1024, 'Review ausente ou acima do limite.');
    check(['complete', 'incomplete'].includes(value.status) && typeof value.model === 'string' && value.model.length > 0
      && typeof value.effort === 'string' && value.effort.length > 0 && hash(value.cliSha256), 'Runtime ou estado não confirmado.');
    check(value.contextSha256 === undefined || value.contextSha256 === null || hash(value.contextSha256), 'Hash de contexto inválido.');
    const run = { ...value, target: identity };
    return { id: run.id, executionId: run.executionId, caseId: run.caseId, repetition: run.repetition, target: identity, reviewSha256: reviewHash(run.review),
      status: run.status, model: run.model, effort: run.effort, cliSha256: run.cliSha256, contextSha256: run.contextSha256 ?? null,
      assessment: assessmentInput(run.assessment, run, expected, digest(suite)), tokens: tokensInput(run.tokens) };
  });
  unique(runs.map(r => r.id), 'Execução'); unique(runs.map(r => r.executionId), 'Sessão do provedor');
  unique(runs.map(r => `${r.caseId}:${r.repetition}`), 'Repetição do caso');
  return { variant: raw.variant, runs };
}
export { CHECKS, reviewHash, corpusHash, suiteInput, batchInput };
