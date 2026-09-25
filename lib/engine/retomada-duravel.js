// Retomada durável (CT-RET da spec docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md,
// entrega 7.A5). Fonte única da referência de retomada de uma revisão headless
// interrompida: engine.retomadas (key do PR -> entrada), espelhada no
// state/inflight.json por montarInflight e restaurada no boot por restaurarRetomadas.
//
// A entrada só sai do Map por consumirRetomada, e quem chama consumir é um DESFECHO:
// sessão que devolveu resultado, retomada recusada pelo CLI, descarte comprovado
// (head mudou, contexto diferente, revisão equivalente concluída), recibo de outro
// aparelho, cancelamento, falha permanente, PR mergeado ou fechado (este, pela repescagem do
// retry e, desde 25/09/2026, pela varredura do ciclo em retomada-varredura.js). Recusa temporária
// (lease, vaga, orçamento, coordenação fora, head não confirmado) nunca consome.
//
// Sem IO de propósito: quem grava o arquivo é o server.js (writeInflight), com
// writeJsonAtomic, e quem decide o que fazer com a validação é o review.js.

// formato de session id do CLI que pode entrar numa linha de shell (--resume). Era
// local do review.js; mora aqui porque é também o que decide se uma linha do
// inflight.json carrega referência de retomada.
const RESUME_SID_RE = /^[0-9a-zA-Z-]{8,64}$/;

const DESFECHOS_RETOMADA = Object.freeze(['retomada', 'recusada', 'nova', 'nenhuma']);
const ESTADOS_INFLIGHT = Object.freeze(['pendente', 'fila', 'execucao']);
const CAMPOS_INFLIGHT = Object.freeze(['key', 'url', 'title', 'author', 'kind', 'estado', 'retomarSid', 'knownHead', 'provedor', 'perfilId', 'sessionId', 'headSha', 'atualizadoEm']);

// frase da esteira quando a referência é descartada antes da sessão. A de head_mudou
// é a mesma de antes desta entrega (test/retomada-apos-falha.test.js casa o texto).
const AVISO_DESCARTE = Object.freeze({
  head_mudou: 'O PR recebeu commit novo depois da queda: a sessão interrompida não é retomada, esta revisão lê o head atual do zero.',
  sem_head_salvo: 'A sessão interrompida não registrou qual commit leu: ela não é retomada, esta revisão lê o head atual do zero.',
  contexto_ausente: 'A sessão interrompida não registrou o perfil do Claude que a abriu: ela não é retomada, esta revisão começa do zero.',
  contexto_incompativel: 'O perfil ou o provedor desta conta mudou desde a queda: a sessão interrompida não é retomada, esta revisão começa do zero.',
  concluida: 'Este commit já tem revisão concluída depois da queda: a sessão interrompida não é retomada.',
  outro_pr: 'A referência de retomada não pertence a este PR: ela foi descartada e esta revisão começa do zero.',
});

function texto(v) { return typeof v === 'string' ? v : ''; }

function mapaDe(engine) {
  if (!(engine.retomadas instanceof Map)) engine.retomadas = new Map();
  return engine.retomadas;
}

function lerRetomada(engine, key) { return mapaDe(engine).get(key) || null; }

function consumirRetomada(engine, key) { return mapaDe(engine).delete(key); }

// contexto local que originou a sessão: o kind do auth resolvido (dir, apikey,
// openrouter, codex) e o id do perfil ('' no legado sem perfil). O grupo de consumo
// não substitui esta identidade (CT-RET).
function contextoDaConta(engine, pr) {
  if (typeof engine.resolveClaudeAuth !== 'function') return { provedor: '', perfilId: '' };
  const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
  const auth = engine.resolveClaudeAuth(conta) || {};
  return { provedor: texto(auth.kind), perfilId: texto(auth.id) };
}

function guardarRetomada(engine, pr, dados = {}) {
  const sid = texto(dados.retomarSid);
  if (!pr || !texto(pr.key) || !RESUME_SID_RE.test(sid)) return null;
  const mapa = mapaDe(engine);
  const anterior = mapa.get(pr.key) || {};
  // head e contexto só são herdados da MESMA sessão: sessão nova com dado ausente
  // fica sem prova, e a validação descarta em vez de supor
  const mesmaSessao = anterior.retomarSid === sid;
  const herdado = (campo) => (mesmaSessao ? texto(anterior[campo]) : '');
  const temContexto = texto(dados.provedor) !== '';
  const provedor = temContexto ? texto(dados.provedor) : herdado('provedor');
  const perfilId = temContexto ? texto(dados.perfilId) : herdado('perfilId');
  const knownHead = texto(dados.knownHead) || herdado('knownHead');
  const entrada = {
    key: pr.key,
    url: texto(pr.url) || texto(anterior.url),
    title: texto(pr.title) || texto(anterior.title),
    author: texto(pr.author) || texto(anterior.author),
    kind: 'auto',
    estado: 'pendente',
    retomarSid: sid,
    knownHead,
    provedor,
    perfilId,
    sessionId: texto(dados.sessionId) || sid,
    headSha: texto(dados.headSha) || knownHead,
    atualizadoEm: new Date().toISOString(),
  };
  mapa.set(pr.key, entrada);
  return entrada;
}

// linha do inflight.json -> entrada do Map. O inflight da v2.57.3 guardava só
// sessionId e headSha: a referência vira retomarSid, o head vira knownHead, e o
// contexto fica vazio, o que a validação lê como contexto ausente.
function normalizarEntrada(bruta, agoraIso) {
  if (!bruta || typeof bruta !== 'object' || !texto(bruta.key)) return null;
  const retomarSid = texto(bruta.retomarSid) || texto(bruta.sessionId);
  if (!RESUME_SID_RE.test(retomarSid)) return null;
  return {
    key: bruta.key,
    url: texto(bruta.url),
    title: texto(bruta.title),
    author: texto(bruta.author),
    kind: 'auto',
    estado: 'pendente',
    retomarSid,
    knownHead: texto(bruta.knownHead) || texto(bruta.headSha),
    provedor: texto(bruta.provedor),
    perfilId: texto(bruta.perfilId),
    sessionId: texto(bruta.sessionId),
    headSha: texto(bruta.headSha),
    atualizadoEm: texto(bruta.atualizadoEm) || agoraIso,
  };
}

function restaurarRetomadas(engine, lista) {
  const mapa = mapaDe(engine);
  const agoraIso = new Date().toISOString();
  for (const bruta of Array.isArray(lista) ? lista : []) {
    const entrada = normalizarEntrada(bruta, agoraIso);
    if (entrada && !mapa.has(entrada.key)) mapa.set(entrada.key, entrada);
  }
  return mapa;
}

function emAndamentoNoBoot(lista) {
  return (Array.isArray(lista) ? lista : []).filter(p => !!p && texto(p.key) !== '' && p.estado !== 'pendente');
}

function linhaInflight(base, entrada, estado, extra) {
  const r = entrada || {};
  return {
    key: base.key,
    url: texto(base.url) || texto(r.url),
    title: texto(base.title) || texto(r.title),
    author: texto(base.author) || texto(r.author),
    kind: 'auto',
    estado,
    retomarSid: texto(r.retomarSid),
    knownHead: texto(r.knownHead) || texto(base.knownHead),
    provedor: texto(r.provedor),
    perfilId: texto(r.perfilId),
    sessionId: texto(extra.sessionId) || texto(r.sessionId),
    headSha: texto(extra.headSha) || texto(r.headSha),
    atualizadoEm: texto(r.atualizadoEm) || new Date().toISOString(),
  };
}

// execução vence fila, fila vence pendente: um PR aparece uma vez só. A referência que
// não está nem na fila nem rodando (esperando vaga entre o dequeue e a sessão, lease,
// orçamento, head não confirmado, retry) sai como pendente, e é isso que fecha a
// janela em que a única referência recuperável sumia do disco.
function montarInflight(engine) {
  const mapa = mapaDe(engine);
  const ativas = engine.activeReviews instanceof Map ? [...engine.activeReviews.values()] : [];
  const fila = Array.isArray(engine.headlessQueue) ? engine.headlessQueue : [];
  const vistos = new Set();
  const lista = [];
  const empurrar = (base, estado, extra) => {
    if (!base || !texto(base.key) || vistos.has(base.key)) return;
    vistos.add(base.key);
    lista.push(linhaInflight(base, mapa.get(base.key), estado, extra));
  };
  for (const s of ativas) {
    if (s && s.mode === 'auto' && s.pr) empurrar(s.pr, 'execucao', { sessionId: texto(s.sessionId), headSha: texto(s.headSha) });
  }
  for (const p of fila) {
    if (p && p.kind !== 'self') empurrar(p, 'fila', {});
  }
  for (const entrada of mapa.values()) empurrar(entrada, 'pendente', {});
  return lista;
}

// revisão equivalente já concluída: decisão do mesmo PR, sobre o mesmo commit que a
// sessão interrompida leu, criada a partir do momento em que a referência foi gravada
function concluidaDepois(engine, entrada) {
  if (!entrada || !texto(entrada.knownHead)) return false;
  const desde = Date.parse(entrada.atualizadoEm);
  if (!Number.isFinite(desde)) return false;
  const decisoes = engine.decisions || {};
  const todas = [...(decisoes.pending || []), ...(decisoes.resolved || [])];
  return todas.some(d => !!d && d.key === entrada.key && d.headSha === entrada.knownHead && Number(d.createdAt) >= desde);
}

// Ordem das perguntas: pertence a este PR, veio do mesmo contexto local, ninguém já
// concluiu, sabemos qual commit ela leu, o commit atual está CONFIRMADO e é o mesmo.
// Head salvo é evidência da tentativa anterior, nunca confirmação do estado atual:
// sem head atual confirmado a resposta é aguardar, nunca retomar (CT-RET).
function validarRetomada(entrada, { prKey, headConfirmado, contexto, concluida } = {}) {
  if (!entrada || !RESUME_SID_RE.test(texto(entrada.retomarSid))) return { acao: 'nenhuma', motivo: 'sem_retomada' };
  if (entrada.key !== prKey) return { acao: 'descartar', motivo: 'outro_pr' };
  if (!texto(entrada.provedor)) return { acao: 'descartar', motivo: 'contexto_ausente' };
  const ctx = contexto || {};
  if (entrada.provedor !== texto(ctx.provedor) || texto(entrada.perfilId) !== texto(ctx.perfilId)) {
    return { acao: 'descartar', motivo: 'contexto_incompativel' };
  }
  if (concluida) return { acao: 'descartar', motivo: 'concluida' };
  if (!texto(entrada.knownHead)) return { acao: 'descartar', motivo: 'sem_head_salvo' };
  if (!texto(headConfirmado)) return { acao: 'aguardar', motivo: 'head_nao_confirmado' };
  if (entrada.knownHead !== headConfirmado) return { acao: 'descartar', motivo: 'head_mudou' };
  return { acao: 'retomar', motivo: 'valida' };
}

const retomadaMod = {
  RESUME_SID_RE, DESFECHOS_RETOMADA, ESTADOS_INFLIGHT, CAMPOS_INFLIGHT, AVISO_DESCARTE,
  lerRetomada, consumirRetomada, contextoDaConta, guardarRetomada, restaurarRetomadas,
  emAndamentoNoBoot, montarInflight, concluidaDepois, validarRetomada,
};
export default retomadaMod;
export {
  RESUME_SID_RE, DESFECHOS_RETOMADA, ESTADOS_INFLIGHT, CAMPOS_INFLIGHT, AVISO_DESCARTE,
  lerRetomada, consumirRetomada, contextoDaConta, guardarRetomada, restaurarRetomadas,
  emAndamentoNoBoot, montarInflight, concluidaDepois, validarRetomada,
};
