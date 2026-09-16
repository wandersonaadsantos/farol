// Transferência voluntária de uma revisão em andamento (7.C7). Puro: sem estado, sem IO.
//
// TRANSFERÊNCIA NÃO É MIGRAÇÃO DE SESSÃO. O `sid` do CLI vale só na máquina que o abriu
// (CT-RET), então o que viaja é a MEMÓRIA do que já foi verificado (C7a) e a colocação do
// item. A sessão de origem é encerrada, e a de destino começa do zero com essa memória.
//
// SÓ PARA DESTINO APTO, e "apto" aqui é mais do que estar vivo: resumo fresco (aparelho
// que não publica capacidade não é enxergável), não pausado pela política, com vaga, com
// provedor de IA pronto e com a CREDENCIAL da conta do PR. Sem credencial no destino não
// existe continuidade: ele não conseguiria nem ler o PR, e a transferência viraria um
// trabalho parado em silêncio.
//
// A PREFERÊNCIA TEM PRAZO. Ela é o único jeito de a colocação sair para um aparelho
// específico, e por isso vence: preferir para sempre um aparelho que sumiu seria reservar
// o PR indefinidamente, exatamente o que a spec proíbe.
const MOTIVOS = ['sem-resumo', 'pausado', 'sem-vaga', 'sem-ia', 'sem-credencial'];

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// `resumo` é a capacidade publicada pelo destino (C3a), já decifrada.
function destinoApto(resumo, { acctTag = '', agora = 0 } = {}) {
  const c = objeto(resumo) ? resumo : null;
  if (!c || Number(c.frescoAte) <= Number(agora)) return { apto: false, motivo: 'sem-resumo' };
  if (c.pausado === true) return { apto: false, motivo: 'pausado' };
  if (c.iaPronta === false) return { apto: false, motivo: 'sem-ia' };
  const teto = Math.max(1, Number(c.teto) || 1);
  if (Number(c.ocupadas) >= teto) return { apto: false, motivo: 'sem-vaga' };
  if (acctTag && !(Array.isArray(c.contas) && c.contas.includes(acctTag) && c.token === true)) {
    return { apto: false, motivo: 'sem-credencial' };
  }
  return { apto: true, motivo: '' };
}

// A preferência do item: vale para o aparelho pedido, enquanto não vencer.
function preferenciaValida(pref, { agora = 0 } = {}) {
  if (!objeto(pref) || !pref.dev) return '';
  return Number(pref.ate) > Number(agora) ? String(pref.dev) : '';
}

export default { MOTIVOS, destinoApto, preferenciaValida };
export { MOTIVOS, destinoApto, preferenciaValida };
