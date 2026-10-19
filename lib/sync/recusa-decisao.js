// Só categorias conhecidas saem no recibo em claro. Nunca enviar o erro livre,
// que pode conter nomes de arquivos, conteúdo da revisão ou dados do provedor.
const MOTIVOS_TECNICOS = new Map([
  ['declaração técnica do repositório ausente', 'declaracao-ausente'],
  ['avaliação técnica atual ausente', 'avaliacao-ausente'],
  ['execução da avaliação técnica não concluída', 'execucao-incompleta'],
  ['avaliação técnica de outro commit', 'commit-mudou'],
  ['declaração técnica mudou', 'declaracao-mudou'],
  ['avaliação técnica inconclusiva', 'inconclusiva'],
  ['violação técnica confirmada', 'violacao'],
  ['achados técnicos não resolvidos', 'achados'],
  ['a prova antiga omitiu lacunas; é necessária nova revisão', 'prova-antiga'],
  ['a base mudou depois da avaliação técnica', 'base-mudou'],
  ['histórico de objeções mudou depois da revisão', 'objecoes-mudaram'],
  ['checks necessários à aprovação ainda não comprovados', 'checks'],
  ['não foi possível reconfirmar a avaliação técnica', 'reconfirmacao'],
]);

export function codigoDaRecusaDecisao(resultado) {
  const r = resultado || {};
  const code = r.blocked || r.code || 'nao_postou';
  if (code !== 'technical_review') return code;
  const motivo = MOTIVOS_TECNICOS.get(r.error);
  return motivo ? `technical_review:${motivo}` : code;
}
