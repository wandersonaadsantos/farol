// A porta de execução deste aparelho (28/09/2026): a UMA pergunta que toda revisão headless
// faz antes de existir. A regra de hoje mora no próprio módulo: PR da própria conta
// (pr-proprio.js).
import prProprio from './pr-proprio.js';

function motivoParaNaoExecutar(engine, pr) {
  if (prProprio.ehMeu(engine, pr)) return 'pr-proprio';
  return '';
}

// Tira do lote o que não pode executar aqui, com um aviso por PR barrado.
function executaveis(engine, itens) {
  const fica = [];
  const avisos = new Set();
  for (const it of itens) {
    const motivo = motivoParaNaoExecutar(engine, it);
    if (!motivo) { fica.push(it); continue; }
    const aviso = prProprio.avisoPrProprio(it.key);
    if (!avisos.has(aviso)) engine.emit('toast', { kind: 'info', text: aviso });
    avisos.add(aviso);
  }
  return fica;
}

export default { motivoParaNaoExecutar, executaveis };
export { motivoParaNaoExecutar, executaveis };
