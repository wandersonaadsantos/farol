// Valor efetivo da política (CT-ADM-POL). PURO: sem estado, sem IO, sem rede.
//
// A REGRA ÚNICA, da qual todo o resto é consequência: o remoto SÓ RESTRINGE. Pausa é OU
// (qualquer um dos dois pausa), teto é o MENOR dos dois, e lista é INTERSEÇÃO. Não existe
// caminho pelo qual um valor vindo do banco faça este aparelho trabalhar MAIS do que a
// configuração local já permitia. É o que torna a política segura de obedecer mesmo sem o
// banco ser confiável: o pior que um admin defeituoso, ou um valor adulterado, consegue
// fazer é parar o aparelho, e parar é o lado seguro.
//
// A QUEDA DA AUTORIDADE NÃO AMPLIA NADA. Enquanto existir política em cache, ela continua
// combinando igual, e `origem` marca `restricao-mantida` nos campos em que o remoto é quem
// decide. Se a queda devolvesse a configuração local, desligar o admin (ou só perder a
// rede) viraria o jeito mais fácil de despausar um aparelho pausado.
//
// `null` numa lista é "ninguém restringiu por conta ou por tipo", e é diferente de `[]`,
// que é "nada é elegível". Sem essa distinção, um lado sem lista viraria lista vazia e
// pararia o Farol por omissão.
const CAMPOS = ['pausado', 'tetoParalelismo', 'contasElegiveis', 'tiposDeOperacao'];

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function lado(v) {
  return objeto(v) ? v : {};
}

function listaDe(v) {
  return Array.isArray(v) ? v : null;
}

function numeroDe(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pausaDe(l, r) {
  return { valor: l === true || r === true, doRemoto: r === true && l !== true };
}

function tetoDe(l, r) {
  if (r === null) return { valor: l, doRemoto: false };
  if (l === null) return { valor: r, doRemoto: true };
  return { valor: Math.min(l, r), doRemoto: r < l };
}

function intersecaoDe(l, r) {
  if (r === null) return { valor: l, doRemoto: false };
  if (l === null) return { valor: r, doRemoto: true };
  const comum = l.filter((x) => r.includes(x));
  return { valor: comum, doRemoto: comum.length < l.length };
}

// Quem decidiu o campo. Com a autoridade caída, um campo decidido pelo remoto não vira
// "remoto" (não há sinal do admin agora): vira `restricao-mantida`, que é o nome honesto
// de "isto continua valendo porque tirar seria ampliar".
function origemDe(doRemoto, autoridade) {
  if (!doRemoto) return 'local';
  return autoridade === true ? 'remoto' : 'restricao-mantida';
}

function politicaEfetiva(local, remota, { autoridade } = {}) {
  const l = lado(local);
  const r = lado(remota);
  const partes = {
    pausado: pausaDe(l.pausado, r.pausado),
    tetoParalelismo: tetoDe(numeroDe(l.tetoParalelismo), numeroDe(r.tetoParalelismo)),
    contasElegiveis: intersecaoDe(listaDe(l.contasElegiveis), listaDe(r.contasElegiveis)),
    tiposDeOperacao: intersecaoDe(listaDe(l.tiposDeOperacao), listaDe(r.tiposDeOperacao)),
  };
  const saida = { origem: {} };
  for (const campo of CAMPOS) {
    saida[campo] = partes[campo].valor;
    saida.origem[campo] = origemDe(partes[campo].doRemoto, autoridade);
  }
  return saida;
}

export default { CAMPOS, politicaEfetiva };
export { CAMPOS, politicaEfetiva };
