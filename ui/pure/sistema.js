// A aba Sistema: o log de falhas agrupado, regime contra episódio, os checks de operação e
// de runtime, os créditos do Sobre e o texto do diagnóstico. Extraído do ui/pure.js na
// Fase 1a da reorganização; o conteúdo não mudou.
//
// Log agrupado: o agrupamento em si é do lib/log-taxonomy.js (triage), servido em
// /api/log/triage; o que mora aqui é SÓ a formatação. O farol.log real tinha 159 linhas que
// eram 146 eventos de 4 episódios, e "1 problema repetido 70 vezes" ficava indistinguível
// de "70 problemas".
//
// Regime contra episódio (24/08/2026): o diagnóstico dizia "101 eventos se resolvem
// sozinhos, 0 exigem ação humana" sobre 6 horas ININTERRUPTAS de falha de rede. Somar
// episódios transitórios e concluir tranquilidade esconde que aquilo é REGIME, e regime é
// decisão de gente (trocar de rede, cobrar o provedor), não do app.
//
// Checks de OPERAÇÃO: os de ambiente respondem "o Farol consegue rodar?", e nenhum respondia
// "o Farol vai achar alguma coisa?". Conta sem organização deixava os cinco verdes e o
// painel vazio para sempre, sem erro nem log. Um check por conta, mais um agregado para o
// caso de tudo silenciado.
//
// Sobre: idealizador é o dono do repo do update, contribuidores vêm da API do mesmo repo.
// Sem dado ainda, aviso explicativo, nunca vazio mudo.
//
// Diagnóstico: é a única saída do app que alguém lê fora do app, então mudança aqui é
// mudança de contrato com quem socorre.

// '2026-08-07 17:32:15' -> '07/08 17:32'. RECORTE DE TEXTO de proposito: o farol.log
// ja grava em horario LOCAL, entao passar por new Date() so criaria chance de mover a
// hora que a pessoa le no arquivo. Carimbo que nao casa volta como veio, nunca vira
// "Invalid Date" na tela.
import { esc, escAttrSelector, fmtSpan, plural } from './comum.js';
import { personMention, repoMention } from './mencoes.js';

export function fmtLogStamp(ts) {
  const m = String(ts ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(ts ?? '');
}

// quantos PRs cabem na linha antes de virar "e mais N": o relatorio de diagnostico e
// copiado e colado, entao tamanho de linha importa.
const LOG_REFS_VISIVEIS = 4;

// uma linha por grupo:
// 70x  Limite do plano Claude  [ambiente/espera-reset]  07/08 17:32 -> 07/08 21:28  (8 PRs: o/r#1, ...)
export function logGroupLine(g) {
  g = g || {};
  const ini = fmtLogStamp(g.first), fim = fmtLogStamp(g.last);
  // episodio de um instante so nao vira "x -> x" (a comparacao e do texto ja formatado:
  // segundos diferentes dentro do mesmo minuto sao o mesmo instante pra quem le)
  const quando = (!fim || ini === fim) ? ini : `${ini} -> ${fim}`;
  const refs = Array.isArray(g.refs) ? g.refs : [];
  const mostra = refs.slice(0, LOG_REFS_VISIVEIS);
  const resto = refs.length - mostra.length;
  const prs = refs.length
    ? `  (${refs.length} ${refs.length === 1 ? 'PR' : 'PRs'}: ${mostra.join(', ')}${resto ? ` e mais ${resto}` : ''})`
    : '';
  return `${g.count}x  ${g.label}  [${g.grupo}/${g.kind}]  ${quando}${prs}`;
}

// diferença em MINUTOS entre dois carimbos do farol.log, pelos componentes. Os dois
// vêm do mesmo relógio local, então tratar ambos como UTC preserva a diferença e
// evita a única coisa que interessa evitar aqui: o parser do runtime reinterpretar
// fuso e mover a hora que a pessoa lê no arquivo (mesma razão do fmtLogStamp).
export function logSpanMinutes(first, last) {
  const re = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/;
  const a = re.exec(String(first ?? '')), b = re.exec(String(last ?? ''));
  if (!a || !b) return null;
  const ms = (m) => Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  const dif = ms(b) - ms(a);
  return dif >= 0 ? Math.round(dif / 60000) : null;
}

// A partir de quando um grupo deixa de ser episódio. Duas horas porque abaixo disso
// uma queda de rede comum já enche o log, e 2 por hora porque é o ritmo em que o
// Farol perde consulta em TODO ciclo de polling (o intervalo mínimo é de 3 min).
const REGIME_MIN_MINUTOS = 120;

const REGIME_MIN_POR_HORA = 2;

export function logGroupRate(g) {
  g = g || {};
  const count = Number(g.count) || 0;
  const minutos = logSpanMinutes(g.first, g.last);
  if (!count || minutos === null || minutos < REGIME_MIN_MINUTOS) return null;
  const porHora = count / (minutos / 60);
  return { minutos, porHora, regime: porHora >= REGIME_MIN_POR_HORA };
}

// A linha que o resumo ganhou: o que é contínuo é nomeado como contínuo. Sai só pro
// que o app trataria como "passa sozinho": problema que já exige gente não precisa
// desta linha pra ser levado a sério.
export function logRegimeLines(grupos) {
  return (grupos || []).filter(Boolean).filter(g => LOG_KINDS_SOZINHO.includes(g.kind)).map(g => {
    const r = logGroupRate(g);
    if (!r || !r.regime) return '';
    const porHora = r.porHora >= 10 ? Math.round(r.porHora) : Math.round(r.porHora * 10) / 10;
    return `Atenção: ${g.label} não é episódio, é regime: ${g.count} falhas em ${fmtSpan(r.minutos)}`
      + ` (${porHora} por hora). Cada uma se resolve sozinha, e mesmo assim nesse ritmo o Farol perde`
      + ` consulta e postagem o tempo todo. Isso é decisão sua (rede, provedor), não do app.`;
  }).filter(Boolean);
}

// kinds que passam sozinhos (ver lib/log-taxonomy.js): espera-reset espera a hora dela,
// transitorio passa rapido. O resto que nao for operacional exige gente, inclusive kind
// novo que apareca depois: falha nao classificada nunca some da conta.
const LOG_KINDS_SOZINHO = ['transitorio', 'espera-reset'];

export function logReadingLine(grupos) {
  let sozinho = 0, humano = 0, operacional = 0;
  for (const g of (grupos || [])) {
    const n = Number(g && g.count) || 0;
    if (g && g.kind === 'operacional') operacional += n;
    else if (g && LOG_KINDS_SOZINHO.includes(g.kind)) sozinho += n;
    else humano += n;
  }
  return `Leitura: ${sozinho} evento(s) se resolvem sozinhos, ${humano} exigem ação humana, ${operacional} são operacionais.`;
}

// o bloco de resumo do Diagnostico: uma linha por grupo (a ordem ja vem por volume do
// triage) e a leitura no fim. Sem grupo, sem bloco.
export function logSummaryLines(grupos) {
  const gs = (grupos || []).filter(Boolean);
  if (!gs.length) return [];
  return [...gs.map(logGroupLine), logReadingLine(gs), ...logRegimeLines(gs)];
}

// o detalhe cru, limitado: o relatorio e copiado e colado, entao as 159 linhas inteiras
// custavam caro e nao acrescentavam nada depois do resumo. A linha de aviso fica no
// lugar do que foi omitido (no topo), porque o corte guarda as MAIS RECENTES.
export function logTailLines(linhas, max = 40) {
  const l = (Array.isArray(linhas) ? linhas : []).slice();
  const n = Math.max(1, Number(max) || 40);
  if (l.length <= n) return l;
  return [`... e mais ${l.length - n} linhas anteriores`, ...l.slice(-n)];
}

// linha unica da aba Sistema: os n maiores grupos com a contagem. Vazio quando nao ha
// falha, pra a linha sumir em vez de mostrar zero.
export function logSummaryShort(grupos, n = 3) {
  const gs = (grupos || []).filter(Boolean);
  if (!gs.length) return '';
  const total = gs.reduce((a, g) => a + (Number(g.count) || 0), 0);
  const top = gs.slice(0, n).map(g => `${g.count}x ${g.label}`).join(' · ');
  const resto = gs.length - Math.min(n, gs.length);
  // grupo em REGIME entra com a duração junto: na aba Sistema esta é a única linha
  // sobre o log, e "101x Rede indisponível" sem a janela lê como pico de um minuto.
  const continuo = gs.map(g => {
    const r = logGroupRate(g);
    return r && r.regime ? `${g.label} há ${fmtSpan(r.minutos)}` : '';
  }).filter(Boolean);
  // cada ternário no seu próprio const: o ratchet conta '?' por statement e este
  // arquivo não tem folga nesse eixo (mesma razão do diagnosticsText)
  const sufixoResto = resto ? ` · e mais ${plural(resto, 'grupo', 'grupos')}` : '';
  const sufixoContinuo = continuo.length ? ` · contínuo: ${continuo.join(' · ')}` : '';
  return `${plural(total, 'falha', 'falhas')} em ${plural(gs.length, 'grupo', 'grupos')}: ${top}`
    + sufixoResto + sufixoContinuo;
}

export function operationChecks(accounts) {
  const lista = (Array.isArray(accounts) ? accounts : []).filter(a => a && String(a.user || '').trim());
  if (!lista.length) return [];
  const alvo = u => `sys:accounts:.acct-label[data-user="${escAttrSelector(u)}"]`;
  const checks = lista.map(a => {
    const orgs = (a.owners || []).filter(Boolean);
    if (!orgs.length) {
      return { ok: false, label: `Monitoramento de @${a.user}`, goto: alvo(a.user),
        detail: 'sem organização monitorada: nenhuma busca é feita por esta conta, e o painel fica vazio sem erro' };
    }
    if (!a.tokenOk) {
      return { ok: false, label: `Monitoramento de @${a.user}`, goto: alvo(a.user),
        detail: `sem token no gh: as buscas de ${orgs.join(', ')} são puladas (rode gh auth login para esta conta)` };
    }
    return { ok: true, label: `Monitoramento de @${a.user}`, goto: alvo(a.user),
      detail: `vigiando ${orgs.join(', ')}${a.muted ? ' (silenciada: não aparece no painel)' : ''}` };
  });
  // silenciar UMA conta é escolha; silenciar todas esvazia o painel inteiro, e aí
  // o vazio volta a não ter explicação, que é justamente o defeito de origem
  if (lista.length && lista.every(a => a.muted)) {
    checks.push({ ok: false, label: 'Painel', goto: 'sys:accounts:#accountsManager',
      detail: 'todas as contas estão silenciadas: nada aparece no painel, mesmo com PR esperando' });
  }
  return checks;
}

/* Terceira pergunta do Diagnóstico, irmã de operationChecks: o Farol consegue
   ABRIR a sessão? Ambiente verde e operação verde não impedem que TODA revisão
   autônoma morra no instante do spawn, e foi exatamente o que aconteceu no Farol
   rodando em Android (Termux + proot Debian, 25/08/2026): o login padrão do proot
   é root, o Claude Code recusa `--dangerously-skip-permissions` com uid 0, e o
   headless passa essa flag SEMPRE (é fixa em runClaudeStream, não sai do toggle
   de skipPermissions, que só alcança as sessões de terminal). O resultado era um
   "saiu com código 1" por ciclo, pra sempre, sem uma linha na tela dizendo por quê.
   Devolve lista (vazia quando não há o que dizer) pra compor com os outros checks. */
export function runtimeChecks(doctor, config = {}) {
  const d = doctor || {};
  const perfis = Array.isArray(config.claudeProfiles) ? config.claudeProfiles : [];
  const usaCodex = perfis.some(p => p && p.kind === 'codex');
  const checks = [];
  if (d.root) {
    checks.push({
      // sem `goto` de propósito: não há tela do app que conserte isso, e clique que
      // não leva a lugar nenhum é pior que texto puro (doutrina das menções navegáveis)
      ok: false, label: 'Usuário do sistema',
      detail: 'rodando como root (uid 0): o Claude Code recusa --dangerously-skip-permissions '
        + 'nessa condição e toda revisão autônoma falha no spawn. Crie um usuário não-root e rode o Farol por ele'
    });
  }
  if (usaCodex) {
    const temCli = !!d.codex;
    let loginDetail = d.codexLoginDetail || '';
    if (!loginDetail && temCli) loginDetail = 'rode codex login no terminal do sistema';
    if (!loginDetail) loginDetail = 'instale o Codex CLI e rode codex login';
    checks.push({
      ok: temCli, label: 'Codex CLI',
      goto: 'sys:plans:#claudeProfilesManager',
      detail: temCli ? d.codex : 'codex não encontrado no PATH do processo do Farol'
    });
    checks.push({
      ok: d.codexChatGPT === true, label: 'Login Codex',
      goto: 'sys:plans:#claudeProfilesManager',
      detail: d.codexChatGPT === true ? 'autenticado no plano ChatGPT' : loginDetail
    });
  }
  return checks;
}

export function creditsHtml(credits) {
  if (!credits || !credits.owner || !credits.owner.login) {
    return `<div class="credits-wait">Buscando os contribuidores no GitHub… precisa do <code>gh</code> autenticado; a lista aparece sozinha quando a busca responder.</div>`;
  }
  const own = credits.owner;
  const ownName = own.name && own.name.toLowerCase() !== own.login.toLowerCase() ? `<span class="credits-name">${esc(own.name)}</span>` : '';
  // o idealizador tem card próprio; na lista geral ele não repete
  const rest = (credits.contributors || []).filter(c => (c.login || '').toLowerCase() !== own.login.toLowerCase());
  const linhas = rest.map(c =>
    `<div class="credits-item">${personMention(c.login, 'sm')}<span class="credits-meta">${plural(c.contributions | 0, 'contribuição', 'contribuições')}</span></div>`
  ).join('');
  return `
    <div class="credits-founder">
      ${personMention(own.login)}
      <span class="credits-role">Idealizador e mantenedor${ownName ? ' · ' : ''}${ownName}</span>
    </div>
    ${rest.length ? `<div class="credits-sub">Contribuidores</div><div class="credits-grid">${linhas}</div>` : ''}
    <div class="credits-foot">Lista sincronizada com ${repoMention(credits.repo)} no GitHub: quem contribui no repositório entra aqui automaticamente.</div>`;
}

// Monta um prompt pronto pra colar no chat que está resolvendo o PR, a partir
// dos pontos da autoanálise (blockers = travam a aprovação; tips = melhorias).
// PURA: recebe os dados já coletados do STATE/DOM (o app.js faz essa coleta),
// devolve só a string do prompt. Migrada do app.js na Task 12.
export function buildFixPrompt(args = {}) {
  const { key, url, title, card, summary, blockers: rawBlockers, tips: rawTips } = args;
  const blockers = (rawBlockers || []).filter(Boolean);
  const tips = (rawTips || []).filter(Boolean);
  const abre = blockers.length
    ? `Preciso que você corrija os pontos levantados na revisão do PR ${key}, começando pelo que trava a aprovação.`
    : `Preciso que você aplique as melhorias sugeridas na revisão do PR ${key}.`;
  const linhas = [abre, ''];
  if (url) linhas.push(`PR: ${url}`);
  if (title) linhas.push(`Título: ${title}`);
  if (card) linhas.push(`Card: ${card}`);
  if (summary) { linhas.push('', `Resumo da revisão: ${summary}`); }
  if (blockers.length) { linhas.push('', 'Pendências que travam a aprovação (prioridade):', ...blockers.map(b => `- ${b}`)); }
  if (tips.length) { linhas.push('', 'Melhorias sugeridas:', ...tips.map(t => `- ${t}`)); }
  linhas.push('', 'Implemente as correções no código, rode os testes e o lint que fizerem sentido, e no final me diga o que mudou e por quê.');
  return linhas.join('\n');
}

function contaLinhaDiag(a) {
  const primaria = a.primary ? ' [primária]' : '';
  const silenciada = a.muted ? ' · silenciada' : '';
  const token = a.tokenOk ? 'ok' : 'NAO';
  const orgs = (a.owners || []).join(',') || '-';
  return `  @${a.user}${primaria} · rótulo=${a.label || '-'} · tipo=${a.kind || '-'} · orgs=${orgs} · token=${token}${silenciada}`;
}

function assinaturaLinhaDiag(p) {
  const rotulo = p.label ? ' [' + p.label + ']' : '';
  const onde = p.configDir ? 'dir próprio (' + p.configDir + ')' : 'padrão da máquina';
  const conta = p.account ? ' · conta ' + p.account : '';
  const semLogin = p.ready === false ? ' · SEM LOGIN (rode: claude login nesse dir)' : '';
  return `  assinatura Claude${rotulo}: ${onde}${conta}${semLogin}`;
}

function atualizacaoLinhaDiag(u) {
  if (!u) return '?';
  const alvo = u.available ? 'v' + u.sourceVersion + ' DISPONÍVEL' : 'na mais recente';
  const repo = u.repo ? ' ' + u.repo : '';
  const nota = u.note ? ' · ' + u.note : '';
  return `v${u.current} · ${alvo} (${u.channel}${repo})${nota}`;
}

export function diagnosticsText(ctx = {}) {
  const s = ctx.s || {};
  const log = ctx.log || [];
  const grupos = ctx.grupos || [];
  const tail = ctx.tail || 40;
  const d = s.doctor || {};
  const c = s.config || {};
  const contas = s.accounts || [];
  const accts = contas.map(contaLinhaDiag).join('\n');
  const erroSuf = s.error ? ' · último erro: ' + s.error : '';
  const ghAuth = d.ghAuth ? 'sim' : 'NAO';
  const eventos = grupos.reduce((n, g) => n + g.count, 0);
  // resumo primeiro, detalhe depois: quem lê o relatório precisa saber QUANTOS
  // episódios distintos existem antes de encarar linha crua.
  const resumo = grupos.length ? ['  Resumo:', ...logSummaryLines(grupos).map(l => '    ' + l), ''] : [];
  const cabecalhoDetalhe = `  Detalhe (as ${Math.min(log.length, tail)} linhas mais recentes):`;
  const detalhe = log.length ? [cabecalhoDetalhe, ...logTailLines(log, tail)] : ['  (sem falhas registradas)'];
  return [
    '=== Farol · diagnóstico ===',
    `gerado: ${ctx.agora || '?'}`,
    `versão: v${s.app?.version || '?'} · plataforma: ${s.app?.platform || '?'} · node: ${d.node || '?'}`,
    `status: ${s.status || '?'}${erroSuf}`,
    '',
    'Ambiente (doctor):',
    `  gh: ${d.gh || 'NAO ENCONTRADO'}`,
    `  claude: ${d.claude || 'NAO ENCONTRADO'}`,
    ...(d.claudeAuth || []).map(assinaturaLinhaDiag),
    `  git bash: ${d.gitBash || '(n/a)'}`,
    `  conta primária autenticada no gh: ${ghAuth}`,
    `  workspace: ${d.workspace || s.paths?.workspace || '?'}`,
    `  home: ${s.paths?.home || '?'}`,
    // só aparece quando dói: uid 0 mata toda revisão autônoma no spawn, e o
    // relatório é justamente o que a pessoa cola quando "não funciona e não sei por quê"
    ...(d.root ? ['  ATENÇÃO: rodando como root (uid 0), o claude recusa --dangerously-skip-permissions e nenhuma revisão autônoma consegue abrir'] : []),
    '',
    `Contas (${contas.length}):`,
    accts || '  (nenhuma)',
    '',
    'Config:',
    `  intervalo: ${c.intervalSeconds}s · autoReview: ${!!c.autoReview} · autoApproveAll: ${c.autoApproveAll !== false} · autoApproveContested: ${c.autoApproveContested === true} · skipPermissions: ${!!c.skipPermissions}`,
    `  autostart: ${!!c.autostart} · som: ${!!c.soundEnabled} · tema: ${c.theme || '-'}`,
    `  updateRepo: ${c.updateRepo || '-'} · updateSource: ${c.updateSource || '(release)'}`,
    `  mergeBlockedRepos: ${(c.mergeBlockedRepos || []).join(', ') || '-'}`,
    '',
    'Estado agora:',
    `  fila: ${(s.queue || []).length} · panorama: ${(s.panorama || []).length} · meus PRs: ${(s.myPRs || []).length} · decisões pendentes: ${(s.decisions?.pending || []).length} · sessões ativas: ${(s.activeSessions || []).length}`,
    `  atualização: ${atualizacaoLinhaDiag(s.update)}`,
    '',
    // evento = linha com timestamp; o total de LINHAS é maior porque mensagem de erro
    // multilinha (gh, cmd.exe) ocupa mais de uma. Dizer só "159 linhas" e depois "146
    // eventos" na linha de leitura confundia, então o cabeçalho traz os dois.
    `Log de falhas (${eventos} evento(s) em ${grupos.length} grupo(s), ${log.length} linha(s)):`,
    ...resumo,
    ...detalhe,
    '',
    '(este relatório não contém tokens nem senhas)'
  ].join('\n');
}
