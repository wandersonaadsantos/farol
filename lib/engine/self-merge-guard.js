import { coordinationActive } from '../sync/config.js';
import { adquirirPosseDePostagem } from '../sync/posse-postagem.js';

// Merge disputa o mesmo lease das análises e o segura até o GitHub responder.
// Não grava recibo de review: só exclui uma nova análise durante a escrita.
export async function comPosseDeMerge(engine, contexto, executar) {
  const ocupada = [...engine.activeReviews.values()].some(s => s.mode === 'self' && (s.keys || []).includes(contexto.prKey))
    || engine.headlessQueue.some(p => p.kind === 'self' && p.key === contexto.prKey);
  if (ocupada) return { ok: false, error: 'autoanálise em andamento; aguarde antes de mergear' };
  if (!coordinationActive(engine.config.sync)) return executar(null);
  const posse = await adquirirPosseDePostagem(engine, contexto);
  if (!posse.ok) return { ok: false, error: `merge aguardando coordenação entre aparelhos: ${posse.motivo}` };
  try { return await executar(posse.handle); }
  finally { await posse.handle.abort(); }
}
