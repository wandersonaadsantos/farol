// Posse de POSTAGEM entre aparelhos (CT-POST, passo 1). É o MESMO lease das análises
// (/leases/{conta}/{pr}), com operationKind 'post': não existe lock separado por via. A
// revisão automática que segura o lease da sessão exclui o clique, o reenvio, o chat e a
// co-assinatura do mesmo PR, e cada uma dessas exclui as outras.
//
// O handle devolvido é o do coordenador: batimento, validoPor (a última conferência antes
// do POST) e abort. A impressão digital é a da revisão daquele head, porque é o recibo dela
// que guarda o registro de postagem; o handle de postagem nunca chama complete.
//
// Nada aqui lança: recusa volta como { ok: false, motivo }.
import { APP_VERSION } from '../paths.js';
import { accountHash, prHash, operationFingerprint, novoId } from './keys.js';
import { acquireLease } from './lease.js';
import { createHandle } from './coordinator.js';

const CONECTADO = 'conectado';

function recusa(motivo) {
  return { ok: false, motivo };
}

function idsDe(rt, c) {
  const ph = prHash(c.prKey);
  if (!ph || !String(c.account || '').trim() || !c.headSha) return null;
  return { uid: rt.uid, accountHash: accountHash(c.account), prHash: ph };
}

async function tentarLease(rt, ids, c) {
  const dados = { leaseId: novoId(), deviceId: rt.deviceId, operationKind: 'post', headSha: c.headSha, nowMs: rt.agora(), farolVersion: APP_VERSION };
  try {
    const a = await acquireLease(rt.client, ids, dados);
    return { a, leaseId: dados.leaseId };
  } catch {
    return { a: { ok: false, reason: 'indisponivel' }, leaseId: '' };
  }
}

async function adquirirPosseDePostagem(engine, ctx) {
  const rt = engine && engine.sync;
  if (!rt || rt.status !== CONECTADO || !rt.client) return recusa('coordenacao-indisponivel');
  const c = ctx || {};
  const ids = idsDe(rt, c);
  if (!ids) return recusa('coordenacao-indisponivel');
  const { a, leaseId } = await tentarLease(rt, ids, c);
  if (!a.ok && a.reason === 'alheio') return recusa('posse-alheia');
  if (!a.ok) return recusa('coordenacao-indisponivel');
  const handle = createHandle(engine, {
    ids, fingerprint: operationFingerprint('review', c.headSha), leaseId, attemptId: '',
    ctx: { prKey: c.prKey, operationKind: 'post', materialVersion: c.headSha, opId: '' }, expiresAt: a.lease.expiresAt,
  });
  return { ok: true, handle };
}

export default { adquirirPosseDePostagem };
export { adquirirPosseDePostagem };
