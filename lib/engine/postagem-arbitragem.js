// Arbitragem de postagem no funil (CT-POST da spec 2026-09-15-operacao-multidispositivo).
// Com a coordenação entre aparelhos LIGADA, toda tentativa de APPROVE ou REQUEST_CHANGES,
// venha de qual via vier (revisão automática, reenvio, clique, chat ou terminal,
// co-assinatura), passa por aqui antes de chegar ao gh. Desligada, o postReview nem chama
// este módulo: o caminho é o de sempre, byte a byte.
//
// Os passos: 1 posse (handle da via ou lease 'post'); 2 releitura DEPOIS da posse e da
// espera na fila (registro do head e myReviewStates no head; null nunca autoriza); 3
// intenção durável antes da rede; 4 última conferência da posse colada no io.run; 5
// desfecho (confirmada, recusada ou, sem prova, enviando); 6 recuo como tentativa nova,
// proibido com recuoPermitido === false; 7 recibo do head como publicado.
//
// Garantia e limite, sem exagero: no máximo uma tentativa em voo por conta, PR e head
// entre os aparelhos que participam, e nenhuma repetição às cegas depois de uma tentativa
// que pode ter alcançado a rede. NÃO é exactly-once: entre a última conferência e o pacote
// sair existe uma janela que código nenhum fecha, e quem a cobre é o `enviando` com a
// reconciliação (lib/engine/postagem-reconciliacao.js).
import { TEMPOS } from '../constants.js';
import io from '../io.js';
import { novoId } from '../sync/keys.js';
import { adquirirPosseDePostagem } from '../sync/posse-postagem.js';
import { normalizeReviewPayload } from './public-review.js';
import { lerRegistro, gravarIntencao, gravarDesfecho, observarRemoto, hashDoPayload, marcarPublicado, agoraDe } from './registro-postagem.js';
import { reconciliarPostagensIncertas } from './postagem-reconciliacao.js';

const EVENTOS_ARBITRADOS = new Set(['APPROVE', 'REQUEST_CHANGES']);
const ESTADO_NO_GITHUB = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' };
const SHA_RE = /^[0-9a-f]{7,40}$/i;

const MOTIVOS = {
  'coordenacao-indisponivel': 'a coordenação entre aparelhos está fora do ar, então nada foi postado',
  'posse-alheia': 'outro aparelho está com este PR agora, então nada foi postado',
  'posse-perdida': 'a posse deste PR venceu antes do envio, então nada foi postado',
  'posse-tomada': 'outro aparelho assumiu este PR, então nada foi postado',
  'head-desconhecido': 'não deu para saber o commit atual do PR, então nada foi postado',
  'head-mudou': 'chegou commit novo depois da decisão, então nada foi postado para o commit novo',
  'ancora-ausente': 'a postagem ficou sem a âncora do commit, então nada foi postado',
  'estado-desconhecido': 'não deu para conferir no GitHub se você já tinha se manifestado neste commit, então nada foi postado',
  'registro-indisponivel': 'não deu para gravar a intenção de postar no banco compartilhado, então nada foi postado',
  'registro-concorrente': 'outra tentativa de postagem deste commit está registrada, então nada foi postado',
  'resultado-incerto': 'uma postagem deste commit pode ter chegado ao GitHub e ainda não foi conferida; não posto de novo até conferir',
  'recusada-antes': 'o GitHub já recusou exatamente este texto neste commit; só um texto diferente pode ser postado',
  'recusada-pelo-github': 'o GitHub recusou o conteúdo desta postagem',
};

function postagemCoordenadaLigada(engine) {
  return !!engine && typeof engine.syncCoordenacaoAtiva === 'function' && engine.syncCoordenacaoAtiva() === true;
}

function postagemCoordenada(engine, payload) {
  const evento = String((payload && payload.event) || '').toUpperCase();
  return EVENTOS_ARBITRADOS.has(evento) && postagemCoordenadaLigada(engine);
}

function resultado(estado, motivo) {
  return { ok: false, estado, motivo, attempted: false, reviewId: '', error: MOTIVOS[motivo] || motivo };
}

function naoEnviada(motivo) {
  return resultado('nao_enviada', motivo);
}

function shaValido(v) {
  const s = String(v || '');
  if (!SHA_RE.test(s)) return '';
  return s.toLowerCase();
}

function chaveDoPr(pr) {
  if (pr.key) return pr.key;
  return `${pr.repo}#${pr.number}`;
}

async function headVivo(engine, pr) {
  if (typeof engine.headSha !== 'function') return '';
  try {
    return shaValido(await engine.headSha(pr));
  } catch {
    return '';
  }
}

async function montarContexto(engine, opts) {
  const pr = opts.pr || {};
  const obrigatorio = shaValido(opts.commitIdObrigatorio);
  let head = obrigatorio || shaValido(opts.payload && opts.payload.commit_id);
  if (!head && !opts.commitIdObrigatorio) head = await headVivo(engine, pr);
  return {
    pr, head, obrigatorio, via: String(opts.via || ''), evento: String(opts.payload.event).toUpperCase(),
    account: engine.accountForPr(pr), prKey: chaveDoPr(pr),
  };
}

async function obterPosse(engine, ctx, handle) {
  if (handle) {
    const valido = typeof handle.validoPor === 'function' && handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS);
    if (!valido) return { recusa: 'posse-perdida' };
    return { handle, propria: false };
  }
  const p = await adquirirPosseDePostagem(engine, { prKey: ctx.prKey, account: ctx.account, headSha: ctx.head });
  if (!p.ok) return { recusa: p.motivo };
  return { handle: p.handle, propria: true };
}

async function soltarPosse(handle) {
  try { await handle.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
}

function parar(g, r) {
  g.parada = r;
  return false;
}

function recusadosDe(ef) {
  if (!ef || !Array.isArray(ef.recusados)) return [];
  return ef.recusados.map(String);
}

function mesmaTentativa(a, b) {
  return !!a && !!b && a.tentativaId === b.tentativaId;
}

function barradoPeloRegistro(engine, ctx, lido, payload) {
  const ef = lido.efetivo;
  if (!ef) return null;
  if (ef.estado === 'enviando') {
    if (ef === lido.remoto && !mesmaTentativa(lido.local, ef)) observarRemoto(engine, ctx, ef);
    return resultado('enviando', 'resultado-incerto');
  }
  if (ef.estado === 'confirmada') return { ok: true, deduped: true, estado: 'confirmada', motivo: 'ja-registrada', attempted: false, reviewId: String(ef.reviewId || '') };
  const n = normalizeReviewPayload(payload);
  if (ef.estado === 'recusada' && n.ok && recusadosDe(ef).includes(hashDoPayload(n.value))) return resultado('recusada', 'recusada-antes');
  return null;
}

async function estadosNoHead(engine, ctx) {
  try {
    return await engine.myReviewStates(ctx.pr, ctx.head);
  } catch {
    return null;
  }
}

async function jaNoGithub(engine, ctx) {
  await gravarDesfecho(engine, ctx, novoId(), { estado: 'confirmada', motivo: 'ja-no-github', via: ctx.via });
  await marcarPublicado(engine, ctx);
  return { ok: true, deduped: true, estado: 'confirmada', motivo: 'ja-no-github', attempted: false, reviewId: '' };
}

// Passo 2. Consultas anteriores à posse e à espera na fila não valem.
async function naVez(engine, ctx, g, payload) {
  if (ctx.obrigatorio) {
    const vivo = await headVivo(engine, ctx.pr);
    if (!vivo) return parar(g, naoEnviada('head-desconhecido'));
    if (vivo !== ctx.head) return parar(g, naoEnviada('head-mudou'));
  }
  const lido = await lerRegistro(engine, ctx);
  if (!lido.ok) return parar(g, naoEnviada('registro-indisponivel'));
  g.recusados = recusadosDe(lido.efetivo);
  const barrado = barradoPeloRegistro(engine, ctx, lido, payload);
  if (barrado) return parar(g, barrado);
  const estados = await estadosNoHead(engine, ctx);
  if (!Array.isArray(estados)) return parar(g, naoEnviada('estado-desconhecido'));
  if (estados.includes(ESTADO_NO_GITHUB[ctx.evento])) return parar(g, await jaNoGithub(engine, ctx));
  return true;
}

function intencao(engine, ctx, g) {
  const agora = agoraDe(engine);
  return {
    estado: 'enviando', tentativaId: g.tentativaId, intencaoEm: agora, atualizadoEm: agora,
    deviceId: String((engine.sync && engine.sync.deviceId) || ''), via: ctx.via, evento: ctx.evento, head: ctx.head,
    payloadHash: g.payloadHash, recusados: g.recusados, reviewId: '', commitId: '', motivo: '', leiturasVazias: [],
  };
}

// Passos 3 e 4, colados em cada io.run (depois da fila, do token e do arquivo temporário).
async function antesDoEnvio(engine, ctx, g, handle, payload) {
  if (ctx.obrigatorio && shaValido(payload.commit_id) !== ctx.obrigatorio) return parar(g, naoEnviada('ancora-ausente'));
  g.tentativaId = novoId();
  g.payloadHash = hashDoPayload(payload);
  const w = await gravarIntencao(engine, ctx, intencao(engine, ctx, g));
  if (!w.ok) return parar(g, naoEnviada(w.motivo || 'registro-indisponivel'));
  g.ultimo = 'enviando';
  const motivo = await posseAindaVale(handle);
  if (!motivo) return true;
  await gravarDesfecho(engine, ctx, g.tentativaId, { estado: 'nao_enviada', motivo });
  g.ultimo = 'nao_enviada';
  return parar(g, naoEnviada(motivo));
}

// Duas perguntas diferentes: a posse ainda vale pelo relógio, e a GERAÇÃO dela ainda é a
// corrente (7.C8). Depois de uma tomada forçada o executor antigo pode ter lease "válido"
// em memória e mesmo assim estar proibido de publicar.
async function posseAindaVale(handle) {
  if (!handle.validoPor(TEMPOS.POSTAGEM_MARGEM_POSSE_MS)) return 'posse-perdida';
  if (typeof handle.geracaoCorrente !== 'function') return '';
  return (await handle.geracaoCorrente()) ? '' : 'posse-tomada';
}

// Só 422 com corpo de erro do GitHub prova recusa; o resto (timeout, rede, 5xx) é incerto.
function recusaProvada(r) {
  if (!r || !/HTTP 422/.test(String(r.stderr || ''))) return false;
  const corpo = io.parseJson(String(r.stdout || '').trim(), null);
  return !!corpo && typeof corpo === 'object' && (typeof corpo.message === 'string' || Array.isArray(corpo.errors));
}

async function confirmarEnvio(engine, ctx, g, r) {
  const corpo = io.parseJson(String(r.stdout || ''), null);
  const dados = corpo && typeof corpo === 'object' ? corpo : {};
  g.ultimo = 'confirmada';
  g.reviewId = dados.id ? String(dados.id) : '';
  await gravarDesfecho(engine, ctx, g.tentativaId, { estado: 'confirmada', reviewId: g.reviewId, commitId: String(dados.commit_id || '') });
  await marcarPublicado(engine, ctx);
}

// Passo 5. Sem prova de desfecho, o registro fica `enviando`.
async function depoisDoEnvio(engine, ctx, g, r) {
  if (r && r.ok) {
    await confirmarEnvio(engine, ctx, g, r);
    return;
  }
  if (!recusaProvada(r)) return;
  g.ultimo = 'recusada';
  g.recusados = [...g.recusados, g.payloadHash];
  await gravarDesfecho(engine, ctx, g.tentativaId, { estado: 'recusada', motivo: 'recusada-pelo-github', recusados: g.recusados });
}

function criarGuarda(engine, ctx, handle, opts) {
  const g = { parada: null, ultimo: '', tentativaId: '', payloadHash: '', reviewId: '', recusados: [] };
  const recuoPermitido = opts.recuoPermitido !== false;
  g.naVez = () => naVez(engine, ctx, g, opts.payload);
  g.antesDoEnvio = (payload) => antesDoEnvio(engine, ctx, g, handle, payload);
  g.depoisDoEnvio = (r) => depoisDoEnvio(engine, ctx, g, r);
  g.podeRecuar = () => recuoPermitido && g.ultimo === 'recusada';
  return g;
}

function resultadoFinal(g, r) {
  if (g.parada) return g.parada;
  const base = r || { ok: false, error: 'postagem sem resposta' };
  if (base.ok) return { ...base, estado: 'confirmada', motivo: '', attempted: g.ultimo === 'confirmada', reviewId: g.reviewId };
  if (g.ultimo === 'recusada') return { ...base, estado: 'recusada', motivo: 'recusada-pelo-github', attempted: true, reviewId: '' };
  if (g.ultimo === 'enviando') {
    const error = `${MOTIVOS['resultado-incerto']} (${base.error || 'sem resposta'})`;
    return { ...base, estado: 'enviando', motivo: 'resultado-incerto', attempted: true, reviewId: '', error };
  }
  return { ...base, estado: 'nao_enviada', motivo: base.blocked || 'nao-enviada', attempted: false, reviewId: '' };
}

async function arbitrarPostagem(engine, opcoes, enviar) {
  const opts = opcoes || {};
  const ctx = await montarContexto(engine, opts);
  if (!ctx.head) return naoEnviada('head-desconhecido');
  const posse = await obterPosse(engine, ctx, opts.handle);
  if (posse.recusa) return naoEnviada(posse.recusa);
  try {
    const g = criarGuarda(engine, ctx, posse.handle, opts);
    const r = await enviar(g);
    return resultadoFinal(g, r);
  } finally {
    if (posse.propria) await soltarPosse(posse.handle);
  }
}

// Recusas que não chegaram à rede e cuja causa passa sozinha: banco compartilhado fora
// por um instante, leitura do GitHub que falhou. Repetir é seguro porque nada saiu. Posse
// de outro aparelho, commit novo e resultado incerto ficam de fora: repetir ali seria
// disputar trabalho alheio, postar sobre código que ninguém revisou ou arriscar review
// duplicado.
const MOTIVOS_PASSAGEIROS = new Set(['registro-indisponivel', 'coordenacao-indisponivel', 'estado-desconhecido', 'head-desconhecido']);
const RETENTATIVAS_NA_REVISAO = 3;

function falhaPassageira(post) {
  return !!post && post.ok !== true && post.estado === 'nao_enviada' && post.attempted === false && MOTIVOS_PASSAGEIROS.has(post.motivo);
}

function esperaReal(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// Objeto e não função solta: a suíte troca a espera sem mexer em relógio global.
const retentativa = { esperar: esperaReal };

// A revisão automática tenta de novo, no máximo 3 vezes e com 2 s entre elas, só quando a
// recusa é passageira. `antes` roda antes de cada nova tentativa (a conferência do lease).
async function postarComRetentativas(postar, { antes } = {}) {
  let post = await postar();
  for (let i = 0; i < RETENTATIVAS_NA_REVISAO && falhaPassageira(post); i++) {
    await retentativa.esperar(TEMPOS.POSTAGEM_RETENTATIVA_MS);
    if (typeof antes === 'function') antes();
    post = await postar();
  }
  return post;
}

// A revisão automática trata posse perdida como perda de coordenação (err.coordenacao),
// nunca como falha de rede: senão o postRetry reenviaria sem lease.
function lancarSePossePerdida(post) {
  if (!post || post.estado !== 'nao_enviada' || post.motivo !== 'posse-perdida') return;
  throw Object.assign(new Error('lease de coordenação perdido antes de postar; nada foi postado'), { coordenacao: 'perdido' });
}

export default { arbitrarPostagem, reconciliarPostagensIncertas, postagemCoordenada, postagemCoordenadaLigada, lancarSePossePerdida, falhaPassageira, postarComRetentativas, retentativa, MOTIVOS };
export { arbitrarPostagem, reconciliarPostagensIncertas, postagemCoordenada, postagemCoordenadaLigada, lancarSePossePerdida, falhaPassageira, postarComRetentativas, retentativa, MOTIVOS };
