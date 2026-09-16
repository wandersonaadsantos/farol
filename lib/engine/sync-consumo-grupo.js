// Teto do grupo de consumo (7.C4b, CT-GRUPO): publicar o rollup deste aparelho,
// recalcular no relógio o retrato de cada grupo ativo e responder, SÍNCRONO, ao gate.
//
// O STORE DO GRUPO DEPENDE DO BANCO, NUNCA DO ADMIN. O retrato é refeito a cada giro com o
// que está no banco; admin fora não muda nada aqui. Banco fora deixa o retrato envelhecer,
// e retrato velho vale como não verificável.
//
// DOIS DESFECHOS DIFERENTES, com dois tratamentos:
//   - teto estourado: o grupo vira um perfil sintético em `budgetBlockedFor`, e daí valem
//     os fluxos de sempre do orçamento (aviso único, espera, estacionamento na boca);
//   - não verificável: `grupoSegura` segura sem estacionar e sem gastar tentativa, e o
//     escalonador também não deixa o clique atravessar.
//
// ATIVAÇÃO PROTEGIDA: sem a medição externa, `gruposAtivos` é sempre vazio e nada aqui
// barra coisa alguma (`ATIVACAO_TETO_GRUPO_C4B`).
import { SYNC } from '../constants.js';
import { sharedActive } from '../sync/config.js';
import { brasiliaDay } from '../sync/keys.js';
import grupo from '../sync/grupo.js';
import vinculo from '../sync/vinculo.js';
import cg from '../sync/consumo-grupo.js';
import capacidade from '../sync/capacidade.js';
import { ORIGENS_DESCONHECIDAS } from './usage-desfechos.js';
import usage from './usage.js';
import grupos from './sync-grupo.js';
import publicar from './sync-publicar.js';

const NO = 'usageDaily';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function cfgDe(engine) {
  return (engine.config && engine.config.sync) || {};
}

function estado(rt) {
  if (!objeto(rt.consumoGrupo)) rt.consumoGrupo = { publicadoSeq: -1, cursorAt: 0, retratos: {} };
  return rt.consumoGrupo;
}

function sessoesDe(engine) {
  const s = engine.usageSessions && engine.usageSessions.sessions;
  return Array.isArray(s) ? s : [];
}

// Só as sessões que caem num grupo, com o grupo do INSTANTE do gasto. O vínculo é um
// intervalo que só fecha para a frente, então esta lista só cresce: o tamanho dela é a
// sequência que a capacidade anuncia.
function sessoesComGrupo(engine) {
  const saida = [];
  for (const s of sessoesDe(engine)) {
    const g = objeto(s) && s.profileId ? vinculo.grupoDoConsumo(s.profileId, s.at) : null;
    if (g) saida.push({ s, g, dia: brasiliaDay(Number(s.at)) });
  }
  return saida;
}

function desconhecida(s) {
  return ORIGENS_DESCONHECIDAS.has(s.costSource);
}

function somarLinha(acc, s) {
  acc.s += 1;
  if (desconhecida(s)) acc.d += 1;
  else acc.c += Number(s.costUsd) || 0;
}

function tipicoPorGrupo(lista, agora) {
  const porGrupo = {};
  for (const { s, g } of lista) (porGrupo[g] = porGrupo[g] || []).push(s);
  const saida = {};
  for (const [g, sessoes] of Object.entries(porGrupo)) saida[g] = usage.custoTipicoDeReview(sessoes.filter((s) => !desconhecida(s)), agora);
  return saida;
}

function rollupDoDia(lista, dia, tipicos) {
  const g = {};
  for (const item of lista) {
    if (item.dia !== dia) continue;
    g[item.g] = g[item.g] || { c: 0, s: 0, d: 0, t: tipicos[item.g] || 0 };
    somarLinha(g[item.g], item.s);
  }
  return g;
}

// O que a capacidade anuncia: a sequência e o dia da última sessão com grupo, e as reservas
// vivas por grupo. Sai da verdade LOCAL, e não do que foi publicado: se o rollup não subiu,
// os outros aparelhos precisam enxergar a lacuna.
function consumoParaCapacidade(engine) {
  const lista = sessoesComGrupo(engine);
  const ultima = maisRecente(lista);
  return { seq: lista.length, dia: ultima ? ultima.dia : '', grupos: reservasPorGrupo(engine) };
}

// o log de sessões é gravado em ordem de chegada, e a ordem de chegada não é promessa
function maisRecente(lista) {
  let ultima = null;
  for (const item of lista) if (!ultima || Number(item.s.at) >= Number(ultima.s.at)) ultima = item;
  return ultima;
}

function reservasPorGrupo(engine) {
  const saida = {};
  const reservas = engine.admissao && engine.admissao.reservas instanceof Map ? engine.admissao.reservas.values() : [];
  for (const r of reservas) {
    if (r.grupo) saida[r.grupo] = (saida[r.grupo] || 0) + 1;
  }
  return saida;
}

function diasParaPublicar(lista, st, agora) {
  const corte = st.cursorAt || 0;
  const inicioDoMes = cg.inicioDoPeriodo('mes', agora);
  const dias = new Set();
  for (const item of lista) {
    if (Number(item.s.at) > corte && item.dia >= inicioDoMes) dias.add(item.dia);
  }
  return [...dias].sort();
}

// Um PUT por dia que mudou, cada um com a sequência atual. Só avança o cursor quando todos
// subiram: falha parcial é repetida no próximo giro.
async function publicarRollups(engine, cfg, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!sharedActive(cfg) || !rt || !rt.client || !rt.uid || !rt.deviceId) return { ok: false, code: 'sem-conexao' };
  const st = estado(rt);
  const lista = sessoesComGrupo(engine);
  if (st.publicadoSeq === lista.length) return { ok: true, escritas: [] };
  const tipicos = tipicoPorGrupo(lista, agora);
  const escritas = [];
  for (const dia of diasParaPublicar(lista, st, agora)) {
    const valor = { v: 1, u: agora, seq: lista.length, g: rollupDoDia(lista, dia, tipicos) };
    const w = await rt.client.put(`/users/${rt.uid}/${NO}/${rt.deviceId}/${dia}`, valor, {});
    if (!w || !w.ok) return { ok: false, code: (w && w.code) || 'indisponivel', escritas };
    escritas.push(dia);
  }
  st.publicadoSeq = lista.length;
  const ultima = maisRecente(lista);
  st.cursorAt = ultima ? Number(ultima.s.at) : 0;
  return { ok: true, escritas };
}

function ativacaoLiberada(engine) {
  return grupos.ativacaoLiberada(engine);
}

// Grupos aceitos, marcados ativos e com todos os requisitos presentes AQUI. O admin já
// recusou publicar sem eles; o consumidor confere de novo, porque o que veio do fio só
// restringe.
function gruposAtivos(engine, cfg = cfgDe(engine)) {
  const aceitos = objeto(engine.sync && engine.sync.grupos) ? Object.values(engine.sync.grupos) : [];
  const medicaoFeita = ativacaoLiberada(engine);
  return aceitos.map((x) => x && x.grupo).filter((g) => objeto(g) && g.ativo === true
    && grupo.requisitosDaAtivacao({ grupo: g, compartilhamento: sharedActive(cfg), medicaoFeita }).length === 0);
}

function participantes(rt) {
  const devices = objeto(rt.devices) ? rt.devices : {};
  return Object.keys(devices).filter((dev) => dev !== rt.deviceId && objeto(devices[dev]) && devices[dev].contract === 2 && devices[dev].keyReady === true);
}

async function lerRollups(rt, dev, inicio) {
  const r = await rt.client.get(`/users/${rt.uid}/${NO}/${dev}`, { consulta: { orderBy: '$key', startAt: inicio } });
  if (!r || !r.ok) return null;
  return objeto(r.data) ? r.data : {};
}

function statusRemoto(rt, dev, arvore) {
  const aberta = capacidade.abrirCapacidade({ uid: rt.uid, material: rt.material, dev, no: arvore[dev] });
  return aberta ? { u: aberta.u, consumo: aberta.c.consumo } : null;
}

async function lerRemotos(rt, inicio) {
  const status = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/deviceStatus`);
  const arvore = status && objeto(status.valor) ? status.valor : null;
  const remotos = [];
  for (const dev of participantes(rt)) {
    const rollups = await lerRollups(rt, dev, inicio);
    remotos.push({ dev, rollups, status: arvore ? statusRemoto(rt, dev, arvore) : null });
  }
  return remotos;
}

function localDoGrupo(engine, id, inicio, agora) {
  const doGrupo = sessoesComGrupo(engine).filter((x) => x.g === id && x.dia >= inicio);
  const acc = { c: 0, s: 0, d: 0 };
  for (const x of doGrupo) somarLinha(acc, x.s);
  const tipico = usage.custoTipicoDeReview(sessoesComGrupo(engine).filter((x) => x.g === id && !desconhecida(x.s)).map((x) => x.s), agora);
  return { custo: acc.c, desconhecidas: acc.d, reservas: 0, tipico };
}

// O retrato de cada grupo ativo, refeito no giro. Uma leitura só por aparelho, a partir do
// início do período mais longo entre os grupos; cada soma recorta o seu.
async function recalcular(engine, cfg, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  const st = estado(rt);
  const ativos = gruposAtivos(engine, cfg);
  if (!ativos.length || !rt.client || !rt.material) {
    st.retratos = {};
    return { ok: true, grupos: [] };
  }
  const inicios = ativos.map((g) => cg.inicioDoPeriodo(g.periodo, agora)).filter(Boolean).sort();
  const remotos = await lerRemotos(rt, inicios[0] || cg.inicioDoPeriodo('dia', agora));
  const tipicoPadrao = usage.custoTipicoDoEngine(engine);
  const retratos = {};
  for (const g of ativos) {
    const inicio = cg.inicioDoPeriodo(g.periodo, agora) || '';
    const local = localDoGrupo(engine, g.id, inicio, agora);
    retratos[g.id] = { ...cg.somarGrupo({ grupoId: g.id, periodo: g.periodo, agora, local, remotos, tipicoPadrao }), grupo: g, calculadoEm: agora };
  }
  st.retratos = retratos;
  return { ok: true, grupos: Object.keys(retratos) };
}

async function cicloDoConsumoDoGrupo(engine, cfg, { agora = Date.now() } = {}) {
  const pub = await publicarRollups(engine, cfg, { agora });
  const retrato = await recalcular(engine, cfg, { agora });
  return { pub, retrato };
}

function reservasLocaisDo(engine, id) {
  return reservasPorGrupo(engine)[id] || 0;
}

function perfilDaConta(engine, acct) {
  return typeof engine.profileOfAccount === 'function' ? engine.profileOfAccount(acct) : null;
}

function naoVerificavel(motivo, grupoId = '') {
  return { bloqueado: true, naoVerificavel: true, motivo, grupoId };
}

function veredito(engine, g, retrato, kind) {
  const soma = { custo: retrato.custo, desconhecidas: retrato.desconhecidas, reservas: retrato.reservas + reservasLocaisDo(engine, g.id) };
  const p = cg.perfilDoGrupo(g, soma, { hoje: usage.localDay(), inicio: retrato.inicio, kind });
  const st = usage.profileBudgetStatus(p.profile, p.store, retrato.tipico, p.nd);
  return {
    bloqueado: st.blocked === true, naoVerificavel: false, motivo: st.reason || '', grupoId: g.id, perfil: p.profile,
    parcialmenteEstimado: retrato.parcialmenteEstimado, projecaoUsd: soma.reservas * retrato.tipico,
  };
}

// O gate, síncrono. `null` quer dizer que o teto do grupo não se aplica a esta conta:
// nenhum grupo ativo, perfil Codex, tipo não controlado ou grupo do perfil não ativo.
function statusDoGrupo(engine, acct, { agora = Date.now() } = {}) {
  const cfg = cfgDe(engine);
  if (!sharedActive(cfg)) return null;
  const ativos = gruposAtivos(engine, cfg);
  if (!ativos.length) return null;
  const perfil = perfilDaConta(engine, acct);
  if (perfil && perfil.kind === 'codex') return null;
  const v = perfil ? vinculo.vinculoVigente(perfil.id) : null;
  // sem vínculo não é exceção: com teto de grupo ativo, falta de pareamento não escapa dele
  if (!v) return naoVerificavel('perfil-nao-identificado');
  if (!grupo.controlado(v.tipo)) return null;
  const g = ativos.find((x) => x.id === v.grupo);
  if (!g) return null;
  const retrato = estado(engine.sync).retratos[g.id];
  if (!retrato || agora - retrato.calculadoEm > SYNC.GRUPO_RETRATO_MAX_MS) return naoVerificavel('retrato-velho', g.id);
  if (!retrato.verificavel) return naoVerificavel(retrato.motivos[0].motivo, g.id);
  return veredito(engine, g, retrato, perfil ? perfil.kind : '');
}

function grupoSegura(engine, acct) {
  const st = statusDoGrupo(engine, acct);
  return st && st.naoVerificavel ? st.motivo : null;
}

function bloqueioDoGrupo(engine, acct) {
  const st = statusDoGrupo(engine, acct);
  return st && st.bloqueado && !st.naoVerificavel ? st.perfil : null;
}

// Para marcar a reserva: o grupo em que a execução desta conta vai gastar, se houver.
function grupoDaConta(engine, acct) {
  const perfil = perfilDaConta(engine, acct);
  const v = perfil ? vinculo.vinculoVigente(perfil.id) : null;
  return v ? v.grupo : '';
}

// O aviso único do orçamento guarda `grupo:<id>`; ele continua valendo enquanto alguma
// conta seguir barrada por esse grupo.
function grupoAindaBloqueia(engine, idSintetico) {
  const contas = typeof engine.accountList === 'function' ? engine.accountList() : [];
  return contas.some((c) => {
    const p = bloqueioDoGrupo(engine, c.user);
    return !!p && p.id === idSintetico;
  });
}

// Projeção para a tela: um resumo por grupo aceito, com o que falta para ativar.
function resumoParaTela(engine) {
  const cfg = cfgDe(engine);
  const rt = engine.sync || {};
  const aceitos = objeto(rt.grupos) ? Object.values(rt.grupos) : [];
  const vinculos = vinculo.lerVinculos();
  const retratos = objeto(rt.consumoGrupo) ? rt.consumoGrupo.retratos : {};
  return aceitos.map((x) => x && x.grupo).filter(objeto).map((g) => {
    const requisitos = grupo.requisitosDaAtivacao({ grupo: g, compartilhamento: sharedActive(cfg), medicaoFeita: ativacaoLiberada(engine) });
    return { ...grupo.resumoDoGrupo(g, { vinculos }), requisitos, ...visaoDoRetrato(retratos[g.id]) };
  });
}

// Sem retrato (grupo inativo ou ainda não calculado), a tela não inventa número.
function visaoDoRetrato(retrato) {
  if (!retrato) return { verificavel: null, custoUsd: null, parcialmenteEstimado: false };
  return { verificavel: retrato.verificavel, custoUsd: retrato.custo, parcialmenteEstimado: retrato.parcialmenteEstimado };
}

export default {
  publicarRollups, recalcular, cicloDoConsumoDoGrupo, consumoParaCapacidade, gruposAtivos, statusDoGrupo,
  grupoSegura, bloqueioDoGrupo, grupoDaConta, grupoAindaBloqueia, resumoParaTela, NO,
};
export {
  publicarRollups, recalcular, cicloDoConsumoDoGrupo, consumoParaCapacidade, gruposAtivos, statusDoGrupo,
  grupoSegura, bloqueioDoGrupo, grupoDaConta, grupoAindaBloqueia, resumoParaTela, NO,
};
