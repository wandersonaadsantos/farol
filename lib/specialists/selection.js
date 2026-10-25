// Legado é global por segurança. Só curadoria explicitamente modular pode ser omitida.
function applicableEntries(entries, relevantPaths) {
  if (!Array.isArray(relevantPaths)) return entries;
  return entries.filter(entry => entryApplies(entry, relevantPaths));
}
function entryApplies(entry, paths) {
  if (entry.scope !== 'module') return true;
  return entry.sources.some(source => paths.some(p => p === source.path || p.startsWith(source.path.slice(0, source.path.lastIndexOf('/') + 1))));
}
function compactSource(source, entryId, excerpts) {
  const key = `${source.blob}:${source.start}:${source.end}`;
  const previous = excerpts.get(key);
  if (previous) { const { excerpt, ...reference } = source; return { ...reference, excerptRef: previous }; }
  const ref = `${entryId}:${excerpts.size}`;
  excerpts.set(key, ref);
  return { ...source, excerptId: ref };
}
function compactEvidence(entries) {
  const excerpts = new Map();
  return entries.map(entry => ({ ...entry, sources: entry.sources.map(source => compactSource(source, entry.id, excerpts)) }));
}
export { applicableEntries, compactEvidence };
