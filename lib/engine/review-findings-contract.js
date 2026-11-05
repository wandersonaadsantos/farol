// O contrato de cada achado do envelope, PURO (sem IO): saiu do review-findings.js em 05/11/2026
// para o desfecho automático (desfecho-automatico.js) ler a causa dos bloqueios sem puxar o io.js,
// porque a fronteira pública (public-review.js) o alcança e precisa continuar pura.
import { findingCriteriaFields } from './review-finding-criteria.js';

const SEVERITIES = ['blocking', 'suggestion', 'question', 'nitpick'];
const STATES = ['persiste', 'resolvido', 'retirado'];
const MAX_TEXT = 20000;
// Todo bloqueio declara a causa (05/11/2026): defeito do código e a parte do card podem reprovar
// sozinhos; CI, conflito com a base, dependência e arquivo fora do diff são estado do PR, e o
// motor os leva à espera ou à mesa (desfecho-automatico.js), nunca a um pedido de mudanças.
const CAUSAS = ['defeito_codigo', 'card', 'ci', 'conflito', 'dependencia', 'fora_do_diff'];
const respondido = f => ['resolvido', 'retirado'].includes(f?.status);
// Bloqueio vigente sem causa da lista. Resposta de resolução ou retirada não bloqueia mais.
const semCausa = f => f?.severity === 'blocking' && !respondido(f) && !CAUSAS.includes(f.causa);

// `causaObrigatoria: false` é só da memória gravada (review-round-store.js): rodada anterior à
// causa continua legível. Todo envelope novo da sessão passa pela regra.
function normalizeFindings(raw, { causaObrigatoria = true } = {}) {
  if (raw === undefined) return { status: 'legacy', findings: [], issues: [] };
  if (!Array.isArray(raw)) return { status: 'invalid', findings: [], issues: ['findings precisa ser uma lista'] };
  const findings = [], issues = [];
  for (const [i, f] of raw.entries()) {
    if (f?.severity === 'praise') continue;
    const strings = ['title', 'summary', 'file', 'ref', 'evidence'];
    const invalid = !f || !SEVERITIES.includes(f.severity) || typeof f.title !== 'string' || !f.title.trim()
      || typeof f.summary !== 'string' || !f.summary.trim()
      || strings.some(k => f[k] != null && (typeof f[k] !== 'string' || f[k].length > MAX_TEXT))
      || (f.line != null && (!Number.isInteger(f.line) || f.line < 1))
      || (f.status != null && !STATES.includes(f.status));
    if (invalid) { issues.push(`achado ${i + 1} inválido; nenhuma conclusão pode ignorá-lo`); continue; }
    if (causaObrigatoria && semCausa(f)) { issues.push(`achado bloqueante ${i + 1} sem causa declarada`); continue; }
    // a declaração da sessão de que o ponto já está na production; o app confere (heranca-de-producao.js)
    const herdado = f.herdadoDaProducao === true ? { herdadoDaProducao: true } : {};
    findings.push({ file: f.file ?? null, line: f.line ?? null, severity: f.severity,
      title: f.title, summary: f.summary, ref: f.ref || null, status: f.status || null, evidence: f.evidence || '',
      ...(f.severity === 'blocking' && CAUSAS.includes(f.causa) ? { causa: f.causa } : {}),
      ...herdado, ...findingCriteriaFields(f) });
  }
  return { status: issues.length ? 'invalid' : 'complete', findings, issues };
}

// As causas dos bloqueios vigentes do envelope. Envelope legado ou fora do contrato não declara
// causa nenhuma: a regra da causa não se aplica a ele (o resto do gate decide como antes).
function causasDosBloqueios(result) {
  const normalized = normalizeFindings(result?.findings);
  if (normalized.status !== 'complete') return new Set();
  return new Set(normalized.findings.filter(f => f.severity === 'blocking' && !respondido(f)).map(f => f.causa));
}

export { CAUSAS, normalizeFindings, causasDosBloqueios };
