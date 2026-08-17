// Fonte ÚNICA de leitura de process.env fora de lib/paths.js (contrato
// engineering-standards). LEITURA PREGUIÇOSA de propósito: os testes setam os
// stubs FAROL_*_CMD depois do require, então snapshot no load quebraria a suíte.
const env = {
  reviewCmdStub: () => process.env.FAROL_REVIEW_CMD,     // usado só em teste: substitui o claude
  headlessCmdStub: () => process.env.FAROL_HEADLESS_CMD, // idem, caminho headless
  debugSpawns: () => process.env.FAROL_DEBUG_SPAWNS === '1',
  setDebugSpawns: (ligado) => { process.env.FAROL_DEBUG_SPAWNS = ligado ? '1' : ''; },
};
export default env;
export const { reviewCmdStub, headlessCmdStub, debugSpawns, setDebugSpawns } = env;
