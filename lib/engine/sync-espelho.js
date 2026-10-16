import { createECDH, createHash } from 'node:crypto';
import io from '../io.js';
// Espelho sob demanda no mesmo canal cifrado e autenticado das operações.
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import { tag } from '../sync/tags.js';
import { snapshotEspelho, fragmentar, recompor, MAX_PARTES } from '../sync/espelho.js';
const NO = 'live/operations';
const HEX = /^[0-9a-f]{32}$/;
const TTL = 150000;
function parDeChaves() { const e = createECDH('prime256v1'); e.generateKeys(); return e; }
function materialDoEspelho(rt, chave, pub, opId, watchId) {
  const secret = chave.computeSecret(Buffer.from(pub, 'base64'));
  const key = createHash('sha256').update(secret).update(`${rt.uid}|${opId}|${watchId}`).digest('base64');
  return { ...rt, material: { ...rt.material, enc: Object.fromEntries(Object.keys(rt.material.enc).map(k => [k, key])) } };
}
function estado(engine) {
  const rt = engine.sync;
  if (!rt.espelho) rt.espelho = { assistir: new Map(), publicados: new Map(), retirar: new Set() };
  rt.espelho.retirar ||= new Set();
  return rt.espelho;
}
function idDe(rt, nome) { return tag(kek.bufferDe(rt.material.id), 'event', nome); }
function contexto(rt, id, no, esquema) {
  return { uid: rt.uid, caminho: `${NO}/${id}`, campo: 'espelho', no: NO, esquema, material: rt.material, extras: [no.dev, no.t0, no.x] };
}
function abrir(rt, id, no, esquema) {
  if (!no || !no.enc) return null;
  const r = envelope.decifrar({ ...contexto(rt, id, no, esquema), enc: no.enc });
  return r.ok ? r.valor?.p : null;
}
async function escrever(rt, id, p, esquema, t0, agora, ttl = TTL) {
  const no = { v: 1, dev: rt.deviceId, t0, x: agora + ttl };
  const c = envelope.cifrar({ ...contexto(rt, id, no, esquema), cur: rt.cur, r: 1, dados: { p } });
  if (!c.ok) throw Error(`Espelho não cifrado: ${c.motivo}`);
  const w = await rt.client.put(`/users/${rt.uid}/${NO}/${id}`, { ...no, enc: c.enc }, {});
  if (!w?.ok) throw Error('Espelho não publicado');
}
function assistir(engine, body, agora = Date.now()) {
  const rt = engine.sync;
  const opId = String(body?.opId || '');
  if (!rt?.material || !rt?.uid || !HEX.test(opId)) return { ok: false, code: 'espelho-indisponivel' };
  const st = estado(engine);
  if (body.aberto === false) {
    const reg = st.assistir.get(opId);
    if (reg) st.retirar.add(reg.id);
    st.assistir.delete(opId);
    return { ok: true };
  }
  if (!(rt.andamentoRemoto || []).some(o => o.opId === opId && o.situacao === 'viva')) return { ok: false, code: 'sessao-sem-sinal' };
  if (!st.assistir.has(opId) && st.assistir.size >= 4) return { ok: false, code: 'limite-de-espelhos' };
  const reg = st.assistir.get(opId) || { t0: agora, id: idDe(rt, `watch|${rt.deviceId}|${opId}|${agora}`), chave: parDeChaves() };
  st.assistir.set(opId, { ...reg, ate: agora + 35000 });
  return { ok: true };
}
async function publicarPedidos(engine, agora) {
  const rt = engine.sync, st = estado(engine);
  for (const [opId, r] of st.assistir) {
    if (r.ate <= agora) { st.retirar.add(r.id); st.assistir.delete(opId); continue; }
    await escrever(rt, r.id, { opId, pub: r.chave.getPublicKey().toString('base64') }, 'watch1', r.t0, agora, 35000);
  }
  for (const id of st.retirar) {
    const r = await rt.client.del(`/users/${rt.uid}/${NO}/${id}`);
    if (r?.ok) st.retirar.delete(id);
  }
}
function assistidas(rt, arvore, agora) {
  const ops = new Map();
  for (const [id, no] of Object.entries(arvore || {})) {
    if (no.x <= agora || no.dev === rt.deviceId) continue;
    const p = abrir(rt, id, no, 'watch1');
    if (p && HEX.test(p.opId) && typeof p.pub === 'string' && p.pub.length < 160) ops.set(id, { opId: p.opId, pub: p.pub });
  }
  return ops;
}
async function publicarSessao(engine, reg, sessao, feed, agora, watchId, pedido) {
  const rt = engine.sync, st = estado(engine);
  const anterior = st.publicados.get(watchId);
  const chave = anterior?.chaveEcdh || parDeChaves();
  let canal;
  try { canal = materialDoEspelho(rt, chave, pedido.pub, reg.opId, watchId); } catch { return; }
  const valor = snapshotEspelho(sessao, feed, agora);
  // O carimbo não obriga retransmitir a mesma janela inteira a cada giro.
  const resumo = io.safeStringify({ ...valor, capturadoEm: 0 });
  if (anterior?.resumo === resumo && agora - anterior.at < 60000) return;
  const pacote = fragmentar(valor), versao = `${agora}-${pacote.hash.slice(0, 12)}`;
  const ids = [];
  for (let i = 0; i < pacote.partes.length; i++) {
    const id = idDe(rt, `mirror|${reg.opId}|${watchId}|${versao}|${i}`);
    ids.push(id);
  }
  for (let i = 0; i < ids.length; i += 12) {
    await Promise.all(ids.slice(i, i + 12).map((id, j) => escrever(canal, id, { text: pacote.partes[i + j] }, 'mirror-part1', agora, agora)));
  }
  const metaId = idDe(rt, `mirror-meta|${reg.opId}|${watchId}`);
  await escrever(rt, metaId, { opId: reg.opId, watchId, pub: chave.getPublicKey().toString('base64'), versao, partes: ids.length, hash: pacote.hash }, 'mirror-meta1', reg.t0, agora);
  st.publicados.set(watchId, { resumo, chaveEcdh: chave, opId: reg.opId, at: agora, ids, metaId });
  for (const id of anterior?.ids || []) await rt.client.del(`/users/${rt.uid}/${NO}/${id}`);
}
async function cicloEspelho(engine, arvore, agora) {
  const rt = engine.sync;
  if (!rt?.material || !rt.client) return;
  await publicarPedidos(engine, agora);
  const vendo = assistidas(rt, arvore, agora), st = estado(engine);
  for (const [idLocal, reg] of rt.andamento || []) {
    const s = engine.activeReviews?.get(idLocal);
    if (!s) continue;
    for (const [watchId, pedido] of vendo) {
      if (pedido.opId === reg.opId) await publicarSessao(engine, reg, s, engine.activity?.get(idLocal), agora, watchId, pedido);
    }
  }
  for (const [watchId, r] of st.publicados) {
    const existe = [...(rt.andamento?.values() || [])].some(x => x.opId === r.opId);
    if (existe && vendo.has(watchId)) continue;
    for (const id of [...r.ids, r.metaId]) await rt.client.del(`/users/${rt.uid}/${NO}/${id}`);
    st.publicados.delete(watchId);
  }
}
function anexarEspelhos(engine, ops, arvore, agora) {
  const rt = engine.sync;
  if (!rt?.material) return ops;
  return ops.map(o => {
    const watch = estado(engine).assistir.get(o.opId);
    if (!watch) return o;
    const metaId = idDe(rt, `mirror-meta|${o.opId}|${watch.id}`), no = arvore[metaId];
    if (!no || no.dev !== o.dev) return o;
    const meta = abrir(rt, metaId, no, 'mirror-meta1');
    if (!meta || meta.opId !== o.opId || !Number.isSafeInteger(meta.partes) || meta.partes < 1 || meta.partes > MAX_PARTES) return o;
    let canal;
    try { canal = materialDoEspelho(rt, watch.chave, meta.pub, o.opId, watch.id); } catch { return o; }
    const partes = Array.from({ length: meta.partes }, (_, i) => {
      const id = idDe(rt, `mirror|${o.opId}|${watch.id}|${meta.versao}|${i}`), parte = arvore[id];
      if (!parte || parte.dev !== o.dev || parte.x <= agora) return null;
      return abrir(canal, id, parte, 'mirror-part1')?.text;
    });
    const snapshot = recompor(meta, partes);
    if (!snapshot || no.x <= agora) return { ...o, espelho: { estado: 'incompleto' } };
    return { ...o, espelho: { estado: 'completo', ...snapshot, venceEm: no.x } };
  });
}
export { assistir, cicloEspelho, anexarEspelhos };
