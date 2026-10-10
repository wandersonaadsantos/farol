// Quanto uma revisão costuma durar, pelo histórico do próprio aparelho (09/10/2026).
//
// A barra do cartão "Analisando agora" já foi duas coisas erradas: contagem de linhas do
// feed numa curva que parava em 90% e pulava para 100%, e depois uma barra indeterminada
// que só dizia "algo está rodando". O app SABE quanto uma revisão costuma levar: toda
// decisão grava `stages.totalMs` (etapas-revisao.js), e medido em 09/10/2026 eram 980
// revisões com mediana de 5,7 min (p10 2 min, p90 12 min). Este módulo transforma esse
// histórico num tempo típico, e a tela transforma tempo decorrido sobre tempo típico em
// porcentagem (progressoDaSessao, ui/pure/sessao.js).
//
// PURO na parte que decide (tempoTipico, etapasComTamanho recebe tudo pronto). O tamanho
// do PR entra nas etapas da decisão para que as próximas estimativas comparem PR de
// tamanho parecido; decisão gravada antes disto não tem tamanho e só conta na mediana geral.
import { stageSummaryFrom } from './etapas-revisao.js';

// faixas de arquivos alterados (limite superior inclusivo). Poucas e largas de propósito:
// faixa estreita demais nunca junta amostra suficiente e a estimativa cai sempre na geral.
const FAIXAS = [3, 10, 30, Infinity];
// abaixo disto a mediana é ruído, e a tela não promete prazo
const MIN_AMOSTRAS = 5;
// só as revisões mais recentes: modelo, protocolo e máquina mudam com o tempo
const JANELA = 300;
// sessão de stub, cancelada no começo ou retomada de checkpoint não representa revisão
const MIN_TOTAL_MS = 30000;

function faixaDe(arquivos) {
  const n = Number(arquivos);
  if (!Number.isFinite(n) || n <= 0) return -1;
  return FAIXAS.findIndex(lim => n <= lim);
}

function mediana(xs) {
  const v = [...xs].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : Math.round((v[m - 1] + v[m]) / 2);
}

// PURA. `resolved` é o histórico de decisões (mais recente primeiro, como o engine guarda).
// Devolve { tipicoMs, amostras, base: 'tamanho' | 'geral' } ou null sem amostra suficiente.
function tempoTipico(resolved, arquivos) {
  const medidas = [];
  for (const d of resolved || []) {
    const st = d && d.stages;
    if (!st || !(st.totalMs >= MIN_TOTAL_MS)) continue;
    medidas.push(st);
    if (medidas.length >= JANELA) break;
  }
  const faixa = faixaDe(arquivos);
  const doTamanho = faixa < 0 ? [] : medidas.filter(st => faixaDe(st.arquivos) === faixa);
  if (doTamanho.length >= MIN_AMOSTRAS) {
    return { tipicoMs: mediana(doTamanho.map(st => st.totalMs)), amostras: doTamanho.length, base: 'tamanho' };
  }
  if (medidas.length >= MIN_AMOSTRAS) {
    return { tipicoMs: mediana(medidas.map(st => st.totalMs)), amostras: medidas.length, base: 'geral' };
  }
  return null;
}

// a estimativa da revisão que está começando, gravada no registro da sessão ativa (que a
// projeção leva à tela). Falha de medição do tamanho cai na mediana geral, nunca em erro.
function anotarEstimativa(engine, id, metrics) {
  const rec = engine.activeReviews && engine.activeReviews.get(id);
  if (!rec) return;
  const arquivos = metrics && metrics.changedFiles;
  rec.estimativa = tempoTipico(engine.decisions && engine.decisions.resolved, arquivos);
  if (arquivos) rec.arquivosPr = arquivos;
}

// as etapas da sessão que terminou, com o tamanho do PR junto: é o que a próxima
// estimativa usa para comparar PR de tamanho parecido
function etapasComTamanho(engine, id, metrics) {
  const st = stageSummaryFrom(engine.activity.get(id), (engine.activeReviews.get(id) || {}).startedAt, Date.now());
  if (st && metrics && metrics.changedFiles) {
    st.arquivos = metrics.changedFiles;
    st.linhas = metrics.lines || 0;
  }
  return st;
}

const estimativaMod = { FAIXAS, MIN_AMOSTRAS, faixaDe, tempoTipico, anotarEstimativa, etapasComTamanho };
export default estimativaMod;
export { FAIXAS, MIN_AMOSTRAS, faixaDe, tempoTipico, anotarEstimativa, etapasComTamanho };
