// Diagnóstico somente leitura. Nenhuma categoria autoriza exclusão.
import fs from 'node:fs';
import path from 'node:path';
import { parseJson, safeStringify } from '../lib/io.js';
import { executadoDireto } from '../lib/paths.js';
import { readRegularFile } from '../lib/bounded-file.js';

const ID = /^review-[A-Za-z0-9]+$/;
const SID = /^[A-Za-z0-9-]{8,64}$/;
const categories = ['active-consumer-confirmed', 'active-consumer-candidate', 'resumable-checkpoint-candidate',
  'historical-result-reference', 'historical-tree-reference', 'termination-confirmed', 'insufficient-information'];
function strings(value, output = [], depth = 0) {
  if (depth > 40) return output;
  if (typeof value === 'string') output.push(value.replaceAll('\\', '/'));
  else if (value && typeof value === 'object') for (const item of Object.values(value)) strings(item, output, depth + 1);
  return output;
}
function references(record, id) {
  const values = strings(record);
  return { result: values.some(v => v.endsWith('/' + id + '-result.json')),
    tree: values.some(v => v.endsWith('/' + id) || v.includes('/' + id + '/')) };
}
function classifyLegacy(id, request, { records, inflight, sessions }, resultPresent) {
  const repo = request?.repo, head = request?.head;
  const history = records.map(record => references(record, id));
  const sameVersion = value => repo && head && value && (value.pr?.repo === repo || value.key?.startsWith(repo + '#'))
    && (value.headSha === head || value.knownHead === head);
  if (sessions.some(s => references(s, id).tree)) return 'active-consumer-confirmed';
  if (sessions.some(sameVersion)) return 'active-consumer-candidate';
  if (inflight.some(row => sameVersion(row) && SID.test(row.retomarSid || row.sessionId || ''))) return 'resumable-checkpoint-candidate';
  if (history.some(r => r.result) && !history.some(r => r.tree)) return 'historical-result-reference';
  if (history.some(r => r.tree)) return 'historical-tree-reference';
  void resultPresent;
  return 'insufficient-information';
}
function read(file) {
  try {
    return parseJson(readRegularFile(file, 32 * 1024 ** 2).toString('utf8'));
  } catch { return null; }
}
function packBytes(directory) {
  const git = path.join(directory, '.git'), packs = path.join(git, 'objects', 'pack');
  let bytes = 0, files = 0;
  try {
    for (const current of [git, path.join(git, 'objects'), packs]) if (fs.lstatSync(current).isSymbolicLink()) return { bytes: 0, files: 0, available: false };
    for (const entry of fs.readdirSync(packs, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:pack|idx|rev)$/.test(entry.name)) continue;
      bytes += fs.statSync(path.join(packs, entry.name)).size; files++;
    }
    return { bytes, files, available: true };
  } catch { return { bytes: 0, files: 0, available: false }; }
}
async function diagnoseLegacy(home, port) {
  const root = path.join(home, 'workspace/state/technical-review');
  const decisions = read(path.join(home, 'workspace/state/decisions.json'));
  const self = read(path.join(home, 'workspace/state/self-analyses.json'));
  const inflight = read(path.join(home, 'workspace/state/inflight.json'));
  const records = [...(decisions?.pending || []), ...(decisions?.resolved || []), ...Object.values(self || {})];
  let sessions = [], liveStatus = 'unavailable';
  if (port) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(3000) });
      const snapshot = response.ok ? await response.json() : null;
      if (Array.isArray(snapshot?.activeSessions)) { sessions = snapshot.activeSessions; liveStatus = 'available'; }
    } catch { liveStatus = 'unavailable'; }
  }
  const context = { records, inflight: Array.isArray(inflight) ? inflight : [], sessions };
  const items = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !ID.test(entry.name) || fs.existsSync(path.join(root, entry.name + '-material.json'))) continue;
    const request = read(path.join(root, entry.name + '-request.json'));
    const resultPresent = fs.existsSync(path.join(root, entry.name + '-result.json'));
    const packs = packBytes(path.join(root, entry.name));
    items.push({ id: entry.name, category: classifyLegacy(entry.name, request, context, resultPresent),
      gitPackBytesLowerBound: packs.bytes, packMeasurementAvailable: packs.available, durableResultPresent: resultPresent,
      requestIdentityAvailable: !!request?.repo && !!request?.head, processOwnershipKnown: false, eligibleForRemoval: false });
  }
  const grouped = categories.map(category => {
    const members = items.filter(item => item.category === category);
    return { category, count: members.length, gitPackBytesLowerBound: members.reduce((n, item) => n + item.gitPackBytesLowerBound, 0),
      logicalTreeBytes: null, logicalTreeMeasurement: 'não medido por categoria; packs são apenas limite inferior',
      removalCondition: category === 'historical-result-reference'
        ? 'A referência aponta resultado durável externo à árvore; falta comprovar término de consumidores, ausência de retomada e pertencimento seguro antes de remover só a árvore.'
        : 'Comprovar término dos consumidores e ausência de necessidade de retomada; preservar resultados; validar raiz privada. Ausência de referência ou idade não bastam.' };
  });
  return { schema: 1, at: new Date().toISOString(), readOnly: true, cleanupExecuted: false,
    sources: { decisions: !!decisions, selfAnalyses: !!self, inflight: Array.isArray(inflight), liveSnapshot: liveStatus, liveSessions: sessions.length },
    categories: grouped, items, count: items.length,
    interpretation: 'Referência histórica a -result.json não demonstra consumidor da árvore Git. Término da análise ou existência de resultado não comprova término de todos os processos legados sem manifesto.',
    limitations: ['Nenhum legado tem identidade de proprietário/consumidor reconstruída com segurança.', 'Packs são parte do tamanho total; não some esta medida ao total histórico.', 'Checkpoint de verificação de claims é histórico, não prova de sessão retomável.', 'Não foram lidos argumentos de processos nem extraídos conteúdos privados para o relatório.'] };
}
if (executadoDireto(import.meta.url)) {
  const argv = process.argv.slice(2), home = argv[argv.indexOf('--home') + 1], output = argv[argv.indexOf('--output') + 1];
  if (!argv.includes('--home') || !argv.includes('--output') || !home || !output) throw new Error('Informe --home <Farol> --output <JSON>. Somente leitura.');
  const port = Number(argv[argv.indexOf('--port') + 1]) || 0;
  const result = await diagnoseLegacy(home, port);
  fs.writeFileSync(path.resolve(output), safeStringify(result));
  console.log(safeStringify({ count: result.count, categories: result.categories, cleanupExecuted: false }));
}
export { classifyLegacy, diagnoseLegacy, references };

