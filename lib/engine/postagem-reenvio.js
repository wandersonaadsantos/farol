// O reenvio da postagem que falhou (retryFailedPosts, decision.js) nunca desiste de uma falha
// passageira (porte do fork, 17/11/2026). Antes, três tentativas, uma por
// ciclo de polling, e o card ia para a mesa como "desisti": o 500 de um GitHub instável ou uma
// queda de rede de meia hora tiravam da automação um APPROVE que o gate já tinha liberado, e o
// PR podia ser mesclado sem o review. Agora, depois das tentativas rápidas, o reenvio segue com
// recuo crescente (15 min, 30 min, 1 h ... até 6 h), sempre com as mesmas conferências de head
// e de dedup do primeiro envio. Só a recusa que não passa com o tempo, numa lista explícita,
// para de tentar, e a pendência fica com a pessoa, como sempre ficou no oficial.

import { BLOQUEIO_CREDENCIAL } from './credencial-no-texto.js';

// Tentativas rápidas (uma por ciclo de polling) antes do recuo longo. A curva do recuo tem a
// mesma forma da recuperação da prova (recuperacao-prova.js) e fica separada de propósito: são
// duas esperas de domínios diferentes (reenviar um texto pronto x reabrir uma sessão de IA), e
// mudar o ritmo de uma não deve arrastar a outra.
const TENTATIVAS_RAPIDAS = 3;
const RECUO_DO_REENVIO_MS = 15 * 60_000;
const RECUO_MAXIMO_DO_REENVIO_MS = 6 * 60 * 60_000;

// `longas` = tentativas além das rápidas; 0 = a primeira espera longa.
function recuoDoReenvio(longas) {
  return Math.min(RECUO_MAXIMO_DO_REENVIO_MS, RECUO_DO_REENVIO_MS * 2 ** Math.min(Math.max(Number(longas) || 0, 0), 5));
}

// A recusa permanente é só a lista explícita. Na dúvida, passageira: segue no recuo e é
// conferida de novo a cada tentativa. 5xx, 401, 403 e 404 momentâneos, head desconhecido, a
// reconferência técnica que não deu para fazer e erro desconhecido são passageiros. A recusa
// por credencial no texto tem tratamento próprio em decision.js.
const BLOQUEIOS_PERMANENTES = new Set(['criterios_inconsistentes', 'pr_proprio', 'instancia_isolada', BLOQUEIO_CREDENCIAL, 'internal_language']);
const RECONFERENCIA_QUE_FALHOU = /não foi possível reconfirmar/i;
const ERRO_422_DEFINITIVO = /\b422\b[\s\S]*\b(archived|locked)\b|\b(archived|locked)\b[\s\S]*\b422\b/i;

function ehPermanente(post) {
  if (!post || post.ok || post.semToken === true) return false;
  if (BLOQUEIOS_PERMANENTES.has(post.blocked)) return true;
  if (post.blocked === 'technical_review') return !RECONFERENCIA_QUE_FALHOU.test(String(post.error || ''));
  return !post.blocked && ERRO_422_DEFINITIVO.test(String(post.error || ''));
}

// Próximo estado do marcador depois de uma tentativa que falhou. `exhausted` (que a tela lê
// para dizer que o app parou de tentar) só fica verdadeiro na recusa permanente; a passageira
// ganha `proximaEm` depois das rápidas.
function proximaTentativa(postRetry, erro, { permanente = false, agora = Date.now() } = {}) {
  const attempts = (Number(postRetry && postRetry.attempts) || 0) + 1;
  if (permanente) return { ...postRetry, attempts, lastError: erro, exhausted: true, permanente: true };
  const longas = attempts - TENTATIVAS_RAPIDAS;
  const marca = { ...postRetry, attempts, lastError: erro, exhausted: false };
  delete marca.proximaEm;
  if (longas >= 0) marca.proximaEm = agora + recuoDoReenvio(longas);
  return marca;
}

// O item entra na varredura deste ciclo? Marca antiga com `exhausted` sem `permanente` (gravada
// quando o reenvio ainda desistia na terceira) volta ao reenvio: era passageira.
function devidoAgora(postRetry, agora = Date.now()) {
  if (!postRetry || postRetry.permanente === true) return false;
  return agora >= (Number(postRetry.proximaEm) || 0);
}

export { TENTATIVAS_RAPIDAS, recuoDoReenvio, ehPermanente, proximaTentativa, devidoAgora };
export default { TENTATIVAS_RAPIDAS, recuoDoReenvio, ehPermanente, proximaTentativa, devidoAgora };
