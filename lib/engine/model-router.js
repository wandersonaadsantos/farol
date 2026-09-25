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
//
// O CONTEXTO vem antes do tamanho (25/09/2026, pedido do dono: "o modo auto precisa ser
// capaz de usar o opus tb dependendo do contexto do PR"). Repositório crítico, caminho
// sensível ou PR muito grande sobem para o Opus (AUTO_POR_CONTEXTO); o primeiro que vale,
// nessa ordem, é o que o rótulo cita. Até aqui este arquivo dizia o contrário ("Opus no
// automático custaria o contrário do objetivo do modo auto"), e a decisão foi revogada.
// Spec: docs/superpowers/specs/2026-09-25-auto-com-opus-design.md.
import { autoNaFaixa, selecaoClaude, AUTO_POR_FAIXA, AUTO_POR_CONTEXTO } from '../modelos.js';
import { patternToRegex } from './codeowners.js';

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
  // PR grande: esforço alto no meio da tabela. Com o gatilho "PR muito grande" ligado (o
  // padrão), ele nem chega aqui: o contexto já subiu para o Opus.
  return 'grande';
}

const ORIGEM_DA_FAIXA = { semMetrica: 'auto-sem-metrica', pequeno: 'auto-pequeno', medio: 'auto-medio', grande: 'auto-grande' };
const ORIGEM_DO_CONTEXTO = 'auto-contexto';

// A lista inicial de caminhos sensíveis, no estilo do CODEOWNERS. É proposta do Farol e o
// dono ajusta; ausente na config é esta lista, e lista vazia desliga o gatilho.
const CAMINHOS_SENSIVEIS_PADRAO = Object.freeze([
  'k8s/', 'helm/', 'charts/', 'terraform/', '*.tf', 'Dockerfile', 'docker-compose*.yml', '.github/workflows/',
  'auth/', 'security/', '**/*auth*', '**/*secret*', '**/*token*',
  'migrations/', '*.sql',
  'payment/', 'payments/', 'billing/',
]);
const TETO_DE_CAMINHOS = 100;
const TETO_DO_PADRAO = 200;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Saneador da config `autoOpus` (lib/settings.js o recebe por injeção). Ausente é o padrão;
// entrada torta é DESCARTADA, nunca convertida em outra coisa.
function parseAutoOpus(v) {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const repos = Array.isArray(o.reposCriticos) ? o.reposCriticos : [];
  const caminhos = Array.isArray(o.caminhosSensiveis) ? o.caminhosSensiveis : CAMINHOS_SENSIVEIS_PADRAO;
  return {
    reposCriticos: [...new Set(repos.map((r) => String(r).trim().toLowerCase()).filter((r) => REPO.test(r)))],
    caminhosSensiveis: [...new Set(caminhos.map((c) => String(c).trim()).filter((c) => c && !c.startsWith('#') && c.length <= TETO_DO_PADRAO))].slice(0, TETO_DE_CAMINHOS),
    prMuitoGrande: Object.hasOwn(o, 'prMuitoGrande') ? o.prMuitoGrande === true : true,
  };
}

// O primeiro gatilho que vale, na ordem repositório, caminho, tamanho; null quando nenhum.
// Sem métrica, caminho e tamanho não são avaliáveis: só o repositório pode valer.
function gatilhoDeContexto(metrics, config, ctx) {
  const regras = parseAutoOpus(config.autoOpus);
  const repo = String((ctx && ctx.repo) || '').trim().toLowerCase();
  if (repo && regras.reposCriticos.includes(repo)) return { tipo: 'repo', evidencia: repo };
  const arquivos = metrics && Array.isArray(metrics.files) ? metrics.files : [];
  const padroes = regras.caminhosSensiveis.map(patternToRegex).filter(Boolean);
  for (const f of arquivos) {
    const caminho = String((f && f.path) || '').replace(/^\/+/, '');
    if (caminho && padroes.some((re) => re.test(caminho))) return { tipo: 'caminho', evidencia: caminho };
  }
  if (regras.prMuitoGrande && faixaDe(metrics) === 'grande') {
    return { tipo: 'tamanho', evidencia: `${Number(metrics.lines) || 0} linhas, ${Number(metrics.changedFiles) || 0} arquivos` };
  }
  return null;
}

// metrics: { lines, changedFiles, files? } | null (mesma forma de prMetrics/metricsLeitura).
// ctx: { repo } do PR, para o gatilho de repositório crítico.
// Devolve sempre { model, effort, fast } com valores de allowlist do Claude; no contexto,
// também o `gatilho` que o rótulo cita.
function escolheModelo(metrics, config = {}, ctx = {}) {
  if (!isAutoModel(config.reviewModel)) {
    return {
      model: String(config.reviewModel || '').trim().toLowerCase() || '',
      effort: String(config.reviewEffort || '').trim().toLowerCase() || '',
      fast: !!config.reviewFast,
      origem: 'config',
    };
  }
  const gatilho = gatilhoDeContexto(metrics, config, ctx);
  if (gatilho) return { ...autoNaFaixa('contexto', config), origem: ORIGEM_DO_CONTEXTO, gatilho };
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

// O que o contexto diz no rótulo: qual gatilho, com a evidência curta (o repositório, o
// arquivo que casou, ou o tamanho). O modelo sai do catálogo, como nas faixas.
const DESCRICAO_DO_GATILHO = {
  repo: (e) => `repositório crítico ${e}`,
  caminho: (e) => `caminho sensível ${e}`,
  tamanho: (e) => `PR muito grande (${e})`,
};

function nomeDaSelecao(selecao) {
  const s = selecaoClaude(selecao);
  return ((s && (s.nome || s.valor)) || '').toLowerCase();
}

function rotuloOrigem(origem, gatilho = null) {
  if (origem === 'config') return 'modelo fixo da configuração';
  if (origem === ORIGEM_DO_CONTEXTO) {
    const descreve = gatilho && DESCRICAO_DO_GATILHO[gatilho.tipo];
    const motivo = descreve ? descreve(gatilho.evidencia) : 'contexto do PR';
    return `auto: ${motivo}, ${nomeDaSelecao(AUTO_POR_CONTEXTO.selecao)}`;
  }
  const faixa = Object.keys(ORIGEM_DA_FAIXA).find((f) => ORIGEM_DA_FAIXA[f] === origem);
  if (!faixa) return origem || '';
  const f = AUTO_POR_FAIXA[faixa];
  const nome = nomeDaSelecao(f.selecao);
  return `auto: ${DESCRICAO_DA_FAIXA[faixa].replace('{m}', descricaoDoModelo(f, nome))}`;
}

export default {
  isAutoModel, escolheModelo, rotuloOrigem, parseAutoOpus, CAMINHOS_SENSIVEIS_PADRAO,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
};
export {
  isAutoModel, escolheModelo, rotuloOrigem, parseAutoOpus, CAMINHOS_SENSIVEIS_PADRAO,
  PEQUENO_LINHAS, PEQUENO_ARQUIVOS, MEDIO_LINHAS, MEDIO_ARQUIVOS,
};
