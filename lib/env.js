// Fonte ÚNICA de leitura de process.env fora de lib/paths.js
// (core.duplication.business-rule). LEITURA PREGUIÇOSA de propósito: os testes setam os
// stubs FAROL_*_CMD depois do require, então snapshot no load quebraria a suíte.
const env = {
  reviewCmdStub: () => process.env.FAROL_REVIEW_CMD,     // usado só em teste: substitui o claude
  headlessCmdStub: () => process.env.FAROL_HEADLESS_CMD, // idem, caminho headless
  debugSpawns: () => process.env.FAROL_DEBUG_SPAWNS === '1',
  // cópia do eng-behaviour que o gate usa, quando não é a fixada ao lado (tools/eng-behaviour/gate.js)
  engBehaviourHome: () => process.env.FAROL_ENG_BEHAVIOUR_HOME || '',
  // usados só em teste: os endereços dos emuladores do Firebase que o executor do
  // roteiro de regras recebe quando não vêm por argumento (tools/emuladores/regras-v2.js).
  // Nada de produção lê estes nomes; eles moram aqui pela mesma regra dos stubs acima.
  emuladorBanco: () => process.env.FAROL_EMU_BANCO || '',
  emuladorAuth: () => process.env.FAROL_EMU_AUTH || '',
  emuladorProjeto: () => process.env.FAROL_EMU_PROJETO || '',
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
export const { reviewCmdStub, headlessCmdStub, debugSpawns, engBehaviourHome, setDebugSpawns, semAsVariaveis } = env;
export const { emuladorBanco, emuladorAuth, emuladorProjeto } = env;
