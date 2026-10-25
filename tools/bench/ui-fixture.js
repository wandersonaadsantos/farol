// Dados sintéticos; nenhuma origem ou credencial do usuário participa da comparação.
function pr(numero, author = 'bruno') {
  return { key: `acme/app#${numero}`, url: `https://github.com/acme/app/pull/${numero}`,
    repo: 'acme/app', number: numero, title: `Componente sintético ${numero}`, author,
    updatedAt: '2026-10-20T12:00:00Z' };
}
function estadoInicial() {
  const reportMarkdown = '# Revisão sintética\n\n' + Array.from({ length: 20 }, (_, i) =>
    `- Evidência ${i}: src/Componente${i}.tsx preserva o contrato de props.`).join('\n');
  const resolved = Array.from({ length: 6 }, (_, i) => ({ id: `resolvida-${i}`, key: pr(i + 100).key,
    pr: pr(i + 100), status: 'auto_approved', action: 'approve', reportMarkdown,
    resolvedAt: '2026-10-20T12:00:00Z', verdict: 'approve', reasons: [] }));
  return { app: { name: 'Farol', version: 'fixture', platform: 'win32' }, status: 'idle',
    account: { user: 'alice', tokenOk: true }, accounts: [{ user: 'alice', owners: ['acme'] }],
    config: { accounts: [{ user: 'alice', owners: ['acme'] }], intervalSeconds: 300,
      parallelReviews: 1, people: {}, claudeProfiles: [], defaultReviewers: {}, projectReviewers: {},
      theme: 'dark', teamHighlights: false, deliveriesEnabled: false, soundEnabled: false },
    queue: Array.from({ length: 12 }, (_, i) => pr(i + 1)),
    panorama: Array.from({ length: 20 }, (_, i) => pr(i + 1)), myPRs: [pr(50, 'alice')],
    hiddenPRs: [], activeSessions: [], activity: {},
    headlessWaiting: [], decisions: { pending: [], resolved }, selfAnalyses: {},
    reviewActions: {}, chats: {}, usage: {}, toolRuns: {}, update: {},
    paths: { home: '/fixture', workspace: '/fixture/workspace' } };
}
export { estadoInicial };
