// O que o Radar manda à tela além das listas (07/11/2026): projeções do snapshot que liam o
// estado do engine dentro do server.js. Só leitura e só allowlist; nada aqui decide.
import { projetarProntidao } from './prontidao-pr-estado.js';

// Último estado decisivo MEU no GitHub por PR do panorama (staleInfo, que o
// refreshStaleStates já busca). É o que faz o selo concordar entre aparelhos: o
// histórico local só sabe o que ESTE aparelho postou.
function reviewStatesGh(engine) {
  const saida = {};
  const chaves = new Set((engine.panorama || []).map(p => p.key));
  for (const [k, info] of Object.entries(engine.staleInfo || {})) {
    if (chaves.has(k) && ['APPROVED', 'CHANGES_REQUESTED'].includes(info?.lastState)) saida[k] = info.lastState;
  }
  return saida;
}

// A faixa de prontidão (checks, reviewers, merge) de cada PR, com o merge do
// refreshMergeStates vencendo quando foi lido depois (lib/engine/prontidao-pr-estado.js).
function prontidao(engine) {
  return projetarProntidao(engine.prontidao, engine.mergeStates);
}

const radarNaTela = { reviewStatesGh, prontidao };
export default radarNaTela;
export { reviewStatesGh, prontidao };
