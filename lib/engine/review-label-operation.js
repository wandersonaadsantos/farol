// Inclusão e remoção explícita da mesma tag terminam na ordem solicitada.
import { canonicalPrKey } from '../sync/keys.js';
const filas = new WeakMap();
async function naOrdem(engine, key, label, executar) {
  if (!filas.has(engine)) filas.set(engine, new Map());
  const fila = filas.get(engine), id = `${canonicalPrKey(key)}|${label.toLowerCase()}`;
  const anterior = fila.get(id) || Promise.resolve();
  const atual = anterior.catch(() => {}).then(executar);
  fila.set(id, atual);
  try { return await atual; }
  finally { if (fila.get(id) === atual) fila.delete(id); }
}
export { naOrdem };
