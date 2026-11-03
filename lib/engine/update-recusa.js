// Como os dois caminhos que trocam o motor sem instalador (update-servidor.js e
// update-casca.js) recusam um update: avisam pela tela e devolvem o erro a quem chamou.
import fs from 'node:fs';
import path from 'node:path';

function recusa(engine, texto) {
  engine.emit('toast', { kind: 'error', text: texto });
  return { ok: false, error: texto };
}

// Checkout de desenvolvimento: o update automático não substitui o git pull, e sobrescrever a
// árvore de trabalho seria perder código. Devolve a recusa, ou null quando `raiz` não é checkout.
function recusaDeCheckoutGit(engine, raiz) {
  if (!fs.existsSync(path.join(raiz, '.git'))) return null;
  return recusa(engine, `O Farol roda de um repositório git (${raiz}): atualize com git pull. O update automático não sobrescreve código de desenvolvimento.`);
}

export { recusa, recusaDeCheckoutGit };
