// O consumo de uma sessão que morre antes do evento final, mensagem a mensagem.
// Saiu do session.js em 30/10/2026, quando ganhou a mensagem ainda sendo escrita.

// Campo ausente vale zero: mensagem sem usage não pode zerar o que já foi contado, nem
// inventar token.
const CAMPOS_USO = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];

// Soma o uso de UMA mensagem no acumulador da sessão. MEDIDO em três sessões reais do CLI
// (A1, item 1, 16/09/2026): cada bloco de conteúdo chega como evento separado, com o MESMO
// message.id e o MESMO uso, e somar tudo dobrava entrada e cache. Cada id conta uma vez,
// com o último uso visto. A saída desses eventos é um PISO (o total só chega no evento
// final), por isso a linha parcial segue estimada. Mensagem sem id continua somando: sem id
// não há como deduplicar. O mapa por id não é enumerável e nunca viaja no diário. Devolve
// se somou alguma coisa, que distingue "morreu sem gastar" de "gastou e morreu".
function acumularParcial(acc, usage, messageId) {
  if (!acc || !usage || typeof usage !== 'object') return false;
  const valores = {};
  let algum = false;
  for (const campo of CAMPOS_USO) {
    valores[campo] = Math.max(0, Number(usage[campo]) || 0);
    if (valores[campo] > 0) algum = true;
  }
  if (!algum) return false;
  if (typeof messageId === 'string' && messageId) descontarAnterior(acc, messageId, valores);
  for (const campo of CAMPOS_USO) acc[campo] += valores[campo];
  return true;
}

function descontarAnterior(acc, messageId, valores) {
  if (!acc.porMensagem) Object.defineProperty(acc, 'porMensagem', { value: new Map(), enumerable: false });
  const anterior = acc.porMensagem.get(messageId);
  if (anterior) for (const campo of CAMPOS_USO) acc[campo] -= anterior[campo];
  acc.porMensagem.set(messageId, valores);
}

// A mensagem que o modelo ainda está escrevendo (stream_event, 30/10/2026). A reconferência
// do biud-frontend#1627 morreu depois de minutos escrevendo o envelope e entrou no Consumo
// com 79 tokens de saída: sem a mensagem fechada, nada dela era contado. O message_start traz
// a entrada e o cache; a saída só chega no message_delta do fim, então até lá ela é estimada
// pelo texto recebido. O id é o mesmo do evento `assistant`, que substitui a estimativa pelo
// valor real quando a mensagem fecha. Um estado por agente: subagentes escrevem em paralelo.
const CARACTERES_POR_TOKEN = 4;

function usoDoStream(estados, ev) {
  const evento = ev?.event;
  if (!evento || typeof evento !== 'object') return null;
  const chave = ev.parent_tool_use_id || '';
  if (evento.type === 'message_start' && evento.message?.id) {
    estados.set(chave, { id: String(evento.message.id), base: evento.message.usage || {}, caracteres: 0 });
    return { id: String(evento.message.id), usage: { ...evento.message.usage } };
  }
  const estado = estados.get(chave);
  if (!estado) return null;
  if (evento.type === 'message_delta' && evento.usage) return { id: estado.id, usage: { ...estado.base, ...evento.usage } };
  if (evento.type !== 'content_block_delta') return null;
  const delta = evento.delta || {};
  estado.caracteres += String(delta.text ?? delta.thinking ?? delta.partial_json ?? '').length;
  return { id: estado.id, usage: { ...estado.base, output_tokens: Math.ceil(estado.caracteres / CARACTERES_POR_TOKEN) } };
}

export { acumularParcial, usoDoStream, CAMPOS_USO };
