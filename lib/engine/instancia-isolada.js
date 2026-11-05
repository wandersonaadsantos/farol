// Instância de teste não escreve no GitHub (parte D, 05/11/2026).
//
// Uma instância subida com FAROL_HOME fora do ~/.farol e conta real configurada postou sete
// reviews de verdade. A regra: nessa instância toda escrita no GitHub (review, label, pedido
// de revisão, merge) é recusada, a menos que o config.json dela traga `instanciaIsoladaPosta: true`
// (só por arquivo, nunca pela tela). PURO: `isolada` é injetável para teste.
import { instanciaIsolada } from '../paths.js';

function recusaDeIsolada(engine, acao, { isolada = instanciaIsolada } = {}) {
  if (!isolada || engine?.config?.instanciaIsoladaPosta === true) return null;
  return {
    ok: false, blocked: 'instancia_isolada', attempted: false,
    error: `instância isolada (FAROL_HOME fora de ~/.farol) não ${acao} no GitHub; para permitir, grave "instanciaIsoladaPosta": true no config.json`,
  };
}

export default { recusaDeIsolada };
export { recusaDeIsolada };
