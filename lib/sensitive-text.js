// Uma política de detecção; logs e representações de fonte têm saídas distintas.
const MARK = '[segredo mascarado]';
const VARIABLE = /\b(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|CLAUDE_CODE_OAUTH_TOKEN|OPENAI_API_KEY|CODEX_API_KEY|GH_TOKEN|GITHUB_TOKEN)(\s*[=:]\s*)(\S+)/gi;
const URL_VALUE = /([?&](?:auth|access_token|token)=)([^&\s]+)/gi;
const FORMATS = [
  /\bsk-(?:ant|or)-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
];
const BEARER = /\b(Bearer\s+)([A-Za-z0-9._~+/=-]{8,})/gi;

function maskSecrets(value) {
  let text = String(value === undefined || value === null ? '' : value);
  text = text.replace(VARIABLE, (_, name) => `${name}=${MARK}`);
  text = text.replace(URL_VALUE, (_, prefix) => `${prefix}${MARK}`);
  for (const pattern of FORMATS) text = text.replace(pattern, MARK);
  return text.replace(BEARER, MARK);
}

function valueBoundary(text, start, end) {
  const quote = text[start];
  if (['"', "'", '`'].includes(quote)) {
    for (let i = start + 1; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === quote) return [start + 1, i];
    }
    throw new Error('Valor sensível com aspas não terminadas; projeção recusada.');
  }
  if (text.slice(start, end).includes('\\')) throw new Error('Escape sensível ambíguo; projeção recusada.');
  // Sem parser, pontuação também pode pertencer à credencial. A projeção
  // oculta toda a faixa detectada, mesmo que remova sintaxe vizinha.
  return [start, end];
}

// Apenas posições e categorias; valores reconhecidos não saem desta chamada.
function secretRanges(value) {
  const text = String(value), found = [];
  const rules = [[VARIABLE, 3, 'variable'], [URL_VALUE, 2, 'url'],
    ...FORMATS.map(pattern => [pattern, 0, 'credential']), [BEARER, 2, 'bearer']];
  for (const [pattern, group, kind] of rules) {
    for (const match of text.matchAll(new RegExp(pattern.source, pattern.flags + 'd'))) {
      let [start, end] = match.indices[group];
      if (kind === 'variable' || kind === 'url') [start, end] = valueBoundary(text, start, end);
      if (end > start) found.push({ start, end, kind });
    }
  }
  const merged = [];
  for (const range of found.sort((a, b) => a.start - b.start || b.end - a.end)) {
    const previous = merged.at(-1);
    if (previous && range.start < previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

// Recorte para quem RECUSA em vez de mascarar (texto público, lib/engine/credencial-no-texto.js):
// só os formatos com prefixo de emissor, sem a variável, a URL e o Bearer, que casam com texto
// normal de review ("Bearer authentication", "GITHUB_TOKEN: secrets.X", "?token=abc"). Falso
// positivo aqui trava uma revisão boa, então o formato ainda precisa ter cara de valor emitido:
// corpo variado, com letra e dígito, o que tira "ghp_xxxxxxxxxxxxxxxxxxxxxxxx" e
// "sk-your-key-goes-here-please"; sem sequência óbvia, o que tira "ghp_1234567890abcdefghij" e
// "abcd1234efgh5678ijkl"; e sem `*` ou reticências colados, que é valor já cortado na citação. No
// `sk-` também um bloco longo que misture letra e dígito, porque esse prefixo com hífen também é
// nome de classe ("sk-animationcontainerwrapper-2") e "sk-ant-api03-your-key-here" tem dígito.
const ISSUER_PREFIX = /^(?:sk-(?:ant-|or-)?|gh[pousr]_|github_pat_|AIza)/;
const OBVIOUS_RUN_SHARE = 0.5;
function obviousSequence(body) {
  const text = body.toLowerCase();
  let steps = 0;
  for (let i = 1; i < text.length; i++) {
    if (Math.abs(text.charCodeAt(i) - text.charCodeAt(i - 1)) <= 1) steps++;
  }
  return steps / Math.max(text.length - 1, 1) >= OBVIOUS_RUN_SHARE;
}
function issuedCredential(value) {
  const body = value.replace(ISSUER_PREFIX, '');
  if (new Set(body).size < 8 || !/\d/.test(body) || !/[A-Za-z]/.test(body) || obviousSequence(body)) return false;
  return !value.startsWith('sk-') || body.split(/[-_]/).some(part => part.length >= 16 && /\d/.test(part) && /[A-Za-z]/.test(part));
}
const CUT_AFTER = /^(?:\*|\.{3}|…)/;

function replaceCredentials(value, mark) {
  let text = String(value === undefined || value === null ? '' : value);
  for (const pattern of FORMATS) {
    text = text.replace(pattern, (found, offset, whole) => (
      issuedCredential(found) && !CUT_AFTER.test(whole.slice(offset + found.length, offset + found.length + 3)) ? mark : found));
  }
  return text;
}

function hasCredential(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return replaceCredentials(text, '') !== text;
}

export { maskSecrets, secretRanges, replaceCredentials, hasCredential };
