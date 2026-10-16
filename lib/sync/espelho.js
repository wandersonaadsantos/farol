// Janela completa da sessão visível no executor, cifrada e fragmentada no transporte.
import { createHash } from 'node:crypto';
import io from '../io.js';
const MAX_PARTES = 256;
function ocultar(texto) {
  return String(texto || '').replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-(?:ant-)?[A-Za-z0-9_-]{16,})\b/g, '[credencial ocultada]')
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi, '$1 [ocultada]')
    .replace(/((?:token|password|passwd|secret|api[_-]?key|authorization)\s*[=:]\s*["']?)[^\s"',;}]+/gi, '$1[ocultada]');
}
function snapshotEspelho(s, feed, agora) {
  const agents = Object.values(s.agents || {}).map(a => ({ n: a.n, label: ocultar(a.label), desc: ocultar(a.desc), done: !!a.done }));
  const linhas = Array.isArray(feed) ? feed : [];
  const estimativa = s.estimativa ? { tipicoMs: Number(s.estimativa.tipicoMs) || 0 } : null;
  return {
    startedAt: Number(s.startedAt) || agora, ultimoSinalEm: Number(s.ultimoSinalEm) || 0,
    fase: String(s.fase || ''), totalArquivos: Number(s.totalArquivos) || 0, estimativa,
    modelo: String(s.model || ''), heranca: String(s.heranca || ''), capturadoEm: agora,
    agents, agentsLive: agents.filter(a => !a.done).length, lidos: s.filesRead?.size || 0,
    feed: linhas.slice(-120).map(i => ({ t: Number(i.t) || 0, k: String(i.k || ''), text: ocultar(i.text), a: String(i.a || ''), s: String(i.s || '') })),
  };
}
function digest(texto) { return createHash('sha256').update(texto).digest('hex'); }
function fragmentar(valor) {
  const texto = io.safeStringify(valor), partes = [];
  let atual = '';
  for (const ch of texto) {
    if (Buffer.byteLength(io.safeStringify(atual + ch)) > 800) { partes.push(atual); atual = ''; }
    atual += ch;
  }
  if (atual) partes.push(atual);
  if (partes.length > MAX_PARTES) throw Error('Espelho acima do limite de transporte');
  return { partes, hash: digest(texto) };
}
function recompor(meta, partes) {
  if (!Number.isSafeInteger(meta.partes) || meta.partes < 1 || meta.partes > MAX_PARTES || partes.length !== meta.partes || partes.some(p => typeof p !== 'string')) return null;
  const texto = partes.join('');
  if (digest(texto) !== meta.hash) return null;
  try {
    const v = io.parseJson(texto, null);
    if (!v || !Array.isArray(v.feed) || v.feed.length > 120 || !Array.isArray(v.agents)) return null;
    if (v.feed.some(i => !i || !Number.isFinite(i.t) || typeof i.text !== 'string' || i.text.length > 400 || !['info','warn','error','tool','text'].includes(i.k))) return null;
    return v;
  } catch { return null; }
}
export { snapshotEspelho, fragmentar, recompor, ocultar, MAX_PARTES };
