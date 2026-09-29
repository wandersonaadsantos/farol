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
const TAG_RE = /^[0-9a-f]{32}$/;

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

// Título de muitos bytes (emoji, ideograma) somado à conta e à fila pode passar do teto do
// nó; antes de desistir da linha, o título encurta. O `ctag` continua o da linha inteira:
// é ele que diz se o PR mudou, e a versão encurtada é só o que coube no banco.
const TITULOS_DE_RESERVA = [100, 40];
function cifrarLinha(rt, tipo, id, linha, extras) {
  const cifrar = (l) => envelope.cifrar({
    uid: rt.uid, caminho: `${tipo}/${id}`, campo: 'linha', no: tipo, esquema: `${tipo}1`, cur: rt.cur, material: rt.material,
    r: 1, extras, dados: { l },
  });
  let c = cifrar(linha);
  for (const teto of TITULOS_DE_RESERVA) {
    if (c.ok || c.motivo !== 'teto') return c;
    // por caractere, não por unidade UTF-16: cortar um emoji ao meio deixaria meio par
    c = cifrar({ ...linha, title: Array.from(String(linha.title || '')).slice(0, teto).join('') });
  }
  return c;
}

async function escreverLinha(rt, tipo, scope, tag, linha, ctag, agora) {
  const id = escopo.idDe(scope, tag);
  const base = { v: 1, su: escopo.suDe(scope, agora), u: agora, ctag };
  if (!linha) {
    const w = await rt.client.put(`/users/${rt.uid}/${tipo}/${id}`, { ...base, ctag: '', del: true }, {});
    return !!(w && w.ok);
  }
  const c = cifrarLinha(rt, tipo, id, linha, [base.su, ctag]);
  if (!c.ok || c.enc.length > TETOS[tipo]) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${tipo}/${id}`, { ...base, enc: c.enc }, {});
  return !!(w && w.ok);
}

// `filaDe(pr)` (opcional) devolve o estado da fila deste aparelho para o PR; a forma é
// decidida por lib/sync/escopo.js, que só a aceita no Panorama e para PR pedido a mim.
async function publicarEscopo(engine, cfg, { tipo, conta, prs, filaDe = null, agora = Date.now() }) {
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
  const lista = Array.isArray(prs) ? prs : [];
  for (const pr of lista) {
    const fila = typeof filaDe === 'function' && objeto(pr) ? filaDe(pr) : null;
    const linha = escopo.linhaDe(tipo, pr, { conta: String(conta), fila });
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
// A conta chega de dois jeitos: pelo login (`conta`, as contas configuradas aqui, que viram
// tag) ou já pela tag (`scope`, as contas que só outro aparelho tem, lidas das chaves dos
// metas). Com os dois, a tag vence: é ela que endereça o banco.
//
// `ok: false` é a leitura que FALHOU, e não pode ser confundida com a conta sem linha: quem
// lê mantém a visão anterior. `naoAbriram` são as tags cuja linha não decifrou (ficam de
// fora, e a tela as conta), e `maiorU` é o ponto de partida da próxima leitura incremental.
async function lerEscopo(engine, { tipo, conta, scope: tagDaConta = '', desdeU = 0 }) {
  const rt = engine.sync;
  const vazio = { ok: false, linhas: [], saidas: [], naoAbriram: [], maiorU: 0 };
  if (!TETOS[tipo] || !rt || !rt.client || !rt.material) return vazio;
  const kId = kek.bufferDe(rt.material.id);
  const scope = TAG_RE.test(String(tagDaConta || '')) ? String(tagDaConta) : acctTag(kId, String(conta));
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
