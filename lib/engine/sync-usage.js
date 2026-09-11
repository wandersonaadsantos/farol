// Consolidação do consumo entre aparelhos: a metade de lib/engine/sync.js que junta a
// outbox (lib/sync/outbox.js) com o engine. Separada para o sync.js caber no teto de
// linhas, e porque ela tem regra própria: consumo nunca decide nada, só agrega.
//
// A consolidação só age com a chave ligada (consolidationActive). Desligada, nenhuma
// função daqui lê ou grava o sync-outbox.json, e o gancho de usage.js vira no-op.
import { APP_VERSION } from '../paths.js';
import { consolidationActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe, falhaSemConexao } from '../sync/errors.js';
import { readOutbox, saveOutbox, enqueueSession, reconcileFromSessions, flushOutbox, resetForFullSync, outboxTarget, retargetOutbox } from '../sync/outbox.js';
import { consolidatedSummary } from '../sync/consolidated.js';

// Lotes por tick: a migração inicial de um histórico longo não pode esperar um ciclo de
// polling por lote de 50, nem ocupar o tick inteiro com milhares de PATCH seguidos.
const LOTES_POR_TICK = 10;
const CONECTADO = 'conectado';
// janelas que a aba Consumo oferece (7/30/90) mais as das Entregas (15) e o tudo (0);
// valor fora da lista cai no padrão da tela em vez de virar uma janela que ninguém pediu
const JANELAS = [0, 7, 15, 30, 90];
const JANELA_PADRAO = 30;

function ativa(engine) { return consolidationActive((engine.config && engine.config.sync) || {}); }
function sessoesDe(engine) { return (engine.usageSessions && engine.usageSessions.sessions) || []; }

function logar(engine, msg) {
  if (typeof engine.log === 'function') engine.log('WARN', msg);
}

// Carrega do disco na primeira vez e SEMPRE reconcilia pelo cursor: é isso que traz de
// volta a sessão que entrou no usage-sessions.json e não chegou aqui (processo morto
// no meio, consolidação desligada por um tempo, aparelho ainda sem identidade).
// Sem uid não há destino conhecido, e o destino guardado fica como está: marcar um
// destino vazio a cada enfileiramento feito fora do ar faria a fila inteira voltar
// toda vez que a conexão subisse.
function destinoDe(engine) {
  return outboxTarget(engine.sync.uid, ((engine.config && engine.config.sync) || {}).databaseUrl);
}

function outboxReconciliada(engine) {
  const rt = engine.sync;
  if (!rt.outbox) rt.outbox = readOutbox();
  // antes de reconciliar: o retarget zera o cursor, e é o cursor que decide o que volta
  const mudouDestino = retargetOutbox(rt.outbox, destinoDe(engine));
  const novas = reconcileFromSessions(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);
  if (novas || mudouDestino) saveOutbox(rt.outbox);
  return rt.outbox;
}

// O gancho de recordUsage/marcarDesfecho. Roda DEPOIS do save local e nunca lança: o
// registro de consumo não pode falhar por causa da nuvem. Sem identidade do aparelho o
// eventId sairia errado, então espera: o cursor não andou e a reconciliação pega depois.
function enqueueUsage(engine, sessao) {
  const rt = engine.sync;
  if (!rt || !ativa(engine) || !rt.deviceId) return false;
  try {
    const ob = outboxReconciliada(engine);
    if (!enqueueSession(ob, sessao, rt.deviceId, APP_VERSION)) return false;
    return saveOutbox(ob);
  } catch (err) {
    logar(engine, `consumo entre dispositivos: não foi possível enfileirar a sessão (${err && err.message})`);
    return false;
  }
}

function avisarRejeicao(engine, antes, ob) {
  const novos = ob.rejeitados - antes;
  if (novos > 0) logar(engine, `consumo entre dispositivos: ${novos} evento(s) recusado(s) pelo banco e descartado(s) da fila`);
}

// A pausa loga só quando o código muda, pela mesma razão do registrarFalha: a mesma
// recusa a cada tick inundaria o Diagnóstico. A frase é de CONSUMO de propósito: a
// classe `coordenacao-indisponivel` da taxonomia não pode contar envio de consumo
// parado como coordenação fora do ar, porque a coordenação segue funcionando.
function avisarPausa(engine, ob, r) {
  const rt = engine.sync;
  const code = ob.paused && r && !r.ok ? r.code : '';
  if (code && code !== rt.erroConsumo) logar(engine, `consumo entre dispositivos: envio pausado, ${r.motivo || motivoDe(code)} (${code})`);
  rt.erroConsumo = code;
}

// O destino é preso no começo, e não relido a cada lote: um logout ou uma reconexão no
// meio do laço deixava rt.client null e o lote seguinte lançava TypeError dentro do
// tick, contra a regra de que nada daqui lança para o engine. Trocou a conexão, o resto
// da fila fica para o próximo tick, que já vai falar com o destino novo.
async function enviarLotes(engine, ob) {
  const rt = engine.sync;
  const { client, uid, deviceId, geracao } = rt;
  let enviados = 0;
  for (let i = 0; i < LOTES_POR_TICK && ob.pending.length; i++) {
    if (rt.client !== client || rt.geracao !== geracao) return { ok: true, enviados, restantes: ob.pending.length };
    const r = await flushOutbox(client, uid, deviceId, ob);
    enviados += r.enviados;
    if (!r.ok) return { ...r, enviados };
  }
  return { ok: true, enviados, restantes: ob.pending.length };
}

// Um envio por vez: o tick e o botão de consolidar podem pedir no mesmo instante, e dois
// envios do mesmo lote contariam a mesma recusa duas vezes.
function flushUsage(engine) {
  const rt = engine.sync;
  if (!rt || !ativa(engine) || rt.status !== CONECTADO || !rt.client || !rt.deviceId) return Promise.resolve({ ok: true, enviados: 0 });
  if (rt.enviandoConsumo) return rt.enviandoConsumo;
  const ob = outboxReconciliada(engine);
  const antes = ob.rejeitados;
  const p = enviarLotes(engine, ob).then((r) => {
    avisarPausa(engine, ob, r);
    return r;
  }).finally(() => {
    saveOutbox(ob);
    avisarRejeicao(engine, antes, ob);
    rt.enviandoConsumo = null;
  });
  rt.enviandoConsumo = p;
  return p;
}

// Projeção para a tela: contagens, nunca o conteúdo da fila. Antes da primeira
// reconciliação não há número honesto a mostrar, e null diz isso.
function usageStatus(engine) {
  const rt = engine.sync;
  if (!rt || !ativa(engine) || !rt.outbox) return null;
  const ob = rt.outbox;
  return { pendentes: ob.pending.length, enviados: ob.enviados, rejeitados: ob.rejeitados, lastSentAt: ob.lastSentAt, paused: ob.paused };
}

function falha(code, motivo) { return { ok: false, code, motivo: motivo || motivoDe(code) }; }
function desligada() { return falha(SYNC_CODES.DESLIGADO, 'a consolidação de consumo entre aparelhos está desligada'); }

function janelaDe(days) {
  if (days === null || days === undefined || days === '') return JANELA_PADRAO;
  const n = Number(days);
  return JANELAS.includes(n) ? n : JANELA_PADRAO;
}

// Lê SÓ a árvore do próprio uid: o caminho é montado aqui, nunca vem de fora, e as
// regras do banco recusam o resto. Um GET por nó e nenhuma escrita.
async function consolidated(engine, days) {
  const rt = engine.sync;
  if (!rt || !ativa(engine)) return desligada();
  if (rt.status !== CONECTADO || !rt.client || !rt.uid) return falhaSemConexao(rt);
  const base = `/users/${rt.uid}`;
  const [eventos, aparelhos] = await Promise.all([rt.client.get(`${base}/usageEvents`), rt.client.get(`${base}/devices`)]);
  if (!eventos.ok) return falha(eventos.code, eventos.motivo);
  if (!aparelhos.ok) return falha(aparelhos.code, aparelhos.motivo);
  const resumo = consolidatedSummary(eventos.data, aparelhos.data, { days: janelaDe(days), agoraMs: rt.agora(), euDeviceId: rt.deviceId });
  return { ok: true, resumo };
}

// Migração sob demanda: cursor zerado e o histórico inteiro de volta à fila. Não
// duplica nada no banco (o eventId é o mesmo), só reenvia. Sem identidade do aparelho
// o eventId sairia errado, então espera a primeira conexão.
async function consolidate(engine) {
  const rt = engine.sync;
  if (!rt || !ativa(engine)) return desligada();
  if (!rt.deviceId) return falhaSemConexao(rt);
  if (!rt.outbox) rt.outbox = readOutbox();
  resetForFullSync(rt.outbox);
  const enfileirados = reconcileFromSessions(rt.outbox, sessoesDe(engine), rt.deviceId, APP_VERSION);
  saveOutbox(rt.outbox);
  await flushUsage(engine);
  return { ok: true, enfileirados, pendentes: rt.outbox.pending.length };
}

export default { enqueueUsage, flushUsage, usageStatus, consolidated, consolidate };
export { enqueueUsage, flushUsage, usageStatus, consolidated, consolidate };
