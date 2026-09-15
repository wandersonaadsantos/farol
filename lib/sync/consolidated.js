// Projeção do consumo de TODOS os aparelhos a partir dos eventos que cada um subiu
// (usageEvents/{deviceId}/{eventId}). Puro: sem estado, sem IO, sem rede. Quem lê o
// banco é lib/engine/sync-usage.js, e ele só lê a árvore do próprio uid.
//
// A janela corta pelo dia canônico de Brasília (D7), recalculado do `at` de cada
// evento: aparelhos em fusos diferentes gravariam dias locais diferentes para o mesmo
// instante, e a soma de "últimos 7 dias" mudaria conforme o aparelho que a pede.
import { TEMPOS } from '../constants.js';
import { brasiliaDay } from './keys.js';

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;
const TOKENS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'];
// mesma régua da aba Consumo (auditoriaDeConsumo): evento sem origem conta como medido
const ORIGENS = { estimado: 'estimado', 'sem-base': 'semBase', desconhecido: 'semBase' };

function objeto(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : null; }

function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function diaDe(p) {
  const at = numero(p.at);
  if (at > 0) return brasiliaDay(at);
  return typeof p.day === 'string' && DIA_RE.test(p.day) ? p.day : '';
}

// days 0 (ou inválido) é tudo. O corte é inclusivo e conta HOJE como o primeiro dos n,
// por isso recua n - 1 dias: é a janela da aba Consumo local (usageDayKeysBack), e
// recuar n somaria um dia civil a mais que ela para a mesma escolha na tela.
function corteDe(days, agoraMs) {
  const d = numero(days);
  return d > 0 ? brasiliaDay(numero(agoraMs) - (d - 1) * TEMPOS.DIA_MS) : '';
}

function zero() { return { sessions: 0, costUsd: 0 }; }

function linhaVazia(deviceId, aparelhos, euDeviceId) {
  const d = objeto(aparelhos[deviceId]) || {};
  const linha = { deviceId, name: typeof d.name === 'string' ? d.name : '', euMesmo: deviceId === euDeviceId, sessions: 0, costUsd: 0 };
  for (const t of TOKENS) linha[t] = 0;
  linha.lastAt = 0;
  return linha;
}

function somarNaLinha(linha, p) {
  linha.sessions += 1;
  linha.costUsd += numero(p.costUsd);
  for (const t of TOKENS) linha[t] += numero(p[t]);
  linha.lastAt = Math.max(linha.lastAt, numero(p.at));
}

function somarNoDia(porDia, dia, p) {
  const s = porDia.get(dia) || { day: dia, costUsd: 0, sessions: 0 };
  s.costUsd += numero(p.costUsd);
  s.sessions += 1;
  porDia.set(dia, s);
}

function somarNoTotal(totals, p) {
  const custo = numero(p.costUsd);
  const origem = totals[ORIGENS[p.costSource] || 'medido'];
  totals.sessions += 1;
  totals.costUsd += custo;
  origem.sessions += 1;
  origem.costUsd += custo;
}

function contar(acc, linha, evento) {
  const p = objeto(evento);
  if (!p) return;
  const dia = diaDe(p);
  if (!dia || (acc.corte && dia < acc.corte)) return;
  somarNaLinha(linha, p);
  somarNoDia(acc.porDia, dia, p);
  somarNoTotal(acc.totals, p);
}

// o próprio aparelho primeiro (é a linha que a pessoa procura), depois quem gastou mais
function ordemDosAparelhos(a, b) {
  if (a.euMesmo !== b.euMesmo) return a.euMesmo ? -1 : 1;
  return b.costUsd - a.costUsd || a.name.localeCompare(b.name) || a.deviceId.localeCompare(b.deviceId);
}

function consolidatedSummary(usageEvents, devices, { days = 0, agoraMs = Date.now(), euDeviceId = '' } = {}) {
  const eventos = objeto(usageEvents) || {};
  const aparelhos = objeto(devices) || {};
  const acc = { corte: corteDe(days, agoraMs), porDia: new Map(), totals: { sessions: 0, costUsd: 0, medido: zero(), estimado: zero(), semBase: zero() } };
  const linhas = new Map();
  // aparelho sem evento na janela aparece zerado: a tabela diz quem existe, não só quem gastou
  for (const id of new Set([...Object.keys(aparelhos), ...Object.keys(eventos)])) linhas.set(id, linhaVazia(id, aparelhos, euDeviceId));
  for (const [deviceId, doAparelho] of Object.entries(eventos)) {
    for (const evento of Object.values(objeto(doAparelho) || {})) contar(acc, linhas.get(deviceId), evento);
  }
  const series = [...acc.porDia.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { devices: [...linhas.values()].sort(ordemDosAparelhos), series, totals: acc.totals };
}

export default { consolidatedSummary };
export { consolidatedSummary };
