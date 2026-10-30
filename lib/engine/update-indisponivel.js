// Por que esta instalação não se atualiza sozinha (colaborador de update.js). A tela declara o
// motivo (engine.update.indisponivel) e o log não se suja: não é falha, é o jeito de a
// instalação ser.
import fs from 'node:fs';
import path from 'node:path';
import { APP_ROOT, atualizacaoExterna } from '../paths.js';

// Instalação que roda de um checkout git (APP_ROOT/.git) não se atualiza sozinha: o
// update-servidor e o update-casca recusam. Lido uma vez por processo.
let checkoutGitCache;
function ehCheckoutGit() {
  if (checkoutGitCache === undefined) checkoutGitCache = fs.existsSync(path.join(APP_ROOT, '.git'));
  return checkoutGitCache;
}

// 'externo' vence 'checkout-git'; sem nenhum dos dois, null.
function motivoDeIndisponibilidade({ externo, checkoutGit }) {
  if (externo) return 'externo';
  return checkoutGit ? 'checkout-git' : null;
}

// `deps.externa` e `deps.checkoutGit` existem para o teste.
function indisponibilidade(deps) {
  return motivoDeIndisponibilidade({
    externo: deps.externa ?? atualizacaoExterna(),
    checkoutGit: deps.checkoutGit ?? ehCheckoutGit()
  });
}

export { motivoDeIndisponibilidade, indisponibilidade };
