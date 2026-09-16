// Transferência voluntária de uma revisão em andamento (7.C7). Puro: sem estado, sem IO.
//
// TRANSFERÊNCIA NÃO É MIGRAÇÃO DE SESSÃO. O `sid` do CLI vale só na máquina que o abriu
// (CT-RET), então o que viaja é a MEMÓRIA do que já foi verificado (C7a) e a colocação do
// item. A sessão de origem é encerrada, e a de destino começa do zero com essa memória.
//
// SÓ PARA DESTINO APTO, e "apto" aqui é mais do que estar vivo: resumo fresco (aparelho
// que não publica capacidade não é enxergável), consentindo em obedecer ao admin (sem isso
// ele nunca aceitaria a atribuição), não pausado pela política, com vaga, com provedor de
// IA pronto e com a CREDENCIAL da conta do PR. Sem credencial no destino não existe
// continuidade: ele não conseguiria nem ler o PR, e a transferência viraria um trabalho
// parado em silêncio.
//
// A PREFERÊNCIA TEM PRAZO. Ela é o único jeito de a colocação sair para um aparelho
// específico, e por isso vence: preferir para sempre um aparelho que sumiu seria reservar
// o PR indefinidamente, exatamente o que a spec proíbe.
import frota from './frota.js';

const MOTIVOS = ['sem-resumo', 'sem-consentimento', 'pausado', 'sem-vaga', 'sem-ia', 'sem-credencial'];

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// `resumo` é a capacidade publicada pelo destino (C3a), já decifrada. O consentimento só
// recusa quando o resumo diz `false` com todas as letras: resumo que não fala dele é de
// quem montou o objeto à mão, e quem publica capacidade sempre o declara.
function destinoApto(resumo, { acctTag = '', agora = 0 } = {}) {
  const c = objeto(resumo) ? resumo : null;
  if (!c || Number(c.frescoAte) <= Number(agora)) return { apto: false, motivo: 'sem-resumo' };
  if (c.aceitarAdmin === false) return { apto: false, motivo: 'sem-consentimento' };
  if (c.pausado === true) return { apto: false, motivo: 'pausado' };
  if (c.iaPronta === false) return { apto: false, motivo: 'sem-ia' };
  const teto = Math.max(1, Number(c.teto) || 1);
  if (Number(c.ocupadas) >= teto) return { apto: false, motivo: 'sem-vaga' };
  if (acctTag && !(Array.isArray(c.contas) && c.contas.includes(acctTag) && c.token === true)) {
    return { apto: false, motivo: 'sem-credencial' };
  }
  return { apto: true, motivo: '' };
}

// O que a TELA mostra antes de pedir: a mesma aptidão do executor, precedida do que o
// registro do aparelho já diz (dono atual, aposentado, versão, chave, sinal) e seguida da
// memória, que a admissão do destino recusaria depois. É leitura para escolher, nunca a
// decisão: o aparelho de origem confere `destinoApto` de novo na hora de largar a sessão.
//
// `publicadores` só existe na escolha de quem INICIA um candidato (C6): quem não publicou
// aquele item não o conhece, e o executor recusaria com `nao_publiquei`. Lista ausente é
// a transferência de sempre, em que qualquer aparelho apto serve de destino.
function naoPublicou(id, publicadores) {
  return Array.isArray(publicadores) && !publicadores.includes(String(id));
}

function motivoDoDestino({ id, aparelho, resumo, dono = '', acctTag = '', agora = 0, publicadores = null }) {
  const d = objeto(aparelho) ? aparelho : {};
  if (String(id) === String(dono)) return 'dono-atual';
  if (Number(d.retiredAt) > 0) return 'aposentado';
  if (d.contract !== frota.CONTRATO) return 'versao-antiga';
  if (d.keyReady !== true) return 'sem-chave';
  if (!frota.aparelhoV2(d, { agora })) return 'sem-sinal';
  if (naoPublicou(id, publicadores)) return 'nao-publicou';
  const apto = destinoApto(resumo, { acctTag, agora });
  if (!apto.apto) return apto.motivo === 'sem-resumo' ? 'sem-sinal' : apto.motivo;
  if (resumo.ramLivre === 'desconhecida') return 'memoria-desconhecida';
  return resumo.ramLivre === 'baixa' ? 'memoria-baixa' : '';
}

// A origem é quem APLICA o comando: sem consentimento ela o ignora, e sem sinal ninguém
// sabe se ela vai ler. As duas coisas a tela diz antes de oferecer o envio.
function motivoDaOrigem(resumo, { agora = 0 } = {}) {
  const c = objeto(resumo) ? resumo : null;
  if (!c || Number(c.frescoAte) <= Number(agora)) return 'sem-sinal';
  return c.aceitarAdmin === true ? '' : 'sem-consentimento';
}

// A preferência do item: vale para o aparelho pedido, enquanto não vencer.
function preferenciaValida(pref, { agora = 0 } = {}) {
  if (!objeto(pref) || !pref.dev) return '';
  return Number(pref.ate) > Number(agora) ? String(pref.dev) : '';
}

export default { MOTIVOS, destinoApto, motivoDoDestino, motivoDaOrigem, preferenciaValida };
export { MOTIVOS, destinoApto, motivoDoDestino, motivoDaOrigem, preferenciaValida };
