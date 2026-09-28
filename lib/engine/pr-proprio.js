// PR de autoria da PRÓPRIA conta nunca vira revisão headless (28/09/2026).
//
// Medido num PR do engine-ai: o autor era a conta deste Farol, e um aparelho do grupo
// abriu revisão headless nele com essa mesma conta. A label `<conta>:revisando` ficou
// oito minutos no PR, e o time viu o autor "revisando" o próprio trabalho. A fila
// automática nunca traz PR próprio (o GitHub não deixa pedir revisão ao autor), mas os
// outros caminhos até o enqueueHeadless (clique no panorama, URL avulsa, re-revisão e os
// comandos entre aparelhos, que acham o PR também em `myPRs`) não conferiam o autor.
//
// O lugar do autor no próprio PR é a autoanálise (selfpr.js), que não põe label e não
// posta nada. Por isso a regra vale inclusive para o clique: não existe revisão headless
// legítima de PR próprio, e o botão certo para isso já existe.
//
// Sem rede de propósito: o autor vem do item (fila, panorama, comando e distribuição o
// trazem) e, para a URL avulsa que chega sem ele, da lista `myPRs`, que é exatamente a
// busca `--author @me` de cada conta. Falta de dado nunca bloqueia.

// PURA. Autor ou conta vazios não provam nada, então dão false.
function ehPrProprio(autor, conta) {
  const a = String(autor || '').trim().toLowerCase();
  const c = String(conta || '').trim().toLowerCase();
  return !!a && !!c && a === c;
}

function ehMeu(engine, pr) {
  if (ehPrProprio(pr.author, engine.accountForPr(pr))) return true;
  return !pr.author && (engine.myPRs || []).some(p => p && p.url === pr.url);
}

function avisoPrProprio(key) {
  return `${key} é seu: revisão não abre em PR próprio. Use a autoanálise em Meus PRs.`;
}

// Tirar os PRs próprios de um lote é da porta de execução (porta-de-execucao.js), que
// junta esta regra com a do aparelho admin.
export { ehPrProprio, ehMeu, avisoPrProprio };
export default { ehPrProprio, ehMeu, avisoPrProprio };
