import { INTERVENTION_KINDS, clockMinutes } from '../ui/pure/interventions.js';

// A tabela ÚNICA das preferências do Farol: chave, padrão, se a tela edita, e como
// sanear o valor que chega.
//
// Por que existe. Até 18/08/2026 uma preferência morava em CINCO lugares: o
// `DEFAULTS` do server.js, a lista `allowed` do updateSettings, o `if (k === 'x')`
// do saneamento, o `settingsMap` do ui/app.js e a linha de leitura no
// renderSettings. Esquecer UM deles não quebrava nada visível: o `updateSettings`
// descartava a chave desconhecida em silêncio e devolvia `undefined`, a tela mostrava
// "Configuração salva." do mesmo jeito, e a preferência simplesmente não persistia.
// Foi a queixa que originou este arquivo ("toda vez que ocorre um update estou
// perdendo tudo").
//
// Agora os três primeiros saem daqui. Os dois da UI não podem importar este arquivo
// (o servidor estático só serve `ui/`, ver lib/http-server.js), então a ponte é um
// TESTE que cruza o `settingsMap` da tela com esta tabela: esquecer aqui quebra a
// suíte em vez de sumir com a preferência de alguém.
//
// Puro: sem estado, sem IO, sem rede. Os saneadores que dependem de parsers vivem em
// lib/parse.js e entram por injeção (`fns`), pra este arquivo não puxar o mundo.

// ui: true  = a tela edita e o updateSettings aceita
// ui: false = existe no config, mas não vem da tela (só de código ou do arquivo)
// san: (valor, cfgAtual, fns) -> valor saneado. Ausente = entra como veio.
function finiteNumber(v, min, max, fallback) {
  if (typeof v !== 'number' && typeof v !== 'string') return fallback;
  const number = Number(v);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback;
}
function voiceEventList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(x => INTERVENTION_KINDS.includes(x)))];
}
function validClock(v, fallback) { return clockMinutes(v) !== null ? v : fallback; }
function contextMode(value) {
  if (['off', 'observe', 'assist'].includes(value)) return value;
  return 'off';
}

const SETTINGS = [
  { key: 'ghUser', def: '', ui: true, san: (v) => String(v).trim() },
  { key: 'owners', def: ['biudtech'], ui: true, san: (v) => listaDeTexto(v) },
  { key: 'accounts', def: [], ui: true, san: (v, _c, f) => f.parseAccounts(v) },
  { key: 'jiraSites', def: [], ui: true, san: (v, _c, f) => f.parseJiraSites(v) },
  // opt-in: nasce desligada e só liga com objeto explícito; o saneador vive em
  // lib/sync/config.js e entra por injeção como os outros parsers
  { key: 'sync', def: { enabled: false, coordination: { enabled: false }, consolidation: { enabled: false }, shared: { enabled: false }, distribution: { enabled: false }, aceitarAdmin: false, deviceName: '', apiKey: '', databaseUrl: '', projectId: '' }, ui: true, san: (v, c, f) => f.parseSyncConfig(v, c.sync) },
  { key: 'intervalSeconds', def: 300, ui: true, san: (v) => clamp(parseInt(v, 10) || 300, 180, 3600) },
  // `autoReview` e `autoApproveAll` saíram desta tabela em 30/09/2026: a política de
  // revisar e de aprovar mora só na conta, e as duas chaves viraram entrada da migração
  // (lib/engine/contas-migracao.js). Não são preferência, não têm padrão e a tela não as edita.
  // Limite POR CONTA, sempre: com ou sem o compartilhamento entre aparelhos ligado.
  { key: 'parallelReviews', def: 1, ui: true, san: (v, c, f) => ouAtual(f.sanitizeParallelReviews(v), c.parallelReviews) },
  // Teto TOTAL deste aparelho: revisoes simultaneas somando TODAS as contas (Politica 3 da
  // spec 2026-09-10-justica-de-fila-entre-orgs). 0 = sem teto total, e e o default: o unico
  // limite e o por conta. So e seguro ligar porque o rodizio de org decide quem ocupa cada
  // vaga; sem ele, um teto total concentraria. E o MESMO numero que o admin define a
  // distancia (`tetoParalelismo` da politica do aparelho): vale o menor dos dois.
  { key: 'globalParallelReviews', def: 0, ui: true, san: (v, c, f) => ouAtual(f.sanitizeGlobalParallelReviews(v), c.globalParallelReviews) },
  { key: 'skipPermissions', def: false, ui: true },
  { key: 'soundEnabled', def: true, ui: true },
  { key: 'voiceEnabled', def: false, ui: true, san: v => v === true },
  { key: 'voiceEvents', def: ['decision', 'access', 'failure', 'operational'], ui: true,
    san: voiceEventList },
  { key: 'voiceVolume', def: 50, ui: true, san: v => finiteNumber(v, 0, 100, 50) },
  { key: 'voiceQuietEnabled', def: false, ui: true, san: v => v === true },
  { key: 'voiceQuietStart', def: '22:00', ui: true, san: v => validClock(v, '22:00') },
  { key: 'voiceQuietEnd', def: '08:00', ui: true, san: v => validClock(v, '08:00') },
  { key: 'interventionReminderMinutes', def: 0, ui: true, san: v => finiteNumber(v, 0, 1440, 0) },
  // opt-in: a aba e a coleta de Destaques do time só existem quando a pessoa
  // escolhe habilitá-las. O arquivo antigo fica preservado enquanto desligado.
  { key: 'teamHighlights', def: false, ui: true, san: (v) => !!v },
  // opt-in: Entregas consulta PRs mergeados via gh search. Desligada, nem a aba
  // nem a consulta existem; não usa IA, mas evita rede/processamento sem uso.
  { key: 'deliveriesEnabled', def: false, ui: true, san: (v) => !!v },
  { key: 'theme', def: 'dark', ui: true },
  { key: 'autostart', def: false, ui: true },
  { key: 'updateSource', def: '', ui: true },
  { key: 'updateRepo', def: 'wandersonaadsantos/farol', ui: true },
  // default LIGADO: só desliga com `false` explícito, pra chave ausente não virar "desligado"
  { key: 'autoUpdate', def: true, ui: true, san: (v) => v !== false },
  // opt-in: só liga com valor verdadeiro explícito
  { key: 'reviewSingleOutput', def: false, ui: false, san: (v) => v === true },
  { key: 'reviewRoundsMode', def: 'observe', ui: false, san: (v) => v === 'enforce' ? 'enforce' : 'observe' },
  // Seleção nova depende de avaliação de decisões: off preserva a análise anterior;
  // observe mede recuperação sem injetar contexto; assist é ativação controlada.
  { key: 'reviewContextMode', def: 'off', ui: false, san: contextMode },
  { key: 'reviewNavigationFacts', def: false, ui: false, omitirPadraoAoGravar: true, san: v => v === true },
  { key: 'reviewBatchedReads', def: false, ui: false, omitirPadraoAoGravar: true, san: v => v === true },
  { key: 'reviewAgentOwnership', def: false, ui: false, omitirPadraoAoGravar: true, san: v => v === true },
  { key: 'reviewContextTokens', def: 3000, ui: false, san: v => finiteNumber(v, 256, 12000, 3000) },
  { key: 'reviewContextLimits', def: {}, ui: false },
  { key: 'sourceCacheLimits', def: {}, ui: false },
  { key: 'auditSampling', def: { enabled: false, accounts: [], dailyLimit: 0, budgetUsd: 0, reserveUsd: 0 }, ui: false },
  { key: 'quotaReservations', def: {}, ui: false },
  { key: 'reReviewResume', def: false, ui: true, san: (v) => !!v },
  { key: 'reviewFast', def: false, ui: true, san: (v) => !!v },
  // co-assinar: aprovar em seu nome quando quem pegou o PR aprovou, sem abrir
  // sessão. Opt-in por decisão: você endossa uma revisão que não fez.
  { key: 'coAssinarReview', def: false, ui: true, san: (v) => !!v },
  // Revisar junto e começar antes do CI continuam escolhas de agendamento.
  { key: 'revisarComOutrosRevisando', def: false, ui: true, san: (v) => v === true },
  { key: 'aguardarCiParaRevisar', def: false, ui: true, san: (v) => v === true },
  // Campo legado: nenhuma configuração pode dispensar os checks necessários.
  { key: 'aguardarCiParaAprovar', def: true, ui: false, san: () => true },
  { key: 'mergeBlockedRepos', def: ['biudtech/biud-frontend'], ui: true, san: (v) => listaDeTexto(v) },
  { key: 'defaultReviewers', def: {}, ui: true, san: (v, _c, f) => f.parseDefaultReviewers(v) },
  { key: 'projectReviewers', def: {}, ui: true, san: (v, _c, f) => f.parseProjectReviewers(v) },
  { key: 'people', def: {}, ui: true, san: (v, _c, f) => f.parsePeople(v) },
  // null do saneador = valor inválido: mantém o que já estava, não derruba pro padrão
  { key: 'reviewModel', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeClaudeModel(v), c.reviewModel) },
  { key: 'reviewEffort', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeClaudeEffort(v), c.reviewEffort) },
  // Quando o Auto sobe para o Opus pelo contexto do PR (25/09/2026). `null` é a lista inicial
  // do roteador, que é quem saneia a cada leitura (parseAutoOpus em
  // lib/engine/model-router.js): por isso não há `san` aqui. Por enquanto só do arquivo; a
  // tela vem do Claude Design, e aí a chave passa a `ui: true` com o saneador injetado.
  { key: 'autoOpus', def: null, ui: false, omitirPadraoAoGravar: true },
  { key: 'codexReviewModel', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeCodexModel(v), c.codexReviewModel) },
  // Origem da última escolha: preserva IDs explícitos quando a equivalência não é bijetiva.
  { key: 'modelSelectionProvider', def: '', ui: false },
  { key: 'codexReviewEffort', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeCodexEffort(v), c.codexReviewEffort) },
  // Antigravity CLI (lib/agy/): o padrão é o que a medição recomendou, o Gemini Flash High
  // sem subagente (docs/superpowers/specs/2026-10-20-agy-provedor.md, seção 8). Vazio também
  // roda nele: o `agy` nunca sai sem `--model`, porque o padrão da conta pode ser outro.
  { key: 'agyReviewModel', def: 'gemini-3.8-flash-high', ui: true, san: (v, c, f) => ouAtual(f.sanitizeAgyModel(v), c.agyReviewModel) },
  { key: 'agyReviewEffort', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeAgyEffort(v), c.agyReviewEffort) },
  { key: 'autoPushback', def: true, ui: true, san: (v) => !!v },
  { key: 'debugSpawns', def: false, ui: true, san: (v) => !!v },
  { key: 'claudeConfigDir', def: '', ui: true, san: (v, _c, f) => f.sanitizeClaudeDir(v) },
  { key: 'claudeProfiles', def: [], ui: true, san: (v, _c, f) => f.normalizeClaudeProfiles(v) },
  { key: 'claudeProfileId', def: '', ui: true, san: (v, _c, f) => f.normalizeClaudeProfileId(v) },
  // Cadeia de perfis (20/10/2026, lib/engine/cadeia-perfis.js): a ordem em que as assinaturas
  // pagam a revisão. Aqui só a forma; quem confere contra os perfis salvos e deriva o
  // claudeProfileId é o reconciliar, depois de aplicar o patch inteiro. null = config de antes
  // da cadeia, que o reconciliar migra a partir do perfil padrão.
  { key: 'cadeiaPerfis', def: null, ui: true, san: (v, _c, f) => f.normalizarCadeia(v) },
  // Marcador explícito das migrações de config que não podem rodar duas vezes (30/09/2026,
  // lib/engine/contas-migracao.js): 1 = o teto total de quem já tinha o compartilhamento
  // ligado foi preservado. Não vem da tela nem do POST /api/settings.
  { key: 'esquemaConfig', def: 0, ui: false },
  // porta: existe no config e NÃO vem da tela. Trocar porta em runtime derrubaria o
  // servidor que respondeu o pedido, então é edição de arquivo, com reinício.
  { key: 'port', def: null, ui: false },
  // Autenticação da API local (A4): 'exigir' liga a exigência em qualquer ambiente.
  // NÃO vem da tela nem do POST /api/settings, porque uma página sem credencial não pode
  // ligar nem desligar a própria proteção. Edição de arquivo, com reinício. No modo
  // celular a exigência não depende desta chave (lib/local-auth/modo.js).
  // `omitirPadraoAoGravar`: no padrão a chave não é escrita no config.json, para quem
  // nunca ligou o recurso não ganhar chave nova por causa dele (CT-COMPAT, item a).
  { key: 'localAuth', def: '', ui: false, omitirPadraoAoGravar: true },
];

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }
function ouAtual(saneado, atual) { return saneado === null ? atual : saneado; }
function listaDeTexto(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v).split(/[,;\s]+/).filter(Boolean);
}

// Padrões prontos pro construtor. `port` sai daqui com o valor injetado, porque o
// número mora em lib/constants.js e este arquivo não importa nada.
function defaults(port) {
  const o = {};
  for (const s of SETTINGS) o[s.key] = s.def;
  o.port = port;
  return o;
}

// As chaves que o updateSettings aceita. Quem não está aqui é reportado como
// ignorada, nunca descartada em silêncio.
const EDITAVEIS = new Set(SETTINGS.filter(s => s.ui).map(s => s.key));

// A config como ela vai para o disco. O saveConfig grava o objeto INTEIRO a cada
// preferência salva, então chave marcada com `omitirPadraoAoGravar` some do arquivo
// enquanto estiver no padrão: recurso não habilitado não deixa rastro no config.json de
// ninguém (CT-COMPAT, item a). Quem editou o arquivo para ligar continua gravado.
function paraGravar(config) {
  const o = { ...(config || {}) };
  for (const s of SETTINGS) {
    if (s.omitirPadraoAoGravar && o[s.key] === s.def) delete o[s.key];
  }
  return o;
}

// Sanea UM valor pela tabela. `fns` traz os parsers de lib/parse.js.
function sanear(key, valor, cfgAtual, fns) {
  const s = SETTINGS.find(x => x.key === key);
  if (!s || !s.san) return valor;
  return s.san(valor, cfgAtual || {}, fns || {});
}

export default { SETTINGS, EDITAVEIS, defaults, sanear, paraGravar };
export { SETTINGS, EDITAVEIS, defaults, sanear, paraGravar };
