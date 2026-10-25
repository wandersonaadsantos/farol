// Projeções históricas mudam nas gravações; orçamento/falhas continuam calculados ao consultar.
const state = new WeakMap();
const revisions = new WeakMap();
function invalidateUsage(engine) { state.delete(engine); }
function invalidateUsageStore(store) { revisions.set(store, (revisions.get(store) || 0) + 1); }
function usageProjection(engine, compute) {
  const old = state.get(engine);
  const revision = revisions.get(engine.usage) || 0;
  if (old && old.store === engine.usage && old.sessions === engine.usageSessions && old.revision === revision) return old.value;
  const value = compute();
  state.set(engine, { store: engine.usage, sessions: engine.usageSessions, revision, value });
  return value;
}
export { invalidateUsage, invalidateUsageStore, usageProjection };
