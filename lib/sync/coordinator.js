// Coordenador de análises entre os aparelhos da mesma pessoa: decide se ESTA análise
// (revisão, autoanálise ou pushback de um PR num head) pode rodar aqui agora. Recebe o
// engine como contexto e lê só o runtime montado por lib/engine/sync.js; quem chama é
// o gate de runClaudeStream (admit) e o clique manual (preflightManual).
//
// Ordem da admissão, e o porquê de cada passo: recibo antes de tudo (análise que já
// terminou em outro aparelho não pode ser paga de novo), preflight do GitHub (review
// meu neste head, feito à mão ou antes da sincronização existir), lease (quem está
// rodando AGORA), releitura do recibo SOB o lease (o outro aparelho pode ter terminado
// entre a primeira leitura e a aquisição) e, só no round automático, o teto do dia.
//
// Nunca lança pelo motivo de coordenação (D9 do contrato): recusa volta como
// { admitted: false, reason, detail }, porque exceção cairia na taxonomia de falha e
// estacionaria o PR, e segurar não é falhar.
import { APP_VERSION } from '../paths.js';
import { SYNC } from '../constants.js';
import { DECISIVE_REVIEW_STATES } from '../engine/decision.js';
import { coordinationActive } from './config.js';
import { SYNC_CODES, motivoDe } from './errors.js';
import { accountHash, prHash, operationFingerprint, brasiliaDay, novoId } from './keys.js';
import { leasePath, leaseAcquirable, acquireLease, renewLease, releaseLease, takeoverLease } from './lease.js';
import tomada from './tomada.js';
import { buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt } from './receipts.js';
import { reserveRound, startRound } from './rounds.js';

const CONECTADO = 'conectado';
const MOTIVO_SEM_HEAD = 'head do PR desconhecido; a coordenação exige a versão material';
const MOTIVO_SEM_CHAVE = 'chave do PR fora do formato dono/repo#número; a coordenação exige a chave';
// accountHash('') devolve hash VÁLIDO. Sem esta recusa, o aparelho que não soubesse a
// conta dona do PR coordenaria num namespace só dele, e o outro, que sabe, em outro:
// os dois se dariam por sozinhos e analisariam o mesmo PR no mesmo head.
const MOTIVO_SEM_CONTA = 'conta dona do PR desconhecida; a coordenação exige a conta';
const MOTIVO_RODADA_PERDIDA = 'a reserva da rodada do dia se perdeu antes de a sessão começar';
const MOTIVO_LEASE_PERDIDO = 'lease perdido; recibo não gravado';
const MOTIVO_ENCERRADO = 'a coordenação desta sessão já foi encerrada';

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusa(reason, detail) {
  return { admitted: false, reason, detail };
}

function admitido(handle) {
  return { admitted: true, handle };
}

function logar(engine, nivel, msg) {
  if (typeof engine.log === 'function') engine.log(nivel, msg);
}

function motivoDoRuntime(rt) {
  return motivoDe((rt.lastError && rt.lastError.code) || SYNC_CODES.INDISPONIVEL);
}

function conectado(rt) {
  return !!rt && rt.status === CONECTADO && !!rt.client;
}

// O nome sai do snapshot de aparelhos que o tick lê; o próprio aparelho usa o nome da
// config, que pode ser mais novo que o snapshot. Sem nome, a tela diz "outro aparelho".
function nomeDoDispositivo(rt, deviceId) {
  if (!deviceId) return '';
  if (deviceId === rt.deviceId) return rt.deviceName || '';
  const d = rt.devices && rt.devices[deviceId];
  return (d && d.name) || '';
}

function noopHandle() {
  // valido() true de propósito: sem coordenação não há lease para perder, e devolver
  // false aqui faria a guarda de postagem barrar quem nem ligou o recurso
  return { noop: true, leaseId: '', attemptId: '', lost: false, done: true, valido: () => true, validoPor: () => true, onLost() {}, complete: async () => ({ ok: true }), abort: async () => {} };
}

// Memória para a tela (recibosVistos) e, na revisão, o PR vira visto POR RECIBO: sem
// isso o toReview o relançaria a cada ciclo só para ouvir a mesma recusa, e sem o motivo
// o reconciliarVistos o devolveria à fila como revisão que morreu. No pushback quem
// avança o marcador é o chamador, que conhece o marcador.
function registrarRecibo(engine, ctx, receipt) {
  const rt = engine.sync;
  const r = ehObjeto(receipt) ? receipt : {};
  if (!rt.recibosVistos) rt.recibosVistos = {};
  const device = (rt.devices && rt.devices[r.deviceId]) || null;
  rt.recibosVistos[ctx.prKey] = {
    at: Number(r.completedAt) || 0, deviceId: r.deviceId || '', deviceName: nomeDoDispositivo(rt, r.deviceId),
    publicationState: r.publicationState || '', operationKind: r.operationKind || ctx.operationKind,
    orfao: receiptOrphanState(r, device, rt.agora()),
  };
  if (ctx.operationKind !== 'review') return;
  if (typeof engine.markSeen === 'function') engine.markSeen(ctx.prKey);
  if (typeof engine.marcarVistoPorRecibo === 'function') engine.marcarVistoPorRecibo(ctx.prKey);
}

// Passos 3 a 5 do contrato: conexão, versão material e chaves. Nada aqui toca a rede.
function preparar(rt, ctx) {
  if (!conectado(rt)) return { recusa: recusa('indisponivel', { motivo: motivoDoRuntime(rt) }) };
  if (!ctx.materialVersion) return { recusa: recusa('indisponivel', { motivo: MOTIVO_SEM_HEAD }) };
  if (!String(ctx.account || '').trim()) return { recusa: recusa('indisponivel', { motivo: MOTIVO_SEM_CONTA }) };
  const ph = prHash(ctx.prKey);
  if (!ph) return { recusa: recusa('indisponivel', { motivo: MOTIVO_SEM_CHAVE }) };
  const ids = { uid: rt.uid, accountHash: accountHash(ctx.account), prHash: ph };
  return { ids, fingerprint: operationFingerprint(ctx.operationKind, ctx.materialVersion), nowMs: rt.agora() };
}

async function consultarRecibo(engine, ctx, pre) {
  const rt = engine.sync;
  const r = await readReceipt(rt.client, pre.ids, pre.fingerprint);
  if (!r.ok) return recusa('indisponivel', { motivo: r.motivo });
  if (!receiptBlocks(r.receipt, rt.agora())) return null;
  registrarRecibo(engine, ctx, r.receipt);
  return recusa('recibo', { receipt: r.receipt, deviceName: nomeDoDispositivo(rt, r.receipt.deviceId) });
}

// null quando não deu para consultar: falta de dado não bloqueia, o pior caso é uma
// análise redundante, nunca uma análise que deixou de acontecer
async function estadosNoHead(engine, ctx) {
  if (!ctx.pr || typeof engine.myReviewStates !== 'function') return null;
  try {
    return await engine.myReviewStates(ctx.pr, ctx.headSha);
  } catch {
    return null;
  }
}

// Review decisivo MEU neste head (postado à mão, por outro aparelho antes da
// sincronização, ou por um Farol que caiu antes de gravar o recibo) é desfecho: vira
// recibo externo, gravado best-effort (se outro aparelho gravou antes, o 412 não importa).
async function reviewExterno(engine, ctx, pre) {
  if (ctx.operationKind !== 'review') return null;
  const states = await estadosNoHead(engine, ctx);
  if (!Array.isArray(states) || !states.some((s) => DECISIVE_REVIEW_STATES.has(s))) return null;
  const rt = engine.sync;
  const recibo = buildReceipt({
    operationKind: 'review', materialVersion: ctx.materialVersion, deviceId: rt.deviceId, leaseId: '', nowMs: rt.agora(),
    outcome: 'external_review', publicationState: 'published', reviewId: '', farolVersion: APP_VERSION,
  });
  await writeReceipt(rt.client, pre.ids, pre.fingerprint, recibo, { ifMatch: 'null_etag' });
  registrarRecibo(engine, ctx, recibo);
  return recusa('recibo', { externo: true });
}

// O tipo da operação do dono vai junto porque o lease é por conta e PR, não por tipo: a
// revisão que ouve "alheio" só pode deixar a label de revisando no PR quando quem está com
// o lease é outra REVISÃO (mesma conta, mesmo nome de label). Lease de pushback ou de
// autoanálise não põe label nenhuma, e preservar a nossa nesse caso a deixaria presa.
function recusaDoLease(rt, a) {
  if (a.reason !== 'alheio') return recusa('indisponivel', { motivo: a.motivo || motivoDe(SYNC_CODES.INDISPONIVEL) });
  const l = ehObjeto(a.lease) ? a.lease : {};
  return recusa('alheio', { deviceId: l.deviceId || '', deviceName: nomeDoDispositivo(rt, l.deviceId), since: Number(l.acquiredAt) || 0, operationKind: String(l.operationKind || '') });
}

// best-effort: lease que não sai agora expira sozinho pelo TTL
async function soltarLease(client, ids, leaseId) {
  await releaseLease(client, ids, { leaseId });
}

async function reservarRodada(rt, pre, leaseId, nowMs) {
  const day = brasiliaDay(nowMs);
  const attemptId = novoId();
  const rr = await reserveRound(rt.client, pre.ids, day, { attemptId, fingerprint: pre.fingerprint, leaseId, nowMs });
  if (!rr.ok && rr.reason === 'esgotado') return { recusa: recusa('esgotado', { day, started: rr.started }) };
  if (!rr.ok) return { recusa: recusa('indisponivel', { motivo: rr.motivo }) };
  const st = await startRound(rt.client, pre.ids, day, { attemptId, leaseId, nowMs });
  if (!st.ok) return { recusa: recusa('indisponivel', { motivo: st.motivo || MOTIVO_RODADA_PERDIDA }) };
  return { attemptId };
}

// Passos 8 a 12: lease, releitura do recibo sob o lease, teto do dia e o handle. Toda
// recusa depois do lease adquirido o devolve antes de sair.
//
// O relógio é relido aqui, e não reaproveitado de preparar(): entre os dois cabem a
// leitura do recibo e o preflight do GitHub (gh com teto de 60s). Com o instante velho
// o lease nasceria perto de vencer (a primeira batida o acharia vencido e cancelaria
// uma sessão paga que acabou de subir) ou já vencido (as regras do banco recusariam o
// PUT e a admissão viraria um 'indisponivel' espúrio).
async function adquirirEAdmitir(engine, ctx, pre) {
  const rt = engine.sync;
  const leaseId = novoId();
  const agora = rt.agora();
  const dados = { leaseId, deviceId: rt.deviceId, operationKind: ctx.operationKind, headSha: ctx.headSha, nowMs: agora, farolVersion: APP_VERSION };
  const a = await acquireLease(rt.client, pre.ids, dados);
  // C8: tomada forçada só acontece com pedido EXPLÍCITO e confirmado, e só quando o lease
  // é de outro aparelho e está vivo. Sem os dois, o caminho é o de sempre.
  if (!a.ok && a.reason === 'alheio' && ctx.tomar === true && ctx.confirmado === true) {
    return tomarEAdmitir(engine, ctx, pre, dados);
  }
  if (!a.ok) return recusaDoLease(rt, a);
  return depoisDoLease(engine, ctx, pre, { leaseId, agora, expiresAt: a.lease.expiresAt, geracao: tomada.geracaoDe(a.lease) });
}

// A evidência da tomada é gravada no ATO, com o risco declarado: ela é o que a tela e o
// histórico mostram, e é o registro honesto de que o consumo pode acontecer duas vezes. O
// Farol não alcança o processo do outro aparelho, e não finge alcançar.
async function tomarEAdmitir(engine, ctx, pre, dados) {
  const rt = engine.sync;
  const t = await takeoverLease(rt.client, pre.ids, dados);
  if (!t.ok) return recusaDoLease(rt, { ok: false, reason: t.reason === 'conflito' ? 'alheio' : t.reason, lease: t.lease });
  registrarTomada(engine, tomada.evidenciaDaTomada(t.anterior, { prKey: ctx.prKey, deviceId: rt.deviceId, nowMs: dados.nowMs }));
  logar(engine, 'WARN', `${ctx.prKey}: lease tomado de ${(t.anterior && t.anterior.deviceId) || 'outro aparelho'}; o processo de la pode seguir vivo (risco de consumo duplicado)`);
  return depoisDoLease(engine, ctx, pre, { leaseId: dados.leaseId, agora: dados.nowMs, expiresAt: t.lease.expiresAt, geracao: t.lease.takeoverSeq });
}

// O outro lado da tomada: este aparelho foi tomado. Ele reconcilia sem tentar reaver nada.
function registrarTomadaSofrida(engine, dados, lease, nowMs) {
  const rt = engine.sync;
  if (!Array.isArray(rt.tomadasSofridas)) rt.tomadasSofridas = [];
  rt.tomadasSofridas.unshift({
    prKey: String((dados.ctx && dados.ctx.prKey) || ''),
    para: String((lease && lease.deviceId) || ''),
    geracao: tomada.geracaoDe(lease),
    risco: 'provavel',
    at: Number(nowMs) || 0,
  });
  if (rt.tomadasSofridas.length > 50) rt.tomadasSofridas.length = 50;
  logar(engine, 'WARN', `${(dados.ctx && dados.ctx.prKey) || 'PR'}: outro aparelho assumiu este PR; a sessao daqui foi encerrada e nada sera postado por ela`);
  if (typeof engine.pushState === 'function') engine.pushState();
}

// Lista viva para a tela, e registro de quem tomou de quem.
function registrarTomada(engine, evidencia) {
  const rt = engine.sync;
  if (!Array.isArray(rt.tomadas)) rt.tomadas = [];
  rt.tomadas.unshift(evidencia);
  if (rt.tomadas.length > 50) rt.tomadas.length = 50;
  if (typeof engine.pushState === 'function') engine.pushState();
}

// Daqui pra baixo o lease JÁ É NOSSO, e toda saída precisa devolvê-lo. Exceção
// inesperada (engine incompleto, defeito na releitura do recibo) sairia por cima do
// `await soltarLease` e deixaria o PR travado para os outros aparelhos até o TTL, com a
// sessão nem tendo começado. O catch solta e relança: quem classifica é o admit.
async function depoisDoLease(engine, ctx, pre, { leaseId, agora, expiresAt, geracao = 1 }) {
  const rt = engine.sync;
  try {
    const recibo = ctx.ignorarRecibo ? null : await consultarRecibo(engine, ctx, pre);
    const rodada = recibo || !ctx.contaRodada ? { attemptId: '' } : await reservarRodada(rt, pre, leaseId, agora);
    const barrado = recibo || rodada.recusa;
    if (barrado) {
      await soltarLease(rt.client, pre.ids, leaseId);
      return barrado;
    }
    return admitido(createHandle(engine, { ids: pre.ids, fingerprint: pre.fingerprint, leaseId, attemptId: rodada.attemptId, ctx, expiresAt, geracao }));
  } catch (err) {
    // best-effort: o lease que não sair agora expira sozinho pelo TTL
    try { await soltarLease(rt.client, pre.ids, leaseId); } catch { /* a falha de origem é a que importa */ }
    throw err;
  }
}

// Os dois overrides valem só no clique explícito: um caminho automático que carregasse
// a flag por engano pularia a coordenação em silêncio.
async function admitir(engine, ctx) {
  if (!coordinationActive(engine.config && engine.config.sync)) return admitido(noopHandle());
  if (ctx.manual && ctx.semCoordenacao) {
    logar(engine, 'INFO', `${ctx.prKey}: gate de coordenação contornado por decisão manual`);
    return admitido(noopHandle());
  }
  const ignorarRecibo = !!(ctx.manual && ctx.ignorarRecibo);
  const c = { ...ctx, ignorarRecibo };
  const pre = preparar(engine.sync, c);
  if (pre.recusa) return pre.recusa;
  const antes = ignorarRecibo ? null : (await consultarRecibo(engine, c, pre)) || (await reviewExterno(engine, c, pre));
  if (antes) return antes;
  return adquirirEAdmitir(engine, c, pre);
}

// Defeito inesperado (engine incompleto, bug) vira espera e não exceção: o chamador
// trataria exceção como falha da revisão e estacionaria o PR.
async function admit(engine, ctx) {
  try {
    return await admitir(engine, ctx || {});
  } catch (err) {
    return recusa('indisponivel', { motivo: `falha interna da coordenação: ${(err && err.message) || err}` });
  }
}

function pararTimer(estado) {
  if (estado.timer) clearInterval(estado.timer);
  estado.timer = null;
}

// callback de quem consome não pode impedir o cancelamento nem os outros callbacks
function avisarPerda(cb) {
  try { cb(); } catch { /* defeito do consumidor não segura o cancelamento da sessão */ }
}

function cancelarSessao(engine, opId) {
  if (!opId || typeof engine.cancelSession !== 'function') return;
  try { engine.cancelSession(opId); } catch { /* sessão que já terminou não tem o que cancelar */ }
}

function perder(engine, h, estado, dados) {
  h.lost = true;
  pararTimer(estado);
  for (const cb of estado.perdas) avisarPerda(cb);
  cancelarSessao(engine, dados.ctx.opId);
}

// Rede caída numa batida não prova que outro aparelho assumiu, e o TTL do lease (4
// batidas) cobre a oscilação. Mas com a queda persistindo nenhuma batida chega a ler o
// lease vencido: o banco o trata como livre a partir de expiresAt, outro aparelho o
// assume e as duas sessões rodariam o mesmo PR no mesmo head. Por isso a validade da
// última escrita que deu certo fica guardada aqui, e passada ela a sessão para sem
// precisar da rede (fail closed: o próprio aparelho sabe que a validade acabou).
function leaseVencido(r, estado, agora) {
  if (r.reason === 'perdido') return true;
  return r.reason === 'indisponivel' && agora >= estado.expiraEm;
}

async function batimento(engine, h, estado, dados) {
  if (estado.emVoo || estado.encerrando || h.done) return;
  estado.emVoo = true;
  try {
    const nowMs = engine.sync.agora();
    const r = await renewLease(dados.client, dados.ids, { leaseId: dados.leaseId, nowMs });
    if (r.ok) estado.expiraEm = nowMs + SYNC.LEASE_TTL_MS;
    else if (!estado.encerrando && !h.done && leaseVencido(r, estado, engine.sync.agora())) {
      // 7.C8: perder para uma TOMADA tem tratamento próprio. O aparelho antigo não recupera
      // a posse, não posta mais (a geração subiu) e registra o risco de consumo duplicado,
      // que é a única coisa honesta a dizer sobre o processo que ele mesmo abriu.
      if (r.reason === 'tomado') registrarTomadaSofrida(engine, dados, r.lease, nowMs);
      perder(engine, h, estado, dados);
    }
  } finally {
    estado.emVoo = false;
  }
}

function recenteDemais(atual, nowMs) {
  return ehObjeto(atual) && Number(atual.completedAt) > nowMs - SYNC.LEASE_TTL_MS;
}

function falhaDe(r) {
  return { ok: false, code: r.code, motivo: r.motivo || motivoDe(r.code) };
}

// 412 quer dizer que já existe recibo deste head: se ele acabou de ser gravado (dentro
// de um TTL de lease), é um sucessor que assumiu e terminou, e o dele fica; se é antigo
// (refazer confirmado, recibo órfão), o desta sessão o substitui, condicionado ao etag.
async function gravarRecibo(dados, recibo, nowMs) {
  const w = await writeReceipt(dados.client, dados.ids, dados.fingerprint, recibo, { ifMatch: 'null_etag' });
  if (w.ok) return { ok: true };
  if (w.code !== SYNC_CODES.CONFLITO) return falhaDe(w);
  const lido = await readReceipt(dados.client, dados.ids, dados.fingerprint);
  if (!lido.ok) return falhaDe(lido);
  if (recenteDemais(lido.receipt, nowMs)) return { ok: true };
  const w2 = await writeReceipt(dados.client, dados.ids, dados.fingerprint, comPostagens(recibo, lido.receipt), { ifMatch: lido.etag });
  return w2.ok ? { ok: true } : falhaDe(w2);
}

// O registro de postagem (lib/engine/registro-postagem.js) mora no filho `postagens` deste
// mesmo nó. Sobrescrever o recibo sem carregar o filho apagaria um `enviando` que outro
// aparelho precisa ver para não postar por cima (CT-POST).
function comPostagens(recibo, anterior) {
  if (!ehObjeto(anterior) || !ehObjeto(anterior.postagens)) return recibo;
  return { ...recibo, postagens: anterior.postagens };
}

async function concluir(engine, h, estado, dados, { outcome = 'completed', publicationState, reviewId = '' } = {}) {
  if (h.done) return { ok: false, code: SYNC_CODES.FALHA_INTERNA, motivo: MOTIVO_ENCERRADO };
  estado.encerrando = true;
  pararTimer(estado);
  h.done = true;
  if (h.lost) return { ok: false, code: SYNC_CODES.CONFLITO, motivo: MOTIVO_LEASE_PERDIDO };
  const nowMs = engine.sync.agora();
  const recibo = buildReceipt({
    operationKind: dados.ctx.operationKind, materialVersion: dados.ctx.materialVersion, deviceId: dados.deviceId,
    leaseId: dados.leaseId, nowMs, outcome, publicationState, reviewId, farolVersion: APP_VERSION,
  });
  const gravado = await gravarRecibo(dados, recibo, nowMs);
  await soltarLease(dados.client, dados.ids, dados.leaseId);
  return gravado;
}

async function abortar(h, estado, dados) {
  if (h.done) return;
  estado.encerrando = true;
  pararTimer(estado);
  h.done = true;
  await soltarLease(dados.client, dados.ids, dados.leaseId);
}

function registrarPerda(h, estado, cb) {
  if (typeof cb !== 'function') return;
  if (h.lost) avisarPerda(cb);
  else estado.perdas.push(cb);
}

// Sem a validade da aquisição (chamador antigo), vale a de um lease pego agora: o
// handle nasce logo depois do acquireLease.
function validadeInicial(rt, expiresAt) {
  return Number.isFinite(expiresAt) ? expiresAt : rt.agora() + SYNC.LEASE_TTL_MS;
}

// Cliente e aparelho ficam presos à admissão: se o runtime reconectar no meio da
// sessão, o recibo e a liberação continuam falando do lease que ESTA sessão pegou.
async function geracaoCorrente(rt, dados, h) {
  try {
    const lido = await rt.client.get(leasePath(dados.ids.uid, dados.ids.accountHash, dados.ids.prHash));
    if (!lido || !lido.ok) return false;
    return !tomada.publicacaoBloqueada(h.geracao, lido.data);
  } catch {
    return false;
  }
}

function createHandle(engine, { ids, fingerprint, leaseId, attemptId, ctx, expiresAt, geracao = 1 }) {
  const rt = engine.sync;
  const dados = { ids, fingerprint, leaseId, ctx, client: rt.client, deviceId: rt.deviceId };
  const estado = { timer: null, emVoo: false, encerrando: false, perdas: [], expiraEm: validadeInicial(rt, expiresAt) };
  // `geracao` é a do lease (7.C8): quem está numa geração atrás não publica mais.
  const h = { noop: false, leaseId, attemptId: attemptId || '', lost: false, done: false, geracao };
  // `lost` só muda na batida do heartbeat (a cada HEARTBEAT_MS, mais o tempo da
  // renovação). Notebook que dorme e acorda com o lease já vencido tem `lost` false até
  // a próxima batida, e nessa janela a postagem sairia com o lease de outro aparelho.
  // `valido()` não espera batida nenhuma: compara o relógio com a validade conhecida.
  h.valido = () => !h.lost && rt.agora() < estado.expiraEm;
  // CT-POST, passo 4: a última conferência antes de cada POST exige folga, não só validade
  h.validoPor = (margemMs) => !h.lost && rt.agora() + (Number(margemMs) || 0) < estado.expiraEm;
  // C8: a última conferência antes do POST pergunta também pela GERAÇÃO. Depois de uma
  // tomada forçada o lease continua existindo, com outro dono e geração maior, e quem ficou
  // atrás não pode publicar. Leitura indisponível NÃO autoriza: na dúvida, não posta.
  h.geracaoCorrente = async () => geracaoCorrente(rt, dados, h);
  h.onLost = (cb) => registrarPerda(h, estado, cb);
  h.complete = (opcoes) => concluir(engine, h, estado, dados, opcoes);
  h.abort = () => abortar(h, estado, dados);
  // o batimento nunca rejeita (os clientes do banco devolvem { ok }), e o catch fica
  // só como rede contra rejeição solta derrubar o processo pelo timer
  const bater = () => { batimento(engine, h, estado, dados).catch(() => undefined); };
  estado.timer = setInterval(bater, SYNC.HEARTBEAT_MS);
  if (estado.timer && typeof estado.timer.unref === 'function') estado.timer.unref();
  // registro dos handles vivos: é o que permite devolver os leases quando a
  // sincronização para (desligar, logout, trocar de conta, encerrar o app). Sem isso,
  // cada saída deixava o PR preso até o TTL, e outro aparelho esperava por nada.
  if (!rt.handlesVivos) rt.handlesVivos = new Set();
  rt.handlesVivos.add(h);
  const sair = () => { if (rt.handlesVivos) rt.handlesVivos.delete(h); };
  const complete0 = h.complete;
  const abort0 = h.abort;
  h.complete = (o) => complete0(o).finally(sair);
  h.abort = () => abort0().finally(sair);
  return h;
}

function bloqueio(r) {
  return { ok: false, reason: r.reason, detail: r.detail };
}

async function headDoPr(engine, pr) {
  if (typeof engine.headSha !== 'function') return '';
  try {
    return String((await engine.headSha(pr)) || '');
  } catch {
    return '';
  }
}

function contaDoPr(engine, pr) {
  if (pr.account) return pr.account;
  return typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
}

// Só leitura: nunca reserva, nunca adquire e nunca escreve (nem o seen local). O gate
// no spawn roda de novo depois do clique e é ele quem decide de fato.
async function verificarManual(engine, pr) {
  if (!coordinationActive(engine.config && engine.config.sync)) return { ok: true };
  const rt = engine.sync;
  if (!conectado(rt)) return bloqueio(recusa('indisponivel', { motivo: motivoDoRuntime(rt) }));
  const ctx = { prKey: pr.key, account: contaDoPr(engine, pr), materialVersion: await headDoPr(engine, pr), operationKind: 'review' };
  const pre = preparar(rt, ctx);
  if (pre.recusa) return bloqueio(pre.recusa);
  const r = await readReceipt(rt.client, pre.ids, pre.fingerprint);
  if (!r.ok) return bloqueio(recusa('indisponivel', { motivo: r.motivo }));
  if (receiptBlocks(r.receipt, pre.nowMs)) return bloqueio(recusa('recibo', { receipt: r.receipt, deviceName: nomeDoDispositivo(rt, r.receipt.deviceId) }));
  const l = await rt.client.get(leasePath(pre.ids.uid, pre.ids.accountHash, pre.ids.prHash));
  if (!l.ok) return bloqueio(recusa('indisponivel', { motivo: l.motivo }));
  if (alheioDeVerdade(rt, l.data, pre.nowMs)) return bloqueio(recusaDoLease(rt, { reason: 'alheio', lease: l.data }));
  return { ok: true };
}

// Lease vivo DESTE aparelho (uma revisão automática ou um pushback em andamento aqui)
// não é bloqueio do clique: quem evita a análise em dobro local é a deduplicação do
// enqueueHeadless. Sem esta distinção o preflight nomeava o próprio aparelho como
// "outro" e a tela mandava esperar por si mesmo.
function alheioDeVerdade(rt, lease, nowMs) {
  if (leaseAcquirable(lease, { leaseId: '', nowMs }) !== 'alheio') return false;
  return !(ehObjeto(lease) && lease.deviceId && lease.deviceId === rt.deviceId);
}

async function preflightManual(engine, pr) {
  try {
    return await verificarManual(engine, pr || {});
  } catch (err) {
    return bloqueio(recusa('indisponivel', { motivo: `falha interna da coordenação: ${(err && err.message) || err}` }));
  }
}

export default { admit, createHandle, noopHandle, preflightManual, registrarRecibo };
export { admit, createHandle, noopHandle, preflightManual, registrarRecibo };
