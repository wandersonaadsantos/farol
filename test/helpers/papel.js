// O papel do motor na bancada de sincronização (28/09/2026).
//
// A bancada de um motor só faz o papel de DOIS aparelhos: o admin que agenda e emite
// comandos, e o executor que publica, aceita e roda. Em produção o admin nunca executa
// (lib/engine/papel-do-aparelho.js), então, no trecho em que este motor faz o papel do
// executor, o sinal do banco passa a apontar OUTRO aparelho como admin. Fora desse trecho
// ele continua sendo o admin, e o que a tela e as permissões do admin leem não muda.
//
// O sinal fica fixo durante o trecho: o giro dos sinais relê o nó do admin no banco e o
// regravaria para este motor no meio de um fluxo de executor. Devolve a função que
// restaura o papel de admin.

function sinaisDe(rt) {
  if (!rt.sinais || typeof rt.sinais !== 'object') {
    rt.sinais = { conexaoEm: Date.now(), lidos: new Set(), beat: null, ready: null, modo: '', voltaPendente: false, voltando: false, ultimoBatimentoEm: 0, adminLidoEm: 0 };
  }
  return rt.sinais;
}

function comoExecutor(engine, outroDev = 'dev-admin-remoto') {
  const s = sinaisDe(engine.sync);
  const antes = Object.getOwnPropertyDescriptor(s, 'admin');
  const generation = Number(s.admin && s.admin.generation) || 0;
  Object.defineProperty(s, 'admin', {
    configurable: true, enumerable: true,
    get: () => ({ dev: outroDev, generation }),
    set: () => { },
  });
  return function restaurar() {
    if (antes) Object.defineProperty(s, 'admin', antes);
    else delete s.admin;
  };
}

export default { comoExecutor };
export { comoExecutor };
