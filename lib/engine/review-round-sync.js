import { marcoDe } from './sync-historico.js';
// Transporte privado de rodadas pelo nó cifrado e write-once já usado pelo histórico.
// Fragmentos preservam o conteúdo inteiro; manifesto ausente nunca significa memória vazia.
import capacidade from '../sync/capacidade.js';
import { sharedActive } from '../sync/config.js';
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import { tag } from '../sync/tags.js';
import { safeStringify, parseJson } from '../io.js';
import { contentHash, validRound } from './review-round-store.js';

const SCHEME = 'round1';
const CHUNK_BYTES = 9000;

function context(engine, scope) {
  const rt = engine.sync;
  if (!sharedActive(engine.config?.sync || {})) return { status: 'local' };
  const key = rt?.material && kek.bufferDe(rt.material.id);
  if (!rt?.client || !rt.uid || !rt.cur || !key) return { status: 'unavailable', reason: 'sincronização da memória não está pronta' };
  return { status: 'ready', rt, root: `reviewBodies/${tag(key, 'review-rounds', scope)}` };
}

function versions(id, count) {
  const prefix = BigInt(`0x${id}`).toString();
  return Array.from({ length: count + 1 }, (_, i) => prefix + String(i).padStart(6, '0'));
}

function partsOf(round) {
  const text = Buffer.from(safeStringify(round, ''), 'utf8');
  const parts = [];
  for (let i = 0; i < text.length; i += CHUNK_BYTES) parts.push(text.subarray(i, i + CHUNK_BYTES).toString('base64'));
  return parts;
}

async function putPart(ctx, version, value) {
  const caminho = `${ctx.root}/${version}`;
  const sealed = envelope.cifrar({ uid: ctx.rt.uid, caminho, campo: 'round', no: 'reviewBodies', esquema: SCHEME,
    cur: ctx.rt.cur, material: ctx.rt.material, r: 1, dados: { value } });
  if (!sealed.ok) return false;
  const w = await ctx.rt.client.put(`/users/${ctx.rt.uid}/${caminho}`, { v: 1, enc: sealed.enc }, { ifMatch: 'null_etag' });
  if (w?.ok) return true;
  if (w?.code !== 'conflito') return false;
  const existing = await ctx.rt.client.get(`/users/${ctx.rt.uid}/${caminho}`);
  return existing?.ok && contentHash(openPart(ctx, version, existing.data)) === contentHash(value);
}

function openPart(ctx, version, node) {
  if (!node?.enc) return null;
  const opened = envelope.decifrar({ enc: node.enc, material: ctx.rt.material, uid: ctx.rt.uid,
    caminho: `${ctx.root}/${version}`, campo: 'round', esquema: SCHEME });
  return opened.ok ? opened.valor?.value : null;
}

async function publishRound(engine, round) {
  if (!validRound(round, round?.scope)) return { ok: false, reason: 'rodada fora do contrato de compartilhamento' };
  const ctx = context(engine, round.scope);
  if (ctx.status === 'local') return { ok: true, status: 'local' };
  if (ctx.status !== 'ready') return { ok: false, reason: ctx.reason };
  try {
    const since = ctx.rt.historicoDesde || (ctx.rt.historicoDesde = marcoDe(Date.now()));
    if (round.at < since) return { ok: false, reason: 'memória anterior ao compartilhamento exige envio explícito' };
    const receipt = `${round.scope}|${round.id}|${contentHash(round)}`;
    if (ctx.rt.roundsPublished?.has(receipt)) return { ok: true, status: 'shared' };
    const parts = partsOf(round), ids = versions(round.id, parts.length);
    for (const [i, text] of parts.entries()) if (!await putPart(ctx, ids[i + 1], { kind: 'part', id: round.id, index: i, text })) {
      return { ok: false, reason: 'fragmento de memória não foi confirmado no conjunto' };
    }
    const manifest = { kind: 'manifest', id: round.id, scope: round.scope, count: parts.length, hash: contentHash(round) };
    if (!await putPart(ctx, ids[0], manifest)) return { ok: false, reason: 'manifesto de memória não foi confirmado no conjunto' };
    if (!(ctx.rt.roundsPublished instanceof Set)) ctx.rt.roundsPublished = new Set();
    ctx.rt.roundsPublished.add(receipt);
    return { ok: true, status: 'shared' };
  } catch { return { ok: false, reason: 'falha ao publicar memória no conjunto' }; }
}

function restoreRound(ctx, manifest, nodes, scope) {
  if (!/^[a-f0-9]{32}$/.test(manifest.id) || manifest.scope !== scope || !Number.isSafeInteger(manifest.count) || manifest.count < 1 || manifest.count > Object.keys(nodes).length) return null;
  const ids = versions(manifest.id, manifest.count), parts = [];
  for (let i = 0; i < manifest.count; i++) {
    const part = openPart(ctx, ids[i + 1], nodes[ids[i + 1]]);
    if (part?.kind !== 'part' || part.id !== manifest.id || part.index !== i || typeof part.text !== 'string') return null;
    parts.push(Buffer.from(part.text, 'base64'));
  }
  const round = parseJson(Buffer.concat(parts).toString('utf8'), null);
  return validRound(round, scope) && contentHash(round) === manifest.hash ? round : null;
}

async function incompatiblePeer(ctx) {
  const peers = Object.entries(ctx.rt.devices || {}).filter(([id, d]) => id !== ctx.rt.deviceId && !d.retiredAt);
  if (!peers.length) return false;
  const response = await ctx.rt.client.get(`/users/${ctx.rt.uid}/live/deviceStatus`);
  if (!response?.ok) return true;
  return peers.some(([dev]) => capacidade.abrirCapacidade({ uid: ctx.rt.uid, material: ctx.rt.material,
    dev, no: response.data?.[dev] })?.c.reviewRoundsSchema !== 1);
}

async function readRemoteRounds(engine, scope) {
  const ctx = context(engine, scope);
  if (ctx.status === 'local') return { ok: true, rounds: [], status: 'local' };
  if (ctx.status !== 'ready') return { ok: false, rounds: [], reason: ctx.reason };
  try {
    if (await incompatiblePeer(ctx)) return { ok: false, rounds: [], reason: 'outro executor não confirmou suporte à memória de rodadas' };
    const response = await ctx.rt.client.get(`/users/${ctx.rt.uid}/${ctx.root}`);
    if (!response?.ok) return { ok: false, rounds: [], reason: 'memória remota indisponível' };
    const nodes = response.data || {}, rounds = [], values = Object.entries(nodes).map(([id, n]) => openPart(ctx, id, n));
    let invalid = values.some(v => !v || !['manifest', 'part'].includes(v.kind));
    const manifests = values.filter(v => v?.kind === 'manifest');
    for (const m of manifests) {
      const round = restoreRound(ctx, m, nodes, scope);
      if (round) rounds.push(round); else invalid = true;
    }
    const committed = new Set(manifests.map(m => m.id));
    if (values.some(v => v?.kind === 'part' && !committed.has(v.id))) invalid = true;
    return { ok: !invalid, rounds, status: 'shared', reason: invalid ? 'memória remota incompleta ou incompatível' : '' };
  } catch { return { ok: false, rounds: [], reason: 'memória remota não pôde ser conferida' }; }
}

export default { publishRound, readRemoteRounds };
export { publishRound, readRemoteRounds };
