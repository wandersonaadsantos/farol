// Contraprovas de leitura restrita: não representam execução de testes.
import { parseJson, safeStringify } from '../io.js';
import { registrarCheckpoint, CHECKPOINT_MARKER } from './checkpoint-da-sessao.js';

function restrictedCheckpoint(engine, opts, text) {
  if (!opts.selfIsolation) return;
  const match = String(text).trim().match(CHECKPOINT_MARKER);
  const entry = match ? parseJson(match[1], null) : null;
  const session = engine.activeReviews?.get(opts.id);
  if (entry?.method !== 'read' || !session?.filesRead?.has(entry.file) || !entry.evidence) return;
  if (!['confirmado', 'refutado', 'inconclusivo'].includes(entry.verdict)) return;
  const hidden = opts.selfIsolation.manifest?.representations?.some(view => view.redactions.length
    && ['patches', 'head', 'base', 'mergeBase'].some(side => view.path === `${side}/${entry.file}`));
  const guarded = hidden ? { ...entry, verdict: 'inconclusivo' } : entry;
  const note = hidden ? `[Modelo indicou ${entry.verdict}; valores ocultos neste arquivo mantêm a contraprova inconclusiva] ` : '';
  registrarCheckpoint(engine, opts, safeStringify({ ...guarded, evidence: '[Leitura restrita, sem execução de teste] ' + note + entry.evidence }));
}

function recordProjection(result, observed, isolation) {
  const manifest = isolation.manifest;
  observed.sourceProjection = { ...manifest.projection, limitations: manifest.limitations,
    representations: manifest.representations.filter(view => view.path.startsWith('patches/')) };
  observed.scope.basis = 'source-projection';
  observed.scope.originalTextComplete = !manifest.representations.some(view => view.redactions.length);
  const note = 'Leitura observada de representações fixadas; valores ocultos não foram lidos. '
    + 'Marcadores iguais indicam igualdade no recorte, não revelam conteúdo, formato ou validade da credencial. '
    + 'Contraprovas em arquivos com valores ocultos permanecem inconclusivas por decisão do host.';
  result.reportMarkdown = note + '\n\n' + (result.reportMarkdown || '');
  if (!observed.scope.originalTextComplete) {
    result.summary = '[Projeção com valores ocultos] ' + (result.summary || '');
  }
}

function restrictedVerification(entries, head, sessionId, verify) {
  const current = entries.filter(e => e.sessionId === sessionId && e.headSha === head);
  const result = verify(current, head);
  if (result.status === 'failed') return result;
  if (current.some(e => e.verdict !== 'confirmado')) return { ...result, status: 'unknown' };
  if (result.status === 'not_applicable') return { ...result, status: 'unknown' };
  return result;
}

export { restrictedCheckpoint, restrictedVerification, recordProjection };
