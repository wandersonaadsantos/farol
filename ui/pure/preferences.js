// Apresentação das preferências transferíveis; o inventário vem de SETTINGS no servidor.
const MAX_PREFERENCES_BYTES = 1024 * 1024;
const PREFERENCE_LABELS = {
  ghUser: 'Conta principal do GitHub', owners: 'Organizações monitoradas', accounts: 'Contas e políticas de automação',
  jiraSites: 'Sites e projetos do Jira', sync: 'Sincronização entre aparelhos', intervalSeconds: 'Intervalo de checagem',
  parallelReviews: 'Revisões simultâneas por conta', globalParallelReviews: 'Revisões simultâneas neste aparelho',
  skipPermissions: 'Executar sem prompts de permissão', soundEnabled: 'Toque sonoro', voiceEnabled: 'Avisos por voz',
  voiceEvents: 'Eventos anunciados por voz', voiceVolume: 'Volume da voz', voiceQuietEnabled: 'Horário silencioso da voz',
  voiceQuietStart: 'Início do horário silencioso', voiceQuietEnd: 'Fim do horário silencioso',
  interventionReminderMinutes: 'Lembrete de intervenção (minutos)', teamHighlights: 'Destaques do time',
  deliveriesEnabled: 'Entregas', theme: 'Tema', autostart: 'Iniciar com o sistema', updateSource: 'Fonte das atualizações',
  updateRepo: 'Repositório das atualizações', autoUpdate: 'Atualizações automáticas', reReviewResume: 'Retomar revisões',
  reviewFast: 'Revisão rápida', coAssinarReview: 'Aprovar junto com quem pegou o PR',
  revisarComOutrosRevisando: 'Revisar com outra pessoa revisando', aguardarCiParaRevisar: 'Aguardar CI para revisar',
  mergeBlockedRepos: 'Repositórios com merge bloqueado', defaultReviewers: 'Revisores por organização',
  projectReviewers: 'Revisores por projeto', people: 'Papéis e conhecimentos das pessoas', reviewModel: 'Modelo do Claude',
  reviewEffort: 'Esforço do Claude', codexReviewModel: 'Modelo do Codex', codexReviewEffort: 'Esforço do Codex',
  agyReviewModel: 'Modelo do Antigravity', agyReviewEffort: 'Esforço do Antigravity', autoPushback: 'Devolver PR ao autor',
  debugSpawns: 'Diagnóstico de processos', claudeConfigDir: 'Diretório do Claude', claudeProfiles: 'Perfis e orçamentos dos provedores',
  claudeProfileId: 'Perfil padrão', cadeiaPerfis: 'Ordem e ativação dos perfis',
};
const FIELD_LABELS = {
  user: 'Conta', owners: 'Organizações', label: 'Nome', kind: 'Tipo', muted: 'Silenciada', autoReview: 'Revisar sozinho',
  onClean: 'Sem ressalvas', onCaveats: 'Com ressalvas', onReject: 'Ao reprovar', claudeProfileId: 'Perfil',
  budgetWeight: 'Peso no orçamento', padroesRevisao: 'Padrões do time', reviewRules: 'Regras de revisão',
  enabled: 'Ativado', coordination: 'Coordenação', consolidation: 'Consolidação', shared: 'Compartilhamento',
  distribution: 'Distribuição', aceitarAdmin: 'Aceitar política do administrador', deviceName: 'Nome do aparelho',
  databaseUrl: 'Banco', projectId: 'Projeto', id: 'Identificador', baseUrl: 'Endereço', projectKeys: 'Projetos',
  dir: 'Diretório', email: 'E-mail esperado', budgetDaily: 'Orçamento diário', budgetTotal: 'Orçamento total',
  budgetSince: 'Início do orçamento', budgetByWeekday: 'Orçamento por dia da semana', budgetDates: 'Orçamento por data',
  ativo: 'Ativo na cadeia', papel: 'Papel', dominios: 'Conhecimentos',
};
const VALUE_LABELS = {
  decision: 'Decisão', access: 'Acesso', failure: 'Falha', operational: 'Operacional',
  approve: 'Aprovar', wait: 'Esperar você', request_changes: 'Pedir mudanças',
  maquina: 'Login desta máquina', codex: 'Codex', agy: 'Antigravity', apikey: 'Chave de API', openrouter: 'OpenRouter',
};
function structuredValue(value, field = '') {
  if (typeof value === 'boolean') return value ? 'Ligado' : 'Desligado';
  if (Array.isArray(value)) return value.length ? value.map(item => structuredValue(item, field)).join('\n\n') : 'Nenhum';
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (!entries.length) return 'Nenhum';
    return entries.map(([key, item]) => `${Object.hasOwn(FIELD_LABELS, key) ? FIELD_LABELS[key] : key}: ${structuredValue(item, key)}`).join('\n');
  }
  if (['onClean', 'onCaveats', 'onReject', 'kind', 'voiceEvents'].includes(field) && Object.hasOwn(VALUE_LABELS, value)) return VALUE_LABELS[value];
  return String(value ?? 'Padrão');
}
function preferenceValue(key, value) {
  if (key === 'theme') return value === 'light' ? 'Claro' : 'Escuro';
  if (key === 'intervalSeconds') return `${Number(value) / 60} minutos`;
  if (key === 'interventionReminderMinutes') return value === 0 ? 'Desligado' : `${value} minutos`;
  if (key === 'voiceVolume') return `${value}%`;
  if (value === '' || value === null) return 'Padrão';
  return structuredValue(value, key);
}
export { MAX_PREFERENCES_BYTES, PREFERENCE_LABELS, preferenceValue };
