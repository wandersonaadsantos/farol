// Conferência do que a revisão afirma ter validado. Não executa comandos do modelo.
const texto = v => typeof v === 'string' ? v.trim() : '';
const compacto = v => texto(v).replace(/\s+/g, ' ');

function errosDaRecomendacao(a, head) {
  const r = a.recomendacao;
  if (!r) return [];
  if (!texto(r.descricao) || !['hipotese', 'validada'].includes(r.estado)) return [`${a.chave}: recomendação sem descrição ou estado válido`];
  if (r.estado === 'hipotese') return [];
  const erros = [];
  if (!head || r.headSha !== head) erros.push(`${a.chave}: recomendação validada em head diferente ou desconhecido`);
  for (const campo of ['casoDefeito', 'casoPreservado']) {
    const c = r[campo];
    if (!texto(c?.cenario) || !texto(c?.esperado) || !texto(c?.observado) || !texto(c?.prova)) erros.push(`${a.chave}: recomendação validada sem ${campo} reproduzível`);
    else if (c.resultado !== 'passou') erros.push(`${a.chave}: recomendação sem execução aprovada em ${campo}`);
  }
  if (compacto(r.casoDefeito?.cenario) === compacto(r.casoPreservado?.cenario)) erros.push(`${a.chave}: contraexemplo de preservação repete o caso de defeito`);
  return erros;
}

function conferirProduto(decisoes, fontes) {
  const erros = [], registros = [];
  if (!Array.isArray(decisoes)) return { erros: ['procedência das decisões de produto ausente'], registros };
  for (const d of decisoes) {
    const registro = { descricao: texto(d?.descricao), estado: texto(d?.estado), uso: texto(d?.uso), fonteId: texto(d?.fonteId), trecho: texto(d?.trecho) };
    registros.push(registro);
    if (!registro.descricao || !['requisito_card', 'registro', 'nao_confirmada', 'conflito'].includes(registro.estado)
      || !['contexto', 'fundamenta_veredito'].includes(registro.uso)) {
      erros.push('decisão de produto sem descrição, estado ou uso válido');
      continue;
    }
    const fonte = fontes.itens.find(f => f.id === registro.fonteId);
    if (['requisito_card', 'registro'].includes(registro.estado)) {
      if (!fonte || !registro.trecho || !compacto(fonte.texto).includes(compacto(registro.trecho))) erros.push('decisão de produto sem trecho conferido em fonte primária lida nesta revisão');
      else registro.fonte = { url: fonte.url, hash: fonte.hash, autor: fonte.autor, atualizadoEm: fonte.atualizadoEm, autoridade: fonte.autoridade };
      if (registro.estado === 'requisito_card' && fonte?.tipo !== 'card') erros.push('comentário não pode ser apresentado como requisito descrito no card');
    }
    if (registro.uso === 'fundamenta_veredito' && (registro.estado !== 'requisito_card' || !fontes.completa)) {
      erros.push('veredito depende de decisão de produto conflitante, sem leitura completa ou sem autoridade confirmada');
    }
  }
  return { erros, registros };
}

export { errosDaRecomendacao, conferirProduto };
