import { specialistSource } from './specialist-source.js';
import { saveRound, scopeFor } from '../../lib/engine/review-round-store.js';
import { digest } from '../../lib/specialists/contract.js';
let serial = 0;
function auditFixture(engine) {
  const remote = specialistSource(), repo = `org/audit-${++serial}`, key = repo + '#1';
  remote.state.commits[remote.second]['src/a.ts'] = 'export const value = 1;\n';
  const finding = { id: 'f-original', file: 'src/a.ts', line: 1, severity: 'suggestion', title: 'Valor mutável', summary: 'Conferir a imutabilidade do valor.', ref: null, status: null, evidence: '',
    criteria: { key: 'valor-mutavel', criterion: 'Conferir imutabilidade', source: 'src/a.ts:1', scope: 'Valor alterado neste diff' } };
  const round = { schema: 1, id: digest(key).slice(0, 32), ordinal: 1, scope: scopeFor(key, 'dev'), parents: [], headSha: remote.second,
    baseSha: remote.first, at: Date.now(), executor: 'fixture', decision: 'auto_approve', verdict: 'approve', findingsStatus: 'complete', findings: [finding], unresolved: [], files: [{ path: 'src/a.ts', sha: remote.gitBlob(remote.state.commits[remote.second]['src/a.ts']) }], integrity: [] };
  saveRound(round);
  const decision = { id: digest([key, 'decision']).slice(0, 32), pr: { account: 'dev', repo, number: 1 }, key, analysisStatus: 'complete',
    headSha: remote.second, roundId: round.id, verdict: 'approve', reviewMarkdown: 'Revisão original aprovada.',
    inventarioDiff: { status: 'complete', headSha: remote.second, baseSha: remote.first, changedFiles: 1,
      files: [{ path: 'src/a.ts', sha: round.files[0].sha, status: 'modified', lines: 1 }] } };
  engine.decisions = { pending: [], resolved: [decision] };
  engine.config.accounts = [{ user: 'dev', owners: ['org'], muted: false }]; engine.config.ghUser = 'dev';
  engine.tokens.dev = 'synthetic-fixture'; engine.tokenOk = true;
  engine.accountList = () => engine.config.accounts; engine.tokenFor = a => a === 'dev' ? 'synthetic-fixture' : null;
  engine.ghEnv = account => ({ ...process.env, TEST_ACCOUNT: account }); engine.accountForPr = () => 'dev';
  engine.resolveClaudeAuth = () => ({ kind: 'dir', dir: '' }); engine.budgetBlockedFor = () => null;
  const run = async (command, args, options) => {
    if (String(args[1]).includes('/compare/')) {
      return { ok: true, stdout: JSON.stringify({ base: remote.first, mergeBase: remote.first, head: remote.second,
        files: [{ path: 'src/a.ts', status: 'modified', sha: decision.inventarioDiff.files[0].sha }] }), stderr: '' };
    }
    return remote.run(command, args, options);
  };
  return { engine, remote, run, decision, round };
}
export { auditFixture };
