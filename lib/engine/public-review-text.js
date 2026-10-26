import { REVIEW_COHERENCE_GAP } from '../technical-review/verdict.js';
// Normalização compartilhada pelas travas do texto público.
// Cf é invisível para quem lê, mas poderia separar palavras aos olhos do detector.
const INVISIBLE = /\p{Cf}/gu;

function normalizeUnicode(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-');
}

function fold(value) {
  return normalizeUnicode(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]+/g, ' ')
    .toLowerCase();
}

const SEM_BLOQUEIO = [
  /^nao (?:encontrei|identifiquei|vi) (?:nada bloqueante|nenhum(?:a)? (?:blocker|bloqueador|bloqueio|impedimento|problema bloqueante))(?: no codigo| neste pr| nesta revisao)?$/,
  /^(?:sem|nao ha|nenhum) (?:blockers?|bloqueadores?|bloqueios?)(?: no codigo| neste pr| nesta revisao)?$/,
  /^nada (?:aqui |no codigo )?(?:segura|impede|bloqueia) o merge$/,
  /^(?:no blockers?|no blocking (?:issues?|findings?)(?: found)?|nothing blocking)$/,
];

function payloadCoherenceGap(payload) {
  if (String(payload?.event || '').toUpperCase() !== 'REQUEST_CHANGES') return '';
  // Citações e código não são afirmações do revisor. Esta defesa reconhece frases
  // inequívocas conhecidas; não pretende interpretar toda linguagem natural.
  const prose = fold(String(payload.body || '').replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '')
    .replace(/^\s*>.*$/gm, '').replace(/`[^`\n]*`/g, '').replace(/[*_]/g, ''));
  const frases = prose.split(/[.!?\n;]+/).map(frase => frase.trim());
  // Só afirmações globais completas: "no código de autenticação" não afirma
  // ausência de defeito em pagamentos. Uma menção de CI não apaga contradições.
  const limpas = frases.filter(frase => SEM_BLOQUEIO.some(re => re.test(frase)));
  if (!limpas.length) return '';
  // Exceção restrita ao código limpo com explicação afirmativa de checks
  // obrigatórios falhando em um commit identificado, nunca a uma menção genérica.
  const ciAtual = frases.some(frase => /^os checks obrigatorios[ ,a-z0-9_()/:\-]* estao falhando no (?:commit|head) [a-f0-9]{7,40}$/.test(frase)
    && !/\b(?:nao|nunca|antes|anterior|antigo|primeira|talvez|estavam)\b/.test(frase));
  const ciSuperado = /\bja (?:passou|passaram|ficou verde|estao verdes)\b/.test(prose);
  if (ciAtual && !ciSuperado && limpas.every(frase => frase.endsWith(' no codigo'))) return '';
  return REVIEW_COHERENCE_GAP;
}


export { normalizeUnicode, fold, payloadCoherenceGap };
