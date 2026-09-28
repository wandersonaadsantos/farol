// A porta de execução deste aparelho (28/09/2026): a UMA pergunta que toda revisão headless
// faz antes de existir. Duas regras hoje, cada uma dona do próprio módulo: PR da própria
// conta (pr-proprio.js) e aparelho admin, que só observa (papel-do-aparelho.js).
import prProprio from './pr-proprio.js';
import papel from './papel-do-aparelho.js';

function motivoParaNaoExecutar(engine, pr) {
  if (papel.souObservador(engine)) return 'observador';
  if (prProprio.ehMeu(engine, pr)) return 'pr-proprio';
  return '';
}

// O aparelho inteiro não executa (é o admin): os caminhos automáticos que fazem efeito antes
// de chegar ao enqueueHeadless (âncora, aviso, fila) perguntam isto primeiro.
function aparelhoObserva(engine) {
  return papel.souObservador(engine);
}

function avisoDe(motivo, key) {
  return motivo === 'observador' ? papel.AVISO_OBSERVADOR : prProprio.avisoPrProprio(key);
}

// Tira do lote o que não pode executar aqui, com um aviso por PR barrado (o do observador
// sai uma vez só, porque ele vale para o lote inteiro).
function executaveis(engine, itens) {
  const fica = [];
  const avisos = new Set();
  for (const it of itens) {
    const motivo = motivoParaNaoExecutar(engine, it);
    if (!motivo) { fica.push(it); continue; }
    const aviso = avisoDe(motivo, it.key);
    if (!avisos.has(aviso)) engine.emit('toast', { kind: 'info', text: aviso });
    avisos.add(aviso);
  }
  return fica;
}

export default { motivoParaNaoExecutar, executaveis, aparelhoObserva };
export { motivoParaNaoExecutar, executaveis, aparelhoObserva };
