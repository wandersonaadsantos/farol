// Contraprovas de leitura restrita: não representam execução de testes.
import { parseJson, safeStringify } from '../io.js';
import { registrarCheckpoint, CHECKPOINT_MARKER } from './checkpoint-da-sessao.js';

function restrictedCheckpoint(engine, opts, text) {
  if (!opts.selfIsolation) return;
  const match = String(text).trim().match(CHECKPOINT_MARKER);
  const entry = match ? parseJson(match[1], null) : null;
  const session = engine.activeReviews?.get(opts.id);
  if (entry?.method !== 'read' || !session?.filesRead?.has(entry.file) || !entry.evidence) return;
  registrarCheckpoint(engine, opts, safeStringify({ ...entry, evidence: '[Leitura restrita, sem execução de teste] ' + entry.evidence }));
}

function restrictedVerification(entries, head, sessionId, verify) {
  const current = entries.filter(e => e.sessionId === sessionId && e.headSha === head);
  const result = verify(current, head);
  if (result.status === 'failed') return result;
  if (current.some(e => e.verdict !== 'confirmado')) return { ...result, status: 'unknown' };
  if (result.status === 'not_applicable') return { ...result, status: 'unknown' };
  return result;
}

export { restrictedCheckpoint, restrictedVerification };
