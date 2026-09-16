// Andamento ao vivo entre aparelhos (7.C3): publicar o que roda aqui e ler o que roda nos
// outros. A projeção (o que pode viajar) é de lib/sync/andamento.js.
//
// TRÊS RITMOS, e cada um existe por um motivo:
//   - no mínimo 10 s entre escritas da mesma operação: o feed da sessão emite dezenas de
//     eventos por segundo, e cada escrita é cota;
//   - renovação a cada 60 s mesmo sem mudança: o nó vence em 150 s, e uma análise longa
//     parada numa etapa não pode sumir da tela do outro por estar quieta;
//   - DELETE ao terminar: a tela do outro não pode ficar mostrando "em andamento" até vencer.
// Por causa do segundo ritmo o relógio é PRÓPRIO: o ciclo de polling pode ser de minutos.
//
// A LEITURA NUNCA CHAMA pushState. Andamento muda o tempo todo, e empurrar o estado inteiro
// a cada mudança de outro aparelho faria a tela deste redesenhar sem parar. Ela emite um
// evento próprio, `sync-live`, que a tela aplica como delta.
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import andamento from '../sync/andamento.js';
import publicacao from './sync-publicacao.js';
import pendencias from './sync-pendencias.js';
import historico from './sync-historico.js';
import escopos from './sync-escopo.js';

const NO = 'live/operations';
const CAMPO = 'andamento';
const ESQUEMA = 'op1';
const ESPACO_MIN_MS = 10 * 1000;
const RENOVACAO_MS = 60 * 1000;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function estado(rt) {
  if (!(rt.andamento instanceof Map)) rt.andamento = new Map();
  return rt.andamento;
}

function extrasDe(no) {
  return [no.dev, no.t0, no.x];
}

function sessaoComConta(engine, sessao) {
  const pr = objeto(sessao.pr) ? sessao.pr : {};
  const conta = typeof engine.accountForPr === 'function' && pr.key ? engine.accountForPr(pr) : '';
  return { ...sessao, account: conta || '' };
}

function precisaEscrever(reg, resumo, agora) {
  if (!reg.ultimaEscrita) return true;
  const passou = agora - reg.ultimaEscrita;
  if (passou >= RENOVACAO_MS) return true;
  return resumo !== reg.resumo && passou >= ESPACO_MIN_MS;
}

async function escrever(rt, reg, projecao, agora) {
  const caminho = `${NO}/${reg.opId}`;
  const no = { v: 1, dev: rt.deviceId, t0: reg.t0, x: andamento.vencimentoDe(agora) };
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO, no: NO, esquema: ESQUEMA, cur: rt.cur, material: rt.material,
    r: 1, extras: extrasDe(no), dados: { p: projecao },
  });
  if (!cifrado.ok) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { ...no, enc: cifrado.enc }, {});
  return !!(w && w.ok);
}

async function apagar(rt, opId) {
  const r = await rt.client.del(`/users/${rt.uid}/${NO}/${opId}`);
  return !!(r && r.ok);
}

// Publica as sessões vivas e apaga as que terminaram. Sem frota ou sem chave, não escreve
// nada: o que já subiu vence sozinho em 150 s.
async function sincronizarAndamentos(engine, cfg, { agora = Date.now() } = {}) {
  const pode = publicacao.podePublicar(engine, cfg);
  if (!pode.ok) return pode;
  const rt = engine.sync;
  const kId = kek.bufferDe(rt.material.id);
  const regs = estado(rt);
  const vivas = engine.activeReviews instanceof Map ? engine.activeReviews : new Map();
  const escritas = [];
  for (const [idLocal, sessao] of vivas) {
    const reg = regs.get(idLocal) || { opId: andamento.opIdDe(kId, rt.deviceId, idLocal), t0: agora, ultimaEscrita: 0, resumo: '' };
    const feed = engine.activity instanceof Map ? engine.activity.get(idLocal) : [];
    const projecao = andamento.projetar(sessaoComConta(engine, sessao), feed, { kId, agora });
    const resumo = publicacao.resumoDe(projecao);
    regs.set(idLocal, reg);
    if (!precisaEscrever(reg, resumo, agora)) continue;
    if (!await escrever(rt, reg, projecao, agora)) continue;
    Object.assign(reg, { ultimaEscrita: agora, resumo });
    escritas.push(reg.opId);
  }
  const apagadas = [];
  for (const [idLocal, reg] of [...regs]) {
    if (vivas.has(idLocal)) continue;
    regs.delete(idLocal);
    if (reg.ultimaEscrita && await apagar(rt, reg.opId)) apagadas.push(reg.opId);
  }
  return { ok: true, escritas, apagadas };
}

// Lê o nó inteiro de operações e devolve o que roda nos OUTROS aparelhos. Falha fechada:
// item que não decifra, ou cujo claro não confere com `dev`/`t0`/`x` da AAD, some.
function lerAndamentos(engine, arvore, { agora = Date.now() } = {}) {
  const rt = engine.sync || {};
  if (!rt.material || !objeto(arvore)) return [];
  const saida = [];
  for (const [opId, no] of Object.entries(arvore)) {
    if (!objeto(no) || no.dev === rt.deviceId || !no.enc) continue;
    const aberto = envelope.decifrar({
      enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${NO}/${opId}`, campo: CAMPO, esquema: ESQUEMA, extras: extrasDe(no),
    });
    if (!aberto.ok || !objeto(aberto.valor) || !objeto(aberto.valor.p)) continue;
    const aparelho = objeto(rt.devices) && objeto(rt.devices[no.dev]) ? rt.devices[no.dev].name : '';
    saida.push({ opId, dev: no.dev, aparelho: aparelho || '', t0: Number(no.t0) || 0, situacao: andamento.situacao(no, agora), ...aberto.valor.p });
  }
  return saida.sort((a, b) => a.t0 - b.t0);
}

// Aplica uma leitura: guarda a visão e avisa a tela por evento próprio, NUNCA por pushState.
function aplicarLeitura(engine, arvore, opcoes) {
  const lista = lerAndamentos(engine, arvore, opcoes);
  if (engine.sync) engine.sync.andamentoRemoto = lista;
  if (typeof engine.emit === 'function') engine.emit('sync-live', { operacoes: lista });
  return lista;
}

// Qualquer aparelho pode apagar nó vencido: a remoção é cooperativa e só afeta exibição.
async function apagarVencidos(engine, arvore, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!rt || !rt.client || !objeto(arvore)) return [];
  const feitos = [];
  for (const [opId, no] of Object.entries(arvore)) {
    if (andamento.situacao(no, agora) !== 'interrompida') continue;
    if (Number(objeto(no) && no.x) + andamento.TTL_MS > agora) continue;
    if (await apagar(rt, opId)) feitos.push(opId);
  }
  return feitos;
}

async function lerNoRemoto(rt, no = NO) {
  try {
    const r = await rt.client.get(`/users/${rt.uid}/${no}`);
    return r && r.ok && objeto(r.data) ? r.data : {};
  } catch {
    // leitura que falha não apaga a visão anterior: ela vence sozinha pelo `x`
    return null;
  }
}

// Um ciclo do relógio próprio: publica o que roda aqui, lê o que roda nos outros e apaga
// o que venceu faz tempo. Sem frota nem chave, não faz nada, nem leitura: sem outro
// aparelho pronto não existe andamento remoto para ver.
async function ciclo(engine, cfg, opcoes = {}) {
  const agora = opcoes.agora || Date.now();
  const pub = await sincronizarAndamentos(engine, cfg, { agora });
  if (!pub.ok) return pub;
  const arvore = await lerNoRemoto(engine.sync);
  if (arvore === null) return pub;
  aplicarLeitura(engine, arvore, { agora });
  await apagarVencidos(engine, arvore, { agora });
  await historico.sincronizarHistorico(engine, cfg, { agora });
  await publicarEscopos(engine, cfg, agora);
  // "precisa de você" anda no mesmo relógio: é a mesma frota e a mesma cadência de tela
  await pendencias.sincronizarPendencias(engine, cfg);
  const abertas = await lerNoRemoto(engine.sync, 'live/pending');
  const vistos = await lerNoRemoto(engine.sync, 'live/seen');
  if (abertas !== null && vistos !== null) {
    pendencias.aplicarPendencias(engine, abertas, vistos);
    await pendencias.limparVistos(engine, abertas, vistos, { agora });
  }
  return pub;
}

function daConta(engine, lista, conta) {
  const alvo = String(conta).toLowerCase();
  const dono = (pr) => String((typeof engine.accountForPr === 'function' && engine.accountForPr(pr)) || '').toLowerCase();
  return (Array.isArray(lista) ? lista : []).filter((pr) => dono(pr) === alvo);
}

// Panorama e Meus PRs, por conta monitorada: cada conta tem um publicador só (o meta
// decide), então "outro publicador" aqui é resultado normal, não falha.
async function publicarEscopos(engine, cfg, agora) {
  const contas = typeof engine.accountList === 'function' ? engine.accountList() : [];
  for (const conta of contas) {
    await escopos.publicarEscopo(engine, cfg, { tipo: 'panorama', conta: conta.user, prs: daConta(engine, engine.panorama, conta.user), agora });
    await escopos.publicarEscopo(engine, cfg, { tipo: 'myPrs', conta: conta.user, prs: daConta(engine, engine.myPRs, conta.user), agora });
  }
}

const AGENDADOR = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: (t) => clearInterval(t) };

// O relógio só existe com o compartilhamento ligado, e é parado junto com a conexão.
function ligarRelogio(engine, cfgDe, agendador = AGENDADOR) {
  const rt = engine.sync;
  if (!rt || rt.relogioAndamento) return false;
  let rodando = false;
  const tique = async () => {
    if (rodando) return;
    rodando = true;
    try { await ciclo(engine, cfgDe(engine)); } catch (err) {
      if (typeof engine.log === 'function') engine.log('WARN', `andamento ao vivo: ${err && err.message}`);
    } finally { rodando = false; }
  };
  rt.relogioAndamento = { timer: agendador.setInterval(tique, ESPACO_MIN_MS), agendador };
  if (rt.relogioAndamento.timer && typeof rt.relogioAndamento.timer.unref === 'function') rt.relogioAndamento.timer.unref();
  return true;
}

function desligarRelogio(rt) {
  if (!rt || !rt.relogioAndamento) return false;
  rt.relogioAndamento.agendador.clearInterval(rt.relogioAndamento.timer);
  rt.relogioAndamento = null;
  if (rt.andamento instanceof Map) rt.andamento.clear();
  rt.andamentoRemoto = [];
  return true;
}

export default { ciclo, ligarRelogio, desligarRelogio, sincronizarAndamentos, lerAndamentos, aplicarLeitura, apagarVencidos, ESPACO_MIN_MS, RENOVACAO_MS };
export { ciclo, ligarRelogio, desligarRelogio, sincronizarAndamentos, lerAndamentos, aplicarLeitura, apagarVencidos, ESPACO_MIN_MS, RENOVACAO_MS };
