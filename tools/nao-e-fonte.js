// Diretórios que nenhuma ferramenta deste repositório abre, porque não são fonte
// do projeto.
//
// A lista mora aqui porque é a MESMA decisão para as três ferramentas que andam
// no sistema de arquivos, e não a preferência de uma delas. Uma cópia por
// ferramenta divergiria no primeiro diretório novo, e foi exatamente o que
// aconteceu: `.claude/` faltava nas três e `.superpowers/` só existia na higiene,
// então uma worktree criada pelo harness fez o gate contar o repositório inteiro
// de novo sob outro caminho, com 76 regressões falsas e o `check` vendo 340
// arquivos no lugar de 171.
//
// O que entra aqui é código que o repositório não escreveu (dependência
// instalada), saída derivada do que ele escreveu (build), ou área de trabalho de
// ferramenta (worktree, plano de execução, scratch). Recorte que é preferência de
// UMA ferramenta, como a higiene pular `docs/` ou o gate pular `test/`, continua
// na ferramenta: ali a diferença é o ponto, não o acidente.
export const NAO_E_FONTE = Object.freeze([
  'node_modules',
  'dist',
  '.git',
  '.worktrees',
  '.claude',
  '.superpowers',
  'scratchpad_test',
]);

/** A lista comum mais o que aquela ferramenta pula por conta própria. */
export function ignorar(...extras) {
  return new Set([...NAO_E_FONTE, ...extras]);
}

export default { NAO_E_FONTE, ignorar };
