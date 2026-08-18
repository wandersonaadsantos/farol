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
const SETTINGS = [
  { key: 'ghUser', def: '', ui: true, san: (v) => String(v).trim() },
  { key: 'owners', def: ['biudtech'], ui: true, san: (v) => listaDeTexto(v) },
  { key: 'accounts', def: [], ui: true, san: (v, _c, f) => f.parseAccounts(v) },
  { key: 'intervalSeconds', def: 300, ui: true, san: (v) => clamp(parseInt(v, 10) || 300, 180, 3600) },
  { key: 'autoReview', def: true, ui: true },
  { key: 'parallelReviews', def: 1, ui: true, san: (v, c, f) => ouAtual(f.sanitizeParallelReviews(v), c.parallelReviews) },
  { key: 'autoApproveAll', def: false, ui: true },
  { key: 'autoApproveContested', def: false, ui: true },
  { key: 'skipPermissions', def: false, ui: true },
  { key: 'soundEnabled', def: true, ui: true },
  { key: 'theme', def: 'dark', ui: true },
  { key: 'autostart', def: false, ui: true },
  { key: 'updateSource', def: '', ui: true },
  { key: 'updateRepo', def: 'wandersonaadsantos/farol', ui: true },
  // default LIGADO: só desliga com `false` explícito, pra chave ausente não virar "desligado"
  { key: 'autoUpdate', def: true, ui: true, san: (v) => v !== false },
  // opt-in: só liga com valor verdadeiro explícito
  { key: 'reReviewResume', def: false, ui: true, san: (v) => !!v },
  { key: 'reviewFast', def: false, ui: true, san: (v) => !!v },
  { key: 'mergeBlockedRepos', def: ['biudtech/biud-frontend'], ui: true, san: (v) => listaDeTexto(v) },
  { key: 'defaultReviewers', def: {}, ui: true, san: (v, _c, f) => f.parseDefaultReviewers(v) },
  { key: 'projectReviewers', def: {}, ui: true, san: (v, _c, f) => f.parseProjectReviewers(v) },
  { key: 'people', def: {}, ui: true, san: (v, _c, f) => f.parsePeople(v) },
  // null do saneador = valor inválido: mantém o que já estava, não derruba pro padrão
  { key: 'reviewModel', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeModel(v), c.reviewModel) },
  { key: 'reviewEffort', def: '', ui: true, san: (v, c, f) => ouAtual(f.sanitizeEffort(v), c.reviewEffort) },
  { key: 'autoPushback', def: true, ui: true, san: (v) => !!v },
  { key: 'debugSpawns', def: false, ui: true, san: (v) => !!v },
  { key: 'claudeConfigDir', def: '', ui: true, san: (v, _c, f) => f.sanitizeClaudeDir(v) },
  { key: 'claudeProfiles', def: [], ui: true, san: (v, _c, f) => f.normalizeClaudeProfiles(v) },
  { key: 'claudeProfileId', def: '', ui: true, san: (v, _c, f) => f.normalizeClaudeProfileId(v) },
  // porta: existe no config e NÃO vem da tela. Trocar porta em runtime derrubaria o
  // servidor que respondeu o pedido, então é edição de arquivo, com reinício.
  { key: 'port', def: null, ui: false },
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

// Sanea UM valor pela tabela. `fns` traz os parsers de lib/parse.js.
function sanear(key, valor, cfgAtual, fns) {
  const s = SETTINGS.find(x => x.key === key);
  if (!s || !s.san) return valor;
  return s.san(valor, cfgAtual || {}, fns || {});
}

export default { SETTINGS, EDITAVEIS, defaults, sanear };
export { SETTINGS, EDITAVEIS, defaults, sanear };
