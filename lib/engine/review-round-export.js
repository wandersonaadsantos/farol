// A seleção entra na medição e confirmação já existentes do histórico local.
import { localScopes, readRounds, contentHash } from './review-round-store.js';
import { bytesForRound } from './review-round-sync.js';

function historicalRounds(engine, since) {
  const accounts = new Set(engine.accountList().map(a => a.user.toLowerCase()));
  const entries = [];
  for (const scope of localScopes()) {
    if (!accounts.has(scope.split('|')[0])) continue;
    const local = readRounds(scope);
    if (!local.ok) throw new Error('memória local incompatível; arquivos preservados');
    for (const round of local.rounds.filter(r => r.at < since)) entries.push({
      kind: 'round', id: `round1:${contentHash([scope, round.id])}`, version: contentHash(round),
      value: round, bytes: bytesForRound(engine, round),
    });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}
export { historicalRounds };
