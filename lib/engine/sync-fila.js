// A fila deste aparelho para a linha do Panorama (controle do celular, 28/09/2026): a
// FIAÇÃO que lê o engine e entrega os fatos à regra pura (lib/sync/fila.js).
//
// Os fatos são lidos UMA vez por giro de publicação e servem a todas as linhas: ler o
// engine PR a PR repetiria as mesmas varreduras de fila, sessão e pendência para cada
// linha. A política da conta é lida sob demanda e guardada no próprio objeto de fatos,
// porque o Panorama costuma ter poucas contas e muitas linhas.
import fila from '../sync/fila.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function emCursoDe(engine) {
  const chaves = new Set();
  for (const pr of Array.isArray(engine.headlessQueue) ? engine.headlessQueue : []) {
    if (pr && pr.kind !== 'self' && pr.key) chaves.add(pr.key);
  }
  const vivas = engine.activeReviews instanceof Map ? engine.activeReviews.values() : [];
  for (const s of vivas) for (const k of (s && s.keys) || []) chaves.add(k);
  return chaves;
}

function pendentesDe(engine) {
  const mapa = new Map();
  const lista = engine.decisions && Array.isArray(engine.decisions.pending) ? engine.decisions.pending : [];
  for (const d of lista) if (d && d.key && !mapa.has(d.key)) mapa.set(d.key, Number(d.createdAt) || 0);
  return mapa;
}

// o estacionamento pela MESMA projeção que a tela local usa (parkedParaUi), que já sabe
// ler o arquivo antigo sem motivo (`legado`) e separar a falha de autenticação
function estacionadosDe(engine) {
  const mapa = new Map();
  const proj = typeof engine.parkedParaUi === 'function' ? engine.parkedParaUi() : {};
  for (const [k, m] of Object.entries(objeto(proj) ? proj : {})) {
    mapa.set(k, { tipo: String((m && m.tipo) || 'legado'), desde: Date.parse((m && m.at) || '') || 0 });
  }
  return mapa;
}

function foraDeCenaDe(engine) {
  const mapa = new Map();
  for (const [k, v] of Object.entries(objeto(engine.skipComentado) ? engine.skipComentado : {})) {
    mapa.set(k, Number(v && v.at) || 0);
  }
  return mapa;
}

function conjunto(v) {
  return v instanceof Set ? v : new Set();
}

function fatosDaFila(engine) {
  return {
    emCurso: emCursoDe(engine),
    pendentes: pendentesDe(engine),
    ignorados: conjunto(engine.ignorados),
    estacionados: estacionadosDe(engine),
    retry: engine.retryAfterNet instanceof Map ? engine.retryAfterNet : new Map(),
    foraDeCena: foraDeCenaDe(engine),
    vistos: conjunto(engine.seen),
    contas: new Map(),
  };
}

function chamar(engine, metodo, conta, padrao) {
  return typeof engine[metodo] === 'function' ? engine[metodo](conta) : padrao;
}

// As mesmas perguntas, e na mesma forma, que o filtro da auto-revisão do check() faz
// (server.js, toReview): silenciada, revisa sozinho, limite do plano e teto do grupo.
function contaDe(engine, fatos, conta) {
  const chave = String(conta || '').toLowerCase();
  if (fatos.contas.has(chave)) return fatos.contas.get(chave);
  const retrato = {
    silenciada: chamar(engine, 'isMuted', conta, false) === true,
    automatica: chamar(engine, 'autoReviewFor', conta, true) !== false,
    limiteAte: Number(chamar(engine, 'limiteDoPlanoAte', conta, 0)) || 0,
    grupoSegura: chamar(engine, 'grupoSegura', conta, false) === true,
  };
  fatos.contas.set(chave, retrato);
  return retrato;
}

// O estado da fila de um PR do Panorama, ou `null` para PR que não foi pedido a mim.
function filaDoPr(engine, fatos, pr) {
  if (!objeto(pr) || pr.mine !== true || !pr.key) return null;
  const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
  return fila.estadoDaFila(pr.key, { ...fatos, conta: contaDe(engine, fatos, conta) });
}

export default { fatosDaFila, filaDoPr };
export { fatosDaFila, filaDoPr };
