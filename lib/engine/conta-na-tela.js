// A CONTA de cada sessão e de cada PR da espera, no que vai para a tela e para o andamento
// entre aparelhos (29/09/2026). Sem ela, quem lê deduzia a conta pelo dono do repositório,
// e a revisão pedida a uma conta sem organização (a silenciada, usada para revisões
// escolhidas a dedo) aparecia como da conta dona da org: sumia da fila de uma e surgia
// "em execução" na outra. A conta é a do item (accountForPr), a mesma que revisa.

function contaDo(engine, pr) {
  return (engine && typeof engine.accountForPr === 'function' && engine.accountForPr(pr)) || '';
}

// O PR que o registro da sessão leva (revisão e autoanálise).
function prDaSessao(engine, pr) {
  return { key: pr.key, url: pr.url, title: pr.title || '', author: pr.author || '', account: contaDo(engine, pr) };
}

// A fila de espera: as chaves na ordem da fila (é a posição que o botão "Na fila (N)"
// mostra) e a conta de cada uma.
function esperaParaTela(engine) {
  const fila = engine.headlessQueue || [];
  return {
    headlessWaiting: fila.map(p => p.key),
    headlessWaitingContas: Object.fromEntries(fila.map(p => [p.key, contaDo(engine, p)])),
  };
}

export default { prDaSessao, esperaParaTela };
export { prDaSessao, esperaParaTela };
