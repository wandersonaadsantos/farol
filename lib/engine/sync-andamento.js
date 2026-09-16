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
import { SYNC } from '../constants.js';
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import andamento from '../sync/andamento.js';
import publicacao from './sync-publicacao.js';
import consumoGrupo from './sync-consumo-grupo.js';
import pendencias from './sync-pendencias.js';
import historico from './sync-historico.js';
import escopos from './sync-escopo.js';
import listas from './sync-listas.js';
import pushbacks from './sync-pushback.js';
import distribuicao from './sync-distribuicao.js';
import sinais from './sync-sinais.js';
import aceite from './sync-aceite.js';
import comandos from './sync-comandos.js';
import checkpointSync from './sync-checkpoint.js';

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
function aplicarLista(engine, lista) {
  if (engine.sync) engine.sync.andamentoRemoto = lista;
  if (typeof engine.emit === 'function') engine.emit('sync-live', { operacoes: lista });
  return lista;
}

function aplicarLeitura(engine, arvore, opcoes) {
  return aplicarLista(engine, lerAndamentos(engine, arvore, opcoes));
}

// A leitura do relógio, com o PR de cada operação resolvido pelo catálogo cifrado
// (`pr: { key, account, title, author } | null`). É o que deixa a tela nomear o PR e
// pedir o aviso da tomada; sem a linha do catálogo, `null` e rótulo genérico.
async function lerEAplicar(engine, cfg, arvore, opcoes = {}) {
  const saida = [];
  for (const op of lerAndamentos(engine, arvore, opcoes)) {
    saida.push({ ...op, pr: await publicacao.prDaTag(engine, cfg, op.prTag) });
  }
  return aplicarLista(engine, saida);
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

// Leitura que falha devolve null, e null não é "nó vazio": o cliente do banco não lança,
// ele responde `ok: false`, e tratar essa resposta como `{}` apagava da tela o andamento dos
// outros aparelhos a cada queda de rede. Nó ausente (`ok` com `null`) é que é vazio.
async function lerNoRemoto(rt, no = NO) {
  try {
    const r = await rt.client.get(`/users/${rt.uid}/${no}`);
    if (!r || !r.ok) return null;
    return objeto(r.data) ? r.data : {};
  } catch {
    // leitura que falha não apaga a visão anterior: ela vence sozinha pelo `x`
    return null;
  }
}

// A leitura do andamento falhou: a tela recebe a visão anterior e a hora da falha, para
// dizer que o que mostra pode estar velho em vez de mostrar uma lista vazia.
function avisarFalhaDaLeitura(engine, agora) {
  const anterior = engine.sync && Array.isArray(engine.sync.andamentoRemoto) ? engine.sync.andamentoRemoto : [];
  if (typeof engine.emit === 'function') engine.emit('sync-live', { operacoes: anterior, falhaEm: agora });
}

// Um ciclo do relógio próprio: publica o que roda aqui, lê o que roda nos outros e apaga
// o que venceu faz tempo. Sem frota nem chave, não faz nada, nem leitura: sem outro
// aparelho pronto não existe andamento remoto para ver, e as listas remotas dizem por quê.
// A lista local de aparelhos só é relida no carimbo de presença. Quando o portão da frota
// recusa, pode ser só a lista que ficou velha (outro aparelho acabou de abrir a chave): relê
// uma vez, respeitando a cadência, e tenta de novo.
async function publicarComFrotaFresca(engine, cfg, agora) {
  const pub = await sincronizarAndamentos(engine, cfg, { agora });
  const rt = engine.sync;
  if (pub.ok || pub.code !== 'sem-frota' || !rt || typeof engine.syncFrota !== 'function') return pub;
  if (agora - (Number(rt.frotaRelidaEm) || 0) < SYNC.FROTA_RELEITURA_MS) return pub;
  rt.frotaRelidaEm = agora;
  const lida = await engine.syncFrota();
  if (!lida || !lida.ok) return pub;
  return sincronizarAndamentos(engine, cfg, { agora });
}

async function ciclo(engine, cfg, opcoes = {}) {
  const agora = opcoes.agora || Date.now();
  const pub = await publicarComFrotaFresca(engine, cfg, agora);
  if (!pub.ok) {
    listas.semLeitura(engine, pub.code, { agora });
    return pub;
  }
  const arvore = await lerNoRemoto(engine.sync);
  if (arvore === null) avisarFalhaDaLeitura(engine, agora);
  else {
    await lerEAplicar(engine, cfg, arvore, { agora });
    await apagarVencidos(engine, arvore, { agora });
  }
  // capacidade e catálogo só sobem quando mudam; sem a capacidade o admin não enxerga
  // este aparelho como apto, e sem o catálogo o item distribuído não tem nome na tela
  // o rollup sobe antes da capacidade que anuncia a sequência dele
  await consumoGrupo.cicloDoConsumoDoGrupo(engine, cfg, { agora });
  await publicacao.publicarCapacidade(engine, cfg);
  await publicacao.publicarNoCatalogo(engine, cfg, prsDoCatalogo(engine));
  // o modo sai dos sinais deste giro, então eles vêm antes da distribuição
  await sinais.cicloDosSinais(engine, cfg, { agora });
  // política e grupo dependem da autoridade observada logo acima
  await aceite.cicloDoAceite(engine, cfg);
  // comando remoto depende da mesma autoridade fresca, e nunca da distribuição
  await comandos.cicloDosComandos(engine, cfg, { agora });
  // o que as sessões vivas verificaram não pode ficar preso aqui se elas morrerem
  await checkpointSync.publicarDeSessoesVivas(engine, cfg, { agora });
  await distribuicao.cicloDaDistribuicao(engine, cfg, { agora });
  await historico.sincronizarHistorico(engine, cfg, { agora });
  await publicarEscopos(engine, cfg, agora);
  // Panorama e Meus PRs dos outros aparelhos: GET incremental só quando o ponteiro andou
  await listas.lerListasRemotas(engine, cfg, { agora });
  await pushbacks.sincronizarPushbacks(engine, cfg, { agora });
  const memoria = await lerNoRemoto(engine.sync, 'pushbacks');
  if (memoria !== null) pushbacks.aplicarPushbacks(engine, memoria, { agora });
  // "precisa de você" anda no mesmo relógio: é a mesma frota e a mesma cadência de tela
  await pendencias.sincronizarPendencias(engine, cfg);
  const abertas = await lerNoRemoto(engine.sync, 'live/pending');
  const vistos = await lerNoRemoto(engine.sync, 'live/seen');
  if (abertas !== null && vistos !== null) {
    await pendencias.aplicarPendenciasIdentificadas(engine, cfg, abertas, vistos);
    await pendencias.limparVistos(engine, abertas, vistos, { agora });
  }
  return pub;
}

// O que este aparelho pode pôr na frente dos outros: a fila de revisão, o que espera
// distribuição, as pendências e as sessões vivas. As duas últimas viajam só como tag
// (`live/pending`, `live/operations`), e sem a linha aqui o outro aparelho não teria como
// dizer QUAL PR precisa dele. Panorama e Meus PRs já viajam nos escopos, com o próprio texto.
function prsDoCatalogo(engine) {
  const fila = Array.isArray(engine.queue) ? engine.queue : [];
  const distribuindo = engine.headlessDistribuindo instanceof Map ? [...engine.headlessDistribuindo.values()].map((x) => x.pr) : [];
  const pendentes = engine.decisions && Array.isArray(engine.decisions.pending) ? engine.decisions.pending.map(prDaPendencia) : [];
  const vivas = engine.activeReviews instanceof Map ? [...engine.activeReviews.values()].map((s) => s && s.pr) : [];
  // UM PR, UMA LINHA: a mesma chave vinda de duas fontes com campos diferentes seria
  // reescrita a cada giro. A primeira fonte vence.
  const vistos = new Set();
  return [...fila, ...distribuindo, ...pendentes, ...vivas].filter((pr) => {
    if (!objeto(pr) || !pr.key || vistos.has(pr.key)) return false;
    vistos.add(pr.key);
    return true;
  });
}

// a decisão guarda a chave fora do objeto do PR, e o autor às vezes também
function prDaPendencia(d) {
  if (!objeto(d)) return null;
  const pr = objeto(d.pr) ? d.pr : {};
  return { ...pr, key: pr.key || d.key, author: pr.author || d.author };
}

function daConta(engine, lista, conta) {
  const alvo = String(conta).toLowerCase();
  const dono = (pr) => String((typeof engine.accountForPr === 'function' && engine.accountForPr(pr)) || '').toLowerCase();
  return (Array.isArray(lista) ? lista : []).filter((pr) => dono(pr) === alvo);
}

// Panorama e Meus PRs, por conta monitorada: cada conta tem um publicador só (o meta
// decide), então "outro publicador" aqui é resultado normal, não falha.
// Lista de conta cuja busca nunca deu certo neste processo está vazia por falta de leitura:
// publicá-la poria lápide nas linhas que outro aparelho publicou (arranque a frio).
function jaLido(conjunto, valor) {
  return conjunto instanceof Set && conjunto.has(String(valor || '').toLowerCase());
}

function panoramaPronto(engine, conta) {
  const owners = Array.isArray(conta.owners) ? conta.owners : [];
  return owners.length > 0 && owners.every((o) => jaLido(engine.ownersJaLidos, o));
}

async function publicarEscopos(engine, cfg, agora) {
  const contas = typeof engine.accountList === 'function' ? engine.accountList() : [];
  for (const conta of contas) {
    if (panoramaPronto(engine, conta)) {
      await escopos.publicarEscopo(engine, cfg, { tipo: 'panorama', conta: conta.user, prs: daConta(engine, engine.panorama, conta.user), agora });
    }
    if (jaLido(engine.contasMeusPrsLidas, conta.user)) {
      await escopos.publicarEscopo(engine, cfg, { tipo: 'myPrs', conta: conta.user, prs: daConta(engine, engine.myPRs, conta.user), agora });
    }
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
  sinais.esquecerSinais(rt);
  if (rt.andamento instanceof Map) rt.andamento.clear();
  rt.andamentoRemoto = [];
  return true;
}

export default { ciclo, ligarRelogio, desligarRelogio, sincronizarAndamentos, lerAndamentos, aplicarLeitura, lerEAplicar, prsDoCatalogo, apagarVencidos, ESPACO_MIN_MS, RENOVACAO_MS };
export { ciclo, ligarRelogio, desligarRelogio, sincronizarAndamentos, lerAndamentos, aplicarLeitura, lerEAplicar, prsDoCatalogo, apagarVencidos, ESPACO_MIN_MS, RENOVACAO_MS };
