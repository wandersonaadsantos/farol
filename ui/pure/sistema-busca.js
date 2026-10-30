// A busca do Sistema e as seções que somem com a sincronização desligada. Extraído de
// ui/telas/sistema.js: o índice e as duas regras são puros, a tela só desenha.

import { sysNorm } from './comum.js';

/* Índice da busca do Sistema. Casar por textContent da seção inteira, como era antes,
   acendia meia dúzia de seções ao mesmo tempo (o termo "conta" aparece em quase todas)
   e empilhava tudo na vertical. Com índice, o resultado é uma lista curta que aponta
   pra UMA linha. 'at' é o seletor do alvo, e todo alvo tem que existir no HTML. */
export const SYS_INDEX = [
  { sec: 'overview', at: '#reviewLabels', title: 'Tags de revisão no GitHub', hint: 'tags, labels, marcador, revisando, remover, limpeza' },
  { sec: 'overview', at: '#setupManager', title: 'Configuração e retomada', hint: 'onboarding, começar, roteiro, configurar, retomar' },
  { sec: 'overview', at: '#preferencesTransfer', title: 'Importar preferências', hint: 'importação, exportação, arquivo, tema, toque, lembretes, diferenças' },
  { sec: 'plans', at: '#capacityManager', title: 'Reserva de cota e recursos', hint: 'cota, reserva, percentual, janela, memória, ram, cpu, processos, recursos' },
  { sec: 'reviewers', at: '#auditManager', title: 'Auditoria de reviews', hint: 'auditoria, amostra, qualidade, humano, falso positivo, omissão, custo' },
  { sec: 'overview', at: '#updateBox', title: 'Versão e atualização', hint: 'update, atualizar, versão, release' },
  { sec: 'overview', at: '#doctor', title: 'Saúde do ambiente', hint: 'doctor, gh, claude, git bash, diagnóstico' },
  { sec: 'sync', at: '#syncManager', title: 'Sincronização entre aparelhos', hint: 'sync, firebase, aparelho, dispositivo, coordenação, lease, consolidação, consumo, um farol por pr' },
  { sec: 'devices', at: '#devicesManager', title: 'Aparelhos e administração', hint: 'aparelho, admin, aposentar, renomear, política, pausar, navegador pareado, limpeza, revogar, garantia' },
  { sec: 'plans', at: '#claudeProfilesManager', title: 'Orçamento por perfil', hint: 'orçamento, teto, limite, custo, gasto, cota' },
  { sec: 'groups', at: '#groupsManager', title: 'Grupos de consumo', hint: 'grupo, teto, orçamento, vincular perfil, codex, custo somado' },
  { sec: 'accounts', at: '#accountsManager', title: 'Contas do GitHub', hint: 'conta, identidade, cor, silenciar, política, token, usuário, login, gh' },
  // as organizações monitoradas são da conta (a seção Conexões, que as repetia sem efeito, saiu em 03/10/2026)
  { sec: 'accounts', at: '#accountsManager', title: 'Organizações monitoradas (por conta)', hint: 'org, organização, owners, panorama, repositórios' },
  // revisar e aprovar sozinho são da conta desde 30/09/2026: a busca leva ao cartão dela
  { sec: 'accounts', at: '#accountsManager', title: 'Revisar e aprovar sozinho (por conta)', hint: 'auto review, revisão na hora, fila, auto approve, ressalva, aprovação, reprovar' },
  { sec: 'automation', at: '#sys-row-pushback', title: 'Detectar pushback automaticamente', hint: 'contestação, autor, desfecho' },
  { sec: 'plans', at: '#cadeiaPerfis', title: 'Ordem de uso dos perfis', hint: 'cadeia, prioridade, fallback, principal, limite do plano, reset, assinatura, trocar, gemini, antigravity' },
  { sec: 'plans', at: '#sys-row-provedor', title: 'Configuração do provedor', hint: 'claude, codex, antigravity, gemini, agy, openrouter, perfil, conta, provedor' },
  { sec: 'plans', at: '#sys-row-modelo', title: 'Modelo das sessões autônomas', hint: 'opus, sonnet, haiku, fable, auto, best, codex, gpt, sol, terra, luna, modelo, limite do plano, openrouter' },
  { sec: 'automation', at: '#sys-row-paralelas', title: 'Revisões paralelas por conta', hint: 'paralelo, simultâneo, série, fila, velocidade' },
  { sec: 'automation', at: '#sys-row-teto-global', title: 'Teto total deste aparelho', hint: 'teto, total, global, paralelismo, simultâneo, aparelho' },
  { sec: 'plans', at: '#sys-row-esforco', title: 'Esforço de raciocínio', hint: 'effort, pensar, raciocínio, alto, baixo, xhigh' },
  { sec: 'automation', at: '#sys-row-intervalo', title: 'Intervalo de checagem', hint: 'polling, minutos, frequência' },
  { sec: 'automation', at: '#sys-row-skipperms', title: 'Sessão no terminal sem pedir permissões', hint: 'dangerously skip permissions, prompts' },
  // saiu de Sistema > Conexões em 03/10/2026, com a seção (merge-bloqueado.js)
  { sec: 'automation', at: '#sys-row-mergeblocked', title: 'Repos bloqueados pra merge', hint: 'merge, mergear, bloqueio, bloqueado, bloquear, repo, repos, repositório, self merge, desativa o botão Merge de Meus PRs' },
  { sec: 'plans', at: '#claudeProfilesManager', title: 'Perfis de IA e chaves', hint: 'claude, codex, chatgpt, plano, assinatura, config dir, login, chave' },
  { sec: 'reviewers', at: '#reviewersEditor', title: 'Revisores e qualidade por projeto', hint: 'revisor, time, padrão da org, exceção, repo' },
  { sec: 'prefs', at: '#sys-row-identity', title: 'Identidade nos cards', hint: 'barra, etiqueta, ponto, marcador' },
  { sec: 'prefs', at: '#sys-row-mutedview', title: 'Contas silenciadas', hint: 'recolher, esmaecer, ocultar, exibição' },
  { sec: 'prefs', at: '#sys-row-interventions', title: 'Avisos de intervenção e voz', hint: 'voz, som, lembrete, silêncio, acesso, pendência' },
  { sec: 'reviewers', at: '#specialistManager', title: 'Especialistas por repositório', hint: 'contexto, arquitetura, contratos, fontes, lições, curadoria' },
  { sec: 'prefs', at: '#sys-row-sound', title: 'Som ao chegar PR novo', hint: 'som, aviso, notificação' },
  { sec: 'prefs', at: '#sys-row-teamhighlights', title: 'Destaques do time', hint: 'destaques, kudos, elogios, memória, time, equipe' },
  { sec: 'prefs', at: '#sys-row-deliveries', title: 'Entregas', hint: 'entregas, merges, prs mergeados, github, atividade' },
  { sec: 'prefs', at: '#rowAutostart', title: 'Iniciar com o sistema', hint: 'autostart, inicialização, segundo plano, iniciar com o Windows, iniciar com o macOS, login' },
  { sec: 'news', at: '#relNotes', title: 'Novidades por versão', hint: 'changelog, release notes, o que mudou' },
  { sec: 'diag', at: '#sys-row-spawns', title: 'Registrar processos (diagnóstico)', hint: 'spawns, terminal piscando, debug' },
  { sec: 'diag', at: '#sys-row-log', title: 'Log de falhas', hint: 'log, erro, falha, pr-health' },
  { sec: 'about', at: '#aboutPrivacy', title: 'Privacidade', hint: 'dados, telemetria, coleta, local, privacidade' },
  { sec: 'about', at: '#aboutLicense', title: 'Licença', hint: 'mit, licença, open source, garantia' },
  { sec: 'about', at: '#aboutCredits', title: 'Créditos', hint: 'contribuidores, autores, idealizador, mantenedor, quem fez' },
];

// Itens do índice cujo texto (título, dica e nome da seção) contém a consulta, na ordem do índice.
export function buscarNoSistema(indice, query, nomeDaSecao) {
  const q = sysNorm(query).trim();
  if (!q) return [];
  return indice.filter((e) => sysNorm(`${e.title} ${e.hint} ${nomeDaSecao(e.sec)}`).includes(q));
}

// Aparelhos e Grupos só fazem sentido com a sincronização ligada: desligada, as duas
// seções só mostravam o aviso de que ela está desligada.
export function secoesOcultasDoSistema(config) {
  const ligada = !!(config && config.sync && config.sync.enabled === true);
  return ligada ? [] : ['devices', 'groups'];
}

export default { SYS_INDEX, buscarNoSistema, secoesOcultasDoSistema };
