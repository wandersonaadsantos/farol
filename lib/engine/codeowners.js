/* CODEOWNERS: quem é AUTORIDADE sobre cada arquivo do PR (v2.51.0).

   Existe por causa de um furo real do "um Farol por PR" (v2.50.1): sair de cena
   porque outra pessoa está revisando trata aprovação como se fosse fungível, e ela
   não é quando o repo tem dono de código. As duas formas medidas em 20/08/2026,
   com os logins trocados por letras (o pacote de distribuição é auditado e não
   pode carregar conta de ninguém):

     repo A   `* @dona-do-repo`
     repo B   `* @dona-A @dona-B` mais `/package.json @dona-C` (e afins)

   No repo B o gate é EXIGIDO de verdade (ruleset com `require_code_owner_review:
   true`), então a aprovação da dona-C não libera nada fora do `package.json`. Se o
   Farol dela pega o PR primeiro e os Farols das donas A e B saem de cena, o PR
   trava; e se a co-assinatura estivesse ligada, seria pior, porque o gate de
   codeowner seria satisfeito SEM nenhum codeowner ter revisado, que é o oposto do
   que ele existe pra fazer.

   A regra que sai daí: só saio de cena se quem pegou o PR cobre a MESMA exigência
   que eu cobriria, arquivo a arquivo (`cobreMinhaExigencia`). CODEOWNERS é OU
   dentro da linha e "a ÚLTIMA linha que casa vence" por arquivo, não é acumulativo.

   Tudo aqui é PURO. Quem faz IO é o skip-review.js.

   LIMITE DECLARADO: dono que é TIME (`@org/slug`) não dá pra resolver sem mais uma
   chamada de rede por time, então arquivo com dono de time é tratado como
   DESCONHECIDO e o resultado é sempre o lado seguro (não sai de cena). Melhor
   revisar à toa que calar quem o repo exige. */

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

// Algum arquivo do PR tem dono que é TIME? Se sim, a análise inteira é
// inconclusiva e quem chama tem que cair no lado seguro.
function temDonoDeTime(regras, caminhos) {
  return (caminhos || []).some(c => ownersForPath(regras, c).some(ehTime));
}

// Sou autoridade neste PR? (dono de pelo menos um arquivo que ele mexe)
function souAutoridade(regras, caminhos, eu) {
  return (caminhos || []).some(c => souDono(regras, c, eu));
}

/* A pergunta que decide a saída de cena: quem pegou o PR cobre TUDO que eu
   cobriria? Verdadeiro quando, pra todo arquivo em que EU sou dono, `outro`
   também é. Se sobra um arquivo meu que ele não cobre, minha revisão continua
   sendo exigida e eu não posso me calar.

   Casos que isso resolve (mesma nomenclatura do cabeçalho):
   - repo B, dona-B pega: as duas estão na linha `*`, então cobre    -> saio
   - repo B, dona-C pega: ela não é dona do `*`, não cobre           -> reviso
   - repo B tocando package.json, dona-B pega: ela não é dona dali   -> dona-C revisa
   - repo A, alguém de fora pega: não é dona de nada lá              -> dona-do-repo revisa

   Não ser dono de nada torna a resposta trivialmente verdadeira, e isso está
   certo: sem exigência minha, não há o que preservar. */
function cobreMinhaExigencia(regras, caminhos, eu, outro) {
  if (temDonoDeTime(regras, caminhos)) return false;
  const meus = (caminhos || []).filter(c => souDono(regras, c, eu));
  return meus.every(c => souDono(regras, c, outro));
}

const codeownersMod = {
  parseCodeowners, patternToRegex, ownersForPath, souDono, souAutoridade,
  temDonoDeTime, cobreMinhaExigencia,
};
export default codeownersMod;
export {
  parseCodeowners, patternToRegex, ownersForPath, souDono, souAutoridade,
  temDonoDeTime, cobreMinhaExigencia,
};
