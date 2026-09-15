// Registro durável de cada tentativa de postar APPROVE ou REQUEST_CHANGES com a
// coordenação entre aparelhos ligada (CT-POST, passos 3 e 5, e a reconciliação). Duas
// cópias com papéis diferentes:
//   - LOCAL, em state/postagens.json, gravada de forma atômica: sobrevive a banco fora do
//     ar e a reinício, e é a lista que a reconciliação percorre;
//   - REMOTA, no filho postagens/{EVENTO} do recibo da revisão daquele head: é o que faz
//     outro aparelho enxergar um `enviando` e não postar por cima.
//
// Estados: enviando (a tentativa pode ter alcançado a rede; lido como INCERTO), confirmada,
// recusada e nao_enviada. Só nao_enviada, ou nenhum registro, autoriza tentar de novo;
// recusada autoriza apenas um texto que ainda não foi recusado.
//
// O remoto leva só o que o recibo já expõe: head em claro, ids de aparelho e de tentativa,
// horários, hashes de payload e o id do review. Conta e PR nunca sobem em texto, porque o
// caminho já é o hash dos dois (lib/sync/keys.js).
//
// Nada aqui lança: falha de disco ou de banco volta como { ok: false }.
import path from 'node:path';
import crypto from 'node:crypto';
import { STATE_DIR } from '../paths.js';
import { readJson, writeJsonAtomic, safeStringify } from '../io.js';
import { accountHash, prHash, operationFingerprint, canonicalPrKey } from '../sync/keys.js';
import { receiptPath } from '../sync/receipts.js';

const ESTADOS = new Set(['enviando', 'confirmada', 'recusada', 'nao_enviada']);
const TERMINAIS = new Set(['confirmada', 'recusada', 'nao_enviada']);
const CAMPOS_REMOTOS = ['estado', 'tentativaId', 'intencaoEm', 'atualizadoEm', 'deviceId', 'via', 'evento', 'head', 'payloadHash', 'recusados', 'reviewId', 'commitId', 'motivo'];
const COM_ETAG = { etag: true };
const INDISPONIVEL = 'registro-indisponivel';
// Recusas da função da C0 que não são falha: coordenação desligada, recibo ainda não
// gravado (co-assinatura, ou postagem antes do desfecho da revisão) e recibo já publicado.
// O farol.log é só de falha (invariante 3), então estas não viram WARN.
const PUBLICACAO_SEM_FALHA = new Set(['coordenacao-desligada', 'sem-recibo', 'inalterado']);

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function logar(engine, msg) {
  if (engine && typeof engine.log === 'function') engine.log('WARN', msg);
}

// Relógio da coordenação quando existe (corrigido pelo servidor do banco), senão o local.
function agoraDe(engine) {
  const rt = engine && engine.sync;
  if (rt && typeof rt.agora === 'function') return rt.agora();
  return Date.now();
}

// O arquivo é por PROCESSO de Farol. `engine.postagensArquivo` existe para a suíte simular
// dois aparelhos no mesmo processo, já que o STATE_DIR é resolvido uma vez no import de
// lib/paths.js; em produção o campo não existe e vale state/postagens.json.
function arquivoDePostagens(engine) {
  return (engine && engine.postagensArquivo) || path.join(STATE_DIR, 'postagens.json');
}

function chaveDoRegistro(ctx) {
  const c = ctx || {};
  return [String(c.account || '').toLowerCase(), canonicalPrKey(c.prKey), String(c.head || '').toLowerCase(), String(c.evento || '').toUpperCase()].join('|');
}

function registroValido(r) {
  return ehObjeto(r) && ESTADOS.has(r.estado) && typeof r.tentativaId === 'string' && Number.isFinite(r.intencaoEm);
}

function hashDoPayload(payload) {
  return crypto.createHash('sha256').update(safeStringify(payload, '')).digest('hex');
}

function lerLocais(engine) {
  const dados = readJson(arquivoDePostagens(engine), {});
  return ehObjeto(dados) ? dados : {};
}

function gravarLocal(engine, ctx, registro) {
  const todos = lerLocais(engine);
  todos[chaveDoRegistro(ctx)] = { ...registro, account: ctx.account, prKey: ctx.prKey, head: ctx.head, evento: ctx.evento };
  try {
    writeJsonAtomic(arquivoDePostagens(engine), todos);
    return true;
  } catch (err) {
    logar(engine, `registro de postagem local não gravado (${ctx.prKey}): ${err.message}`);
    return false;
  }
}

function caminhoRemoto(rt, ctx) {
  const fp = operationFingerprint('review', ctx.head);
  return `${receiptPath(rt.uid, accountHash(ctx.account), prHash(ctx.prKey), fp)}/postagens/${String(ctx.evento).toUpperCase()}`;
}

function paraRemoto(registro) {
  const saida = {};
  for (const campo of CAMPOS_REMOTOS) {
    if (registro[campo] !== undefined) saida[campo] = registro[campo];
  }
  return saida;
}

// CT-FIO: o que chega pelo banco só restringe. Registro remoto ilegível não autoriza nada:
// vira `enviando` sem prova, e a reconciliação decide a partir de quando ele foi visto.
function normalizarRemoto(data) {
  if (data === null || data === undefined) return null;
  if (registroValido(data)) return data;
  return { estado: 'enviando', tentativaId: '', intencaoEm: Number.NaN, invalido: true };
}

function carimbo(r, campo) {
  const v = Number(r[campo]);
  return Number.isFinite(v) ? v : 0;
}

function desempateDaMesmaTentativa(a, b) {
  const aTerminal = TERMINAIS.has(a.estado);
  if (aTerminal !== TERMINAIS.has(b.estado)) return aTerminal ? a : b;
  return carimbo(a, 'atualizadoEm') >= carimbo(b, 'atualizadoEm') ? a : b;
}

// PURA: qual das duas cópias vale. Remoto ilegível vence sempre (só restringe). Mesma
// tentativa: desfecho vence `enviando`, e entre dois desfechos vence o mais recente.
// Tentativas diferentes: vence a intenção mais nova.
function estadoEfetivo(local, remoto) {
  if (!local) return remoto || null;
  if (!remoto) return local;
  if (remoto.invalido) return remoto;
  if (local.tentativaId === remoto.tentativaId) return desempateDaMesmaTentativa(local, remoto);
  return carimbo(local, 'intencaoEm') >= carimbo(remoto, 'intencaoEm') ? local : remoto;
}

async function lerRegistro(engine, ctx) {
  const cru = lerLocais(engine)[chaveDoRegistro(ctx)];
  const local = registroValido(cru) ? cru : null;
  const rt = engine && engine.sync;
  if (!rt || !rt.client) return { ok: false, motivo: INDISPONIVEL, local };
  try {
    const lido = await rt.client.get(caminhoRemoto(rt, ctx), COM_ETAG);
    if (!lido.ok) return { ok: false, motivo: INDISPONIVEL, local };
    const remoto = normalizarRemoto(lido.data);
    return { ok: true, local, remoto, efetivo: estadoEfetivo(local, remoto) };
  } catch {
    return { ok: false, motivo: INDISPONIVEL, local };
  }
}

// Leitura com etag e escrita condicionada a ele: `aceita` diz se o que está no banco pode
// ser substituído. Nenhum aparelho sem posse escreve aqui, e o CAS cobre o resto.
async function escreverRemoto(engine, ctx, registro, aceita) {
  const rt = engine && engine.sync;
  if (!rt || !rt.client) return { ok: false, motivo: INDISPONIVEL };
  try {
    const caminho = caminhoRemoto(rt, ctx);
    const lido = await rt.client.get(caminho, COM_ETAG);
    if (!lido.ok) return { ok: false, motivo: INDISPONIVEL };
    if (!aceita(normalizarRemoto(lido.data))) return { ok: false, motivo: 'registro-concorrente' };
    const w = await rt.client.put(caminho, paraRemoto(registro), { ifMatch: lido.etag || 'null_etag' });
    return w.ok ? { ok: true } : { ok: false, motivo: INDISPONIVEL };
  } catch {
    return { ok: false, motivo: INDISPONIVEL };
  }
}

async function gravarIntencao(engine, ctx, registro) {
  if (!gravarLocal(engine, ctx, registro)) return { ok: false, motivo: INDISPONIVEL };
  const aceita = (r) => !r || r.tentativaId === registro.tentativaId || (r.estado !== 'enviando' && !r.invalido);
  const w = await escreverRemoto(engine, ctx, registro, aceita);
  if (w.ok) return { ok: true };
  gravarLocal(engine, ctx, { ...registro, estado: 'nao_enviada', motivo: w.motivo, atualizadoEm: agoraDe(engine) });
  return { ok: false, motivo: w.motivo };
}

async function gravarDesfecho(engine, ctx, tentativaId, campos, opcoes) {
  const atual = lerLocais(engine)[chaveDoRegistro(ctx)];
  const mesma = registroValido(atual) && atual.tentativaId === tentativaId;
  const base = mesma ? atual : { tentativaId, intencaoEm: agoraDe(engine), evento: ctx.evento, head: ctx.head };
  const registro = { ...base, ...campos, atualizadoEm: agoraDe(engine) };
  const aceita = (r) => !r || r.invalido || r.tentativaId === tentativaId || r.estado !== 'enviando';
  if (opcoes && opcoes.remotoPrimeiro) {
    const primeiro = await escreverRemoto(engine, ctx, registro, aceita);
    if (!primeiro.ok) return { ok: false, local: false, remoto: false };
    const gravou = gravarLocal(engine, ctx, registro);
    return { ok: gravou, local: gravou, remoto: true };
  }
  const local = gravarLocal(engine, ctx, registro);
  const remoto = await escreverRemoto(engine, ctx, registro, aceita);
  return { ok: local && remoto.ok, local, remoto: remoto.ok };
}

// Cópia local de um `enviando` visto no banco (de outro aparelho, ou de uma vida anterior
// deste): é o que põe a dúvida na lista da reconciliação daqui.
function observarRemoto(engine, ctx, remoto) {
  const intencaoEm = Number.isFinite(remoto.intencaoEm) ? remoto.intencaoEm : agoraDe(engine);
  const tentativaId = remoto.tentativaId || 'remoto-ilegivel';
  return gravarLocal(engine, ctx, { ...remoto, tentativaId, intencaoEm, leiturasVazias: [], origem: 'remoto' });
}

function gravarLeituras(engine, ctx, leituras) {
  const atual = lerLocais(engine)[chaveDoRegistro(ctx)];
  if (!registroValido(atual)) return false;
  return gravarLocal(engine, ctx, { ...atual, leiturasVazias: leituras });
}

function listarIncertos(engine) {
  return Object.values(lerLocais(engine)).filter((r) => registroValido(r) && r.estado === 'enviando');
}

function adotarLocal(engine, ctx, efetivo) {
  return gravarLocal(engine, ctx, { ...efetivo });
}

// Passo 7 de CT-POST: `confirmada` marca o recibo daquele head como publicado, pela função
// única da C0. Import tardio de propósito: lib/engine/sync.js alcança o coordenador, que
// alcança lib/engine/decision.js, que importa a arbitragem; o import estático fecharia o
// ciclo no carregamento.
async function marcarPublicado(engine, ctx) {
  try {
    const { syncAtualizarPublicacao } = await import('./sync.js');
    const dados = { account: ctx.account, prKey: ctx.prKey, headSha: ctx.head, operationKind: 'review', publicationState: 'published' };
    const r = await syncAtualizarPublicacao(engine, dados);
    if (r && r.ok === false && !PUBLICACAO_SEM_FALHA.has(r.motivo)) logar(engine, `${ctx.prKey}: recibo não marcado como publicado: ${r.motivo || r.code || 'falha'}`);
  } catch (err) {
    logar(engine, `${ctx.prKey}: recibo não marcado como publicado: ${err.message}`);
  }
}

export default {
  lerRegistro, gravarIntencao, gravarDesfecho, estadoEfetivo, observarRemoto, gravarLeituras, listarIncertos,
  adotarLocal, marcarPublicado, hashDoPayload, agoraDe, arquivoDePostagens, chaveDoRegistro,
};
export {
  lerRegistro, gravarIntencao, gravarDesfecho, estadoEfetivo, observarRemoto, gravarLeituras, listarIncertos,
  adotarLocal, marcarPublicado, hashDoPayload, agoraDe, arquivoDePostagens, chaveDoRegistro,
};
