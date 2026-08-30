// Fonte ÚNICA de leitura de process.env fora de lib/paths.js
// (core.duplication.business-rule). LEITURA PREGUIÇOSA de propósito: os testes setam os
// stubs FAROL_*_CMD depois do require, então snapshot no load quebraria a suíte.
const env = {
  reviewCmdStub: () => process.env.FAROL_REVIEW_CMD,     // usado só em teste: substitui o claude
  headlessCmdStub: () => process.env.FAROL_HEADLESS_CMD, // idem, caminho headless
  debugSpawns: () => process.env.FAROL_DEBUG_SPAWNS === '1',
  setDebugSpawns: (ligado) => { process.env.FAROL_DEBUG_SPAWNS = ligado ? '1' : ''; },
  // Copia do ambiente sem os nomes pedidos, para quem dispara `git`.
  //
  // Mora AQUI, e nao junto de quem usa, por causa da propria regra que este
  // arquivo existe para cumprir: a leitura de process.env tem uma casa so. Quem
  // chama e que sabe QUAIS nomes remover (a lista autoritativa e do git, nao
  // nossa), entao ela vem por parametro em vez de estar escrita aqui dentro.
  semAsVariaveis: (nomes) => {
    const copia = { ...process.env };
    for (const nome of nomes) delete copia[nome];
    return copia;
  },
};
export default env;
export const { reviewCmdStub, headlessCmdStub, debugSpawns, setDebugSpawns, semAsVariaveis } = env;
