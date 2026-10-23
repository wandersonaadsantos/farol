// Retrato histórico por SHA. Nunca troca o head antigo pelo head atual do PR.
import io, { parseJson, safeStringify } from '../io.js';
import { reader } from '../specialists/github.js';
import { safeText, sourceRef, identityOf } from '../specialists/contract.js';
import { readRounds, scopeFor } from '../engine/review-round-store.js';
import { check, SHA, digest } from './contract.js';

function targetFor(engine, decisionId, account) {
  const decision = [...engine.decisions.pending, ...engine.decisions.resolved].find(d => d.id === decisionId);
  check(decision, 'Revisão não encontrada no histórico local.');
  const identity = identityOf({ account, repo: decision.pr?.repo });
  check(engine.accountList().some(a => a.user.toLowerCase() === identity.account), 'Conta não configurada.');
  check(Number.isInteger(decision.pr.number) && decision.key === `${decision.pr.repo}#${decision.pr.number}`, 'Identidade do PR inválida.');
  const inventory = decision.inventarioDiff;
  check(decision.analysisStatus === 'complete' && inventory?.status === 'complete' && SHA.test(decision.headSha)
    && decision.headSha === inventory.headSha && SHA.test(inventory.baseSha) && Array.isArray(inventory.files)
    && inventory.files.length === inventory.changedFiles && new Set(inventory.files.map(f => f.path)).size === inventory.files.length, 'Revisão sem inventário completo e head/base verificáveis.');
  const saved = readRounds(scopeFor(decision.key, identity.account));
  const round = saved.ok && saved.rounds.find(r => r.id === decision.roundId && r.headSha === decision.headSha && r.baseSha === inventory.baseSha);
  check(round && round.findingsStatus === 'complete', 'Rodada incompatível ou não pertence à conta escolhida.');
  const findings = [...round.findings, ...round.unresolved.filter(f => !round.findings.some(current => current.id === f.id))];
  check(new Set(findings.map(f => f.id)).size === findings.length, 'Identidades de achados ambíguas.');
  const target = { ...identity, decisionId, key: decision.key, number: decision.pr.number, head: decision.headSha, base: inventory.baseSha,
    roundId: round.id, files: inventory.files, original: { findings, verdict: decision.verdict, review: safeText(decision.reviewMarkdown || 'Sem texto público registrado.', 64000, 'Review original') } };
  // Não deixa um achado legado ser encaminhado sem passar pela fronteira de privacidade.
  safeText(safeStringify(target.original), 128000, 'Achados originais');
  return { ...target, fingerprint: digest(target) };
}
async function snapshotFor(engine, target) {
  check(target.files.length > 0 && target.files.length <= 100, 'Auditoria desta versão suporta de 1 a 100 arquivos; excedente fica inconclusivo, nunca truncado.');
  const response = await io.run('gh', ['api', `repos/${target.repo}/compare/${target.base}...${target.head}`, '--jq',
    '{base: .base_commit.sha, mergeBase: .merge_base_commit.sha, head: .commits[-1].sha, files: [.files[] | {path: .filename, previous: .previous_filename, status, sha}]}'], { env: engine.ghEnv(target.account) });
  check(response.ok, 'Não foi possível recuperar o diff histórico.');
  const compare = parseJson(response.stdout);
  check(compare?.base === target.base && SHA.test(compare.mergeBase) && compare.head === target.head && Array.isArray(compare.files)
    && compare.files.length === target.files.length && new Set(compare.files.map(f => f.path)).size === target.files.length, 'Comparação histórica incompleta ou incompatível com o inventário original.');
  const head = await reader(engine, target, target.head), base = await reader(engine, target, compare.mergeBase);
  const files = []; let bytes = 0;
  for (const f of target.files) {
    const record = compare.files.find(c => c.path === f.path && c.status === f.status && c.sha === f.sha);
    check(record, 'Arquivo do diff histórico não confere com o inventário.');
    const ref = sourceRef({ path: f.path, start: 1, end: 1 });
    const beforePath = record.previous || f.path;
    sourceRef({ ...ref, path: beforePath });
    const before = record.status === 'added' ? null : await base.textAt({ ...ref, path: beforePath });
    const after = record.status === 'removed' ? null : await head.textAt(ref);
    if (after) check(after.blob === f.sha, 'Blob do arquivo não confere com a revisão.');
    if (!after && before) check(before.blob === f.sha, 'Blob removido não confere com a revisão.');
    for (const content of [before, after]) if (content) {
      if (content.text.trim()) safeText(content.text, 256 * 1024, 'Fonte auditada');
      bytes += Buffer.byteLength(content.text);
    }
    check(bytes <= 256 * 1024, 'Retrato acima de 256 KiB; auditoria inconclusiva, sem corte.');
    files.push({ path: f.path, previous: beforePath, status: f.status, base: before, head: after });
  }
  const snapshot = { schema: 1, head: target.head, base: target.base, mergeBase: compare.mergeBase, files };
  return { ...snapshot, fingerprint: digest(snapshot) };
}
export { targetFor, snapshotFor };
