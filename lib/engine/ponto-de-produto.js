// Decisão de produto não é do Farol (regra do dono de 20/11/2026).
//
// Caso de origem: num PR do dono do produto, a revisão levantou "Pergunta de produto em aberto"
// nos motivos. O revisor analisa se o código está correto; a escolha de produto é de quem faz o
// produto, e o Farol nunca a questiona. O prompt diz isso à sessão; aqui o motor garante que um
// item PURAMENTE de produto não chegue ao texto público nem aos motivos, venha de onde vier.
//
// A marca é estreita de propósito, e a dúvida fica sempre do lado de manter o item:
// - precisa da expressão explícita ("decisão de produto", "pergunta de produto", "escolha de
//   produto", "questão de produto", no singular ou no plural);
// - item que também fala de segurança, correção ou defeito técnico fica, como ponto técnico, em
//   qualquer ordem das palavras ("produto e segurança" e "segurança e produto" ficam os dois);
// - item com negação junto da expressão ("não é decisão de produto") fica.
// O filtro age só sobre ITENS da lista de motivos e do `paraQuemMergeia`. Comentário de linha não
// passa por aqui: ele ancora um achado do review, e tirá-lo deixaria o achado sem a linha.
//
// PURO: só lê e normaliza o envelope. Não decide postagem, não toca gate.
const MARCA_DE_PRODUTO = /\b(?:decis(?:ão|ao|ões|oes)|perguntas?|escolhas?|quest(?:ão|ao|ões|oes))\s+de\s+produto\b/i;
const NEGACAO_DA_MARCA = /\b(?:não|nao|nem|nunca)\s+(?:é|e|são|sao|se\s+trata\s+de|como)?\s*(?:uma?\s+)?(?:decis|pergunt|escolh|quest)[\wÀ-ÿ]*\s+de\s+produto\b/i;
const ASSUNTO_TECNICO = /\b(?:seguran[çc]a|vulnerab\w*|credencia\w*|segredo\w*|autentica\w*|autoriza\w*|permiss\w*|corre[çc][ãa]o|incorret\w*|bugs?|defeit\w*|erros?|falhas?|quebr\w*|regress\w*|vazament\w*|inje[çc][ãa]o|perda\s+de\s+dado\w*|race|concorr[êe]ncia)\b/i;

function textoDoItem(item) {
  if (typeof item === 'string') return item;
  return (item && typeof item === 'object' && typeof item.text === 'string') ? item.text : '';
}

function ehPontoDeProduto(item) {
  const texto = textoDoItem(item);
  if (!MARCA_DE_PRODUTO.test(texto)) return false;
  if (NEGACAO_DA_MARCA.test(texto)) return false;
  return !ASSUNTO_TECNICO.test(texto);
}

// Tira dos motivos que a sessão escreveu os itens puramente de produto. Muta o envelope de
// propósito, como os outros passos do conferirEnvelope (envelope-revisao.js), e devolve quantos
// itens saíram. O `paraQuemMergeia` é filtrado em para-quem-mergeia.js.
function semPontosDeProduto(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.reasons)) return 0;
  const antes = result.reasons.length;
  result.reasons = result.reasons.filter((r) => !ehPontoDeProduto(r));
  return antes - result.reasons.length;
}

export default { ehPontoDeProduto, semPontosDeProduto };
export { ehPontoDeProduto, semPontosDeProduto };
