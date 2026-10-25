// Replay sintético: mede recuperação/repetição, nunca precisão de uma decisão de modelo.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { semAsVariaveis } from '../lib/env.js';
import { safeStringify, writeJsonAtomic } from '../lib/io.js';
import { CASES, replayContextCases } from './replay-contexto.js';
import { roundMemoryBlock } from '../lib/engine/review-findings.js';
import { persistenceMetrics } from '../lib/persistence-metrics.js';

const args = process.argv.slice(2);
const output = args[args.indexOf('--output') + 1];
const baseline = args[args.indexOf('--baseline') + 1];
const home = semAsVariaveis([]).FAROL_HOME;
function temporaryHome(directory) {
  if (!directory || !fs.existsSync(directory)) return false;
  const own = fs.lstatSync(directory);
  if (!own.isDirectory() || own.isSymbolicLink()) return false;
  const temporary = fs.statSync(os.tmpdir(), { bigint: true });
  let ancestor = path.dirname(path.resolve(directory));
  while (ancestor !== path.dirname(ancestor)) {
    const stat = fs.lstatSync(ancestor, { bigint: true });
    if (stat.isSymbolicLink()) return false;
    if (stat.dev === temporary.dev && stat.ino === temporary.ino) return true;
    ancestor = path.dirname(ancestor);
  }
  return false;
}
if (!args.includes('--output') || !args.includes('--baseline') || !home
  || !temporaryHome(home)) throw new Error('Informe --baseline <checkout> --output <json> com FAROL_HOME temporário existente.');
const old = await import(pathToFileURL(path.join(path.resolve(baseline), 'lib/engine/review-findings.js')));
const replay = await replayContextCases();
const first = replay.cases[0], measured = first.measurements;
const finding = { id: 'r:f1', severity: 'blocking', title: 'Contrato alterado',
  summary: 'Consumidor espera número e o retorno virou objeto. ' + 'Contexto sintético de suporte. '.repeat(80),
  file: 'src/consumer.js', line: 2, evidence: 'amount().toFixed(2) no consumidor' };
const context = { status: 'ready', parents: [{ id: 'r', headSha: first.frozenIdentity.H, baseSha: first.frozenIdentity.B, findings: [finding], unresolved: [finding] }] };
const beforeBlock = old.roundMemoryBlock(context), afterBlock = roundMemoryBlock(context);
fs.mkdirSync(home, { recursive: true });
const decisions = { pending: [], resolved: Array.from({ length: 1436 }, (_, id) => ({ id, status: 'posted', reportMarkdown: 'relatório sintético '.repeat(400) })) };
for (let i = 0; i < 5; i++) writeJsonAtomic(path.join(home, 'decisions.json'), decisions);
const report = { schema: 1, at: new Date().toISOString(), node: process.version,
  method: 'Mesmas fontes sintéticas, H/M fixados; parser frio e quente no mesmo processo. Memória compara funções reais da base e da entrega com o mesmo achado. Gravação usa arquivo temporário e fsync reais. Sem GitHub ou provedor.',
  map: { files: Object.keys(CASES[0].versions.head).length, coldMs: measured.coldMs, warmMs: measured.warmMs, coldParses: measured.coldParses,
    warmParses: measured.warmParses, warmParserHits: measured.warmParserHits, fixtureReadCalls: measured.fixtureReadCalls },
  recovery: { changed: 'src/api.js', knownConsumerRecovered: first.recovered.consumerEvidenceAvailable,
    knownTestRecovered: first.recovered.testEvidenceAvailable, selectedSnippetPaths: first.recovered.selectedSnippetPaths,
    complete: first.recovered.mapComplete, decisionQualityMeasured: false },
  replay,
  context: { bytes: measured.contextBytes, tokenEstimate: measured.tokenEstimate, method: measured.tokenMethod },
  history: { beforeBytes: Buffer.byteLength(beforeBlock), afterBytes: Buffer.byteLength(afterBlock),
    beforeTokenEstimate: Math.ceil(beforeBlock.length / 4), afterTokenEstimate: Math.ceil(afterBlock.length / 4),
    allBlockersRetained: afterBlock.includes('r:f1') && afterBlock.includes(finding.evidence) },
  persistence: persistenceMetrics(), limitations: ['Não mede qualidade/veredito de modelo, CPU em produção ou gasto faturado.', 'Não mede download Git; provas de Git/cache estão nos testes com origens locais.', 'Cinco gravações não constituem p95.'] };
fs.writeFileSync(path.resolve(output), safeStringify(report));
console.log(safeStringify({ map: report.map, recovery: report.recovery, context: report.context, history: report.history,
  replay: report.replay.cases.map(item => ({ id: item.id, recovered: item.recovered, measurements: item.measurements })),
  persistenceSamples: report.persistence.writes.length }));
