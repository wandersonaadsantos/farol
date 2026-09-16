// História de revisões entre aparelhos (7.C3): publicar o índice e o corpo de cada revisão
// daqui, ler as recentes de todos (ou de um aparelho) e abrir uma revisão.
//
// SÓ SOBE O QUE ACONTECEU DEPOIS DE O COMPARTILHAMENTO LIGAR NESTE APARELHO. O histórico
// que já existia é "envio do histórico local", um ato explícito com tamanho medido (C3g);
// publicar tudo sozinho no primeiro ciclo seria exatamente o envio em massa que a spec
// manda perguntar antes. O marco fica em `state/sync-historico.json`, porque reiniciar não
// pode empurrar o marco para frente e esconder o que aconteceu no meio.
//
// O CORPO É WRITE-ONCE POR VERSÃO. A versão é o instante da mudança de status, então o
// mesmo item publicado de novo depois de um reinício encontra o nó e para ali (412), sem
// sobrescrever nada. O ponteiro `live/rev/recentReviews/{aparelho}` diz aos outros que há
// novidade, e eles pedem só o que é mais novo que o último visto.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import historico from '../sync/historico.js';
import publicacao from './sync-publicacao.js';

const NO_INDICE = 'recentReviews';
const NO_CORPO = 'reviewBodies';
const NO_PONTEIRO = 'live/rev/recentReviews';
const MARCO = path.join(STATE_DIR, 'sync-historico.json');
const LIMITE_LEITURA = 30;
// teto por ciclo: um aparelho que ficou horas desconectado não despeja tudo de uma vez
const LIMITE_POR_CICLO = 20;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function marcoDe(agora) {
  const d = io.readJson(MARCO, null);
  if (objeto(d) && Number(d.desde) > 0) return Number(d.desde);
  try {
    io.ensureDir(path.dirname(MARCO));
    io.writeJsonAtomic(MARCO, { v: 1, desde: agora });
  } catch {
    // sem o arquivo o marco vale só nesta sessão: o pior caso é o próximo boot adiar o
    // marco, e o que ficou no meio vai para o envio explícito do histórico
  }
  return agora;
}

function lista(v) {
  return Array.isArray(v) ? v : [];
}

function candidatas(engine, desde) {
  const d = engine.decisions || {};
  const todas = [...lista(d.pending), ...lista(d.resolved)];
  return todas.filter((x) => x && x.id && historico.tDe(x) >= desde);
}

function registros(rt) {
  if (!(rt.historicoPublicado instanceof Map)) rt.historicoPublicado = new Map();
  return rt.historicoPublicado;
}

async function publicarIndice(rt, reviewId, d, indice) {
  const caminho = `${NO_INDICE}/${reviewId}`;
  const t = historico.tDe(d);
  const claro = { v: 1, t, d: rt.deviceId, dt: historico.dtDe(rt.deviceId, t) };
  const c = envelope.cifrar({
    uid: rt.uid, caminho, campo: 'indice', no: NO_INDICE, esquema: 'rr1', cur: rt.cur, material: rt.material,
    r: 1, extras: [claro.t, claro.d], dados: { i: indice },
  });
  if (!c.ok) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { ...claro, enc: c.enc }, {});
  return !!(w && w.ok);
}

// 412 quer dizer que a versão já está lá: para o write-once isso é sucesso.
async function publicarCorpo(rt, reviewId, versao, corpo) {
  const caminho = `${NO_CORPO}/${reviewId}/${versao}`;
  const c = envelope.cifrar({
    uid: rt.uid, caminho, campo: 'corpo', no: NO_CORPO, esquema: 'rb1', cur: rt.cur, material: rt.material,
    r: versao, dados: { c: corpo },
  });
  if (!c.ok) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { v: 1, enc: c.enc }, { ifMatch: 'null_etag' });
  return !!(w && (w.ok || w.code === 'conflito'));
}

// Sem a projeção da tela, o relatório cru (diagnóstico interno) nunca sobe.
function projecaoDaTela(engine, d) {
  if (typeof engine.decisionForUi === 'function') return engine.decisionForUi(d);
  return { ...d, reportMarkdown: undefined };
}

// Uma revisão, índice e corpo. Devolve o id publicado, ou '' se não subiu. Usada também
// pelo envio explícito do histórico (C3g), para as duas portas publicarem igual.
async function publicarUma(engine, kId, d) {
  const rt = engine.sync;
  const reviewId = historico.reviewIdDe(kId, rt.deviceId, d.id);
  const ui = projecaoDaTela(engine, d);
  const corpoOk = await publicarCorpo(rt, reviewId, historico.versaoDe(d), historico.corpoDe(ui));
  const indiceOk = corpoOk && await publicarIndice(rt, reviewId, d, historico.indiceDe(d, { kId }));
  return indiceOk ? reviewId : '';
}

// Quanto uma revisão ocupa no banco, MEDIDO: cifra de verdade em memória e soma o que
// iria no corpo do PUT. É o número que a tela mostra antes de o dono confirmar o envio.
function bytesDe(engine, kId, d) {
  const rt = engine.sync;
  const reviewId = historico.reviewIdDe(kId, rt.deviceId, d.id);
  const ui = projecaoDaTela(engine, d);
  const versao = historico.versaoDe(d);
  const corpo = envelope.cifrar({
    uid: rt.uid, caminho: `${NO_CORPO}/${reviewId}/${versao}`, campo: 'corpo', no: NO_CORPO, esquema: 'rb1',
    cur: rt.cur, material: rt.material, r: versao, dados: { c: historico.corpoDe(ui) },
  });
  const indice = envelope.cifrar({
    uid: rt.uid, caminho: `${NO_INDICE}/${reviewId}`, campo: 'indice', no: NO_INDICE, esquema: 'rr1',
    cur: rt.cur, material: rt.material, r: 1, extras: [historico.tDe(d), rt.deviceId], dados: { i: historico.indiceDe(d, { kId }) },
  });
  if (!corpo.ok || !indice.ok) return 0;
  return Buffer.byteLength(corpo.enc) + Buffer.byteLength(indice.enc) + 120;
}

async function sincronizarHistorico(engine, cfg, { agora = Date.now() } = {}) {
  const pode = publicacao.podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  const desde = rt.historicoDesde || (rt.historicoDesde = marcoDe(agora));
  const mapa = registros(rt);
  const escritas = [];
  let maiorT = 0;
  for (const d of candidatas(engine, desde)) {
    if (escritas.length >= LIMITE_POR_CICLO) break;
    const versao = historico.versaoDe(d);
    if (mapa.get(d.id) === versao) continue;
    const reviewId = await publicarUma(engine, kId, d);
    if (!reviewId) continue;
    mapa.set(d.id, versao);
    escritas.push(reviewId);
    maiorT = Math.max(maiorT, historico.tDe(d));
  }
  if (maiorT) await rt.client.put(`/users/${rt.uid}/${NO_PONTEIRO}/${rt.deviceId}`, maiorT, {});
  return { ok: true, escritas };
}

function abrirIndice(rt, reviewId, no) {
  if (!objeto(no) || !no.enc) return null;
  const aberto = envelope.decifrar({
    enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${NO_INDICE}/${reviewId}`, campo: 'indice', esquema: 'rr1', extras: [no.t, no.d],
  });
  if (!aberto.ok || !objeto(aberto.valor) || !objeto(aberto.valor.i)) return null;
  return { reviewId, t: Number(no.t) || 0, dev: no.d, aparelho: nomeDoAparelho(rt, no.d), ...aberto.valor.i };
}

function consultaDe(dev, desdeT) {
  if (dev) return { orderBy: 'dt', startAt: `${dev}|`, endAt: `${dev}|~`, limitToLast: LIMITE_LEITURA };
  const consulta = { orderBy: 't', limitToLast: LIMITE_LEITURA };
  if (desdeT) consulta.startAt = desdeT;
  return consulta;
}

function nomeDoAparelho(rt, dev) {
  const d = objeto(rt.devices) ? rt.devices[dev] : null;
  return objeto(d) && d.name ? d.name : '';
}

// Todos os aparelhos, ou só um. "Todos" inclui este: a lista é a história única.
// null é a leitura que FALHOU (sem conexão, sem chave, banco recusou), e é diferente de []:
// a tela precisa dizer que não conseguiu ler em vez de dizer que não há revisões.
async function lerRecentes(engine, { dev = '', desdeT = 0 } = {}) {
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.material) return null;
  const consulta = consultaDe(dev, desdeT);
  const r = await rt.client.get(`/users/${rt.uid}/${NO_INDICE}`, { consulta });
  if (!r || !r.ok) return null;
  if (!objeto(r.data)) return [];
  const lista = Object.entries(r.data).map(([id, no]) => abrirIndice(rt, id, no)).filter(Boolean);
  return historico.ordenar(lista);
}

// Vale a MAIOR versão que decifra: uma versão corrompida não esconde a anterior.
async function abrirRevisao(engine, reviewId) {
  const rt = engine.sync;
  const id = String(reviewId || '');
  if (!rt || !rt.client || !rt.material || !/^[0-9a-f]+$/.test(id)) return null;
  const r = await rt.client.get(`/users/${rt.uid}/${NO_CORPO}/${id}`);
  if (!r || !r.ok || !objeto(r.data)) return null;
  const versoes = Object.keys(r.data).filter((v) => /^[0-9]+$/.test(v)).sort((a, b) => Number(b) - Number(a));
  for (const v of versoes) {
    const no = r.data[v];
    if (!objeto(no) || !no.enc) continue;
    const aberto = envelope.decifrar({
      enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${NO_CORPO}/${id}/${v}`, campo: 'corpo', esquema: 'rb1', rMinimo: Number(v),
    });
    if (aberto.ok && objeto(aberto.valor) && objeto(aberto.valor.c)) return { reviewId: id, versao: Number(v), ...aberto.valor.c };
  }
  return null;
}

export default { sincronizarHistorico, lerRecentes, abrirRevisao, publicarUma, bytesDe, marcoDe, LIMITE_POR_CICLO };
export { sincronizarHistorico, lerRecentes, abrirRevisao, publicarUma, bytesDe, marcoDe, LIMITE_POR_CICLO };
