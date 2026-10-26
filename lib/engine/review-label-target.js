// Fronteira dos marcadores de revisão: GitHub público, PR canônico e label gerenciada.
import { canonicalPrKey } from '../sync/keys.js';
const GERENCIADA = /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?:revisando$/i;
function labelGerenciada(label) { return typeof label === 'string' && GERENCIADA.test(label); }
function mesmoPr(a, b) { const key = canonicalPrKey(a); return !!key && key === canonicalPrKey(b); }
function prDaUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    const m = /^\/([\w.-]+)\/([\w.-]+)\/pull\/([1-9]\d*)\/?$/.exec(url.pathname);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || !m || !Number.isSafeInteger(Number(m[3])) || [m[1], m[2]].some(p => p === '.' || p === '..')) return null;
    return { key: `${m[1]}/${m[2]}#${m[3]}`, repo: `${m[1]}/${m[2]}`, number: Number(m[3]), url: `https://github.com/${m[1]}/${m[2]}/pull/${m[3]}` };
  } catch { return null; }
}
export { labelGerenciada, prDaUrl, mesmoPr };
