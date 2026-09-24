// Roteador de modelo por custo-benefício (PURA). Quando config.reviewModel === 'auto',
// a revisão headless não manda 'auto' pro CLI: escolhe o modelo (e esforço/fast) a partir
// das métricas do PR, que o Farol já mediu pra fan-out.
//
// Por que o Farol decide, e não o openrouter/auto: a documentação do OpenRouter diz
// que o auto otimiza adequação à tarefa, não o custo. Aqui a entrada é tamanho do
// diff (prova local), não classificação de prompt. Falta de métrica NUNCA cai no mais
// leve: degrada pro meio da tabela, que é o lado seguro.
//
// O QUE cada faixa usa mora no catálogo (lib/modelos.js, AUTO_POR_FAIXA), apontando para as
// MESMAS seleções que a tela oferece: aqui fica só o que é pequeno, médio e grande. Até
// 24/09/2026 este arquivo escrevia 'haiku' e 'sonnet' à mão, e mudar o que uma seleção
// significa não mudava o Auto junto.
import { autoNaFaixa, selecaoClaude, AUTO_POR_FAIXA } from '../modelos.js';

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

// A faixa de tamanho do PR. Sem métrica é faixa própria, que nunca cai no mais leve.
function faixaDe(metrics) {
  const medido = !!(metrics && (Number.isFinite(metrics.lines) || Number.isFinite(metrics.changedFiles)));
  if (!medido) return 'semMetrica';
  const lines = Number(metrics.lines) || 0;
  const files = Number(metrics.changedFiles) || 0;
  if (lines < PEQUENO_LINHAS && files < PEQUENO_ARQUIVOS) return 'pequeno';
  if (lines < MEDIO_LINHAS && files < MEDIO_ARQUIVOS) return 'medio';
  // PR grande: esforço alto no meio da tabela. Opus no automático custaria o contrário
  // do objetivo do modo auto; quem quer Opus fixo escolhe a seleção Opus.
  return 'grande';
}

const ORIGEM_DA_FAIXA = { semMetrica: 'auto-sem-metrica', pequeno: 'auto-pequeno', medio: 'auto-medio', grande: 'auto-grande' };

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
  const faixa = faixaDe(metrics);
  return { ...autoNaFaixa(faixa, config), origem: ORIGEM_DA_FAIXA[faixa] };
}

// O texto de cada origem nomeia o modelo pela seleção do catálogo, entao nunca diz um
// modelo que a faixa deixou de usar.
const DESCRICAO_DA_FAIXA = {
  semMetrica: 'métrica indisponível, {m} por segurança',
  pequeno: 'PR pequeno, {m}',
  medio: 'PR médio, {m}',
  grande: 'PR grande, {m}',
};

// "haiku + modo rápido", "sonnet com esforço alto" ou só o nome
function descricaoDoModelo(f, nome) {
  if (f.fast === true) return `${nome} + modo rápido`;
  if (f.effort === 'high') return `${nome} com esforço alto`;
  return nome;
}

function rotuloOrigem(origem) {
  if (origem === 'config') return 'modelo fixo da configuração';
  const faixa = Object.keys(ORIGEM_DA_FAIXA).find((f) => ORIGEM_DA_FAIXA[f] === origem);
  if (!faixa) return origem || '';
  const f = AUTO_POR_FAIXA[faixa];
  const s = selecaoClaude(f.selecao);
  const nome = ((s && (s.nome || s.valor)) || '').toLowerCase();
  return `auto: ${DESCRICAO_DA_FAIXA[faixa].replace('{m}', descricaoDoModelo(f, nome))}`;
}

export default {
  isAutoModel, escolheModelo, rotuloOrigem,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
};
export {
  isAutoModel, escolheModelo, rotuloOrigem,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
};
