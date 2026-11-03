// Quais seções do Sistema somem: a regra vale para a navegação e para a busca da tela.

// Aparelhos e Grupos só fazem sentido com a sincronização ligada: desligada, as duas
// seções só mostravam o aviso de que ela está desligada.
export function secoesOcultasDoSistema(config) {
  return config?.sync?.enabled === true ? [] : ['devices', 'groups'];
}

export default { secoesOcultasDoSistema };
