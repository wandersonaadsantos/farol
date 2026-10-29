// O que um manifesto de motor diz à casca (28/10/2026), PURO. Dois lugares perguntam a
// mesma coisa sobre um `package.json` de motor: o bootstrap (`casca-bootstrap.js`, escolhendo
// em ~/.farol/engine a versão que vai rodar) e o update sob a casca (`update-casca.js`,
// recusando o pacote que o bootstrap nunca escolheria). A regra mora aqui, num lugar só,
// senão os dois poderiam divergir no que aceitam e o update instalaria o que o boot ignora.
import { nodeVersionSatisfies } from '../node-runtime.js';

// O formato de versão que vira nome de pasta em ENGINE_DIR. Fora dele a pasta nunca é
// escolhida, e uma versão com barra ou `..` escreveria fora de ENGINE_DIR.
const VERSAO = /^\d+\.\d+\.\d+$/;

// A faixa `engines.farolShell` do manifesto, ou '' quando ele não a declara.
function faixaDaCasca(manifesto) {
  const faixa = manifesto && manifesto.engines && manifesto.engines.farolShell;
  return typeof faixa === 'string' ? faixa : '';
}

// A casca que roda cabe na faixa que o pacote declara? Faixa vazia nunca aceita.
function cascaAceita(versaoCasca, faixa) {
  return !!faixa && nodeVersionSatisfies(versaoCasca, faixa);
}

export default { VERSAO, faixaDaCasca, cascaAceita };
export { VERSAO, faixaDaCasca, cascaAceita };
