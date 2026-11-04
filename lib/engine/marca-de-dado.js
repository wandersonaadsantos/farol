// Desarma a marca que delimita dado de terceiros no prompt. Sem isto, a marca escrita com caractere
// invisível ou com outro traço não era desarmada e, para o modelo, parece a de verdade: o texto fecharia
// o bloco e o resto seria lido como instrução do Farol. Em outra caixa só vale colada aos sinais, porque
// sem eles é texto comum, como o caminho `lib/card-jira.js`. Defesa de melhor esforço: letra de largura
// total e homóglifo passam, e por isso o bloco continua rotulado como dado e os portões são do app.
const INVISIVEL = String.raw`[\p{Cf}\p{Mn}\u115F\u1160\u3164\uFFA0]*`;
const TRACO = String.raw`[-\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]`;
const VAO = String.raw`[\s\p{Cf}\p{Mn}\u115F\u1160\u3164\uFFA0]*`;

function desarmarMarca(texto, marca) {
  const letras = [...marca].map(c => (c === '-' ? TRACO : c)).join(INVISIVEL);
  const limpar = achado => achado.replace(new RegExp(INVISIVEL, 'gu'), '').replace(new RegExp(TRACO, 'gu'), ' ');
  return String(texto || '')
    .replace(new RegExp(letras, 'gu'), limpar)
    .replace(new RegExp(`(?<=<<<${VAO})${letras}|${letras}(?=${VAO}>>>)`, 'giu'), limpar);
}

export { desarmarMarca };
