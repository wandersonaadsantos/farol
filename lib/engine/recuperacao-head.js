// Commit novo encerra a recuperação do commit anterior sem apagar o relatório.
function largarPorCommitNovo(engine, item, head) {
  const d = engine.decisions.pending.find(decisao => decisao.id === item.id);
  if (!d) return 0;
  const anterior = String(item.headSha || '').slice(0, 7) || '?';
  const novo = String(head || '').slice(0, 7) || '?';
  d.esperaProva = null;
  d.blockedKind = 'stale_head';
  d.blockedHead = head;
  d.headQuietoDesde = Date.now();
  d.reasons = [{ text: `chegou commit novo enquanto eu buscava a prova técnica (${anterior} -> ${novo}): reviso de novo sozinho, este texto fala do código anterior`, kind: 'gate' },
    ...(d.reasons || []).filter(r => !(r && typeof r === 'object' && r.espera === true))];
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: head andou de ${anterior} pra ${novo} na busca da prova; marcada stale_head.`);
  engine.emit('toast', { kind: 'info', text: `↻ ${item.key}: chegou commit novo enquanto eu buscava a prova, então reviso de novo sozinho; o card mostra quando.` });
  return 1;
}

export { largarPorCommitNovo };
