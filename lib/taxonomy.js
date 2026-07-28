'use strict';
// Taxonomia do perfil de review (papel + matriz por domínio) e de pushback, mais a
// paleta de cores por conta. Só dados/constantes, sem lógica. Molda o TOM e a POSTURA
// da revisão automática, NUNCA a decisão técnica. Ver docs/QUALITY.md e CLAUDE.md.

// Paleta default de cores por conta (âmbar do Farol primeiro), atribuída por
// índice quando a conta não define uma cor própria. Dá a cada identidade uma cor
// estável pro painel separar visualmente trabalho, pessoal, etc.
const ACCOUNT_PALETTE = ['#ffb454', '#a78bfa', '#34d399', '#f2707a', '#6ca8f2', '#f59e0b', '#22d3ee', '#64748b'];

// PERFIL DE REVIEW por pessoa: molda o TOM e a POSTURA da revisão automática
// (NUNCA a decisão técnica). Dois eixos, marcados à mão: PAPEL (carreira/posição)
// e MATRIZ de competência por DOMÍNIO. Marcado por login (aba Time e card do PR).
const PAPEL_LEVELS = ['estagio', 'junior', 'pleno', 'senior', 'techlead', 'arquiteto', 'especialista'];
const PAPEL_LABEL = { estagio: 'Estágio', junior: 'Júnior', pleno: 'Pleno', senior: 'Sênior', techlead: 'Tech Lead', arquiteto: 'Arquiteto', especialista: 'Especialista' };
const PAPEL_TONE = {
  estagio: 'início de carreira. Tom acolhedor e didático: reconheça a iniciativa e o que ficou bom, explique o PORQUÊ de cada ajuste, enquadre correções como aprendizado e nunca desanime, mesmo pedindo mudanças.',
  junior: 'júnior. Tom encorajador e explicativo: reforce os acertos, detalhe os ajustes com contexto e motivo, sem assumir muito conhecimento prévio.',
  pleno: 'pleno. Tom direto e colaborativo: vá aos pontos com objetividade, assumindo autonomia técnica.',
  senior: 'sênior. Tom direto e objetivo, de par pra par: assuma contexto compartilhado e vá aos pontos sem suavizar nem alongar.',
  techlead: 'tech lead do time. Foque em direção, consistência e impacto no time; assuma que pondera trade-offs e coordena; seja conciso e estratégico, não didático.',
  arquiteto: 'arquiteto(a). Discuta decisões estruturais e trade-offs de design no nível de sistema; assuma domínio profundo; vá aos pontos de arquitetura sem didatismo.',
  especialista: 'especialista (referência na área dele). No que for da especialidade, defira e foque em nuances; fora dela, trate como par técnico.'
};
const DOMAINS = ['backend', 'frontend', 'dados', 'infra'];
const DOMAIN_LABEL = { backend: 'Backend', frontend: 'Frontend', dados: 'Dados', infra: 'Infra/DevOps' };
const DOMAIN_LEVELS = ['basico', 'intermediario', 'avancado', 'autoridade'];
const DOMAIN_LEVEL_LABEL = { basico: 'Básico', intermediario: 'Intermediário', avancado: 'Avançado', autoridade: 'Autoridade' };
const DOMAIN_POSTURE = {
  autoridade: 'é autoridade aqui: defira, levante pontos como sugestão/pergunta, foque no alto nível e assuma que já considerou o básico.',
  avancado: 'é sólida aqui: postura de par, aponte direto sem explicar fundamentos.',
  intermediario: 'está em evolução aqui: explique o porquê dos ajustes com contexto.',
  basico: 'está começando aqui: explique com cuidado, pegue fundamentos gentilmente e enquadre como aprendizado.'
};
// pushback: quando o autor contesta um review meu. Marcado à mão em Revisões
// recentes, com o desfecho; alimenta o tom/postura das revisões futuras da pessoa.
const PUSHBACK_OUTCOMES = ['author_right', 'we_right', 'mixed'];
const PUSHBACK_LABEL = { author_right: 'o autor tinha razão (você errou)', we_right: 'você tinha razão', mixed: 'meio-termo' };

module.exports = {
  ACCOUNT_PALETTE,
  PAPEL_LEVELS, PAPEL_LABEL, PAPEL_TONE,
  DOMAINS, DOMAIN_LABEL, DOMAIN_LEVELS, DOMAIN_LEVEL_LABEL, DOMAIN_POSTURE,
  PUSHBACK_OUTCOMES, PUSHBACK_LABEL,
};
