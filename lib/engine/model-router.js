// Roteador de modelo por custo-benefício (PURA). Quando config.reviewModel === 'auto',
// a revisão headless não manda 'auto' pro CLI: escolhe haiku/sonnet (e esforço/fast)
// a partir das métricas do PR, que o Farol já mediu pra fan-out.
//
// Por que o Farol decide, e não o openrouter/auto: a documentação do OpenRouter diz
// que o auto otimiza adequação à tarefa, não o custo. Aqui a entrada é tamanho do
// diff (prova local), não classificação de prompt. Falta de métrica NUNCA cai em
// haiku: degrada pra sonnet, o meio da tabela, que é o lado seguro.

// Limiares alinhados ao fan-out (lib/engine/fanout.js): abaixo deles o PR é "cabe
// numa sessão"; acima, a cobertura já custa caro e o modelo barato demais falha
// no envelope com mais frequência (retry pago).
const PEQUENO_LINHAS = 200;
const PEQUENO_ARQUIVOS = 5;
const MEDIO_LINHAS = 1000;
const MEDIO_ARQUIVOS = 20;

function isAutoModel(v) {
  return String(v == null ? '' : v).trim().toLowerCase() === 'auto';
}

// metrics: { lines, changedFiles } | null (mesma forma de prMetrics/metricsLeitura).
// Devolve sempre { model, effort, fast } com valores de allowlist do Claude.
function escolheModelo(metrics, config = {}) {
  if (!isAutoModel(config.reviewModel)) {
    return {
      model: String(config.reviewModel || '').trim().toLowerCase() || '',
      effort: String(config.reviewEffort || '').trim().toLowerCase() || '',
      fast: !!config.reviewFast,
      origem: 'config',
    };
  }
  const lines = Number(metrics && metrics.lines) || 0;
  const files = Number(metrics && metrics.changedFiles) || 0;
  const medido = !!(metrics && (Number.isFinite(metrics.lines) || Number.isFinite(metrics.changedFiles)));

  if (!medido) {
    return { model: 'sonnet', effort: 'medium', fast: false, origem: 'auto-sem-metrica' };
  }
  if (lines < PEQUENO_LINHAS && files < PEQUENO_ARQUIVOS) {
    return { model: 'haiku', effort: '', fast: true, origem: 'auto-pequeno' };
  }
  if (lines < MEDIO_LINHAS && files < MEDIO_ARQUIVOS) {
    return { model: 'sonnet', effort: 'medium', fast: !!config.reviewFast, origem: 'auto-medio' };
  }
  // PR grande: sonnet com esforço alto. Opus no automático custaria o contrário
  // do objetivo do modo auto; quem quer Opus pinado escolhe opus no select.
  return { model: 'sonnet', effort: 'high', fast: false, origem: 'auto-grande' };
}

function rotuloOrigem(origem) {
  const mapa = {
    config: 'modelo fixo da configuração',
    'auto-sem-metrica': 'auto: métrica indisponível, sonnet por segurança',
    'auto-pequeno': 'auto: PR pequeno, haiku + modo rápido',
    'auto-medio': 'auto: PR médio, sonnet',
    'auto-grande': 'auto: PR grande, sonnet com esforço alto',
  };
  return mapa[origem] || origem || '';
}

export {
  isAutoModel, escolheModelo, rotuloOrigem,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
};
export default {
  isAutoModel, escolheModelo, rotuloOrigem,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
};
