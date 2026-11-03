// Ausência na busca autoral não prova fechamento: a autoanálise também aceita
// PR de outro autor, e o índice pode omitir até PRs próprios por vários ciclos.
// Duas ausências apenas adiam a consulta direta, nunca autorizam exclusão.
const AUSENCIAS_ANTES_DE_CONFERIR = 2;
const CHAVE_PR = /^([^/#\s]+\/[^/#\s]+)#([1-9]\d*)$/;

export async function reconcileSelfAnalyses(engine, openPRs, accountsRead) {
  const openKeys = new Set(openPRs.map(pr => pr.key));
  for (const key of engine.selfPruneStrikes.keys()) {
    if (openKeys.has(key) || !engine.selfAnalyses[key]) engine.selfPruneStrikes.delete(key);
  }
  let pruned = false;
  for (const [key, analysis] of Object.entries(engine.selfAnalyses)) {
    if (openKeys.has(key)) continue;
    const match = CHAVE_PR.exec(key);
    if (!match) continue;
    const account = engine.accountForOwner(match[1].split('/')[0]);
    if (!accountsRead.has(String(account || '').toLowerCase())) continue;
    const absences = Math.min((engine.selfPruneStrikes.get(key) || 0) + 1, AUSENCIAS_ANTES_DE_CONFERIR);
    engine.selfPruneStrikes.set(key, absences);
    if (absences < AUSENCIAS_ANTES_DE_CONFERIR) continue;
    const pr = engine.prFromUrl(`https://github.com/${match[1]}/pull/${match[2]}`);
    if (!pr) continue;
    let state = null;
    try { state = await engine.prState({ ...pr, account }); }
    catch { /* Consulta inconclusiva não autoriza apagar um relatório. */ }
    if (state === 'OPEN') engine.selfPruneStrikes.delete(key);
    if (state !== 'CLOSED' && state !== 'MERGED') continue;
    // A sessão pode ter concluído outro relatório enquanto a consulta aguardava.
    if (engine.selfAnalyses[key] !== analysis) continue;
    engine.selfPruneStrikes.delete(key);
    delete engine.selfAnalyses[key];
    pruned = true;
    engine.log('WARN', `autoanálise de ${key} removida: GitHub confirmou PR ${state}`);
  }
  if (pruned) engine.saveSelfAnalyses();
}
