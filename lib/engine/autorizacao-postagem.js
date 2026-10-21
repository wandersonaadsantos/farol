// Autorizações de postagem das sessões interativas e sua revogação.
import crypto from 'node:crypto';
import { TEMPOS } from '../constants.js';
import { iniciarTrabalho, encerrarTrabalho } from './continuidade-revisao.js';

const REVIEW_CAP_TTL_MS = TEMPOS.AUTORIZACAO_POSTAGEM_MS;

// Idade a partir da qual uma sessão de TERMINAL deixa de contar como viva: 12h cobre
// com folga o uso humano (almoço, reunião, voltar de manhã cedo no dia seguinte). Acima
// disso, quem segura a entrada quase sempre é um terminal FANTASMA (janela morta cujo
// aviso de saída, o trap EXIT, nunca chegou, pendência conhecida do macOS), e sessão
// fantasma não pode segurar credencial de escrita nem travar o update enquanto o engine
// viver. FONTE ÚNICA de propósito: o mesmo fantasma é julgado aqui (isenção de TTL da
// capability, G17) e em lib/engine/update.js (busy do update, G14); dois números
// divergentes fariam a mesma janela morta ser fantasma num lugar e viva no outro.
const TERMINAL_SESSION_MAX_MS = TEMPOS.SESSAO_TERMINAL_MAX_MS;

// A sessão dona da cap ainda está aberta, é uma sessão de terminal E a cap ainda está
// dentro do teto absoluto? Só esse trio isenta do TTL (ver o laço de poda em reviewCaps).
// Sem createdAt confiável não há isenção: falha fechado, porque sem idade provada não dá
// pra afirmar que a cap está dentro do teto.
function terminalOwnerAlive(engine, cap, now) {
  if (!cap || !cap.ownerId) return false;
  if (!Number.isFinite(cap.createdAt) || now - cap.createdAt > TERMINAL_SESSION_MAX_MS) return false;
  if (!(engine.activeReviews instanceof Map)) return false;
  const dona = engine.activeReviews.get(String(cap.ownerId));
  return !!dona && dona.mode === 'terminal';
}

function reviewCaps(engine) {
  if (!(engine.reviewPostCaps instanceof Map)) engine.reviewPostCaps = new Map();
  const now = Date.now();
  for (const [token, cap] of engine.reviewPostCaps) {
    // G17: sessão de TERMINAL não tem prazo (o usuário abre a janela e pode voltar horas
    // depois); enquanto a sessão dona viver, a cap vive junto. O TTL segue valendo pra cap
    // ÓRFÃ (sessão morta que deixou token pra trás), que é o risco real que ele mitiga.
    // A isenção é SÓ de terminal, checada no modo da sessão dona: a revisão headless
    // (mode 'auto') também mora em activeReviews enquanto roda, e uma exceção genérica
    // por "dona viva" daria cap sem prazo pra ela. O chat nem entra em activeReviews.
    // E a isenção tem teto absoluto (TERMINAL_SESSION_MAX_MS): terminal fantasma não vira
    // credencial eterna.
    if (!cap || (cap.expiresAt <= now && !terminalOwnerAlive(engine, cap, now))) revokeReviewPostCapability(engine, token);
  }
  return engine.reviewPostCaps;
}

// Capability efêmera: o header x-farol é proteção de origem, não segredo. A escrita
// interativa precisa também estar limitada aos PRs e à conta daquela sessão.
function createReviewPostCapability(engine, keys, account, source, ownerId) {
  const scopedKeys = new Set((Array.isArray(keys) ? keys : [])
    .map(k => String(k || '').trim())
    .filter(k => /^[\w.-]+\/[\w.-]+#\d+$/.test(k)));
  if (!scopedKeys.size || engine.isMuted?.(account)) return '';
  const token = crypto.randomBytes(32).toString('base64url');
  reviewCaps(engine).set(token, {
    keys: scopedKeys,
    continuidade: new Map([...scopedKeys].map(key => [key, iniciarTrabalho(engine, { key, account })])),
    used: new Set(),
    account: String(account || ''),
    source: String(source || ''),
    ownerId: String(ownerId || ''),
    createdAt: Date.now(), // âncora do teto absoluto da isenção de dona viva (G17)
    expiresAt: Date.now() + REVIEW_CAP_TTL_MS,
  });
  return token;
}

function revokeReviewPostCapability(engine, token) {
  const cap = engine.reviewPostCaps?.get(String(token || ''));
  for (const permissao of cap?.continuidade?.values() || []) encerrarTrabalho(permissao);
  engine.reviewPostCaps?.delete(String(token || ''));
}

function revokeReviewPostCapabilitiesByOwner(engine, ownerId) {
  const owner = String(ownerId || '');
  if (!(engine.reviewPostCaps instanceof Map)) return;
  for (const [token, cap] of engine.reviewPostCaps) {
    if (cap && cap.ownerId === owner) revokeReviewPostCapability(engine, token);
  }
}

function reviewPostCapability(engine, token, key) {
  const cap = reviewCaps(engine).get(String(token || ''));
  if (!cap) return { ok: false, error: 'autorização de postagem ausente ou expirada' };
  if (!cap.keys.has(key)) return { ok: false, error: 'esta sessão não pode postar nesse PR' };
  if (cap.used.has(key)) return { ok: false, error: 'a revisão desse PR já foi enviada nesta sessão' };
  if (cap.inflight && cap.inflight.has(key)) return { ok: false, error: 'a revisão desse PR já está sendo enviada nesta sessão' };
  return { ok: true, cap };
}

export { reviewCaps, createReviewPostCapability, revokeReviewPostCapability, revokeReviewPostCapabilitiesByOwner, reviewPostCapability, TERMINAL_SESSION_MAX_MS };
