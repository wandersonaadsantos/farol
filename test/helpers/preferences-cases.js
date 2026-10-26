// Domínios e exemplos concretos das preferências para os testes de transferência.
import { SETTINGS, defaults } from '../../lib/settings.js';
import { MODEL_ALIASES, EFFORT_LEVELS, CODEX_EFFORT_LEVELS, AGY_EFFORT_LEVELS } from '../../lib/parse.js';
import { catalogoParaTela } from '../../lib/modelos.js';
import { PAPEL_LEVELS, DOMAINS, DOMAIN_LEVELS } from '../../lib/taxonomy.js';
const account = { user: 'dev', owners: ['acme'], autoReview: false, onClean: 'wait', onCaveats: 'wait', onReject: 'wait' };
const profiles = [
  { id: 'p', label: 'Codex', kind: 'codex' }, { id: 'q', label: 'Claude', dir: 'C:/Farol/perfil' },
  { id: 'maquina', label: 'Máquina', kind: 'maquina' }, { id: 'agy', label: 'Google', kind: 'agy', email: 'dev@example.invalid' },
  { id: 'api', label: 'API', kind: 'apikey', apiKey: 'synthetic-private-api', baseUrl: 'https://api.example.invalid' },
  { id: 'router', label: 'Router', kind: 'openrouter', apiKey: 'synthetic-private-router', baseUrl: 'https://openrouter.ai/api' },
];
const sync = {
  enabled: false, coordination: { enabled: false }, consolidation: { enabled: false }, shared: { enabled: false },
  distribution: { enabled: false }, aceitarAdmin: false, deviceName: 'Desktop', apiKey: 'synthetic-sync-key',
  databaseUrl: 'https://demo.firebaseio.com', projectId: 'demo',
};
function baseConfig() {
  return { ...structuredClone(defaults(0)), esquemaConfig: 1, ghUser: 'dev', owners: ['acme'], accounts: [structuredClone(account)],
    claudeProfiles: structuredClone(profiles), cadeiaPerfis: profiles.map(p => ({ id: p.id, ativo: false })), sync: structuredClone(sync) };
}
const stripKey = ({ apiKey: _key, ...value }) => value;
function syncCases() {
  const cases = [];
  for (let bits = 0; bits < 64; bits++) {
    const flags = Array.from({ length: 6 }, (_, bit) => !!(bits & (1 << bit)));
    if (flags[4] && !flags[1]) continue;
    cases.push({ ...stripKey(sync), enabled: flags[0], coordination: { enabled: flags[1] }, consolidation: { enabled: flags[2] }, shared: { enabled: flags[3] }, distribution: { enabled: flags[4] }, aceitarAdmin: flags[5] });
  }
  for (const deviceName of ['', 'Notebook', 'á'.repeat(40)]) cases.push({ ...stripKey(sync), deviceName });
  return cases;
}
function accountCases() {
  const cases = [[], [{ ...account, user: 'other', owners: [] }], [{ ...account, label: '<Trabalho & pessoal>', color: '#ffb454', kind: 'work', muted: true, claudeProfileId: 'p', budgetWeight: 0.25, padroesRevisao: 'Regras\ncom acentos', reviewRules: { acme: { mode: 'manual', authors: { alex: 'auto', bia: 'manual' } } } }]];
  for (const autoReview of [false, true]) for (const onClean of ['wait', 'approve']) for (const onCaveats of ['wait', 'approve']) for (const onReject of ['wait', 'request_changes']) {
    if (onClean === 'wait' && onCaveats === 'approve') continue;
    cases.push([{ ...account, autoReview, onClean, onCaveats, onReject }]);
  }
  cases.push([account, { ...account, user: 'other', owners: ['other-org'] }]);
  return cases;
}
function peopleCases() {
  const cases = [{}];
  for (const papel of PAPEL_LEVELS) cases.push({ dev: { papel } });
  for (const domain of DOMAINS) for (const level of DOMAIN_LEVELS) cases.push({ dev: { dominios: { [domain]: level } } });
  cases.push({ dev: { papel: 'senior', dominios: Object.fromEntries(DOMAINS.map(d => [d, 'autoridade'])) }, other: { papel: 'junior' } });
  return cases;
}
function fieldCases() {
  const catalog = catalogoParaTela();
  const result = Object.fromEntries(SETTINGS.filter(s => s.ui && typeof s.def === 'boolean').map(s => [s.key, [false, true]]));
  Object.assign(result, {
    ghUser: ['', 'dev', 'other'], owners: [[], ['acme'], ['acme', 'other-org']], accounts: accountCases(),
    jiraSites: [[], [{ id: 'work', label: 'Jira', baseUrl: 'https://example.atlassian.net', owners: ['acme'], projectKeys: ['PROJ'] }], [{ id: 'self', label: '<Jira>', baseUrl: 'https://jira.example.invalid:8443', owners: [], projectKeys: [] }]],
    sync: syncCases(), intervalSeconds: [180, 181, 300, 3599, 3600], parallelReviews: [1, 2, 3, 4],
    globalParallelReviews: Array.from({ length: 9 }, (_, n) => n), voiceEvents: Array.from({ length: 16 }, (_, bits) => ['decision', 'access', 'failure', 'operational'].filter((_, bit) => bits & (1 << bit))),
    voiceVolume: [0, 1, 50, 99, 100], voiceQuietStart: ['00:00', '00:01', '12:30', '23:59'], voiceQuietEnd: ['00:00', '00:01', '12:30', '23:59'],
    interventionReminderMinutes: [0, 1, 5, 1439, 1440], theme: ['dark', 'light'], updateSource: ['', 'C:/Farol/releases', 'https://example.invalid/releases'],
    updateRepo: ['', 'acme/farol', 'wandersonaadsantos/farol'], mergeBlockedRepos: [[], ['acme/app'], ['acme/app', 'other/app']],
    defaultReviewers: [{}, { acme: ['alex'] }, { acme: ['alex', 'acme/team'], other: ['bia'] }],
    projectReviewers: [{}, { 'acme/app': ['alex'] }, { 'acme/app': ['alex', 'acme/team'], 'other/app': ['bia'] }],
    people: peopleCases(), reviewModel: ['', ...MODEL_ALIASES, 'claude-opus-5'], reviewEffort: ['', ...EFFORT_LEVELS],
    codexReviewModel: [...new Set([...catalog.codex.map(model => model.valor), 'gpt-6.1-sol'])], codexReviewEffort: ['', ...CODEX_EFFORT_LEVELS],
    agyReviewModel: ['', ...catalog.agy.map(model => model.valor), 'claude-opus-5', 'gpt-6.1-sol'], agyReviewEffort: ['', ...AGY_EFFORT_LEVELS],
    claudeConfigDir: ['', 'C:/Users/Exemplo/perfil', '/Users/exemplo/perfil com espaços'],
    claudeProfiles: [[], ...profiles.map(p => [stripKey(p)]), profiles.map(stripKey), [{ ...stripKey(profiles[0]), budgetDaily: 0, budgetTotal: 100.5, budgetSince: '2026-10-26', budgetByWeekday: { 0: 0, 6: 12.5 }, budgetDates: { '2026-12-31': 20 } }]],
    claudeProfileId: ['', ...profiles.map(p => p.id)],
    cadeiaPerfis: [[], profiles.map(p => ({ id: p.id, ativo: false })), profiles.map(p => ({ id: p.id, ativo: true })), [...profiles].reverse().map(p => ({ id: p.id, ativo: p.id === 'q' }))],
  });
  return result;
}
export { account, profiles, sync, baseConfig, fieldCases };
