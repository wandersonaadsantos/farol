// Justiça de fila entre orgs e contas (spec 2026-09-10-justica-de-fila-entre-orgs).
//
// O painel existe porque uma automação que CEDE A VEZ, vista de fora, é idêntica a uma
// automação QUEBRADA: nos dois casos o PR fica parado e nada na tela explica. É a mesma
// lição do estacionamento visível (v2.57.4) e do rastro durável do gate de orçamento.
//
// Puro: recebe o `filaJusta` do snapshot e devolve HTML. Não decide nada.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou. O import
// abaixo é a camada de baixo do diretório.
import { fmtDur } from './comum.js';

// "há 12m" / "agora" pra um intervalo já medido em ms (o snapshot manda a diferença
// pronta, não o instante, pra tela não depender do relógio da máquina bater com o do
// engine). null = nunca aconteceu.
export function fjQuando(ms) {
  if (ms == null) return 'nunca';
  const d = fmtDur(ms);
  return d ? `há ${d}` : 'agora';
}

// US$ com 2 casas; null/indefinido vira travessão, nunca "NaN" nem "US$ 0.00" (que
// mentiria dizendo que existe teto zerado onde não existe teto nenhum).
export function fjMoeda(v) {
  // null/'' ANTES do Number: Number(null) e Number('') são 0 e finitos, e "US$ 0,00"
  // afirmaria que existe um teto zerado onde na verdade não existe teto nenhum, que é
  // a diferença entre "não pode gastar" e "não configurou".
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? `US$ ${n.toFixed(2)}` : '—';
}
