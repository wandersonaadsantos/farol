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

export { registrarTela, telasRegistradas, telaPorId };
