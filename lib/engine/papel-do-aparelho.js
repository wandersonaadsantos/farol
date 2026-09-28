// O papel DESTE aparelho, lido do estado da sincronizacao. Sem compartilhamento ligado o
// aparelho e o Farol de sempre, e nunca observador.
import { ehObservador } from '../sync/papel.js';
import adminChave from '../sync/admin-chave.js';
import { sharedActive } from '../sync/config.js';

function souObservador(engine) {
  const cfg = (engine && engine.config && engine.config.sync) || {};
  if (!sharedActive(cfg)) return false;
  const rt = engine.sync || {};
  const admin = rt.sinais && rt.sinais.admin ? String(rt.sinais.admin.dev || '') : '';
  return ehObservador({ adminDev: admin, deviceId: rt.deviceId, temChaveDeAdmin: !!adminChave.lerChaveDeAdmin() });
}

const AVISO_OBSERVADOR = 'Este aparelho e o admin: ele assiste e decide, e as revisoes rodam nos aparelhos com a conta.';

export default { souObservador, AVISO_OBSERVADOR };
export { souObservador, AVISO_OBSERVADOR };
