// O que das sessões ativas vai para a tela. PURA, sem engine e sem IO.
//
// Saiu do lib/engine/session.js em 30/09/2026: o arquivo está acima do teto de tamanho e
// o ratchet passou a medir crescimento, e isto aqui é assunto próprio, a fronteira entre
// o registro interno da sessão (mapas, blobs, Set de leitura) e o que a tela pode ver.

// projeção das sessões ativas pro snapshot: PURA. Tira o que é interno (fileBlobs,
// o mapa cru de agents) e entrega a contagem e a lista compacta que a UI mostra.
function projectSessions(records) {
  return (records || []).map((s) => {
    const { fileBlobs, agents, filesRead, scopeRoot, ...rest } = s;
    void fileBlobs; void scopeRoot;
    // NUMERADOR da leitura vai para a tela (o Set nao vai): "12 arquivos do PR lidos" e
    // medida de verdade, ao contrario da barra que existia antes, que era a contagem de
    // linhas do feed passada por uma exponencial e saturava em 90%.
    if (filesRead && filesRead.size) rest.lidos = filesRead.size;
    const list = Object.values(agents || {});
    if (!list.length) return rest;
    return {
      ...rest,
      agents: list.map(a => ({ n: a.n, label: a.label, desc: a.desc, done: !!a.done })),
      agentsLive: list.filter(a => !a.done).length,
    };
  });
}

const projecaoMod = { projectSessions };
export default projecaoMod;
export { projectSessions };
