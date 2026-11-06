// Regra única de gasto dos pedidos de agente: conferida ao pedir (autoanalise-agente.js) e de novo
// na vez do item na fila (review.js), porque o orçamento pode estourar no meio da espera.
export function recusa(code, motivo) { return { ok: false, code, motivo }; }

// Os mesmos quatro freios que seguram a fila automática, com o motivo escrito: um agente em
// laço não gasta a assinatura sozinho.
const FREIOS_DE_GASTO = [
  ['grupo_em_espera', (e, conta) => e.grupoSegura(conta) && 'o teto do grupo de consumo está em espera'],
  ['limite_do_plano', (e, conta) => e.limiteDoPlanoAte(conta) && 'a assinatura do Claude está no limite do plano'],
  ['orcamento', (e, conta) => { const p = e.budgetBlockedFor(conta); return p && `o orçamento do perfil "${p.label}" estourou`; }],
  ['cota', (e, conta) => { const q = e.quotaBlockedFor(conta); return q && `a cota do perfil "${q.profile?.label || ''}" está no limite`; }],
];

export function recusaDeGasto(engine, conta) {
  for (const [code, motivoDe] of FREIOS_DE_GASTO) {
    const motivo = motivoDe(engine, conta);
    if (motivo) return recusa(code, motivo);
  }
  return null;
}
