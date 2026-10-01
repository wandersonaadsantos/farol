// Admissão local (CT-ADM): a autoridade de ocupação DESTE aparelho quando o
// compartilhamento está ligado. Com ele desligado, este módulo não é consultado e o
// escalonador é o de sempre (CT-COMPAT).
//
// RESERVA ANTES DO PROVEDOR. A vaga é tomada antes de iniciar qualquer execução, de forma
// atômica no processo: sem isso, um clique e uma operação automática no mesmo tick contam
// a mesma vaga livre duas vezes e as duas saem.
//
// REQUISITOS DUROS, que recusam desde o primeiro dia: presença vencida, aparelho como root
// (o CLI recusa `--dangerously-skip-permissions` com uid 0 e a sessão morre no spawn),
// provedor não pronto, aparelho pausado pela política, e sem vaga.
//
// PISO DE MEMÓRIA, e a regra que mais importa: **medição indisponível é DESCONHECIDO, não
// memória suficiente**. Iniciar sem saber é a decisão que produz o encerramento pelo
// sistema operacional no meio da revisão. O piso protege contra COMEÇAR numa condição já
// insuficiente; ele não promete que qualquer PR cabe.
//
// O piso inicial é MARGEM DECLARADA, não regra sustentada por dado: a medição em execuções
// reais é etapa própria da C4 e não fecha com teste simulado. Por isso cada reserva guarda
// a métrica e o piso que usou, que é o ponto de coleta dessa medição.
import os from 'node:os';
import { rodandoComoRoot } from '../paths.js';
import { SYNC } from '../constants.js';
import { sharedActive } from '../sync/config.js';
import { politicaEfetiva } from './politica-efetiva.js';
import cachePolitica from '../sync/cache-politica.js';

const TIPOS = ['review', 'self', 'pushback', 'chat', 'tool'];
const ESTADOS = ['reserva', 'execucao'];
const MB = 1024 * 1024;
// os mesmos clamps do escalonador (parallelLimit e globalParallelLimit, em review.js)
const LIMITE_POR_CONTA_MAXIMO = 4;
const TETO_TOTAL_MAXIMO = 8;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function estado(engine) {
  if (!objeto(engine.admissao)) engine.admissao = { reservas: new Map(), seq: 0 };
  return engine.admissao;
}

function ativa(engine) {
  return sharedActive((engine.config && engine.config.sync) || {});
}

// Memória livre em MB, ou null quando não dá para medir. `process.availableMemory` existe
// nas versões recentes do Node e responde pelo LIMITE do processo (container, cgroup);
// `os.freemem` responde pela máquina. Vale o MENOR dos dois que se souber.
function memoriaLivreMb() {
  const valores = [];
  try { if (typeof process.availableMemory === 'function') valores.push(process.availableMemory() / MB); } catch { /* ambiente sem a API */ }
  try { const livre = os.freemem(); if (Number.isFinite(livre) && livre > 0) valores.push(livre / MB); } catch { /* sem a métrica do sistema */ }
  const bons = valores.filter((v) => Number.isFinite(v) && v > 0);
  return bons.length ? Math.floor(Math.min(...bons)) : null;
}

// O teto TOTAL que este aparelho se dá: `globalParallelReviews`, o mesmo número que o
// escalonador lê (globalParallelLimit em review.js). 0, ausente ou torto = sem teto total.
//
// Até 30/09/2026 o lado local era `parallelReviews`: o limite POR CONTA virava, calado, o
// total do aparelho assim que o compartilhamento ligava, e o mesmo número queria dizer
// duas coisas conforme uma chave em outra tela. Agora cada número diz uma coisa só.
function tetoTotalLocal(engine) {
  const n = parseInt((engine.config || {}).globalParallelReviews, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(TETO_TOTAL_MAXIMO, n) : null;
}

// `tetoParalelismo` nulo = nenhum dos dois lados opinou: não há teto total, e o que
// limita é o limite por conta do escalonador.
function politicaDoAparelho(engine) {
  const cfg = (engine.config && engine.config.sync) || {};
  const cache = cfg.aceitarAdmin === true ? cachePolitica.lerPolitica() : null;
  const local = { pausado: false, tetoParalelismo: tetoTotalLocal(engine) };
  const autoridade = !!(engine.sync && engine.sync.autoridade && engine.sync.autoridade.fresca);
  return politicaEfetiva(local, cache ? cache.politica : null, { autoridade });
}

function tetoDaPolitica(politica) {
  const n = Number(politica && politica.tetoParalelismo);
  return politica && politica.tetoParalelismo !== null && Number.isFinite(n) && n >= 1 ? n : Infinity;
}

function limitePorConta(engine) {
  const n = parseInt((engine.config || {}).parallelReviews, 10);
  return Number.isFinite(n) ? Math.min(LIMITE_POR_CONTA_MAXIMO, Math.max(1, n)) : 1;
}

// Quantas revisões este aparelho roda ao mesmo tempo, como NÚMERO: é o que a capacidade
// publica (`paralelismo`) e o que a tela mostra. Com teto total, é ele. Sem teto total, é
// o que os limites por conta permitem somados, porque "sem teto" não é um número que o
// agendador do admin nem um aparelho em versão antiga saibam ler.
function totalDoAparelho(engine, politica = politicaDoAparelho(engine)) {
  const teto = tetoDaPolitica(politica);
  if (Number.isFinite(teto)) return teto;
  const contas = typeof engine.accountList === 'function' ? engine.accountList().filter((a) => a && a.user).length : 0;
  return limitePorConta(engine) * Math.max(1, contas);
}

// O aparelho está pausado pelo admin? É a pergunta de todo trabalho que o Farol começa
// SOZINHO e que não passa pela reserva de vaga: a varredura de pushback (abre sessão) e a
// co-assinatura (posta APPROVE). Até 01/10/2026 só a revisão respeitava a pausa, pela
// reserva, e o painel dizia "não pega PR novo" de um aparelho que seguia classificando
// pushback e aprovando em seu nome. Sem compartilhamento não há política de aparelho, e
// nada está pausado. O que você dispara por clique não passa por aqui.
function pausado(engine) {
  return ativa(engine) && politicaDoAparelho(engine).pausado === true;
}

function ocupadas(est) {
  return est.reservas.size;
}

// Presença vencida: o aparelho não consegue nem dizer que está vivo, e admitir aqui é
// prometer trabalho que o conjunto não vai conseguir acompanhar.
function presencaVencida(engine, agora) {
  const rt = engine.sync;
  if (!rt || !rt.lastPresenceAt) return true;
  return agora - rt.lastPresenceAt > SYNC.PRESENCE_TICK_MS * 3;
}

function requisitoDuro(engine, { agora, tipo }) {
  if (!TIPOS.includes(String(tipo || ''))) return 'tipo-desconhecido';
  if (presencaVencida(engine, agora)) return 'presenca-vencida';
  if (rodandoComoRoot()) return 'root';
  const doctor = objeto(engine.doctorInfo) ? engine.doctorInfo : {};
  if (!doctor.claude) return 'provedor-nao-pronto';
  if (politicaDoAparelho(engine).pausado) return 'pausado';
  const livre = memoriaLivreMb();
  if (livre === null) return 'memoria-desconhecida';
  if (livre < SYNC.PISO_MEMORIA_MB) return 'memoria-insuficiente';
  return '';
}

// A exceção de clique atravessa SÓ o teto. Ela não é autorização genérica: piso de
// memória, root, provedor, pausa e presença continuam valendo, e nada fica gravado.
function reservar(engine, { tipo = 'review', clique = false, excecao = false, agora = Date.now(), ref = '', grupo = '' } = {}) {
  const est = estado(engine);
  const impedimento = requisitoDuro(engine, { agora, tipo });
  if (impedimento) return { ok: false, motivo: impedimento };
  // sem teto total, não há vaga a negar aqui: `|| 1` transformava "sem teto" em teto 1
  const teto = tetoDaPolitica(politicaDoAparelho(engine));
  const cheio = ocupadas(est) >= teto;
  if (cheio && !(clique && excecao)) return { ok: false, motivo: 'sem-vaga', teto, ocupadas: ocupadas(est) };
  est.seq += 1;
  const id = `adm${est.seq}`;
  est.reservas.set(id, {
    id, tipo, ref: String(ref || ''), grupo: String(grupo || ''), estado: 'reserva', at: agora, clique: clique === true,
    excecao: cheio, memoriaMb: memoriaLivreMb(), pisoMb: SYNC.PISO_MEMORIA_MB,
  });
  return { ok: true, id, excecao: cheio };
}

function iniciar(engine, id) {
  const reg = estado(engine).reservas.get(String(id || ''));
  if (!reg) return false;
  reg.estado = 'execucao';
  return true;
}

// Liberada em QUALQUER desfecho: sucesso, erro, cancelamento e recusa antes do provedor.
function liberar(engine, id) {
  return estado(engine).reservas.delete(String(id || ''));
}

// Resumo mínimo (CT-ADM): contagem por estado e por tipo, com a atribuição quando houver.
// Nunca conteúdo de chat nem de ferramenta.
function resumo(engine) {
  const est = estado(engine);
  const porEstado = Object.fromEntries(ESTADOS.map((e) => [e, 0]));
  const porTipo = Object.fromEntries(TIPOS.map((t) => [t, 0]));
  const refs = [];
  for (const reg of est.reservas.values()) {
    porEstado[reg.estado] = (porEstado[reg.estado] || 0) + 1;
    porTipo[reg.tipo] = (porTipo[reg.tipo] || 0) + 1;
    if (reg.ref) refs.push(reg.ref);
  }
  return { total: est.reservas.size, porEstado, porTipo, refs };
}

export default { TIPOS, ativa, pausado, reservar, iniciar, liberar, resumo, memoriaLivreMb, politicaDoAparelho, totalDoAparelho };
export { TIPOS, ativa, pausado, reservar, iniciar, liberar, resumo, memoriaLivreMb, politicaDoAparelho, totalDoAparelho };
