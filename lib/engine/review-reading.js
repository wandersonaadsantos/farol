// Experimento de agendamento: não agrega conteúdo nem concede cobertura.
function batchedReadBlock(config = {}) {
  if (config.reviewBatchedReads !== true) return '';
  return '\n\n## Agendamento experimental de leituras independentes\n'
    + 'Para caminhos já conhecidos, agrupe até QUATRO chamadas Read independentes na MESMA mensagem, uma por arquivo. '
    + 'Cada chamada conserva caminho, conteúdo e resultado observável próprios. Aguarde todos os resultados antes do próximo grupo. '
    + 'Propague esta orientação aos revisores e verificadores. Buscas que dependem de resultado anterior continuam sequenciais. '
    + 'Use os patches preparados; leia fonte completa, base e chamadores sempre que a análise exigir. '
    + 'Complete resultados truncados antes de declarar leitura ou cobertura. Falha ou ausência de resultado é leitura pendente. '
    + 'Não concatene arquivos por shell, não substitua leitura por nome, resumo ou cache e não diminua os critérios. '
    + 'O coordenador continua conferindo achados, evidências e interações entre arquivos. '
    + 'O agrupamento é apenas instrução ao modelo; o Farol continua observando cada leitura pelos mecanismos existentes.\n';
}
export { batchedReadBlock };
