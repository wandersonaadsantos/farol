// Valor efetivo da política (CT-ADM-POL). PURO: sem estado, sem IO, sem rede.
//
// A REGRA ÚNICA, da qual todo o resto é consequência: o remoto SÓ RESTRINGE. Pausa é OU
// (qualquer um dos dois pausa) e teto é o MENOR dos dois. Não existe
// caminho pelo qual um valor vindo do banco faça este aparelho trabalhar MAIS do que a
// configuração local já permitia. É o que torna a política segura de obedecer mesmo sem o
// banco ser confiável: o pior que um admin defeituoso, ou um valor adulterado, consegue
// fazer é parar o aparelho, e parar é o lado seguro.
//
// A QUEDA DA AUTORIDADE NÃO AMPLIA NADA. Enquanto existir política em cache, ela continua
// combinando igual, e `origem` marca `restricao-mantida` nos campos em que o remoto é quem
// decide. Se a queda devolvesse a configuração local, desligar o admin (ou só perder a
// rede) viraria o jeito mais fácil de despausar um aparelho pausado.
const CAMPOS = ['pausado', 'tetoParalelismo'];

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function lado(v) {
  return objeto(v) ? v : {};
}

// `null` e ausente são "não opina", e não zero: Number(null) é 0, e um lado sem teto
// viraria o teto mais restritivo de todos (30/09/2026, quando o lado local passou a
// poder não ter teto total).
function numeroDe(v) {
  if (v === null || v === undefined) return null;
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
