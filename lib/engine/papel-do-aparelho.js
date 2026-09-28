// O papel DESTE aparelho, lido do estado da sincronização. Sem compartilhamento ligado o
// aparelho é o Farol de sempre, e nunca observador.
import { ehObservador } from '../sync/papel.js';
import adminChave from '../sync/admin-chave.js';
import { sharedActive } from '../sync/config.js';

// Memo de leitura da chave local: { em: <timestamp>, tem: <bool> }. A chave é custosa
// (readFileSync + JSON.parse) e só importa quando não há sinal do admin. A memória expira
// em 5 segundos para pegar trocas de chave, mas não lê em cada chamada de enfileira/admissão.
let memoChaveLocal = null;
const MEMO_TTL_MS = 5000;

function souObservador(engine, { lerChave = adminChave.lerChaveDeAdmin, agora = Date.now() } = {}) {
  const cfg = (engine && engine.config && engine.config.sync) || {};
  if (!sharedActive(cfg)) return false;
  const rt = engine.sync || {};
  const admin = rt.sinais && rt.sinais.admin ? String(rt.sinais.admin.dev || '') : '';
  // Se há sinal do admin, a chave local não importa; só lê sob demanda quando não há sinal
  let temChaveDeAdmin = false;
  if (!admin) {
    // Sem sinal, tenta usar memo
    if (memoChaveLocal && (agora - memoChaveLocal.em) < MEMO_TTL_MS) {
      temChaveDeAdmin = memoChaveLocal.tem;
    } else {
      // Memo expirado ou ausente, lê e guarda
      temChaveDeAdmin = !!lerChave();
      memoChaveLocal = { em: agora, tem: temChaveDeAdmin };
    }
  }
  return ehObservador({ adminDev: admin, deviceId: rt.deviceId, temChaveDeAdmin });
}

const AVISO_OBSERVADOR = 'Este aparelho é o admin: ele assiste e decide, e as revisões rodam nos aparelhos com a conta.';

export default { souObservador, AVISO_OBSERVADOR };
export { souObservador, AVISO_OBSERVADOR };
