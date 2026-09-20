// Soma do consumo do grupo (7.C4b, CT-GRUPO). Puro: sem estado, sem IO, sem rede.
//
// O QUE NÃO SE PROVA COMPLETO NÃO É MOSTRADO COMO COMPLETO. Cada aparelho participante
// entra por dois dados independentes: o rollup diário (`usageDaily/{dev}/{dia}`) e a
// capacidade cifrada, que anuncia a sequência e o dia da última sessão dele e as reservas
// vivas por grupo. Quando os dois não fecham, o orçamento é NÃO VERIFICÁVEL:
//   - leitura que falhou, ou aparelho sem capacidade publicada: `sem-dados`;
//   - rollup fora da forma: `invalido`;
//   - dia anunciado no período sem rollup, ou com sequência menor: `lacuna`;
//   - reserva anunciada por capacidade mais velha que o TTL: `reserva-vencida`.
//
// VALOR DESCONHECIDO É OUTRA COISA: o evento existe e está contado, só o valor não. Ele
// pesa a reserva do custo típico e marca "parcialmente estimado", sem tornar o orçamento
// inverificável.
//
// O PRÓPRIO APARELHO entra pela verdade local, que quem chama já somou: o que ele mesmo
// publicou pode estar atrasado em relação ao disco.
import { SYNC, TEMPOS } from '../constants.js';
import { brasiliaDay } from './keys.js';

const ID_RE = /^[0-9a-f]{32}$/;
const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function naoNegativo(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function diaUtc(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

function formatar(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// O dia é o canônico de Brasília (D7), igual para todos os aparelhos. A semana começa na
// segunda-feira; o mês, no dia 1. Período desconhecido não vira "dia" por omissão.
function inicioDoPeriodo(periodo, agora) {
  const hoje = brasiliaDay(Number(agora));
  if (periodo === 'dia') return hoje;
  if (periodo === 'mes') return `${hoje.slice(0, 8)}01`;
  if (periodo !== 'semana') return null;
  const base = diaUtc(hoje);
  const recuo = (new Date(base).getUTCDay() + 6) % 7;
  return formatar(base - recuo * TEMPOS.DIA_MS);
}

function linhaDoGrupo(v) {
  if (!objeto(v) || !naoNegativo(v.c) || !naoNegativo(v.s) || !naoNegativo(v.d)) return null;
  const linha = { c: v.c, s: v.s, d: v.d };
  if (naoNegativo(v.t)) linha.t = v.t;
  return linha;
}

function sanearRollup(bruto) {
  if (!objeto(bruto) || bruto.v !== 1 || !naoNegativo(bruto.u) || !naoNegativo(bruto.seq) || !objeto(bruto.g)) return null;
  const g = {};
  for (const [id, v] of Object.entries(bruto.g)) {
    const linha = ID_RE.test(id) ? linhaDoGrupo(v) : null;
    if (!linha) return null;
    g[id] = linha;
  }
  return { v: 1, u: bruto.u, seq: bruto.seq, g };
}

function mediana(valores) {
  const bons = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (!bons.length) return 0;
  const meio = Math.floor(bons.length / 2);
  return bons.length % 2 ? bons[meio] : (bons[meio - 1] + bons[meio]) / 2;
}

// Os rollups do período, já saneados; um só fora da forma invalida o aparelho inteiro,
// porque somar só os bons esconderia justamente o dia que não se sabe.
function rollupsDoPeriodo(rollups, inicio) {
  const saida = {};
  for (const [dia, bruto] of Object.entries(rollups)) {
    if (!DIA_RE.test(dia) || dia < inicio) continue;
    const limpo = sanearRollup(bruto);
    if (!limpo) return null;
    saida[dia] = limpo;
  }
  return saida;
}

function lacuna(consumo, doPeriodo, inicio) {
  if (!objeto(consumo) || !DIA_RE.test(String(consumo.dia || '')) || consumo.dia < inicio) return false;
  const doDia = doPeriodo[consumo.dia];
  return !doDia || doDia.seq < Number(consumo.seq);
}

function reservasDe(status, grupoId, agora) {
  const consumo = objeto(status.consumo) ? status.consumo : {};
  const n = objeto(consumo.grupos) ? Number(consumo.grupos[grupoId]) || 0 : 0;
  if (n <= 0) return { n: 0 };
  if (Number(agora) - Number(status.u) > SYNC.RESERVA_GRUPO_TTL_MS) return { motivo: 'reserva-vencida' };
  return { n };
}

// Quanto este aparelho ainda tem reservado no grupo. APOSENTADO é o único caso em que
// "não sei" vira zero em vez de motivo, e só depois do TTL que já existia: a reserva dele
// não é renovada porque ninguém espera mais retrato dele, e manter o motivo para sempre
// era o travamento permanente. Aparelho ATIVO sem retrato fresco continua sendo pendência.
function reservaDoRemoto(r, grupoId, agora) {
  if (!objeto(r.status)) return { n: 0 };
  const reserva = reservasDe(r.status, grupoId, agora);
  if (reserva.motivo && r.aposentado === true) return { n: 0 };
  return reserva;
}

// Um aparelho remoto: devolve o que ele soma, ou o motivo de não dar para saber.
//
// A ordem importa e é esta: leitura que FALHOU é sempre `sem-dados`, aposentado ou não —
// aposentar encerra a exigência de dado NOVO, não perdoa dado que não deu para ler. Dado
// torto também continua invalidando. O que muda para o aposentado é só a ausência de
// retrato vivo: nele, isso é o estado esperado, e o gasto que ele já publicou continua
// somando na janela em vez de sumir.
function avaliarRemoto(r, { grupoId, inicio, agora }) {
  if (!objeto(r.rollups)) return { motivo: 'sem-dados' };
  if (!objeto(r.status) && r.aposentado !== true) return { motivo: 'sem-dados' };
  const doPeriodo = rollupsDoPeriodo(r.rollups, inicio);
  if (!doPeriodo) return { motivo: 'invalido' };
  // sem retrato não dá para detectar lacuna; com ele, a lacuna vale igual para os dois,
  // porque gasto que existe e não foi publicado continua sendo gasto que não se sabe
  if (objeto(r.status) && lacuna(r.status.consumo, doPeriodo, inicio)) return { motivo: 'lacuna' };
  const reserva = reservaDoRemoto(r, grupoId, agora);
  if (reserva.motivo) return { motivo: reserva.motivo };
  const soma = { custo: 0, desconhecidas: 0, reservas: reserva.n, tipicos: [] };
  for (const dia of Object.values(doPeriodo)) {
    const linha = dia.g[grupoId];
    if (!linha) continue;
    soma.custo += linha.c;
    soma.desconhecidas += linha.d;
    if (linha.t !== undefined) soma.tipicos.push(linha.t);
  }
  return soma;
}

function somarGrupo({ grupoId, periodo, agora, local, remotos, tipicoPadrao = 0 }) {
  const inicio = inicioDoPeriodo(periodo, agora);
  const eu = objeto(local) ? local : {};
  const total = { custo: Number(eu.custo) || 0, desconhecidas: Number(eu.desconhecidas) || 0, reservas: Number(eu.reservas) || 0 };
  const tipicos = [Number(eu.tipico) || 0];
  const motivos = [];
  if (!inicio) motivos.push({ dev: '', motivo: 'periodo-desconhecido' });
  const lista = inicio && Array.isArray(remotos) ? remotos.filter(objeto) : [];
  for (const r of lista) {
    const a = avaliarRemoto(r, { grupoId, inicio, agora });
    if (a.motivo) {
      motivos.push({ dev: String(r.dev || ''), motivo: a.motivo });
      continue;
    }
    total.custo += a.custo;
    total.desconhecidas += a.desconhecidas;
    total.reservas += a.reservas;
    tipicos.push(...a.tipicos);
  }
  return {
    verificavel: motivos.length === 0, motivos, inicio: inicio || '', ...total,
    tipico: mediana(tipicos) || Number(tipicoPadrao) || 0,
    parcialmenteEstimado: total.desconhecidas > 0,
  };
}

// O grupo visto como um perfil, para o gate reusar `profileBudgetStatus` sem copiar a
// regra. Período `dia` usa o teto diário; semana e mês usam o total desde o início do
// período, e por isso o custo mora na chave do próprio início.
function perfilDoGrupo(grupo, soma, { hoje, inicio, kind }) {
  const id = `grupo:${grupo.id}`;
  const profile = { id, label: `grupo ${grupo.nome || grupo.id.slice(0, 6)}`, kind };
  let diaDoCusto = inicio;
  if (grupo.periodo === 'dia') {
    profile.budgetDaily = grupo.tetoUsd;
    diaDoCusto = hoje;
  } else {
    profile.budgetTotal = grupo.tetoUsd;
    profile.budgetSince = inicio;
  }
  const byProfileDay = {};
  byProfileDay[`${id}|${diaDoCusto}`] = { costUsd: Number(soma.custo) || 0 };
  const projetadas = (Number(soma.desconhecidas) || 0) + (Number(soma.reservas) || 0);
  return { profile, store: { byProfileDay }, nd: { hoje: projetadas, desde: projetadas } };
}

export default { inicioDoPeriodo, sanearRollup, somarGrupo, perfilDoGrupo };
export { inicioDoPeriodo, sanearRollup, somarGrupo, perfilDoGrupo };
