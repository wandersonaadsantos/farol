// Forma da política por aparelho (CT-ADM-POL). Puro: sem estado, sem IO, sem rede.
//
// A ALLOWLIST É A DEFESA PRINCIPAL. O que chega de fora é um objeto que outro aparelho
// montou, e o Farol aplica esse objeto em cima da própria configuração. Sem allowlist,
// bastaria o admin publicar uma chave a mais para mexer em algo que nunca foi combinado.
// Por isso: chave que não está na lista é DESCARTADA, e descartar não recusa o pacote.
// Recusar o pacote inteiro por causa de uma chave desconhecida faria uma versão mais nova
// do Farol, que publica um campo novo, desligar a política em todas as versões antigas.
//
// Valor fora de faixa também não recusa: `tetoParalelismo` é CLAMPADO para 1 a 4. É o
// mesmo clamp que lib/engine/review.js já aplica no valor local, e repetir aqui é
// proposital: o valor remoto nunca deve conseguir passar por cima do limite do aparelho.
//
// Campo ausente não é campo falso: significa que o admin não opinou, e quem combina
// (lib/engine/politica-efetiva.js) deixa o valor local valer.
const TIPOS = ['review', 'self', 'pushback', 'chat', 'tool'];
const TAG_RE = /^[0-9a-f]{32}$/;
const TETO_MINIMO = 1;
const TETO_MAXIMO = 4;
const ESQUEMA = 'politica1';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampDoTeto(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(TETO_MAXIMO, Math.max(TETO_MINIMO, n));
}

function tagsDe(v) {
  if (!Array.isArray(v)) return null;
  const limpas = v.filter((x) => typeof x === 'string' && TAG_RE.test(x));
  return [...new Set(limpas)];
}

function tiposDe(v) {
  if (!Array.isArray(v)) return null;
  return TIPOS.filter((t) => v.includes(t));
}

// Um saneador por campo: o que devolve null não entra no resultado, e por isso "não
// opinou" e "opinou com lixo" terminam iguais, que é o lado seguro.
const CAMPOS = {
  pausado: (v) => (typeof v === 'boolean' ? v : null),
  tetoParalelismo: clampDoTeto,
  contasElegiveis: tagsDe,
  tiposDeOperacao: tiposDe,
};

function sanearPolitica(bruta) {
  if (!objeto(bruta)) return {};
  const saida = {};
  for (const [campo, sanear] of Object.entries(CAMPOS)) {
    const valor = sanear(bruta[campo]);
    if (valor !== null) saida[campo] = valor;
  }
  return saida;
}

export default { ESQUEMA, TIPOS, CAMPOS, sanearPolitica };
export { ESQUEMA, TIPOS, CAMPOS, sanearPolitica };
