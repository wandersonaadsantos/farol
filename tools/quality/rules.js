// As regras do gate mecânico do Farol que dá pra medir sem AST, sobre o
// código já limpo pelo strip.js. APROXIMAÇÕES ASSUMIDAS (o gate mede regressão
// por baseline, então imprecisão estável não machuca):
//  - ternarioAninhado: 2+ '?' de ternário no mesmo statement (separado por ;),
//    depois de remover '?.' e '??'. Não distingue encadeado (estilo else-if,
//    tolerado na prática) de aninhado de verdade; a baseline absorve os atuais.
//  - profundidadeExcedida: profundidade de CHAVES dentro de função, contando
//    a partir da chave do corpo. Objeto literal inflaciona; baseline absorve.
//  - emptyCatch: só conta catch cujo corpo era vazio JÁ NO FONTE CRU (catch
//    vazio com comentário de intenção é tolerado, vide doutrina do repo).
import { strip } from './strip.js';

const LIMITES = { maxLines: 400, maxDepth: 3 };
// arquivos onde a leitura direta é o lar legítimo da coisa
const ENV_FONTE_UNICA = ['lib/env.js', 'lib/paths.js'];
const JSON_SANTUARIOS = ['lib/io.js'];
const PORTA_SANTUARIOS = ['lib/constants.js'];

function norm(p) { return p.replace(/\\/g, '/'); }

function scanFile(source, relPath) {
  const p = norm(relPath);
  const code = strip(source);
  const linhas = code.split('\n');
  const r = {};

  const uteis = linhas.filter((l) => l.trim() !== '').length;
  r.maxLines = uteis > LIMITES.maxLines ? 1 : 0;

  // catch vazio: casa no CRU (comentário dentro do corpo salva) E no limpo
  // (pra não casar "catch {}" dentro de string)
  const vaziosLimpo = [...code.matchAll(/catch\s*(\([^)]*\))?\s*\{\s*\}/g)];
  let emptyCatch = 0;
  for (const m of vaziosLimpo) {
    const cru = source.slice(m.index, m.index + m[0].length);
    if (!/\/\/|\/\*/.test(cru)) emptyCatch++;
  }
  r.emptyCatch = emptyCatch;

  r.varUse = (code.match(/\bvar\s/g) || []).length;
  r.jsonParseCru = JSON_SANTUARIOS.includes(p) ? 0 : (code.match(/JSON\s*\.\s*parse\s*\(/g) || []).length;
  r.jsonStringifyCru = JSON_SANTUARIOS.includes(p) ? 0 : (code.match(/JSON\s*\.\s*stringify\s*\(/g) || []).length;
  r.processEnvDireto = ENV_FONTE_UNICA.includes(p) ? 0 : (code.match(/process\s*\.\s*env\b/g) || []).length;

  // ternário aninhado por statement
  const semOpcionais = code.replace(/\?\./g, '  ').replace(/\?\?/g, '  ');
  r.ternarioAninhado = semOpcionais
    .split(';')
    .filter((s) => (s.match(/\?/g) || []).length >= 2).length;

  const tempoProp = (code.match(/\b(ttl|ttlMs|timeout|timeoutMs|delay|delayMs|maxAge|expiresIn)\s*:\s*\d/g) || []).length;
  const tempoMult = (code.match(/\b\d+\s*\*\s*60\s*\*\s*1000\b/g) || []).length;
  r.tempoMagico = tempoProp + tempoMult;

  r.portaLiteral = PORTA_SANTUARIOS.includes(p) ? 0 : (code.match(/\b47170\b/g) || []).length;

  r.profundidadeExcedida = profundidadeExcedida(code);
  return r;
}

// conta pontos onde a profundidade de chaves dentro de uma função passa do teto.
// baseline absorve o ruído de objeto literal; o que importa é não CRESCER.
function profundidadeExcedida(code) {
  let depth = 0;
  let estouros = 0;
  let dentroDeEstouro = false;
  for (const c of code) {
    if (c === '{') {
      depth++;
      // depth 1 = corpo da função/bloco raiz; teto efetivo = maxDepth + 1
      if (depth > LIMITES.maxDepth + 1 && !dentroDeEstouro) { estouros++; dentroDeEstouro = true; }
    } else if (c === '}') {
      depth = Math.max(0, depth - 1);
      if (depth <= LIMITES.maxDepth + 1) dentroDeEstouro = false;
    }
  }
  return estouros;
}

export default { scanFile, LIMITES, ENV_FONTE_UNICA };
export { scanFile, LIMITES, ENV_FONTE_UNICA };
