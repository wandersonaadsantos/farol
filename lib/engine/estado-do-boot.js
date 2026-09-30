// O que o engine LE do disco no boot, nos formatos que cada arquivo ja teve. PURO.
//
// Saiu do server.js em 30/09/2026 pelo mesmo motivo dos outros dois modulos extraidos
// nesta semana: o arquivo esta acima do teto de tamanho e o ratchet passou a medir
// crescimento, entao codigo novo nao entra sem abrir espaco. E o assunto se sustenta
// sozinho: ler estado gravado por uma versao anterior sem que o boot precise saber
// quantos formatos ja existiram.

// keys do arquivo de estacionamento, nos dois formatos que ele já teve (lista crua até
// a v2.57.3; `{ keys, motivos }` desde a v2.57.4). Qualquer outra forma é vazio.
function chavesEstacionadas(salvo) {
  let lista = [];
  if (Array.isArray(salvo)) lista = salvo;
  else if (salvo && Array.isArray(salvo.keys)) lista = salvo.keys;
  return lista.filter(k => typeof k === 'string');
}

// FIX 3 (v2.53.1): a metade que o recoverInflight aplica na âncora de re-revisão
// de um PR que estava inflight no reinício. Âncora OBJETO ({head,dia,rodadas})
// só libera o head (fica ''), preservando dia/rodadas, pra o teto diário não
// zerar por causa de um reinício; âncora STRING legada devolve undefined (não
// há contador a preservar, então o chamador apaga como sempre). Função pura,
// extraída pra manter a profundidade de chaves do método baixa.
function ancoraAposReinicio(v) {
  if (v && typeof v === 'object') return { ...v, head: '' };
  return undefined;
}

const estadoDoBootMod = { chavesEstacionadas, ancoraAposReinicio };
export default estadoDoBootMod;
export { chavesEstacionadas, ancoraAposReinicio };
