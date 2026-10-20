// Quais telas existem e o que cada uma faz ao entrar e ao chegar estado novo.
//
// POR QUE EXISTE: até a Fase 1b o switchTab listava as abas pelo nome
// (`if (name === 'entregas') loadDeliveries()`) e o connect() listava os renderizadores,
// quinze chamadas em sequência. Com o código das abas em módulos, isso obrigaria o módulo a
// importar o bootstrap de volta, que é ciclo. Aqui a dependência é de mão única: a tela se
// declara, o bootstrap percorre.
const TELAS = new Map();

/**
 * @param {{ id: string, aoEntrar?: () => void, aoEstado?: () => void, aoRedimensionar?: () => void }} tela
 * `id` é o nome da aba (o `data-tab` do HTML), ou um nome próprio para tela sem aba.
 * `aoEntrar` roda quando a aba passa a ser a visível; `aoEstado`, a cada snapshot do SSE;
 * `aoRedimensionar`, a cada resize da janela (já debounced pelo bootstrap, ui/app.js).
 */
function registrarTela(tela) {
  if (!tela || !tela.id) throw new Error('tela sem id');
  if (TELAS.has(tela.id)) throw new Error(`tela registrada duas vezes: ${tela.id}`);
  TELAS.set(tela.id, tela);
}

function telasRegistradas() { return [...TELAS.values()]; }

function telaPorId(id) { return TELAS.get(id) || null; }

// Quem precisa saber que a tela mudou de lugar FORA de um clique ou tecla (a caixa de
// revisão abre depois de buscar a decisão; o endereço da página, ui/telas/rota.js, ouve).
// Mora aqui pela mesma razão do registro: a tela avisa sem importar quem escuta, e quem
// escuta não vira ciclo com ela.
const OUVINTES_DE_NAVEGACAO = [];
function aoNavegar(fn) { OUVINTES_DE_NAVEGACAO.push(fn); }
function avisarNavegacao() { for (const fn of OUVINTES_DE_NAVEGACAO) fn(); }

export { registrarTela, telasRegistradas, telaPorId, aoNavegar, avisarNavegacao };
