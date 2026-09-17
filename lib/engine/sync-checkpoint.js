// Checkpoint compartilhado no banco (7.C7): publicar o que ESTE aparelho verificou e
// herdar o que os outros verificaram, sempre cifrado e por loja.
//
// O QUE ISTO RESOLVE: hoje a memória do que já foi conferido contra o código morre no
// aparelho que rodou a sessão. Quem pega o mesmo PR depois refaz tudo, e o custo é
// dinheiro. Compartilhar a MEMÓRIA não é migrar sessão: o `sid` do CLI continua sem valer
// fora da máquina que o abriu (CT-RET), e nada aqui retoma processo.
//
// FALHA FECHADA EM TODA LEITURA: entrada que não decifra, que perdeu a forma ou que veio
// de outra loja fica de fora inteira e vira contagem de "não verificável", nunca entrada
// pela metade dentro do gate.
//
// SÓ SOBE O QUE FALTA: cada entrada tem id de conteúdo e o nó é escrita única, então
// republicar é barato e nunca duplica.
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import checkpoint from '../sync/checkpoint.js';
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import { prTag } from '../sync/tags.js';
import { checkpointPath, appendCheckpointEntry, readCheckpoint } from './verification-checkpoint.js';
import publicacao from './sync-publicacao.js';
import publicar from './sync-publicar.js';

const NO = 'checkpoints';
const CAMPO = 'checkpoint';
const ESQUEMA = 'chk1';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function caminhoDe(loja, tagDoPr, id) {
  return `${NO}/${loja}/${tagDoPr}/${id}`;
}

function contexto(engine, cfg, { prKey, loja }) {
  const rt = engine.sync;
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  if (!rt || !rt.client || !rt.uid || !rt.material || !rt.cur) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const lojaLimpa = checkpoint.lojaValida(loja);
  if (!lojaLimpa || !prKey) return recusa('forma', 'checkpoint precisa de PR e de loja conhecida');
  const kId = kek.bufferDe(rt.material.id);
  if (!kId) return recusa('sem-chave', 'o material da chave não serve para gerar tag');
  return { ok: true, rt, loja: lojaLimpa, kId, tagDoPr: prTag(kId, prKey) };
}

// A loja entra no caminho E no envelope: entrada movida de `self` para `review` não abre.
function cifrar(ctx, id, entrada) {
  const caminho = caminhoDe(ctx.loja, ctx.tagDoPr, id);
  return envelope.cifrar({
    uid: ctx.rt.uid, caminho, campo: CAMPO, no: `${NO}/${ctx.loja}`, esquema: ESQUEMA,
    cur: ctx.rt.cur, material: ctx.rt.material, r: 1, dados: { e: entrada },
  });
}

function abrir(ctx, id, no) {
  if (!objeto(no) || !no.enc) return null;
  const caminho = caminhoDe(ctx.loja, ctx.tagDoPr, id);
  const aberto = envelope.decifrar({
    enc: no.enc, material: ctx.rt.material, uid: ctx.rt.uid, caminho, campo: CAMPO, esquema: ESQUEMA,
  });
  if (!aberto.ok || !objeto(aberto.valor)) return null;
  return { id, dev: String(no.dev || ''), entrada: aberto.valor.e };
}

// Publica as entradas locais desta loja que ainda não subiram. O gate de publicação é o
// mesmo dos outros conteúdos compartilhados: sem outro aparelho pronto para ler, ninguém
// escreve nada.
async function publicarCheckpoint(engine, cfg, { prKey, loja = 'review', agora = Date.now() } = {}) {
  const ctx = contexto(engine, cfg, { prKey, loja });
  if (!ctx.ok) return ctx;
  const pode = publicacao.podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const lido = readCheckpoint(checkpointPath(prKey, ctx.loja));
  if (!lido.ok) return recusa('forma', lido.reason || 'checkpoint local ilegível');
  const escritas = [];
  for (const entrada of lido.entries) {
    // entrada herdada de outro aparelho não volta a subir: ela já está lá
    if (entrada && entrada.dev) continue;
    const id = checkpoint.idDaEntrada(ctx.kId, { dev: ctx.rt.deviceId, prKey, entrada });
    if (!id) continue;
    const chave = `${NO}/${ctx.loja}/${ctx.tagDoPr}/${id}`;
    if (publicacao.jaPublicado(ctx.rt, chave)) continue;
    const cifrado = cifrar(ctx, id, checkpoint.sanearEntrada(entrada));
    if (!cifrado.ok) continue;
    const w = await ctx.rt.client.put(`/users/${ctx.rt.uid}/${chave}`, { v: 1, u: agora, dev: ctx.rt.deviceId, enc: cifrado.enc }, {});
    if (!w || !w.ok) continue;
    publicacao.marcarPublicado(ctx.rt, chave, id);
    escritas.push(id);
  }
  return { ok: true, escritas };
}

async function lerCheckpointRemoto(engine, cfg, { prKey, loja = 'review' } = {}) {
  const ctx = contexto(engine, cfg, { prKey, loja });
  if (!ctx.ok) return ctx;
  const lido = await publicar.lerNo(ctx.rt.client, `/users/${ctx.rt.uid}/${NO}/${ctx.loja}/${ctx.tagDoPr}`);
  if (!lido) return recusa(SYNC_CODES.INDISPONIVEL, 'não deu para ler o checkpoint do conjunto');
  const arvore = objeto(lido.valor) ? lido.valor : {};
  const remotas = [];
  let ilegiveis = 0;
  for (const [id, no] of Object.entries(arvore)) {
    if (objeto(no) && String(no.dev || '') === ctx.rt.deviceId) continue;
    const aberta = abrir(ctx, id, no);
    if (!aberta) { ilegiveis += 1; continue; }
    remotas.push(aberta);
  }
  return { ok: true, remotas, ilegiveis };
}

// Traz para o disco local o que os outros verificaram, e devolve o desfecho da herança
// (integral, parcial ou reinício), que é o que a operação registra.
async function herdarCheckpoint(engine, cfg, { prKey, loja = 'review', headSha = '', blobs = null } = {}) {
  const ctx = contexto(engine, cfg, { prKey, loja });
  if (!ctx.ok) return { ...ctx, herdadas: 0, desfecho: 'reinicio' };
  const remoto = await lerCheckpointRemoto(engine, cfg, { prKey, loja });
  if (!remoto.ok) return { ...remoto, herdadas: 0, desfecho: 'reinicio' };
  const caminhoLocal = checkpointPath(prKey, ctx.loja);
  const lido = readCheckpoint(caminhoLocal);
  const locais = lido.ok ? lido.entries : [];
  const { novas, ignoradas } = checkpoint.mesclar({ locais, remotas: remoto.remotas, kId: ctx.kId, dev: ctx.rt.deviceId, prKey });
  for (const entrada of novas) appendCheckpointEntry(caminhoLocal, prKey, '', entrada);
  const relevantes = novas.filter((e) => relevante(e, headSha, blobs)).length;
  return {
    ok: true, herdadas: novas.length, relevantes,
    ilegiveis: remoto.ilegiveis + ignoradas,
    desfecho: checkpoint.desfechoDaHeranca({ herdadas: novas.length, relevantes }),
  };
}

// Mesma régua do checkpoint local: sem head não descarta, mesmo head vale, e blob igual
// mantém a entrada viva num head novo.
function relevante(e, headSha, blobs) {
  if (!headSha || !e.headSha || e.headSha === headSha) return true;
  return !!(blobs && e.file && e.blobSha && blobs[e.file] === e.blobSha);
}

// O que as sessões VIVAS já verificaram sobe no relógio, e não só no fim: sessão que morre
// no meio deixaria a verificação inteira presa neste aparelho.
async function publicarDeSessoesVivas(engine, cfg, { agora = Date.now() } = {}) {
  const vivas = engine.activeReviews instanceof Map ? engine.activeReviews : new Map();
  const feitas = [];
  for (const sessao of vivas.values()) {
    const loja = checkpoint.lojaValida(sessao && sessao.checkpoint);
    const prKey = sessao && sessao.pr && sessao.pr.key;
    if (!loja || !prKey) continue;
    const r = await publicarCheckpoint(engine, cfg, { prKey, loja, agora });
    if (r.ok && r.escritas.length) feitas.push({ prKey, loja, escritas: r.escritas.length });
  }
  return feitas;
}

export default { publicarCheckpoint, lerCheckpointRemoto, herdarCheckpoint, publicarDeSessoesVivas, NO, CAMPO, ESQUEMA };
export { publicarCheckpoint, lerCheckpointRemoto, herdarCheckpoint, publicarDeSessoesVivas, NO, CAMPO, ESQUEMA };
