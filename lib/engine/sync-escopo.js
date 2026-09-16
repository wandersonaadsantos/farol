// Panorama e Meus PRs entre aparelhos (7.C3): publicar por conta, ler por conta.
//
// UM PUBLICADOR POR CONTA, decidido pelo meta com CAS: quem encontra outro publicador vivo
// para ali. Assim dois aparelhos que monitoram a mesma conta não escrevem as mesmas linhas.
//
// PR QUE SAI VIRA TOMBSTONE (`del: true`), não DELETE: quem leu antes precisa saber que ele
// saiu, e um DELETE simplesmente sumiria da consulta incremental sem aviso. O tombstone
// pode ser apagado 24 h depois.
//
// Depois de reiniciar, o publicador não sabe o que já está lá. Em vez de reescrever tudo,
// ele lê as próprias linhas pelo índice `su` e compara os `ctag`, que ficam em claro.
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import escopo from '../sync/escopo.js';
import { acctTag, prTag } from '../sync/tags.js';
import publicacao from './sync-publicacao.js';

const TETOS = { panorama: 2048, myPrs: 8192 };

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function conhecidas(rt, tipo, scope) {
  if (!objeto(rt.escopos)) rt.escopos = {};
  const chave = `${tipo}/${scope}`;
  return rt.escopos[chave];
}

function guardar(rt, tipo, scope, mapa) {
  rt.escopos[`${tipo}/${scope}`] = mapa;
}

async function tomarVez(rt, tipo, scope, agora) {
  const caminho = `/users/${rt.uid}/${tipo}Meta/${scope}`;
  const r = await rt.client.get(caminho, { etag: true });
  if (!r || !r.ok) return false;
  if (!escopo.possoPublicar(r.data, rt.deviceId, agora)) return false;
  const w = await rt.client.put(caminho, escopo.metaDe({ dev: rt.deviceId, agora }), { ifMatch: r.etag || 'null_etag' });
  return !!(w && w.ok);
}

async function lerLinhasCruas(rt, tipo, scope, desdeU = 0) {
  const consulta = { orderBy: 'su', startAt: escopo.suDe(scope, desdeU), endAt: `${scope}|~` };
  const r = await rt.client.get(`/users/${rt.uid}/${tipo}`, { consulta });
  if (!r || !r.ok) return null;
  // nó ausente é lista vazia, não falha: é o primeiro publicador desta conta
  return objeto(r.data) ? r.data : {};
}

async function reconstruir(rt, tipo, scope) {
  const cruas = await lerLinhasCruas(rt, tipo, scope);
  if (cruas === null) return null;
  const mapa = new Map();
  for (const [id, no] of Object.entries(cruas)) {
    const tag = id.slice(scope.length + 1);
    if (objeto(no) && id.startsWith(`${scope}_`)) mapa.set(tag, no.del === true ? '' : String(no.ctag || ''));
  }
  return mapa;
}

async function escreverLinha(rt, tipo, scope, tag, linha, ctag, agora) {
  const id = escopo.idDe(scope, tag);
  const base = { v: 1, su: escopo.suDe(scope, agora), u: agora, ctag };
  if (!linha) {
    const w = await rt.client.put(`/users/${rt.uid}/${tipo}/${id}`, { ...base, ctag: '', del: true }, {});
    return !!(w && w.ok);
  }
  const c = envelope.cifrar({
    uid: rt.uid, caminho: `${tipo}/${id}`, campo: 'linha', no: tipo, esquema: `${tipo}1`, cur: rt.cur, material: rt.material,
    r: 1, extras: [base.su, ctag], dados: { l: linha },
  });
  if (!c.ok || c.enc.length > TETOS[tipo]) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${tipo}/${id}`, { ...base, enc: c.enc }, {});
  return !!(w && w.ok);
}

async function publicarEscopo(engine, cfg, { tipo, conta, prs, agora = Date.now() }) {
  if (!TETOS[tipo]) return { ok: false, code: 'forma', motivo: 'tipo de projeção desconhecido' };
  const pode = publicacao.podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  const scope = acctTag(kId, String(conta));
  if (!await tomarVez(rt, tipo, scope, agora)) return { ok: false, code: 'outro-publicador', motivo: 'outro aparelho publica esta conta agora' };
  let mapa = conhecidas(rt, tipo, scope);
  if (!mapa) {
    mapa = await reconstruir(rt, tipo, scope);
    if (!mapa) return { ok: false, code: 'indisponivel', motivo: 'não deu para ler o que já foi publicado' };
    guardar(rt, tipo, scope, mapa);
  }
  const atuais = new Set();
  const escritas = [];
  for (const pr of Array.isArray(prs) ? prs : []) {
    const linha = escopo.linhaDe(tipo, pr);
    if (!linha || !linha.key) continue;
    const tag = prTag(kId, linha.key);
    atuais.add(tag);
    const ctag = escopo.ctagDe(kId, linha);
    if (mapa.get(tag) === ctag) continue;
    if (await escreverLinha(rt, tipo, scope, tag, linha, ctag, agora)) { mapa.set(tag, ctag); escritas.push(tag); }
  }
  const saidas = [];
  for (const [tag, ctag] of [...mapa]) {
    if (atuais.has(tag) || ctag === '') continue;
    if (await escreverLinha(rt, tipo, scope, tag, null, '', agora)) { mapa.set(tag, ''); saidas.push(tag); }
  }
  if (escritas.length || saidas.length) await rt.client.put(`/users/${rt.uid}/live/rev/${tipo}/${scope}`, agora, {});
  return { ok: true, scope, escritas, saidas };
}

function abrirLinha(rt, tipo, id, no) {
  const aberto = envelope.decifrar({
    enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${tipo}/${id}`, campo: 'linha', esquema: `${tipo}1`, extras: [no.su, no.ctag],
  });
  return aberto.ok && objeto(aberto.valor) && objeto(aberto.valor.l) ? aberto.valor.l : null;
}

// Lê as linhas de uma conta. Meus PRs chega marcado como somente leitura: o botão Merge
// nunca é habilitado por dado remoto.
//
// `ok: false` é a leitura que FALHOU, e não pode ser confundida com a conta sem linha: quem
// lê mantém a visão anterior. `naoAbriram` são as tags cuja linha não decifrou (ficam de
// fora, e a tela as conta), e `maiorU` é o ponto de partida da próxima leitura incremental.
async function lerEscopo(engine, { tipo, conta, desdeU = 0 }) {
  const rt = engine.sync;
  const vazio = { ok: false, linhas: [], saidas: [], naoAbriram: [], maiorU: 0 };
  if (!TETOS[tipo] || !rt || !rt.client || !rt.material) return vazio;
  const kId = kek.bufferDe(rt.material.id);
  const scope = acctTag(kId, String(conta));
  const cruas = await lerLinhasCruas(rt, tipo, scope, desdeU);
  if (cruas === null) return vazio;
  const r = { ok: true, linhas: [], saidas: [], naoAbriram: [], maiorU: 0 };
  for (const [id, no] of Object.entries(cruas)) {
    if (!objeto(no) || !id.startsWith(`${scope}_`)) continue;
    const tag = id.slice(scope.length + 1);
    r.maiorU = Math.max(r.maiorU, Number(no.u) || 0);
    if (no.del === true) { r.saidas.push(tag); continue; }
    const linha = abrirLinha(rt, tipo, id, no);
    if (!linha) { r.naoAbriram.push(tag); continue; }
    // o que vem de fora nunca sobrescreve tag, hora nem a marca de somente leitura
    r.linhas.push({ ...linha, prTag: tag, u: Number(no.u) || 0, somenteLeitura: tipo === 'myPrs' });
  }
  r.linhas.sort((a, b) => b.u - a.u);
  return r;
}

async function apagarTombstones(engine, { tipo, conta, agora = Date.now() }) {
  const rt = engine.sync;
  if (!TETOS[tipo] || !rt || !rt.client || !rt.material) return [];
  const scope = acctTag(kek.bufferDe(rt.material.id), String(conta));
  const feitos = [];
  for (const [id, no] of Object.entries((await lerLinhasCruas(rt, tipo, scope)) || {})) {
    if (!escopo.tombstoneApagavel(no, agora)) continue;
    const r = await rt.client.del(`/users/${rt.uid}/${tipo}/${id}`);
    if (r && r.ok) feitos.push(id);
  }
  return feitos;
}

export default { publicarEscopo, lerEscopo, apagarTombstones };
export { publicarEscopo, lerEscopo, apagarTombstones };
