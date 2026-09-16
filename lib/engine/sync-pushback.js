// Memória de pushback entre aparelhos (7.C3): publicar o que este aparelho confirmou, ler
// o que os outros confirmaram, e mesclar sem inventar concordância.
//
// SOBE SÓ O CONFIRMADO. Suspeita de baixa confiança fica aqui esperando alguém confirmar.
//
// RETIRAR É LÁPIDE, não DELETE: o registro que alguém corrigiu ou apagou precisa APAGAR nos
// outros aparelhos, e um nó que simplesmente some seria lido como "nunca existiu" por quem
// ainda tem a cópia antiga, que então a republicaria. Com lápide, ninguém ressuscita.
//
// O QUE NUNCA SOBE: `pushbackScanned` e o contador de falhas. São marcadores de varredura e
// de retry DESTE aparelho; sincronizá-los faria um aparelho pular a varredura que o outro
// fez com outra credencial, e um teste guarda a ausência.
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import pushback from '../sync/pushback-sync.js';
import publicacao from './sync-publicacao.js';

const NO = 'pushbacks';
const CAMPO = 'pushback';
const ESQUEMA = 'pb1';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function publicados(rt) {
  if (!(rt.pushbacksPublicados instanceof Map)) rt.pushbacksPublicados = new Map();
  return rt.pushbacksPublicados;
}

async function escrever(rt, id, no, projecao) {
  const caminho = `${NO}/${id}`;
  if (no.del === true) {
    const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, no, {});
    return !!(w && w.ok);
  }
  const c = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO, no: NO, esquema: ESQUEMA, cur: rt.cur, material: rt.material,
    r: 1, extras: [no.u, no.dev], dados: { p: projecao },
  });
  if (!c.ok) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { ...no, enc: c.enc }, {});
  return !!(w && w.ok);
}

async function sincronizarPushbacks(engine, cfg, { agora = Date.now() } = {}) {
  const pode = publicacao.podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  const mapa = publicados(rt);
  const locais = objeto(engine.pushbacks) ? engine.pushbacks : {};
  const escritas = [];
  const retirados = [];
  for (const [key, reg] of Object.entries(locais)) {
    if (!pushback.confirmado(reg)) continue;
    const id = pushback.idDe(kId, key);
    const projecao = pushback.projetar(reg, { kId });
    const resumo = publicacao.resumoDe(projecao);
    if (mapa.get(key) === resumo) continue;
    if (await escrever(rt, id, { v: 1, u: agora, dev: rt.deviceId }, projecao)) {
      mapa.set(key, resumo);
      escritas.push(id);
    }
  }
  for (const [key, resumo] of [...mapa]) {
    if (pushback.confirmado(locais[key]) || resumo === '') continue;
    const id = pushback.idDe(kId, key);
    if (await escrever(rt, id, { v: 1, u: agora, dev: rt.deviceId, del: true })) {
      mapa.set(key, '');
      retirados.push(id);
    }
  }
  return { ok: true, escritas, retirados };
}

function abrir(rt, id, no) {
  if (!objeto(no) || no.del === true || !no.enc) return null;
  const aberto = envelope.decifrar({
    enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${NO}/${id}`, campo: CAMPO, esquema: ESQUEMA, extras: [no.u, no.dev],
  });
  if (!aberto.ok || !objeto(aberto.valor) || !objeto(aberto.valor.p)) return null;
  return { ...aberto.valor.p, dev: no.dev, u: Number(no.u) || 0 };
}

// As chaves de PR que este aparelho conhece: sem elas não dá para ligar uma tag de volta a
// um PR, e um registro de PR desconhecido não tem onde aparecer mesmo.
function chavesConhecidas(engine) {
  const chaves = new Set(Object.keys(objeto(engine.pushbacks) ? engine.pushbacks : {}));
  for (const lista of [engine.panorama, engine.myPRs]) {
    for (const pr of Array.isArray(lista) ? lista : []) if (pr && pr.key) chaves.add(pr.key);
  }
  return chaves;
}

// Mescla o remoto no local. O que muda de verdade o estado local é só o que a mesclagem
// aponta como remoto vencedor, e a retirada, que APAGA. Conflito não muda nada: fica
// marcado para a tela contar que há divergência.
function aplicarPushbacks(engine, arvore, { agora = Date.now() } = {}) {
  const rt = engine.sync || {};
  if (!rt.material || !objeto(arvore)) return { aplicados: [], conflitos: [], retirados: [] };
  const kId = kek.bufferDe(rt.material.id);
  const aplicados = [];
  const conflitos = [];
  const retirados = [];
  const visao = {};
  for (const key of chavesConhecidas(engine)) {
    const id = pushback.idDe(kId, key);
    const no = arvore[id];
    if (!objeto(no) || no.dev === rt.deviceId) continue;
    const local = engine.pushbacks[key] ? pushback.projetar(engine.pushbacks[key], { kId }) : null;
    if (no.del === true) {
      if (!pushback.retiradoDepoisDe(no, local)) continue;
      if (engine.pushbacks[key]) { delete engine.pushbacks[key]; retirados.push(key); }
      continue;
    }
    const remoto = abrir(rt, id, no);
    if (!remoto) continue;
    const r = pushback.mesclar(local, remoto);
    visao[key] = { ...r, dev: no.dev };
    if (r.conflito) { conflitos.push(key); continue; }
    if (r.origem !== 'remoto') continue;
    engine.pushbacks[key] = { author: '', outcome: remoto.desfecho, note: remoto.nota, at: remoto.at, source: remoto.origem, status: 'confirmed', remoto: true };
    aplicados.push(key);
  }
  rt.pushbackVisao = visao;
  if ((aplicados.length || retirados.length) && typeof engine.savePushbacks === 'function') engine.savePushbacks();
  return { aplicados, conflitos, retirados, agora };
}

export default { sincronizarPushbacks, aplicarPushbacks };
export { sincronizarPushbacks, aplicarPushbacks };
