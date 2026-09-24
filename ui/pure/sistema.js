// A aba Sistema: o log de falhas agrupado, regime contra episódio, os checks de operação e
// de runtime e o texto do diagnóstico. Extraído do ui/pure.js na
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
// Diagnóstico: é a única saída do app que alguém lê fora do app, então mudança aqui é
// mudança de contrato com quem socorre.
// Cada ternário do diagnosticsText mora no seu próprio `const` porque o ratchet conta '?'
// por statement; juntá-los faria o contador subir sem nada ter piorado.

// '2026-08-07 17:32:15' -> '07/08 17:32'. RECORTE DE TEXTO de proposito: o farol.log
// ja grava em horario LOCAL, entao passar por new Date() so criaria chance de mover a
// hora que a pessoa le no arquivo. Carimbo que nao casa volta como veio, nunca vira
// "Invalid Date" na tela.
import { esc, escAttrSelector, fmtClock, fmtSpan, fmtWhenDay, plural } from './comum.js';

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
    // conta que estourou o limite de requisições do GitHub: o ambiente está verde, a
    // conta tem token e orgs, e mesmo assim nada é buscado por ela até o limite
    // renovar. Sem esta linha o painel fica parado sem dizer por quê, que é o defeito
    // de origem desta dimensão. Mesmo rótulo, porque é o mesmo assunto: o monitoramento.
    if (Number(a.limiteGhAte) > 0) {
      return { ok: false, label: `Monitoramento de @${a.user}`, goto: alvo(a.user),
        detail: `no limite de requisições do GitHub: as buscas desta conta voltam às ${fmtClock(Number(a.limiteGhAte))}` };
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

/* As opções dos seletores de modelo (24/09/2026). Elas moravam fixas no ui/index.html,
   uma segunda lista das seleções que o engine aceita, com textos próprios; hoje vêm do
   catálogo do engine (lib/modelos.js) pelo snapshot, em estado().modelos. Sem catálogo
   nenhuma opção é inventada. */
export function opcoesDeModeloHtml(lista) {
  if (!Array.isArray(lista)) return '';
  return lista.map((s) => `<option value="${esc(s.valor)}">${esc(s.rotulo)}</option>`).join('');
}

/* A seleção aceita nível de esforço? A resposta é a do catálogo (o Haiku não aceita, o
   Auto escolhe o esforço sozinho). Valor fora do catálogo, fixado à mão no config.json,
   aceita: quem tem a palavra final é o engine, que reconhece a família pelo nome. */
export function selecaoAceitaEsforco(lista, valor) {
  const s = Array.isArray(lista) ? lista.find((x) => x.valor === valor) : null;
  return s ? s.aceitaEsforco !== false : true;
}

/* Versão do Claude Code (24/09/2026). O Farol pede o modelo por APELIDO (`opus`,
   `sonnet`, `haiku`), e quem decide para onde o apelido aponta é o CLI, versão a versão.
   Com o CLI parado na 2.1.268, o `opus` seguia num modelo que a página oficial já lista
   como legado, e o check "Claude Code" continuava verde, porque ele só pergunta se o CLI
   EXISTE. Este pergunta se ele está em dia, e por isso tem rótulo próprio: dois checks
   chamados "Claude Code" leriam como linha duplicada.

   Sem leitura (registro fora do ar, CLI ausente), o check não aparece: um verde que
   ninguém conferiu é pior que nenhum. Sem `goto`, porque nenhuma tela do app atualiza o
   CLI: o que resolve é um comando no terminal, e o texto diz qual. */
export function versaoClaudeCheck(v) {
  if (!v || !v.instalada) return [];
  const label = 'Versão do Claude Code';
  if (v.atualizada) return [{ ok: true, label, detail: `${v.instalada}, a mais recente` }];
  if (!v.atrasada) {
    return [{ ok: true, label, detail: `${v.instalada}; a ${v.maisRecente} saiu há pouco, atualize quando puder (claude update)` }];
  }
  return [{
    ok: false, label,
    detail: `${v.instalada}, atrás desde ${fmtWhenDay(v.atrasadaDesde)} (a mais recente é a ${v.maisRecente}). `
      + 'O modelo das revisões acompanha o CLI: com ele atrasado, o apelido do modelo pode estar '
      + 'num modelo antigo. Atualize com: claude update',
  }];
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
export function runtimeChecks(doctor, config = {}, claudePerfis = {}) {
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
  for (const p of (claudePerfis && Array.isArray(claudePerfis.problemas)) ? claudePerfis.problemas : []) {
    checks.push({ ok: false, label: 'Perfil de assinatura', goto: 'sys:plans:#claudeProfilesManager', detail: perfilProblemaTexto(p) });
  }
  return checks;
}

// A2: o texto diz o que a sessão FAZ nesse caso (cai na assinatura legada da máquina), sem
// fingir que o perfil escolhido está valendo.
function perfilProblemaTexto(p) {
  const onde = p.escopo === 'conta' ? `a conta @${p.user}` : 'o padrão do Farol';
  const causa = p.code === 'perfil-invalido'
    ? `aponta para o perfil "${p.profileId}", que está incompleto (falta a pasta ou a chave)`
    : `aponta para o perfil "${p.profileId}", que não existe mais`;
  return `${onde} ${causa}: as sessões dela estão usando a assinatura legada da máquina até você escolher outro perfil`;
}


/* O export de diagnóstico montado na tela saiu na A3 (16/09/2026): o texto que a pessoa
   copia passou a ser o Markdown único do engine (lib/engine/diagnostico.js, GET
   /api/diagnostics), que já sai mascarado, inerte e sem e-mail nem caminho de máquina.
   Eram três superfícies dizendo a mesma coisa de jeitos diferentes, e a que morava aqui
   juntava contas e configuração no mesmo texto copiado. */

// O que o servidor recusou num salvamento de preferências, em frase de toast. Vazio
// quando tudo entrou. Um texto só para os três salvamentos da tela: cada handler olhando
// a própria chave escondia a recusa das outras.
export function settingsIgnoradasTexto(r) {
  const lista = r && Array.isArray(r.ignoradas) ? r.ignoradas.filter((k) => typeof k === 'string' && k) : [];
  if (!lista.length) return '';
  const nomes = lista.map((k) => `"${k}"`).join(', ');
  if (lista.length === 1) return `${nomes} não foi salva: o servidor não reconhece essa preferência.`;
  return `${nomes} não foram salvas: o servidor não reconhece essas preferências.`;
}
