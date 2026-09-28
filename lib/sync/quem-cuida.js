// Quem cuida de um PR da fila do admin (28/09/2026). Puro. O admin não executa, então cada
// PR da fila dele tem de dizer onde a revisão acontece, ou que ela não acontece.
function quemCuida({ acctTag = '', prTag = '', aparelhos = [], operacoes = [] } = {}) {
  const viva = (Array.isArray(operacoes) ? operacoes : []).find((o) => o && o.prTag === prTag);
  if (viva) return { situacao: 'revisando', aparelho: String(viva.aparelho || '') };
  const com = (Array.isArray(aparelhos) ? aparelhos : []).filter((a) => a && a.observador !== true
    && Array.isArray(a.contasComToken) && a.contasComToken.includes(acctTag));
  if (com.length) return { situacao: 'cuida', aparelho: String(com[0].nome || '') };
  return { situacao: 'sem-aparelho', aparelho: '' };
}

export default { quemCuida };
export { quemCuida };
