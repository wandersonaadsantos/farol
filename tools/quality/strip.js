// Removedor léxico: apaga o conteúdo de strings, templates, comentários e regex,
// preservando quebras de linha e a estrutura de código (chaves, parênteses,
// operadores). As regras de tools/quality/rules.js SÓ olham o resultado disto,
// nunca o fonte cru: "catch {}" dentro de uma string não é um catch vazio.
//
// Heurística de regex vs divisão: uma / abre regex quando o último token
// significativo anterior indica posição de EXPRESSÃO (operador, abre-parêntese,
// vírgula, return, etc.). É a mesma heurística de scanners clássicos; imprecisão
// residual é aceitável porque o gate mede REGRESSÃO por baseline, não valor exato.

function strip(source) {
  const out = [];
  const n = source.length;
  let i = 0;
  // pilha de modos pra template com interpolação aninhada: 'code' | 'tpl'
  const stack = ['code'];
  let lastSig = ''; // último caractere significativo do modo code (pra regex/div)

  const push = (ch) => { out.push(ch); };
  const blank = (ch) => { out.push(ch === '\n' ? '\n' : ' '); };

  while (i < n) {
    const mode = stack[stack.length - 1];
    const c = source[i];
    const c2 = source[i + 1];

    if (mode === 'tpl') {
      if (c === '\\') { blank(c); if (i + 1 < n) blank(source[i + 1]); i += 2; continue; }
      if (c === '`') { blank(c); stack.pop(); i++; continue; }
      if (c === '$' && c2 === '{') { blank(c); blank(c2); stack.push('code'); i += 2; continue; }
      blank(c); i++; continue;
    }

    // mode === 'code'
    if (c === '/' && c2 === '/') { // comentário de linha
      while (i < n && source[i] !== '\n') { blank(source[i]); i++; }
      continue;
    }
    if (c === '/' && c2 === '*') { // comentário de bloco
      blank(c); blank(c2); i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) { blank(source[i]); i++; }
      if (i < n) { blank('*'); blank('/'); i += 2; }
      continue;
    }
    if (c === "'" || c === '"') { // string
      blank(c); i++;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') { blank(source[i]); i++; if (i < n) { blank(source[i]); i++; } continue; }
        blank(source[i]); i++;
      }
      if (i < n) { blank(c); i++; }
      continue;
    }
    if (c === '`') { blank(c); stack.push('tpl'); i++; continue; }
    if (c === '{' && stack.length > 1) { blank(c); stack.push('code'); i++; continue; }
    if (c === '}' && stack.length > 1) { blank(c); stack.pop(); i++; continue; }
    if (c === '/' && regexPossivel(lastSig)) { // regex literal
      blank(c); i++;
      let emClasse = false;
      while (i < n && (emClasse || source[i] !== '/')) {
        if (source[i] === '\\') { blank(source[i]); i++; if (i < n) { blank(source[i]); i++; } continue; }
        if (source[i] === '[') emClasse = true;
        if (source[i] === ']') emClasse = false;
        if (source[i] === '\n') break; // regex não cruza linha; aborta com segurança
        blank(source[i]); i++;
      }
      if (i < n && source[i] === '/') { blank('/'); i++; }
      while (i < n && /[a-z]/i.test(source[i])) { blank(source[i]); i++; } // flags
      continue;
    }

    push(c);
    if (!/\s/.test(c)) lastSig = ultimaPalavraOuChar(out, c);
    i++;
  }
  return out.join('');
}

// / abre regex quando o token anterior é operador/abertura/palavra de expressão.
function regexPossivel(lastSig) {
  if (lastSig === '') return true;
  if (/^[=([{,;:!&|?+\-*%^~<>]$/.test(lastSig)) return true;
  return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof'].includes(lastSig);
}

// devolve a palavra terminada neste char (pra reconhecer `return` etc.), ou o próprio char
function ultimaPalavraOuChar(out, c) {
  if (!/[a-zA-Z_$]/.test(c)) return c;
  let w = '';
  for (let k = out.length - 1; k >= 0 && /[a-zA-Z0-9_$]/.test(out[k]); k--) w = out[k] + w;
  return w;
}

export default { strip };
export { strip };
