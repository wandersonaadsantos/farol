// "Precisa de você" em todos os aparelhos (7.C3, decisão D3): publicar as pendências
// daqui, ler as dos outros, avisar o que ninguém viu e gravar o visto.
//
// A pendência só é VISTA nos outros aparelhos; agir continua sendo no aparelho dono.
// `at` e `dev` vão em claro e na AAD, e não mudam na vida do item: o banco confere isso.
//
// O AVISO NÃO É pushState. A tela recebe `sync-pending` com a lista e as novas, e decide
// como avisar. O primeiro visto, em qualquer aparelho, cala o aviso nos outros.
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import pendencia from '../sync/pendencia.js';
import publicacao from './sync-publicacao.js';
import identificacao from './sync-identificacao.js';

const NO = 'live/pending';
const NO_VISTO = 'live/seen';
const CAMPO = 'pendencia';
const ESQUEMA = 'pend1';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function extrasDe(no) {
  return [no.at, no.dev];
}

function publicadas(rt) {
  if (!(rt.pendenciasPublicadas instanceof Map)) rt.pendenciasPublicadas = new Map();
  return rt.pendenciasPublicadas;
}

function notificadas(rt) {
  if (!(rt.pendenciasNotificadas instanceof Set)) rt.pendenciasNotificadas = new Set();
  return rt.pendenciasNotificadas;
}

// os motivos saem da projeção da TELA, nunca do registro cru
function itemParaProjetar(engine, item) {
  const ui = typeof engine.decisionForUi === 'function' ? engine.decisionForUi(item) : null;
  return { ...item, reasons: ui && Array.isArray(ui.reasons) ? ui.reasons : [] };
}

async function escrever(rt, itemId, no, projecao) {
  const caminho = `${NO}/${itemId}`;
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO, no: NO, esquema: ESQUEMA, cur: rt.cur, material: rt.material,
    r: 1, extras: extrasDe(no), dados: { p: projecao },
  });
  if (!cifrado.ok) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { ...no, enc: cifrado.enc }, {});
  return !!(w && w.ok);
}

async function sincronizarPendencias(engine, cfg) {
  const pode = publicacao.podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  const mapa = publicadas(rt);
  const abertas = engine.decisions && Array.isArray(engine.decisions.pending) ? engine.decisions.pending : [];
  const ids = new Set();
  const escritas = [];
  for (const item of abertas) {
    if (!item || !item.id) continue;
    ids.add(item.id);
    const projecao = pendencia.projetarPendencia(itemParaProjetar(engine, item), { kId });
    const resumo = publicacao.resumoDe(projecao);
    const reg = mapa.get(item.id) || { itemId: pendencia.itemIdDe(kId, rt.deviceId, item.id), at: Number(item.createdAt) || Date.now() };
    if (reg.resumo === resumo) continue;
    if (!await escrever(rt, reg.itemId, { v: 1, at: reg.at, dev: rt.deviceId }, projecao)) continue;
    mapa.set(item.id, { ...reg, resumo });
    escritas.push(reg.itemId);
  }
  const apagadas = [];
  for (const [idLocal, reg] of [...mapa]) {
    if (ids.has(idLocal)) continue;
    const r = await rt.client.del(`/users/${rt.uid}/${NO}/${reg.itemId}`);
    if (r && r.ok) { mapa.delete(idLocal); apagadas.push(reg.itemId); }
  }
  return { ok: true, escritas, apagadas };
}

function lerPendencias(engine, arvore, vistos) {
  const rt = engine.sync || {};
  if (!rt.material || !objeto(arvore)) return [];
  const saida = [];
  for (const [itemId, no] of Object.entries(arvore)) {
    if (!objeto(no) || no.dev === rt.deviceId || !no.enc) continue;
    const aberto = envelope.decifrar({
      enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${NO}/${itemId}`, campo: CAMPO, esquema: ESQUEMA, extras: extrasDe(no),
    });
    if (!aberto.ok || !objeto(aberto.valor) || !objeto(aberto.valor.p)) continue;
    const aparelho = objeto(rt.devices) && objeto(rt.devices[no.dev]) ? rt.devices[no.dev].name : '';
    // `pr` nasce null: só o catálogo nomeia o PR (aplicarPendenciasIdentificadas), e o que
    // veio de fora nunca preenche esse campo
    saida.push({ itemId, dev: no.dev, aparelho: aparelho || '', at: Number(no.at) || 0, visto: objeto(vistos) && objeto(vistos[itemId]), ...aberto.valor.p, pr: null });
  }
  return saida.sort((a, b) => a.at - b.at);
}

function aplicarPendencias(engine, arvore, vistos) {
  return aplicarLista(engine, lerPendencias(engine, arvore, vistos), vistos);
}

// A mesma aplicação, com o PR de cada pendência nomeado pelo catálogo (null quando o
// catálogo não está disponível). É o caminho do relógio.
async function aplicarPendenciasIdentificadas(engine, cfg, arvore, vistos) {
  const lista = await identificacao.identificarLista(engine, cfg, lerPendencias(engine, arvore, vistos));
  return aplicarLista(engine, lista, vistos);
}

function aplicarLista(engine, lista, vistos) {
  const rt = engine.sync;
  const avisadas = notificadas(rt);
  const novas = lista.filter((p) => pendencia.deveNotificar(p.itemId, { notificadas: avisadas, vistos }));
  for (const p of novas) avisadas.add(p.itemId);
  rt.pendenciasRemotas = lista;
  if (typeof engine.emit === 'function') engine.emit('sync-pending', { pendencias: lista, novas: novas.map((p) => p.itemId) });
  return { lista, novas };
}

// Gravado uma vez só: o segundo aparelho que tenta encontra o nó e isso já é o resultado.
async function marcarVisto(engine, cfg, itemId, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  const id = String(itemId || '');
  if (!/^[0-9a-f]+$/.test(id)) return { ok: false, code: 'forma', motivo: 'item de pendência inválido' };
  if (!rt || !rt.client || !rt.uid) return { ok: false, code: 'sem-conexao', motivo: 'este aparelho não está conectado' };
  const w = await rt.client.put(`/users/${rt.uid}/${NO_VISTO}/${id}`, pendencia.vistoDe({ dev: rt.deviceId, agora }), { ifMatch: 'null_etag' });
  notificadas(rt).add(id);
  if (w && w.ok) return { ok: true, gravado: true };
  if (w && w.code === 'conflito') return { ok: true, gravado: false };
  return { ok: false, code: (w && w.code) || 'indisponivel', motivo: 'não deu para registrar o visto' };
}

async function limparVistos(engine, arvore, vistos, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!rt || !rt.client || !objeto(vistos)) return [];
  const feitos = [];
  for (const [id, visto] of Object.entries(vistos)) {
    const existe = objeto(arvore) && objeto(arvore[id]);
    if (!pendencia.vistoApagavel(visto, { pendenciaExiste: existe, agora })) continue;
    const r = await rt.client.del(`/users/${rt.uid}/${NO_VISTO}/${id}`);
    if (r && r.ok) feitos.push(id);
  }
  return feitos;
}

export default { sincronizarPendencias, lerPendencias, aplicarPendencias, aplicarPendenciasIdentificadas, marcarVisto, limparVistos };
export { sincronizarPendencias, lerPendencias, aplicarPendencias, aplicarPendenciasIdentificadas, marcarVisto, limparVistos };
