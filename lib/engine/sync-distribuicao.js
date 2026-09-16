// Distribuição de trabalho entre aparelhos (7.C5 e anexo S3): publicar candidato, rodar o
// ciclo do agendador (só o admin), e do lado do executor aceitar ou recusar com código.
//
// O CANDIDATO É PUBLICADO NO ATO, não de carona no tick. O round automático pós-push
// existe justamente para não perder um ciclo inteiro de polling, e pendurar a publicação
// no tick devolveria essa perda.
//
// O NOME DO OWNER É APRESENTAÇÃO. Ele viaja cifrado e a AAD o amarra ao item e ao `orgTag`:
// texto transplantado de outro candidato não abre. Nome indisponível não vira "sem nome"
// silencioso: o rótulo fica genérico e o rodízio segue pelo tag.
//
// RECUSA É EXPLÍCITA, com código e com o fim da espera quando existir. Sem isso, um fato
// local invisível ao admin (saída de cena, por exemplo) vira laço de recolocação a cada
// TTL, sem nada na tela.
//
// ATRIBUIÇÃO ACEITA NÃO É PERMISSÃO DE EXECUTAR: ela devolve o item ao caminho local, e daí
// em diante valem os mesmos gates de sempre, inclusive o lease, que continua sendo a
// autoridade final.
import { distributionActive } from '../sync/config.js';
import { SYNC } from '../constants.js';
import envelope from '../sync/envelope.js';
import kek from '../sync/kek.js';
import assinatura from '../sync/assinatura.js';
import adminChave from '../sync/admin-chave.js';
import { outboxTarget } from '../sync/outbox.js';
import candidato from '../sync/candidato.js';
import prontidao from '../sync/prontidao.js';
import capacidade from '../sync/capacidade.js';
import escolha from './escolha.js';
import admissao from './admissao.js';
import publicacao from './sync-publicacao.js';
import publicar from './sync-publicar.js';
import sinais from './sync-sinais.js';

const NO_FILA = 'live/queue';
const NO_ATRIBUICAO = 'live/assign';
const NO_RESPOSTA = 'live/ack';
const NO_PRONTIDAO = sinais.NO_PRONTIDAO;
const CAMPO = 'candidato';
const ESQUEMA = 'cand1';
const CODIGOS = ['saida_de_cena', 'sem_token', 'head_mudou', 'orcamento', 'sem_vaga', 'inapto'];

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mapaDe(v) {
  return objeto(v) ? v : {};
}

function ativa(engine, cfg) {
  if (!distributionActive(cfg)) return false;
  const rt = engine.sync;
  return !!(rt && rt.client && rt.uid && rt.material && rt.cur && rt.autoridade && rt.autoridade.fresca === true);
}

// Distribuir de fato exige também a prontidão fresca do distribuidor. `ativa` sozinha
// segue sendo o que o admin precisa para rodar o agendador: sem isso a prontidão nunca
// nasceria.
function distribuindo(engine, cfg, { agora = Date.now() } = {}) {
  return ativa(engine, cfg) && sinais.modoAtual(engine, { agora }) === 'distribuido';
}

function kIdDe(rt) {
  return kek.bufferDe(rt.material.id);
}

function meusCandidatos(rt) {
  if (!(rt.candidatos instanceof Map)) rt.candidatos = new Map();
  return rt.candidatos;
}

// 1. PUBLICAR: o item vira ponteiro num canal próprio, e o PR fica visível como
// "esperando distribuição" (a lição do estacionamento visível).
async function publicarCandidato(engine, cfg, pr, { agora = Date.now() } = {}) {
  if (!ativa(engine, cfg)) return { ok: false, code: 'distribuicao-desligada' };
  const rt = engine.sync;
  const kId = kIdDe(rt);
  const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
  const c = candidato.candidatoDe(pr, { kId, conta, agora, ttlMs: SYNC.CANDIDATO_TTL_MS });
  if (!c) return { ok: false, code: 'forma' };
  const caminho = `${NO_FILA}/${c.itemId}/${rt.deviceId}`;
  const cifrado = envelope.cifrar({
    uid: rt.uid, caminho, campo: CAMPO, no: NO_FILA, esquema: ESQUEMA, cur: rt.cur, material: rt.material,
    r: 1, extras: [c.itemId, c.orgTag], dados: { owner: candidato.nomeDoOwner(pr) },
  });
  if (!cifrado.ok) return { ok: false, code: 'cifra' };
  const w = await rt.client.put(`/users/${rt.uid}/${caminho}`, { ...c, enc: cifrado.enc }, {});
  if (!w || !w.ok) return { ok: false, code: 'indisponivel' };
  meusCandidatos(rt).set(c.itemId, { pr, conta, publicadoEm: agora });
  return { ok: true, itemId: c.itemId };
}

function abrirNome(rt, itemId, dev, no) {
  const aberto = envelope.decifrar({
    enc: no.enc, material: rt.material, uid: rt.uid, caminho: `${NO_FILA}/${itemId}/${dev}`,
    campo: CAMPO, esquema: ESQUEMA, extras: [itemId, no.orgTag],
  });
  // rótulo genérico quando o nome não abre: o rodízio segue pelo tag, e "sem nome" nunca
  // é confundido com adulteração, que segue a rejeição do registro
  return aberto.ok && objeto(aberto.valor) ? String(aberto.valor.owner || '') : '';
}

// 2 e 3. LER E FUNDIR, com os registros defeituosos ISOLADOS por publicador: um registro
// ilegível de um aparelho não derruba o registro válido de outro para o mesmo PR.
function registroValido(itemId, no) {
  return objeto(no) && no.itemId === itemId && !!no.prTag && !!no.matTag;
}

function juntarRegistro(acc, rt, itemId, dev, no) {
  if (!registroValido(itemId, no)) {
    acc.defeituosos.push({ itemId, dev, motivo: 'campo-fora-do-contrato' });
    return;
  }
  if (!acc.porDev[dev]) acc.porDev[dev] = [];
  acc.porDev[dev].push(no);
  if (!acc.nomes[itemId]) acc.nomes[itemId] = abrirNome(rt, itemId, dev, no);
}

function fundirFila(engine, arvore, { agora = Date.now() } = {}) {
  const rt = engine.sync;
  const acc = { porDev: {}, defeituosos: [], nomes: {} };
  for (const [itemId, publicadores] of Object.entries(mapaDe(arvore))) {
    for (const [dev, no] of Object.entries(mapaDe(publicadores))) juntarRegistro(acc, rt, itemId, dev, no);
  }
  const { porDev, defeituosos, nomes } = acc;
  const itens = candidato.fundir(porDev, { agora }).map((i) => ({ ...i, owner: nomes[i.itemId] || '' }));
  return { itens, defeituosos };
}

function valorDaAtribuicao(a) {
  return { itemId: String(a.itemId || ''), dev: String(a.dev || ''), rev: Number(a.rev) || 0, ttl: Number(a.ttl) || 0 };
}

// 6. ATRIBUIR: escrita assinada pelo admin, com TTL curto. A atribuição pendente ocupa vaga
// até virar lease ou caducar, e é isso que fecha a janela entre medir o PR e pegar o lease.
async function atribuir(engine, rt, { item, dev, generation, jwk, agora }) {
  const anterior = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_ATRIBUICAO}/${item.itemId}`);
  const rev = (anterior && anterior.valor ? Number(anterior.valor.rev) || 0 : 0) + 1;
  const base = { v: 1, itemId: item.itemId, dev, rev, generation, ttl: agora + SYNC.ATRIBUICAO_TTL_MS };
  const sig = assinatura.assinar(jwk, { uid: rt.uid, caminho: `${NO_ATRIBUICAO}/${item.itemId}`, generation, valor: valorDaAtribuicao(base) });
  if (!sig) return false;
  const w = await rt.client.put(`/users/${rt.uid}/${NO_ATRIBUICAO}/${item.itemId}`, { ...base, sig }, { ifMatch: anterior ? anterior.etag : 'null_etag' });
  return !!(w && w.ok);
}

function esperaDaRecusa(respostas, agora) {
  const recusas = {};
  for (const [itemId, r] of Object.entries(mapaDe(respostas))) {
    if (!objeto(r) || r.estado !== 'recusada') continue;
    if (!recusas[itemId]) recusas[itemId] = {};
    recusas[itemId][r.dev] = Number(r.esperaAte) || (Number(r.at) || agora) + SYNC.ATRIBUICAO_TTL_MS;
  }
  return recusas;
}

// 4, 5 e 6 juntos: o ciclo do agendador. Devolve o RELATÓRIO, que é o que decide se a
// prontidão renova (CT-PRONT): fila vazia e "ninguém apto" são resultados legítimos.
async function cicloDoAgendador(engine, cfg, { agora = Date.now() } = {}) {
  if (!ativa(engine, cfg)) return { ok: false, code: 'distribuicao-desligada' };
  const rt = engine.sync;
  const inicio = agora;
  const leituras = { candidatos: false, ocupacao: false, politicas: false };
  const admin = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  const generation = admin && admin.valor ? Number(admin.valor.generation) || 0 : 0;
  const minha = adminChave.lerChaveDeAdmin();
  if (!adminChave.chaveServe(minha, { uid: rt.uid, destino: outboxTarget(rt.uid, cfg.databaseUrl), generation })) {
    return { ok: false, code: 'nao-e-admin' };
  }
  const fila = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_FILA}`);
  leituras.candidatos = !!fila;
  const status = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/deviceStatus`);
  leituras.ocupacao = !!status;
  const atribuicoes = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_ATRIBUICAO}`);
  const respostas = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_RESPOSTA}`);
  leituras.politicas = !!atribuicoes && !!respostas;
  if (!leituras.candidatos || !leituras.ocupacao || !leituras.politicas) {
    return relatorioDeLeituraIncompleta(leituras, inicio);
  }

  const { itens, defeituosos } = fundirFila(engine, fila.valor, { agora });
  const aparelhos = aparelhosDe(engine, { status: status.valor, atribuicoes: atribuicoes.valor, agora });
  const recusas = esperaDaRecusa(respostas.valor, agora);
  const avaliados = defeituosos.map((d) => ({ itemId: d.itemId, desfecho: 'isolado', motivo: d.motivo }));
  const pendentes = itens.filter((i) => !atribuicaoViva(atribuicoes.valor, i.itemId, agora));
  for (const jaAtribuido of itens.filter((i) => atribuicaoViva(atribuicoes.valor, i.itemId, agora))) {
    avaliados.push({ itemId: jaAtribuido.itemId, desfecho: 'espera-com-motivo', motivo: 'atribuicao-viva' });
  }
  const r = escolha.escolher(pendentes, aparelhos, { agora, recusas, ultimaDaOrg: rt.ultimaDaOrg || {} });
  for (const sem of r.semAparelho) avaliados.push({ itemId: sem.itemId, desfecho: 'sem-aparelho-apto', motivo: sem.motivo });
  if (r.item) {
    const feito = await atribuir(engine, rt, { item: r.item, dev: r.dev, generation, jwk: minha.jwk, agora });
    avaliados.push(desfechoDaAtribuicao(r.item.itemId, feito));
    if (feito) marcarVezDaOrg(rt, r.item.orgTag);
  }
  return { ok: true, atribuido: r.item ? { itemId: r.item.itemId, dev: r.dev } : null, relatorio: { leituras, avaliados, duracaoMs: Date.now() - inicio } };
}

// leitura que não conclui NÃO renova a prontidão, e não é disfarçada de fila vazia
function relatorioDeLeituraIncompleta(leituras, inicio) {
  const relatorio = { leituras, avaliados: [], duracaoMs: Date.now() - inicio, erro: 'leitura-incompleta' };
  return { ok: true, relatorio };
}

function desfechoDaAtribuicao(itemId, feito) {
  if (feito) return { itemId, desfecho: 'atribuido', motivo: '' };
  return { itemId, desfecho: 'espera-com-motivo', motivo: 'escrita-recusada' };
}

function marcarVezDaOrg(rt, orgTag) {
  if (!objeto(rt.ultimaDaOrg)) rt.ultimaDaOrg = {};
  rt.seqDaOrg = (Number(rt.seqDaOrg) || 0) + 1;
  rt.ultimaDaOrg[orgTag] = rt.seqDaOrg;
}

function atribuicaoViva(atribuicoes, itemId, agora) {
  const a = objeto(atribuicoes) ? atribuicoes[itemId] : null;
  return objeto(a) && Number(a.ttl) > Number(agora);
}

// A ocupação de cada aparelho vem do resumo publicado por ele (CT-ADM e CT-PRONT).
function aparelhosDe(engine, { status, atribuicoes, agora }) {
  const rt = engine.sync;
  const lista = Object.values(mapaDe(atribuicoes)).map((a) => ({ id: `${a.itemId}`, dev: a.dev, ttl: Number(a.ttl) || 0 }));
  const saida = {};
  for (const [dev, no] of Object.entries(mapaDe(status))) {
    saida[dev] = estadoDoAparelho(rt, dev, no, { lista, agora });
  }
  return saida;
}

function estadoDoAparelho(rt, dev, no, { lista, agora }) {
  const resumo = resumoDoAparelho(rt, dev, no);
  const ocup = prontidao.ocupacaoDe(dev, { resumo, atribuicoes: lista, leases: [], agora });
  const pausado = !!(resumo && resumo.pausado === true);
  const teto = resumo ? Math.max(1, Number(resumo.teto) || 1) : 1;
  return { apto: ocup.temResumo && !pausado, pausado, teto, ocupadas: ocup.total, prioridade: 0 };
}

// O resumo vem cifrado no deviceStatus (C3a): capacidade com a contagem da admissão.
function resumoDoAparelho(rt, dev, no) {
  const aberta = capacidade.abrirCapacidade({ uid: rt.uid, material: rt.material, dev, no });
  if (!aberta) return null;
  const { c } = aberta;
  const adm = objeto(c.admissao) ? c.admissao : { porEstado: {} };
  return {
    frescoAte: aberta.u + SYNC.FROTA_JANELA_MS,
    porEstado: { reserva: Number(adm.porEstado && adm.porEstado.reserva) || 0, execucao: Number(adm.porEstado && adm.porEstado.execucao) || 0 },
    atribuicoes: [],
    teto: Number(c.paralelismo) || 1,
    pausado: c.pausado === true,
  };
}

// 7. ACEITAR OU RECUSAR (executor). A verificação é toda local, e a recusa carrega código e
// espera: é o que impede o agendador de recolocar o mesmo item a cada TTL.
async function responder(engine, cfg, { itemId, estado, code = '', esperaAte = 0, admissaoId = '', agora = Date.now() }) {
  const rt = engine.sync;
  if (!rt || !rt.client || !rt.uid) return false;
  const corpo = { v: 1, dev: rt.deviceId, estado, at: agora, code: CODIGOS.includes(code) ? code : '', esperaAte: Number(esperaAte) || 0, admissaoId: String(admissaoId || '') };
  const w = await rt.client.put(`/users/${rt.uid}/${NO_RESPOSTA}/${String(itemId)}`, corpo, {});
  return !!(w && w.ok);
}

function atribuicaoValida(engine, cfg, atribuicao, { generation, publicKey, agora }) {
  const rt = engine.sync;
  if (!objeto(atribuicao) || atribuicao.dev !== rt.deviceId) return 'nao-e-minha';
  if (cfg.aceitarAdmin !== true) return 'nao-aceita-admin';
  if (Number(atribuicao.ttl) <= Number(agora)) return 'vencida';
  if ((Number(atribuicao.generation) || 0) !== Number(generation)) return 'geracao';
  const ok = assinatura.verificar(publicKey, atribuicao.sig, {
    uid: rt.uid, caminho: `${NO_ATRIBUICAO}/${atribuicao.itemId}`, generation, valor: valorDaAtribuicao(atribuicao),
  });
  return ok ? '' : 'assinatura';
}

// O head é conferido pela TAG: o executor calcula a do head ATUAL e compara com a
// atribuída. Nunca se presume que o head de agora é o que foi atribuído.
function headBate(rt, item, pr) {
  const atual = candidato.matTag(kIdDe(rt), String(pr.headSha || pr.knownHead || ''));
  return atual === item.matTag;
}

async function aceitarAtribuicoes(engine, cfg, arvore, { agora = Date.now() } = {}) {
  if (!ativa(engine, cfg)) return { aceitas: [], recusas: [] };
  const rt = engine.sync;
  const admin = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/control/admin`);
  const generation = admin && admin.valor ? Number(admin.valor.generation) || 0 : 0;
  const publicKey = admin && admin.valor ? admin.valor.publicKey : '';
  const aceitas = [];
  const recusas = [];
  for (const [itemId, atribuicao] of Object.entries(mapaDe(arvore))) {
    const problema = atribuicaoValida(engine, cfg, { ...atribuicao, itemId }, { generation, publicKey, agora });
    if (problema) { if (problema !== 'nao-e-minha') recusas.push({ itemId, code: 'inapto', problema }); continue; }
    const meu = meusCandidatos(rt).get(itemId);
    if (!meu) { recusas.push({ itemId, code: 'inapto', problema: 'nao-publiquei' }); continue; }
    const item = { itemId, matTag: String(atribuicao.matTag || itemId.split('_')[1] || '') };
    if (!headBate(rt, item, meu.pr)) { recusas.push({ itemId, code: 'head_mudou' }); continue; }
    const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(meu.pr) : '';
    if (typeof engine.grupoSegura === 'function' && engine.grupoSegura(conta)) { recusas.push({ itemId, code: 'orcamento', problema: 'grupo-nao-verificavel' }); continue; }
    const grupoDoItem = typeof engine.grupoDaConta === 'function' ? engine.grupoDaConta(conta) : '';
    const vaga = admissao.reservar(engine, { tipo: 'review', ref: meu.pr.key, agora, grupo: grupoDoItem });
    if (!vaga.ok) { recusas.push({ itemId, code: vaga.motivo === 'sem-vaga' ? 'sem_vaga' : 'inapto', problema: vaga.motivo }); continue; }
    aceitas.push({ itemId, pr: meu.pr, admissaoId: vaga.id });
  }
  for (const r of recusas) await responder(engine, cfg, { itemId: r.itemId, estado: 'recusada', code: r.code, esperaAte: agora + SYNC.ATRIBUICAO_TTL_MS, agora });
  for (const a of aceitas) {
    await responder(engine, cfg, { itemId: a.itemId, estado: 'aceita', admissaoId: a.admissaoId, agora });
    if (typeof engine.enfileirarDaDistribuicao === 'function') engine.enfileirarDaDistribuicao(a.pr, a.admissaoId);
  }
  return { aceitas, recusas };
}

// Um giro completo no relógio: o admin agenda (e renova a prontidão quando o ciclo foi
// saudável), e TODO aparelho responde às atribuições que são dele.
async function cicloDaDistribuicao(engine, cfg, { agora = Date.now() } = {}) {
  if (!ativa(engine, cfg)) return { ok: false, code: 'distribuicao-desligada' };
  const rt = engine.sync;
  const agenda = await cicloDoAgendador(engine, cfg, { agora });
  const saudavel = agenda.ok && agenda.relatorio ? prontidao.cicloSaudavel(agenda.relatorio) : { ok: false, motivo: agenda.code || 'nao-e-admin' };
  if (agenda.ok && saudavel.ok) await publicarProntidao(engine, cfg, { agora });
  const atribuicoes = await publicar.lerNo(rt.client, `/users/${rt.uid}/${NO_ATRIBUICAO}`);
  const resposta = atribuicoes ? await aceitarAtribuicoes(engine, cfg, atribuicoes.valor, { agora }) : { aceitas: [], recusas: [] };
  return { ok: true, agenda, saudavel, resposta };
}

// A prontidão só sai depois de um ciclo saudável, e por isso "renovar" significa alguma
// coisa (CT-PRONT). A assinatura é a mesma do batimento, noutro caminho.
function publicarProntidao(engine, cfg, { agora }) {
  return sinais.publicarSinal(engine, cfg, NO_PRONTIDAO, { agora });
}

export default { ativa, distribuindo, cicloDaDistribuicao, publicarProntidao, publicarCandidato, fundirFila, cicloDoAgendador, aceitarAtribuicoes, responder, NO_FILA, NO_ATRIBUICAO, NO_RESPOSTA, NO_PRONTIDAO };
export { ativa, distribuindo, cicloDaDistribuicao, publicarProntidao, publicarCandidato, fundirFila, cicloDoAgendador, aceitarAtribuicoes, responder, NO_FILA, NO_ATRIBUICAO, NO_RESPOSTA, NO_PRONTIDAO };
