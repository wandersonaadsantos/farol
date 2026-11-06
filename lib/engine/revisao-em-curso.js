// Uma revisão local por PR, incluindo o terminal e a janela anterior ao spawn headless.
import { canonicalPrKey as identidade } from '../sync/keys.js';

function revisaoEmCurso(engine, key) {
  const alvo = identidade(key);
  if (!alvo) return false;
  if ((engine.headlessQueue || []).some(p => p.kind !== 'self' && identidade(p.key) === alvo)) return true;
  if ([...(engine.headlessIniciando || [])].some(k => identidade(k) === alvo)) return true;
  return [...(engine.activeReviews || new Map()).values()].some(s => ['auto', 'terminal'].includes(s.mode)
    && (s.keys || []).some(k => identidade(k) === alvo));
}

// A autoanálise tem o próprio dedup de fila e de início; contra a revisão automática ativa do
// mesmo PR ela continua recusada, como antes desta guarda.
function ocupadoParaEnfileirar(engine, pr) {
  if (pr.kind !== 'self') return revisaoEmCurso(engine, pr.key);
  return [...(engine.activeReviews || new Map()).values()].some(s => s.mode === 'auto' && (s.keys || []).includes(pr.key));
}

function separarRevisoesEmCurso(engine, items) {
  const liberados = [];
  const duplicados = [];
  const nesteLote = new Set();
  for (const item of items) {
    const key = identidade(item.key);
    if (nesteLote.has(key) || revisaoEmCurso(engine, item.key)) {
      duplicados.push(item.key);
      continue;
    }
    nesteLote.add(key);
    liberados.push(item);
  }
  return { liberados, duplicados };
}

export { revisaoEmCurso, ocupadoParaEnfileirar, separarRevisoesEmCurso };
