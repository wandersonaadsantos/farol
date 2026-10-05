// O recuo de UM degrau quando o GitHub recusa o review com 422 (saiu do decision.js em
// 05/10/2026, junto com a conferência do head que faltava).
//
// Os dois recuos largam a âncora `commit_id`, e sem ela o GitHub carimba o head do MOMENTO do
// segundo POST. A premissa era que o head já tinha sido conferido antes (review.js e decide()
// não deixam payload de head velho chegar à postagem), mas essa conferência é anterior ao
// primeiro POST: um push entre ela e o recuo fazia o texto revisado no commit antigo sair
// carimbado no commit novo, que ninguém leu. `recusaDoRecuo` relê o head logo antes do recuo
// e só deixa largar a âncora quando ele ainda é o que a revisão leu.

// Âncora inline inválida: recua os pontos pro corpo e tenta de novo. O `commit_id` fica
// FORA de propósito: o 422 pode ter vindo da própria âncora de head, e reenviar o mesmo sha
// falharia igual. Sem o campo o GitHub carimba o head do momento do POST, então o dedup do
// ciclo seguinte lê este review como sendo do head novo: é a degradação escolhida (o
// fallback já desistiu da precisão ao recuar os inlines pro corpo), não um esquecimento.
function inlineFallbackPayload(payload) {
  return {
    event: payload.event,
    body: payload.body + '\n\nOs comentários abaixo não puderam ser ancorados nas linhas do diff:\n' +
      payload.comments.map(c => `- \`${c.path}:${c.line}\`: ${c.body}`).join('\n'),
    comments: []
  };
}

// Mesmo degrau, um andar abaixo: review SEM comentário inline que levou 422 só tem UMA
// precisão pra recuar, a âncora de head. Existe porque o fallback acima é gateado em
// `comments.length` e o APPROVE, que quase nunca tem inline, ficava sem saída nenhuma
// (21/08/2026: o 422 matava a postagem e o clique repetia a recusa pra sempre).
function semAncoraPayload(payload) {
  if (!payload.commit_id) return null;
  return { event: payload.event, body: payload.body, comments: [] };
}

// null = pode recuar. Sem `commit_id` no original não há âncora a perder, e o recuo não muda
// de que commit o texto fala. Com ela, o head tem que ser lido AGORA e ser o mesmo; head que
// não deu para ler também segura, porque largar a âncora sem saber é exatamente o risco.
async function recusaDoRecuo(engine, pr, payload, recusaOriginal) {
  const ancora = String((payload && payload.commit_id) || '');
  if (!ancora) return null;
  let head = '';
  try { head = String((await engine.headSha(pr)) || ''); } catch { head = ''; }
  if (head === ancora) return null;
  const error = head
    ? 'o PR recebeu commit novo durante a postagem; o review não foi repostado sem âncora'
    : 'não deu para conferir o commit do PR; o review não foi repostado sem âncora';
  // a recusa do GitHub vai junto: sem ela, quem lê não sabe por que houve recuo
  const completo = recusaOriginal ? `${error} (o GitHub tinha recusado: ${recusaOriginal})` : error;
  engine.log('WARN', `postar review ${pr.key}: ${completo}`);
  return { ok: false, attempted: true, blocked: head ? 'head_mudou' : 'head_desconhecido', error: completo };
}

export { inlineFallbackPayload, semAncoraPayload, recusaDoRecuo };
export default { inlineFallbackPayload, semAncoraPayload, recusaDoRecuo };
