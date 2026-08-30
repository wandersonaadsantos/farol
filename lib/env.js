// Fonte ÚNICA de leitura de process.env fora de lib/paths.js
// (core.duplication.business-rule). LEITURA PREGUIÇOSA de propósito: os testes setam os
// stubs FAROL_*_CMD depois do require, então snapshot no load quebraria a suíte.
const env = {
  reviewCmdStub: () => process.env.FAROL_REVIEW_CMD,     // usado só em teste: substitui o claude
  headlessCmdStub: () => process.env.FAROL_HEADLESS_CMD, // idem, caminho headless
  debugSpawns: () => process.env.FAROL_DEBUG_SPAWNS === '1',
  setDebugSpawns: (ligado) => { process.env.FAROL_DEBUG_SPAWNS = ligado ? '1' : ''; },
  // Onde mora o clone do eng-behaviour. Existe porque o pacote nao vive no mesmo
  // lugar em toda maquina (Windows e Ubuntu aqui), e o diretorio irmao e o
  // arranjo mais comum, nao um contrato. Vazio significa "usa o irmao".
  engBehaviourHome: () => process.env.ENG_BEHAVIOUR_HOME || '',
};
export default env;
export const { reviewCmdStub, headlessCmdStub, debugSpawns, setDebugSpawns, engBehaviourHome } = env;
