/* CODEOWNERS: quem é AUTORIDADE sobre cada arquivo do PR (v2.51.0).

   MUDANÇA DE 28/08/2026 (decisão do Wanderson, à tarde): a cobertura de
   exigência (`cobreMinhaExigencia`, que nasceu aqui na v2.51.0) NÃO gateia mais
   a saída de cena. A regra virou PLANA: ver alguém revisando SEMPRE segura o
   automático, sem a exceção de "reviso por cima quando quem pegou não cobre a
   minha exigência"; o PR espera ação manual. A função saiu do arquivo junto com
   a regra. O arquivo segue existindo pela AUTORIDADE da co-assinatura: "nunca
   co-assino onde sou autoridade" permanece (souAutoridade, consumida por
   autoridadeNaSaida em lib/engine/skip-review.js).

   CODEOWNERS é OU dentro da linha e "a ÚLTIMA linha que casa vence" por arquivo,
   não é acumulativo (semântica do GitHub).

   Tudo aqui é PURO. Quem faz IO é o skip-review.js.

   LIMITE DECLARADO: dono que é TIME (`@org/slug`) não dá pra resolver sem mais
   uma chamada de rede por time, então souDono só reconhece menção INDIVIDUAL, e
   time nunca prova autoridade minha. */

// Uma linha útil do CODEOWNERS vira { pattern, owners }. Comentário, linha vazia e
// linha sem dono são descartadas. `owners` guarda o texto cru (com @) porque a
// distinção entre pessoa e time importa lá embaixo.
function parseCodeowners(texto) {
  const regras = [];
  for (const linhaBruta of String(texto || '').split(/\r?\n/)) {
    const linha = linhaBruta.replace(/#.*$/, '').trim();
    if (!linha) continue;
    const partes = linha.split(/\s+/);
    const pattern = partes.shift();
    const owners = partes.filter(x => x.startsWith('@'));
    if (!pattern || !owners.length) continue;
    regras.push({ pattern, owners });
  }
  return regras;
}

// Padrão do CODEOWNERS (estilo gitignore) vira RegExp. Regras aplicadas:
//   `/x`    ancora na raiz            `x/`   tudo dentro do diretório
//   `*`     qualquer coisa menos `/`  `**`   qualquer coisa, inclusive `/`
//   sem barra nenhuma = casa o nome em QUALQUER nível (é o caso do `*`)
function patternToRegex(bruto) {
  let p = String(bruto || '').trim();
  if (!p) return null;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith('/');
  if (anchored) p = p.slice(1);
  // `**/x` tem que casar `x` na raiz também, então o prefixo é opcional
  let prefixo = '';
  if (p.startsWith('**/')) { prefixo = '(?:.*/)?'; p = p.slice(3); }
  else if (!anchored && !p.includes('/')) prefixo = '(?:.*/)?';
  let corpo = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') { corpo += '.*'; i++; }
    else if (c === '*') corpo += '[^/]*';
    else if (c === '?') corpo += '[^/]';
    else corpo += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${prefixo}${corpo}${dirOnly ? '/.*' : ''}$`);
}

// Donos de UM arquivo: a ÚLTIMA regra que casa vence (semântica do GitHub; não
// acumula donos de regras anteriores). Arquivo sem regra que case não tem dono.
function ownersForPath(regras, caminho) {
  const alvo = String(caminho || '').replace(/^\/+/, '');
  let achado = [];
  for (const r of regras || []) {
    const re = patternToRegex(r.pattern);
    if (re && re.test(alvo)) achado = r.owners;
  }
  return achado;
}

const ehTime = (owner) => String(owner || '').includes('/');
const mesmoLogin = (a, b) => String(a).replace(/^@/, '').toLowerCase() === String(b).replace(/^@/, '').toLowerCase();

// Sou dono deste arquivo? Só por menção INDIVIDUAL: dono que é time não dá pra
// resolver aqui (ver o limite declarado no cabeçalho).
function souDono(regras, caminho, login) {
  return ownersForPath(regras, caminho).some(o => !ehTime(o) && mesmoLogin(o, login));
}

// Sou autoridade neste PR? (dono de pelo menos um arquivo que ele mexe)
function souAutoridade(regras, caminhos, eu) {
  return (caminhos || []).some(c => souDono(regras, c, eu));
}

const codeownersMod = {
  parseCodeowners, patternToRegex, ownersForPath, souDono, souAutoridade,
};
export default codeownersMod;
export {
  parseCodeowners, patternToRegex, ownersForPath, souDono, souAutoridade,
};
