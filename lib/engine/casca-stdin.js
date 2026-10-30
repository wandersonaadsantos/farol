// O fim do stdin como aviso de que a casca nativa morreu (onda de pendências das cascas,
// 30/10/2026). A casca Mac entrega um pipe como stdin do motor e o segura aberto enquanto
// vive; a Windows faz o mesmo, além do Job Object. Quando o app morre sem repassar sinal
// (crash, kill -9, logout), o sistema fecha a ponta da casca e o EOF é o que chega: sem isto
// o pai do bootstrap virava órfão do launchd e o motor reexecutado seguia segurando a porta.
//
// Só em modo casca: quem chama confere `modoCasca()`. O modo servidor roda com stdin fechado
// sob systemd e NÃO pode sair por isso. Stdin já fechado na largada (sem pai que segure o
// pipe) também termina, e conta como "sem pai".
//
// `aoFechar` corre uma vez só, no primeiro de `end` ou `error`. O `resume()` é o que faz o
// `end` chegar: um stream pausado nunca lê até o fim.
function vigiarStdin({ stdin = process.stdin, aoFechar }) {
  let feito = false;
  const fechar = () => {
    if (feito) return;
    feito = true;
    aoFechar();
  };
  stdin.on('end', fechar);
  stdin.on('error', fechar);
  stdin.resume();
}

export default { vigiarStdin };
export { vigiarStdin };
