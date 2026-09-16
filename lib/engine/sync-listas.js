// Panorama e Meus PRs de OUTROS aparelhos (7.C3, CT-LEITURA): ler por conta, guardar a
// visão e avisar a tela por evento próprio.
//
// CT-LEITURA: lista grande chega por GET incremental quando um ponteiro do `live` muda. O
// ponteiro é `live/rev/{tipo}/{escopo}`, que o publicador grava quando escreve alguma linha
// (lib/engine/sync-escopo.js). Por giro, a leitura custa três GETs pequenos (o ponteiro e os
// dois metas); as linhas só são lidas quando o ponteiro andou, e a partir do maior `u` já lido.
//
// DE QUEM É A LINHA. A linha não diz quem a escreveu; o meta do escopo diz quem publica a
// conta agora (um publicador por conta). Por isso a origem é o `dev` do meta, e o prazo dele
// (`x`) é o que diz se o publicador continua vivo. Quando o publicador muda, a visão é
// relida do zero: o novo publicador reconcilia o que ficou, e a leitura incremental não
// enxergaria o que ele não reescreveu. Escopo publicado por ESTE aparelho não é remoto.
//
// LEITURA QUE FALHA NÃO VIRA LISTA VAZIA. O escopo guarda a última visão boa, marca a falha
// com a hora e não avança o ponteiro, então o giro seguinte lê de novo.
//
// A tela recebe `sync-lists` quando a projeção muda, e de novo a cada batimento (a idade da
// leitura precisa andar na tela mesmo com a lista parada). Nunca pushState.
import { sharedActive } from '../sync/config.js';
import { SYNC } from '../constants.js';
import kek from '../sync/kek.js';
import { acctTag } from '../sync/tags.js';
import { resumoDoClaro } from '../sync/catalogo.js';
import escopos from './sync-escopo.js';

const TIPOS = ['panorama', 'myPrs'];
// o que da linha chega à tela: allowlist, igual à da publicação (lib/sync/escopo.js)
const CAMPOS = ['key', 'url', 'title', 'author', 'repo', 'number', 'isDraft', 'updatedAt', 'selos', 'mergeable', 'headRefName', 'baseRefName'];

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function estadoDe(rt) {
  if (!objeto(rt.listasRemotas)) rt.listasRemotas = { estado: 'aguardando', escopos: new Map(), resumo: '', emitidoEm: 0 };
  return rt.listasRemotas;
}

function novoEscopo(tipo, conta) {
  return { tipo, conta, dono: null, rev: null, desdeU: 0, linhas: new Map(), naoAbriram: new Set(), estado: 'aguardando', lidoEm: 0, falhaEm: 0, confirmadoAte: 0 };
}

async function lerNo(rt, caminho) {
  const r = await rt.client.get(`/users/${rt.uid}/${caminho}`);
  if (!r || !r.ok) return null;
  return objeto(r.data) ? r.data : {};
}

function recomecar(reg, dono) {
  Object.assign(reg, { dono, rev: null, desdeU: 0 });
  reg.linhas.clear();
  reg.naoAbriram.clear();
}

function aplicarLeitura(reg, r) {
  for (const l of r.linhas) { reg.linhas.set(l.prTag, l); reg.naoAbriram.delete(l.prTag); }
  for (const tag of r.saidas) { reg.linhas.delete(tag); reg.naoAbriram.delete(tag); }
  // a versão nova que não abre derruba a velha: melhor faltar do que mostrar o que mudou
  for (const tag of r.naoAbriram) { reg.linhas.delete(tag); reg.naoAbriram.add(tag); }
  reg.desdeU = Math.max(reg.desdeU, r.maiorU);
}

async function atualizarEscopo(engine, reg, { scope, revs, metas, agora }) {
  const rt = engine.sync;
  const meta = objeto(metas[reg.tipo]) && objeto(metas[reg.tipo][scope]) ? metas[reg.tipo][scope] : {};
  const dono = String(meta.dev || '');
  if (dono !== reg.dono) recomecar(reg, dono);
  reg.confirmadoAte = Number(meta.x) || 0;
  if (!dono || dono === rt.deviceId) {
    reg.linhas.clear();
    reg.naoAbriram.clear();
    Object.assign(reg, { estado: dono ? 'local' : 'sem-publicador', lidoEm: agora });
    return;
  }
  const rev = objeto(revs[reg.tipo]) ? Number(revs[reg.tipo][scope]) || 0 : 0;
  if (rev === reg.rev) { Object.assign(reg, { estado: 'ok', lidoEm: agora }); return; }
  const r = await escopos.lerEscopo(engine, { tipo: reg.tipo, conta: reg.conta, desdeU: reg.desdeU });
  if (!r.ok) { Object.assign(reg, { estado: 'falhou', falhaEm: agora }); return; }
  aplicarLeitura(reg, r);
  Object.assign(reg, { rev, estado: 'ok', lidoEm: agora });
}

function marcarFalha(st, agora) {
  for (const reg of st.escopos.values()) Object.assign(reg, { estado: 'falhou', falhaEm: agora });
}

// Um giro de leitura. Devolve a projeção e avisa a tela quando ela mudou.
async function lerListasRemotas(engine, cfg, { agora = Date.now() } = {}) {
  const rt = engine.sync || {};
  const st = estadoDe(rt);
  if (!sharedActive(cfg)) return semLeitura(engine, 'desligada', { agora });
  if (!rt.client || !rt.uid || !rt.material) return semLeitura(engine, 'sem-chave', { agora });
  st.estado = 'ligada';
  const [revs, ...metasLidas] = await Promise.all([lerNo(rt, 'live/rev'), ...TIPOS.map((t) => lerNo(rt, `${t}Meta`))]);
  if (revs === null || metasLidas.includes(null)) {
    marcarFalha(st, agora);
    return emitir(engine, agora);
  }
  const metas = Object.fromEntries(TIPOS.map((t, i) => [t, metasLidas[i]]));
  const kId = kek.bufferDe(rt.material.id);
  const vivos = new Set();
  const contas = typeof engine.accountList === 'function' ? engine.accountList() : [];
  for (const conta of contas) {
    const scope = acctTag(kId, String(conta.user));
    for (const tipo of TIPOS) {
      const chave = `${tipo}/${String(conta.user).toLowerCase()}`;
      vivos.add(chave);
      if (!st.escopos.has(chave)) st.escopos.set(chave, novoEscopo(tipo, String(conta.user)));
      await atualizarEscopo(engine, st.escopos.get(chave), { scope, revs, metas, agora });
    }
  }
  for (const chave of [...st.escopos.keys()]) if (!vivos.has(chave)) st.escopos.delete(chave);
  return emitir(engine, agora);
}

// Sem leitura possível (compartilhamento desligado, sem frota, sem chave): a visão guardada
// sai de cena e a tela recebe o motivo, em vez de uma lista vazia.
function semLeitura(engine, estado, { agora = Date.now() } = {}) {
  const st = estadoDe(engine.sync || {});
  st.estado = String(estado || 'indisponivel');
  st.escopos.clear();
  return emitir(engine, agora);
}

function nomeDoAparelho(rt, dev) {
  const d = objeto(rt.devices) ? rt.devices[dev] : null;
  return objeto(d) && d.name ? String(d.name) : '';
}

function linhaParaTela(l, reg) {
  const saida = {};
  for (const campo of CAMPOS) if (l[campo] !== undefined) saida[campo] = l[campo];
  return { ...saida, u: l.u, account: reg.conta, somenteLeitura: l.somenteLeitura === true };
}

function escopoParaTela(rt, reg) {
  return {
    tipo: reg.tipo, account: reg.conta, dev: reg.dono || '', aparelho: nomeDoAparelho(rt, reg.dono),
    estado: reg.estado, lidoEm: reg.lidoEm, falhaEm: reg.falhaEm, confirmadoAte: reg.confirmadoAte,
    naoAbriram: reg.naoAbriram.size,
    linhas: [...reg.linhas.values()].sort((a, b) => b.u - a.u).map((l) => linhaParaTela(l, reg)),
  };
}

// O que a tela recebe, pelo evento e pela rota. O compartilhamento desligado vale na hora,
// sem esperar o próximo giro.
function projecaoDasListas(engine) {
  const rt = engine.sync || {};
  const st = estadoDe(rt);
  const cfg = (engine.config && engine.config.sync) || {};
  if (!sharedActive(cfg)) return { estado: 'desligada', limiteMs: SYNC.LISTAS_IDADE_MAX_MS, escopos: [] };
  return {
    estado: st.estado,
    limiteMs: SYNC.LISTAS_IDADE_MAX_MS,
    escopos: [...st.escopos.values()].map((reg) => escopoParaTela(rt, reg)),
  };
}

function emitir(engine, agora) {
  const st = estadoDe(engine.sync || {});
  const proj = projecaoDasListas(engine);
  const semHora = { ...proj, escopos: proj.escopos.map((x) => ({ ...x, lidoEm: 0 })) };
  const resumo = resumoDoClaro(semHora);
  const batimento = agora - st.emitidoEm >= SYNC.LISTAS_BATIMENTO_MS;
  if ((resumo !== st.resumo || batimento) && typeof engine.emit === 'function') {
    engine.emit('sync-lists', proj);
    Object.assign(st, { resumo, emitidoEm: agora });
  }
  return proj;
}

export default { lerListasRemotas, semLeitura, projecaoDasListas };
export { lerListasRemotas, semLeitura, projecaoDasListas };
