// Fachada do ui/pure: o conteúdo mora em ui/pure/*.js desde a Fase 1a da reorganização
// (15/09/2026). Este arquivo existe para o ui/app.js e os testes continuarem importando de
// um lugar só; nome novo nasce no módulo do assunto, nunca aqui.
//
// O contrato de pureza do diretório, as camadas e as regras de quem mexe estão em
// ui/pure/README.md.
export * from './pure/aparelhos.js';
export * from './pure/aparelhos-limpeza.js';
export * from './pure/aparelhos-politica.js';
export * from './pure/autoanalise.js';
export * from './pure/capacidades.js';
export * from './pure/comum.js';
export * from './pure/compartilhado.js';
export * from './pure/compartilhado-historico.js';
export * from './pure/compartilhado-posse.js';
export * from './pure/consumo.js';
export * from './pure/contas.js';
export * from './pure/contas-gh.js';
export * from './pure/diagnostico.js';
export * from './pure/entregas.js';
export * from './pure/fila-justa.js';
export * from './pure/grupos.js';
export * from './pure/jira.js';
export * from './pure/listas-remotas.js';
export * from './pure/mencoes.js';
export * from './pure/pareamento.js';
export * from './pure/perfil.js';
export * from './pure/meus-prs.js';
export * from './pure/pessoas.js';
export * from './pure/pr-compartilhado.js';
export * from './pure/radar.js';
export * from './pure/review.js';
export * from './pure/sessao.js';
export * from './pure/sistema.js';
export * from './pure/sobre.js';
export * from './pure/sync.js';
export * from './pure/sync-chave.js';
