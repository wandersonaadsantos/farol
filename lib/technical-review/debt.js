// Baseline não dispensa avaliar se a entrega agravou a dívida conhecida.
import io from '../io.js';
import { envSemRepositorioHerdado } from '../git-env.js';

function absorbedFiles(context, result) {
  return result.rules.filter(r => r.conhecidos > 0).flatMap(rule => {
    const baseline = (context.profile.baselines || []).find(b => b.rule === rule.rule);
    return (baseline?.known || []).map(signature => signature.split('|')[1])
      .filter(file => rule.acionadores.includes(file)).map(file => ({ rule: rule.rule, file }));
  });
}

async function evidenceExists(context, file, evidence) {
  if (!Array.isArray(evidence)) return false;
  for (const revision of ['base', 'head']) {
    const proof = evidence.find(e => e.revision === revision && e.file === file);
    if (!proof || !Number.isInteger(proof.line) || proof.line < 1 || !String(proof.observation || '').trim()) return false;
    const response = await io.run('git', ['show', `${context[revision]}:${file}`], {
      cwd: context.snapshot, env: envSemRepositorioHerdado(),
    });
    if (!response.ok || proof.line > response.stdout.split('\n').length) return false;
  }
  return true;
}

async function debtVerdict(context, result, comparisons = []) {
  const comparisonContext = { ...context, base: result.changeSet?.ancora || context.base };
  for (const target of absorbedFiles(context, result)) {
    const entry = Array.isArray(comparisons) && comparisons.find(c => c.rule === target.rule && c.file === target.file);
    if (!entry || !['alta', 'media'].includes(entry.confidence) || !String(entry.rationale || '').trim()) return 'not-run';
    if (!(await evidenceExists(comparisonContext, target.file, entry.evidence))) return 'not-run';
    if (['introduced', 'aggravated'].includes(entry.state)) return 'fail';
    if (entry.state !== 'unchanged') return 'not-run';
  }
  return 'pass';
}

export { absorbedFiles, debtVerdict };
