// O checkpoint de verificação que a sessão headless sinaliza (ver "Checkpoint de verificação"
// no docs/REVIEW-GATES.md). Saiu do lib/engine/session.js em 20/10/2026 para servir aos dois
// jeitos de sinalizar: o `description` de um Bash no Claude Code e a linha de texto
// `FAROL_CHECKPOINT: {...}` no Antigravity CLI (lib/agy/stream.js), que não tem esse campo.
// Só o ENGINE escreve o checkpoint; a sessão só sinaliza.
import { checkpointPath, appendCheckpointEntry } from './verification-checkpoint.js';
import { parseJson } from '../io.js';

const CHECKPOINT_MARKER = /^FAROL_CHECKPOINT:\s*(.+)$/s;

// `json` é o texto depois do marcador. Marcador mal formado é ignorado e nunca derruba a sessão.
function registrarCheckpoint(engine, opts, json) {
  try {
    const parsed = parseJson(json, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    const review = engine.activeReviews && engine.activeReviews.get(opts.id);
    const prKey = review && review.pr && review.pr.key;
    // A propriedade que habilita a captura NAO e o modo: e a sessao ter sido lancada
    // pelo engine COM o protocolo de checkpoint no prompt e um PR dono. `checkpoint`
    // carrega a LOJA que ela alimenta ('review' | 'self'); ausente = nao participa
    // (terminal, chat, ferramenta). Voltar pra `mode !== 'auto'` reabriria o furo do
    // P0b: a autoanalise nunca produzia verificacao capturavel, e era justamente ela
    // que autorizava merge.
    if (!prKey || !review.checkpoint) return;
    const prUrl = review.pr.url;
    appendCheckpointEntry(checkpointPath(prKey, review.checkpoint), prKey, prUrl || '', {
      claim: String(parsed.claim || ''),
      file: String(parsed.file || ''),
      line: Number(parsed.line) || 0,
      verdict: String(parsed.verdict || ''),
      evidence: String(parsed.evidence || ''),
      sessionId: opts.id,
      headSha: (review && review.headSha) || '',
      // blob do arquivo citado no momento da verificação (mapa preenchido por
      // runHeadlessReview via fetchPrFiles): permite a entrada continuar relevante
      // num head futuro enquanto o arquivo não mudar (ver relevantEntries).
      blobSha: (review && review.fileBlobs && parsed.file && review.fileBlobs[String(parsed.file)]) || '',
      at: new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T'),
    });
  } catch { /* marcador mal formado: ignora, não derruba a sessão */ }
}

export default { registrarCheckpoint, CHECKPOINT_MARKER };
export { registrarCheckpoint, CHECKPOINT_MARKER };
