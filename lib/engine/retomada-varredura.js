// Referência de retomada de PR que foi mergeado ou fechado sai do inflight.json
// (25/09/2026).
//
// O lib/engine/retomada-duravel.js lista "PR mergeado ou fechado" entre os desfechos que
// consomem a entrada, mas só a repescagem do retry (server.js, _repescarRetry) cumpria isso,
// e o mapa do retry é memória: depois de um reinício a entrada continuava no disco e ninguém
// mais perguntava pelo PR. Medido: biudtech/engine-ai#224 ficou "pendente" uma semana depois
// do merge.
//
// Aqui o ciclo pergunta o estado do PR cuja entrada sobrou: só dos que não estão na fila de
// pedidos deste ciclo (esses estão abertos, por definição), nem rodando, nem esperando vaga.
// No máximo uma pergunta por PR a cada TEMPOS.RETOMADA_CONFERIR_MS. E só consome com prova:
// sem resposta (rede, token), a entrada fica, pela mesma regra do prState.
import retomadaMod from './retomada-duravel.js';
import { TEMPOS } from '../constants.js';

function chavesVivas(engine) {
  const vivas = new Set();
  for (const p of engine.queue || []) if (p && p.key) vivas.add(p.key);
  for (const p of engine.headlessQueue || []) if (p && p.key) vivas.add(p.key);
  for (const s of engine.activeReviews instanceof Map ? engine.activeReviews.values() : []) {
    if (s && s.pr && s.pr.key) vivas.add(s.pr.key);
  }
  return vivas;
}

async function varrerFechadas(engine, agora = Date.now()) {
  if (!(engine.retomadas instanceof Map) || !engine.retomadas.size) return;
  if (!(engine.retomadaConferidaEm instanceof Map)) engine.retomadaConferidaEm = new Map();
  const vivas = chavesVivas(engine);
  let consumiu = false;
  for (const [key, entrada] of [...engine.retomadas]) {
    if (vivas.has(key)) continue;
    const ultima = engine.retomadaConferidaEm.get(key);
    if (ultima !== undefined && agora - ultima < TEMPOS.RETOMADA_CONFERIR_MS) continue;
    engine.retomadaConferidaEm.set(key, agora);
    let estado = null;
    try { estado = await engine.prState(entrada); } catch { estado = null; }
    if (estado === 'MERGED' || estado === 'CLOSED') {
      retomadaMod.consumirRetomada(engine, key);
      engine.retomadaConferidaEm.delete(key);
      consumiu = true;
    }
  }
  if (consumiu) engine.writeInflight();
}

export default { varrerFechadas };
export { varrerFechadas };
