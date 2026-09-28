// Quem cuida de um PR da fila do admin (28/09/2026, ajustado 29/09/2026). Puro. O admin não
// executa, então cada PR da fila dele tem de dizer onde a revisão acontece, ou que ela não
// acontece.
//
// AUSÊNCIA DE LEITURA NÃO É AUSÊNCIA DE DADO (mesma régua de ui/pure/compartilhado.js): sem
// nunca ter lido a frota, ou com leitura velha, "sem aparelho com a conta X" seria uma
// afirmação que ninguém verificou. A operação ao vivo é prova por si só e não espera a
// frescura da frota: ela vem de outra leitura (rt.andamentoRemoto), e uma sessão rodando
// agora não fica menos verdadeira porque o retrato da frota atrasou.
const FRESCOR_MAX_MS = 60000;

function quemCuida({ acctTag = '', prTag = '', aparelhos = [], operacoes = [], lidoEm = 0, agora = Date.now() } = {}) {
  const viva = (Array.isArray(operacoes) ? operacoes : []).find((o) => o && o.prTag === prTag);
  if (viva) return { situacao: 'revisando', aparelho: String(viva.aparelho || '') };
  if (!(Number(lidoEm) > 0) || Number(agora) - Number(lidoEm) > FRESCOR_MAX_MS) {
    return { situacao: 'nao-lido', aparelho: '' };
  }
  // cuidar é VAI EXECUTAR: o admin, o pausado e quem não aceita o admin não recebem o PR
  const com = (Array.isArray(aparelhos) ? aparelhos : []).filter((a) => a && a.observador !== true
    && a.pausado !== true && a.aceitarAdmin !== false
    && Array.isArray(a.contasComToken) && a.contasComToken.includes(acctTag));
  if (com.length) return { situacao: 'cuida', aparelho: String(com[0].nome || '') };
  return { situacao: 'sem-aparelho', aparelho: '' };
}

export default { quemCuida, FRESCOR_MAX_MS };
export { quemCuida, FRESCOR_MAX_MS };
