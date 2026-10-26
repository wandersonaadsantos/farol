// Avaliação offline explícita: sem provedor, rede, configuração do app ou publicação.
import { parseJson, safeStringify } from '../lib/io.js';
import { readRegularFile } from '../lib/bounded-file.js';
import { executadoDireto } from '../lib/paths.js';
import { compareReviewQuality } from './review-quality/gate.js';

const MAX_FILE_BYTES = 16 * 1024 * 1024;
function readInput(file) {
  const raw = parseJson(readRegularFile(file, MAX_FILE_BYTES).toString('utf8'));
  if (!raw) throw new Error('JSON inválido.');
  return raw;
}
function main(args) {
  if (args.length !== 3) throw new Error('Informe corpus, referência e candidato em arquivos explícitos.');
  const report = compareReviewQuality(...args.map(readInput));
  console.log(safeStringify(report));
  if (report.status === 'rejected') return 1;
  return report.status === 'passed' ? 0 : 2;
}
if (executadoDireto(import.meta.url)) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch { console.error('Avaliação inconclusiva: entradas ou evidências incompatíveis. Nenhum conteúdo de review foi exposto.'); process.exitCode = 2; }
}
export { main };
