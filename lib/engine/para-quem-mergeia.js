// O que só uma pessoa decide chega a quem decide o merge (03/10/2026).
//
// Caso que motivou (03/10/2026, um PR de infraestrutura): a revisão escreveu, nos pontos internos, que a mudança
// "liga em produção a criação de identidade sem passo humano" e que isso "é uma decisão de
// segurança e produto", e que o escopo ia além do card. O texto público do APPROVE dizia
// "Tenho dois pontos, nenhum segura o merge" e falava só dos dois pontos operacionais. Quem
// mergeou leu só o texto público, dois minutos depois. A informação existia e se perdeu no
// caminho entre a revisão e o PR.
//
// O envelope ganhou `paraQuemMergeia`: a lista do que a sessão viu e que não é questão de
// código (segurança, produto, escopo além do card), escrita para o PR. Aqui o engine garante
// que ela chegue: anexa ao corpo do APPROVE, na voz do revisor, sem dizer que é automático, e
// o texto passa pelo mesmo firewall de linguagem de qualquer review. A aprovação continua
// saindo pela política da conta; o que muda é que quem decide o merge fica sabendo.
// Só o APPROVE: num pedido de mudanças o merge já está segurado pelo próprio review.
const TETO_DE_ITENS = 5;
const TETO_DO_ITEM = 400;

function itensParaQuemMergeia(result) {
  const lista = result && result.paraQuemMergeia;
  if (!Array.isArray(lista)) return [];
  return lista
    .filter((t) => typeof t === 'string')
    .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, TETO_DO_ITEM))
    .filter(Boolean)
    .slice(0, TETO_DE_ITENS);
}

function paragrafo(itens) {
  return `Fica para quem decide o merge, porque não é questão de código:\n${itens.map((t) => `- ${t}`).join('\n')}`;
}

// Anexa ao corpo do APPROVE do envelope, uma vez só (o que já está no corpo não repete).
// Muta o result de propósito, como os outros passos do runHeadlessReview: o payload que o
// clique e a postagem automática usam é o mesmo. Devolve quantos itens entraram.
function incorporarParaQuemMergeia(result) {
  const itens = itensParaQuemMergeia(result);
  // normaliza só o que veio: envelope sem o campo continua sem ele (o retorno do
  // parseHeadlessResult é o envelope, e nada além dele)
  if (result && 'paraQuemMergeia' in result) result.paraQuemMergeia = itens;
  const approve = result && result.payloads && result.payloads.approve;
  if (!itens.length || !approve || typeof approve.body !== 'string') return 0;
  const faltam = itens.filter((t) => !approve.body.includes(t));
  if (!faltam.length) return 0;
  approve.body = `${approve.body.trimEnd()}\n\n${paragrafo(faltam)}`;
  return faltam.length;
}

// O mesmo, devolvendo o resultado: é a forma que o parseHeadlessResult (session.js) usa,
// para valer em todo caminho que lê o envelope da revisão (automático e clique).
function comParaQuemMergeia(result) {
  incorporarParaQuemMergeia(result);
  return result;
}

export default { itensParaQuemMergeia, incorporarParaQuemMergeia, comParaQuemMergeia };
export { itensParaQuemMergeia, incorporarParaQuemMergeia, comParaQuemMergeia };
