// O comentário do PR próprio já saiu? (revisão do Codex sobre a 8c1a1e2, achado 2)
//
// O dedup por estado (COMMENTED no commit) calava o comentário do Farol por causa de qualquer
// comentário anterior da conta no mesmo commit: um "vou olhar depois" escrito à mão, ou o de
// outro assunto. COMMENT não carrega veredito, então o que prova que ESTA publicação já está
// no PR é o próprio texto: um review COMMENTED da conta, neste commit, com o mesmo corpo.
//
// Lê pelo engine.myReviewsWithTime (decision.js), que traz o corpo junto. null = não deu para
// conferir (rede, token), e quem chama decide: o desfecho segue postando (nada saiu ainda), e
// o reenvio espera o próximo ciclo (uma tentativa anterior pode ter saído).

import { decisaoAutomaticaJaPublicada } from './review-head-policy.js';
const normalizar = (texto) => String(texto || '').replace(/\r\n/g, '\n').trim();

async function comentarioJaPublicado(engine, pr, head, body) {
  const reviews = await engine.myReviewsWithTime(pr);
  if (!Array.isArray(reviews)) return null;
  const alvo = normalizar(body);
  return reviews.some((r) => r && r.state === 'COMMENTED' && (!head || r.commit === head) && normalizar(r.body) === alvo);
}

// O "já saiu?" do reenvio, por evento: APPROVE e REQUEST_CHANGES pelo estado no commit (o
// dedup de sempre), COMMENT pelo texto. null = não deu para conferir.
async function jaPublicado(engine, item, event, payload, states) {
  if (event === 'comment') return comentarioJaPublicado(engine, { ...item.pr, key: item.key }, item.headSha, payload && payload.body);
  if (states === null) return null;
  return decisaoAutomaticaJaPublicada(item.pr, states) || states.includes(event === 'approve' ? 'APPROVED' : 'CHANGES_REQUESTED');
}

export default { comentarioJaPublicado, jaPublicado };
export { comentarioJaPublicado, jaPublicado };
