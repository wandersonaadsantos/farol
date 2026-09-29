// O painel dos outros aparelhos na tela do admin (controle do celular, 28/09/2026): lê a
// capacidade que cada um publica em `live/deviceStatus` e projeta, com allowlist, o que a
// tela precisa para ver o aparelho e decidir por ele.
//
// NÃO DECIDE NADA. O agendador e o teto do grupo leem a mesma capacidade por conta própria
// (lib/sync/capacidade.js é a porta única de abrir o envelope); aqui é só apresentação, e
// quem recebe um comando confere tudo de novo com o que sabe.
//
// LEITURA QUE FALHA NÃO APAGA O PAINEL: a visão anterior continua, com a hora da última
// leitura boa, e a tela diz a idade em vez de mostrar os aparelhos como sumidos.
import { sharedActive } from '../sync/config.js';
import { SYNC } from '../constants.js';
import kek from '../sync/kek.js';
import { acctTag } from '../sync/tags.js';
import capacidade from '../sync/capacidade.js';
import publicar from './sync-publicar.js';

const TAG_CURTA = 8;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

async function lerPaineis(engine, cfg, { agora = Date.now(), forcar = false } = {}) {
  const rt = engine.sync;
  if (!sharedActive(cfg) || !rt || !rt.client || !rt.uid || !rt.material) return { ok: false, code: 'sem-conexao' };
  if (!forcar && agora - (Number(rt.painelLidoEm) || 0) < SYNC.PAINEL_LEITURA_MS) return { ok: true, leu: false };
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/deviceStatus`);
  if (!lido) return { ok: false, code: 'sem-leitura' };
  const mapa = {};
  for (const [dev, no] of Object.entries(objeto(lido.valor) ? lido.valor : {})) {
    if (dev === rt.deviceId) continue;
    const aberta = capacidade.abrirCapacidade({ uid: rt.uid, material: rt.material, dev, no });
    mapa[dev] = aberta ? { u: aberta.u, painel: capacidade.painelDaCapacidade(aberta.c) } : { u: Number(no && no.u) || 0, painel: null };
  }
  rt.paineis = mapa;
  rt.painelLidoEm = agora;
  return { ok: true, leu: true };
}

// tag da conta -> login, com o que este aparelho sabe: as contas daqui e o nome que as
// linhas do Panorama e de Meus PRs dos outros trouxeram (lib/engine/sync-listas.js)
function nomesDasContas(engine) {
  const rt = engine.sync || {};
  const nomes = new Map();
  const escopos = objeto(rt.listasRemotas) && rt.listasRemotas.escopos instanceof Map ? rt.listasRemotas.escopos.values() : [];
  for (const reg of escopos) {
    const nome = reg && (reg.conta || reg.nomeRemoto);
    if (nome && reg.scope) nomes.set(reg.scope, String(nome));
  }
  if (!rt.material) return nomes;
  const kId = kek.bufferDe(rt.material.id);
  for (const a of typeof engine.accountList === 'function' ? engine.accountList() : []) {
    if (a && a.user) nomes.set(acctTag(kId, a.user), String(a.user));
  }
  return nomes;
}

function aparelhoParaTela(rt, dev, reg, nomes) {
  const d = objeto(rt.devices) && objeto(rt.devices[dev]) ? rt.devices[dev] : {};
  const base = {
    deviceId: dev, nome: String(d.name || ''), versao: String(d.farolVersion || ''),
    vistoEm: Number(d.lastSeenAt) || 0, aposentado: Number(d.retiredAt) > 0,
    publicadoEm: Number(reg.u) || 0, abriu: !!reg.painel,
  };
  if (!reg.painel) return base;
  const nomeDe = (tag) => nomes.get(tag) || tag.slice(0, TAG_CURTA);
  const comToken = new Set(reg.painel.contasComToken);
  return {
    ...base, ...reg.painel,
    contas: reg.painel.contas.map((c) => ({ ...c, nome: nomeDe(c.acctTag), nomeConhecido: nomes.has(c.acctTag), temToken: comToken.has(c.acctTag) })),
  };
}

// O que o snapshot leva: um item por aparelho que publicou capacidade, mais a hora da
// última leitura boa (0: nenhuma nesta conexão).
function painelDosAparelhos(engine) {
  const rt = engine.sync || {};
  const mapa = objeto(rt.paineis) ? rt.paineis : {};
  const nomes = nomesDasContas(engine);
  return {
    lidoEm: Number(rt.painelLidoEm) || 0,
    aparelhos: Object.entries(mapa).map(([dev, reg]) => aparelhoParaTela(rt, dev, reg, nomes)),
  };
}

export default { lerPaineis, painelDosAparelhos, nomesDasContas };
export { lerPaineis, painelDosAparelhos, nomesDasContas };
