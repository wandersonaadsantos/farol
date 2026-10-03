// Pendência na mesa + commit novo = revisão nova, sem clique (02/10/2026).
//
// Até aqui um resultado que ficava em "Precisa de você" congelava o PR: chegava commit
// novo e nada automático acontecia. O gatilho de re-revisão via review meu parava em
// `pendencia_viva`, o destrave ignorava pendência e o pedido de revisão de novo também.
// Só o seu clique em Aprovar ou Pedir mudanças via o head diferente, marcava a pendência
// como `stale_head` e relançava (decide() em decision.js). Pedido do dono: reanalisar o
// necessário sem depender de ação manual.
//
// Aqui o ciclo faz o que o clique fazia: pendência viva cujo head no GitHub não é mais o
// que a sessão leu vira `stale_head`, com o head novo em `blockedHead`. Quem relança é o
// gatilho B de sempre (explicaReRound em review.js), com o debounce de PR quieto
// recomeçando agora (`headQuietoDesde`), então rajada de push ainda em curso espera. Os
// gates de postagem não mudam: a revisão nova passa por todos eles.
//
// Ficam de fora as pendências que já têm dono para o commit novo: a que espera o CI
// (espera-ci.js larga a espera e marca stale_head), a de reenvio de postagem (postRetry,
// que se desarma sozinho com head novo) e a que já é stale_head. Leitura que falha ou
// pendência sem o head lido não mudam nada: falta de prova nunca dispara revisão.
const curto = (sha) => String(sha || '').slice(0, 7) || '?';

function candidata(d) {
  return !!d && !d.blockedKind && !d.esperaCi && !d.postRetry && !!d.headSha && !!d.pr;
}

// `alvo`: o mesmo recorte de chaves do reconcilePending que chama (null = todas).
async function marcarCommitNovo(engine, alvo = null, agora = Date.now()) {
  const pendentes = ((engine.decisions || {}).pending || []).filter((d) => candidata(d) && (!alvo || alvo.has(d.key)));
  let marcadas = 0;
  for (const item of pendentes) {
    let head = '';
    try { head = await engine.headSha({ ...item.pr, key: item.key }); }
    catch (err) { engine.log('WARN', `head de ${item.key}: ${err.message}`); continue; }
    if (!head || head === item.headSha) continue;
    // re-acha: a pendência pode ter sido decidida durante o await
    const d = engine.decisions.pending.find((x) => x.id === item.id);
    if (!d || !candidata(d)) continue;
    d.blockedKind = 'stale_head';
    d.blockedHead = head;
    d.headQuietoDesde = agora;
    d.reasons = [{ text: `chegou commit novo enquanto o resultado esperava você (${curto(d.headSha)} -> ${curto(head)}): reviso de novo sozinho, este texto fala do código anterior`, kind: 'gate' },
      ...(Array.isArray(d.reasons) ? d.reasons : [])];
    marcadas++;
    engine.log('INFO', `${item.key}: head andou de ${curto(d.headSha)} pra ${curto(head)} com a pendência na mesa; marcada stale_head, a re-revisão sai sozinha.`);
    engine.emit('toast', { kind: 'info', text: `↻ ${item.key}: chegou commit novo, então reviso de novo sozinho; o card mostra quando.` });
  }
  if (marcadas) engine.saveDecisions();
  return marcadas;
}

export default { marcarCommitNovo };
export { marcarCommitNovo };
