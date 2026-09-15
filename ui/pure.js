'use strict';
/* Funcoes PURAS da UI: so dependem dos argumentos. Nao tocam DOM, nao leem STATE nem
   nenhuma global mutavel, e por isso sao as unicas do front que da pra testar com
   `node --test`. Sairam do ui/app.js, que tem ~2700 linhas e nunca teve teste nenhum
   (e a Onda 4 do docs/QUALITY.md).

   Carregado das duas pontas, sem build step: o navegador le por <script src> antes do
   app.js (as funcoes ficam no escopo global, exatamente como estavam), e o node le pelo
   rodape CommonJS la embaixo. `typeof module` no navegador e 'undefined' e nao lanca.

   REGRA: so entra aqui o que for puro. Funcao que precise de STATE, SCOPE ou document
   fica no app.js; se quiser trazer, passe o que ela le como parametro primeiro. */

// Fachada: o conteúdo mora em ui/pure/*.js desde a Fase 1a da reorganização. Cada linha
// de `export *` reexporta um módulo inteiro; nome novo nasce no módulo, nunca aqui.
export * from './pure/autoanalise.js';
export * from './pure/comum.js';
export * from './pure/consumo.js';
export * from './pure/entregas.js';
export * from './pure/fila-justa.js';
export * from './pure/mencoes.js';
export * from './pure/meus-prs.js';
export * from './pure/pessoas.js';
export * from './pure/radar.js';
export * from './pure/review.js';
export * from './pure/sessao.js';
export * from './pure/sync.js';
// Imports de volta: o `export *` reexporta sem trazer nome nenhum para o escopo deste
// arquivo, e o que ainda mora aqui chama estes nomes. A lista é derivada do uso e some
// sozinha quando o último consumidor sair.
import { esc, escAttrSelector, fmtMoney, fmtSpan, plural } from './pure/comum.js';
import { personMention, repoMention } from './pure/mencoes.js';

/* ---------- folhas: sem dependencia nenhuma ---------- */


// escopo salvo no navegador validado contra as contas atuais: conta removida ou
// renomeada deixava um escopo orfao que esvaziava o Radar pra sempre (B15).
// Compara sem caixa e preserva o valor original quando ele e valido.
export function validScope(scope, users) {
  if (!scope || scope === 'all') return 'all';
  const s = String(scope).toLowerCase();
  return (users || []).some(u => String(u).toLowerCase() === s) ? scope : 'all';
}

// abas onde a barra de contas APARECE: so onde o filtro por conta age de verdade
// (Radar, Destaques e Time filtram/agrupam por SCOPE). Allowlist, nao denylist:
// a Entregas nasceu depois e ficou mostrando um filtro que nao filtrava nada (B14);
// aba nova nasce SEM a barra ate alguem decidir que ela respeita o escopo.
export function accountBarVisible(nContas, tab) {
  return nContas >= 2 && (tab === 'radar' || tab === 'destaques' || tab === 'time');
}


export function accountSaveArray(list) {
  return (list || []).map(a => {
    const o = { user: a.user, owners: a.owners || [], label: a.label, color: a.color, kind: a.kind || '', muted: !!a.muted };
    if (a.autoReview === true || a.autoReview === false) o.autoReview = a.autoReview;
    if (a.onClean === 'approve' || a.onClean === 'wait') o.onClean = a.onClean;
    if (a.onCaveats === 'approve' || a.onCaveats === 'wait') o.onCaveats = a.onCaveats;
    if (a.onReject === 'request_changes' || a.onReject === 'wait') o.onReject = a.onReject;
    if (a.claudeProfileId) o.claudeProfileId = a.claudeProfileId;
    // peso da conta no rateio da cota do perfil (Politica 2). O serializador so decide
    // se o campo VIAJA (ausente = padrao, e ausente nao vira `undefined` no JSON); o que
    // conta como peso valido e decidido num lugar so, o parseAccounts do server, que e a
    // fronteira de persistencia. Repetir a regra aqui seria uma terceira copia dela.
    if (a.budgetWeight != null && a.budgetWeight !== '') o.budgetWeight = a.budgetWeight;
    return o;
  });
}


/* ---------- log de falhas agrupado (Diagnostico e aba Sistema) ----------
   O agrupamento em si e do lib/log-taxonomy.js (triage), servido em /api/log/triage:
   a UI nao pode dar require num modulo de lib/ (carrega por <script src>, sem build
   step), entao ela consome o JSON. O que mora aqui e SO a formatacao.

   Motivo de existir: o farol.log real tinha 159 linhas que eram 146 eventos de 4
   episodios (70 de limite de plano, 35 de assinatura desligada, 16 de credencial e
   credito, 13 de rede). O Diagnostico despejava as 159 cruas, e "1 problema repetido
   70 vezes" ficava indistinguivel de "70 problemas". */

// '2026-08-07 17:32:15' -> '07/08 17:32'. RECORTE DE TEXTO de proposito: o farol.log
// ja grava em horario LOCAL, entao passar por new Date() so criaria chance de mover a
// hora que a pessoa le no arquivo. Carimbo que nao casa volta como veio, nunca vira
// "Invalid Date" na tela.
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

/* ---------- regime x episódio: a TAXA da janela ----------
   Caso real (24/08/2026): o diagnóstico dizia "101 eventos se resolvem sozinhos, 0
   exigem ação humana" sobre 6 horas ININTERRUPTAS de falha de rede, madrugada
   inclusive. Cada evento se resolvia mesmo, e ainda assim a leitura estava errada:
   somar episódios transitórios e concluir tranquilidade esconde que aquilo não é
   episódio, é REGIME. Nesse ritmo, busca perdida e postagem que morre no meio
   voltam a acontecer o dia inteiro, e isso é decisão de gente (trocar de rede,
   cobrar o provedor), não do app.

   O cálculo é sobre o que o triage já entrega (`first`/`last`/`count`), então não
   custa dado novo. */

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

/* ---------- "Meus PRs": PR oculto ----------
   Motivo: experimento velho que nunca vai mergear ficava pra sempre na aba (havia PR
   pessoal parado ha 750 dias) e nao existia jeito de tirar da frente. O motor guarda as
   chaves ocultas (snapshot.hiddenPRs) e continua mandando myPRs COMPLETO: quem esconde
   e a UI, e por isso a separacao mora aqui, pura e testada.
   Ocultar nao e pra sempre: atividade nova no PR faz o motor reexibir sozinho. */


/* ---------- folhas com relogio: a hora entra por parametro, com default, pra dar pra testar ---------- */


/* ---------- ciclo de vida das operacoes (widgets showOp/updateOp/closeOp da UI) ---------- */


/* ---------- dependem das folhas ---------- */


/* ---------- checks de OPERAÇÃO (aba Sistema, ao lado dos de ambiente) ----------
   Os 5 checks que já existiam (gh, conta primária, Claude Code, Git Bash, pasta)
   respondem "o Farol consegue rodar?". Nenhum responde "o Farol vai achar
   alguma coisa?", e essa é a pergunta que fica sem resposta quando a tela vem
   vazia. O caso que motivou (Wanderson, 11/08/2026): conta cadastrada SEM
   organização nenhuma deixa os 5 verdes e o painel vazio pra sempre, porque o
   fan-out da busca é `accountList().flatMap(acc => acc.owners...)`: sem owner,
   a lista de alvos é vazia e o gh nunca é chamado. Silêncio total.

   Um check por conta (dizer QUAL conta é o que torna acionável com várias) mais
   um agregado pro caso de tudo silenciado. Sem conta nenhuma devolve vazio: aí
   quem fala é o banner de boas-vindas, e dois avisos pro mesmo problema é ruído. */
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


/* ---------- os três eixos de "por que isto está na sua mesa" ----------
   A pergunta que o agrupamento responde é a que o biud-frontend#774 deixou sem
   resposta: dos N motivos listados, quais foram JULGAMENTO da revisão, quais são
   regra deliberada do app e qual foi só a rede caindo? Numa lista plana os três
   se confundiam, e um 503 do GitHub lia igual a uma ressalva técnica sobre o
   código, o que fazia a automação parecer quebrada quando não estava.
   A ordem é a de quem lê: falha técnica primeiro (é a única acionável agora e
   costuma ser a que segurou tudo), regra depois (explica o comportamento), e o
   que a revisão achou por último (é o conteúdo, não o motivo do bloqueio). */


/* ---------- card de commit novo (pendência stale_head, v2.59.3) ----------
   A tela diz quem está com a bola. Até a v2.59.2 o card mandava "Peça uma revisão
   nova" e oferecia Aprovar/Pedir mudanças sobre um texto ancorado no commit anterior,
   num caso em que o round automático ia revisar sozinho minutos depois
   (Edicoes-CNBB/biblioteca-cnbb-api#22, 09/09/2026). O estado vem do engine
   (reRoundParaUi, lib/engine/review.js); aqui só vira frase. */


/* ---------- fila: o vazio que CONFIRMA ----------
   Sexto passo da onda 5. Vazio bom merece confirmar o que o app fez, nao so dizer que
   nao tem nada: quantos PRs foram aprovados sozinhos hoje, quais orgs sao monitoradas
   e de quanto em quanto tempo. Tudo isso e texto derivado de estado, entao e puro.

   `aprovadosHoje` continua no pure.js e e chamada pelo app.js, nao aqui: ela le
   `decisions.resolved`, que e estado, e o construtor recebe so o numero pronto. */


/* ---------- banner do topo ----------
   Sexto passo da onda 5. Os tres avisos que o banner pode mostrar (sem conta, conta
   sem token, falha na ultima checagem) sao decisao de TEXTO, nao de DOM: quem esconde
   e mostra o elemento continua no app.js.

   A forma e `if` plano de proposito, nao ternario encadeado: medido com scanFile, a
   escada de ternarios subiria o ternarioAninhado do pure.js de 16 pra 17, e o arquivo
   nao tem folga nenhuma nesse eixo.

   Sem `?.` tambem de proposito: snapshot sem `account` tem que explodir alto, como
   explode hoje, em vez de virar silenciosamente "Nenhuma conta detectada" e mentir
   pra quem esta olhando. */
export function statusBannerHtml(s = {}) {
  const partindo = s.status === 'starting';
  if (!s.account.user && !partindo) {
    return 'Bem-vindo ao Farol! Nenhuma conta do GitHub foi detectada. Rode <code>gh auth login</code> no terminal (conta de trabalho) e clique em Verificar agora.';
  }
  if (!s.account.tokenOk && !partindo) {
    return `A conta <b>${esc(s.account.user)}</b> não está autenticada no GitHub CLI. Rode <code>gh auth login</code> no terminal e clique em Verificar agora.`;
  }
  if (s.status === 'error' && s.error) {
    return `Falha na última checagem: ${esc(s.error)}. Vou tentar de novo no próximo ciclo.`;
  }
  return '';
}

/* ---------- painel Sistema: perfis do Claude e contas ----------
   Saiu do app.js na onda 5, quinto passo. Mesmo padrão dos anteriores: o render lê o
   estado e atribui; o CONSTRUTOR só recebe um ctx e devolve string.

   Dois pedaços ficaram no app.js de propósito, porque são DOM e não markup: o guarda
   de foco (não reconstruir enquanto a pessoa digita num campo do bloco) e o
   `hint.hidden = true` do fim dos perfis, que o listener do seletor desfaz. */

// ` selected` de <option>: o padrão aparecia doze vezes no mesmo template da linha
// de conta, e cada repetição contava como ternário no gate. Um nome resolve as doze
// e o markup fica legível: `${sel(a.onClean === 'approve')}` em vez do ternário inteiro.
function sel(cond) { return cond ? ' selected' : ''; }

// Selo do teto estourado. Os motivos `-previsto` dizem que o gasto ainda NÃO
// passou do teto, mas a próxima revisão passaria: é a diferença entre "acabou" e
// "a próxima não cabe", e a ação de quem lê é diferente em cada caso.
function seloOrcamento(budget) {
  const eixo = String(budget.reason || '').startsWith('total') ? 'orçamento total' : 'orçamento diário';
  if (String(budget.reason || '').endsWith('-previsto')) {
    const custo = Number(budget.tipicoReview || 0).toFixed(2);
    return `<span class="a-claude bad" title="a próxima revisão (US$ ${custo} em média) passaria do ${eixo}, então a automação pausou antes de gastar (clique manual continua liberado)">🔴 ${eixo} no limite</span>`;
  }
  return `<span class="a-claude bad" title="${eixo} estourado, automação pausada (clique manual continua liberado)">🔴 ${eixo} estourado</span>`;
}

export function claudeAuthBadge(id, ctx) {
  const all = (ctx.doctor && ctx.doctor.claudeAuth) || [];
  // servidor sempre inclui a entrada '' (padrão da máquina/legado), mesmo com perfis
  // salvos - então id === '' (padrão global sem override, ou conta sem claudeProfileId
  // próprio) acha essa entrada direto. all[0] fica só como último recurso pra doctorInfo
  // ainda não ter chegado num formato esperado (nunca devolve string vazia à toa).
  const info = all.find(x => x.id === id) || all.find(x => x.id === '') || all[0] || null;
  if (!info) return '';
  if (info.apiKeyMode && !info.ready) return `<span class="a-claude bad" title="Perfil de chave de API sem chave preenchida">SEM CHAVE</span>`;
  if (info.openrouterMode && !info.ready) return `<span class="a-claude bad" title="Perfil OpenRouter sem chave preenchida">SEM CHAVE</span>`;
  // bloqueio de orçamento vem de ctx.usage.budgets (fonte única, viva a cada
  // pushState, v2.40.0); o doctor parou de carregar blocked/reason, e este selo
  // lia de lá (achado da revisão adversarial: o ramo tinha virado código morto).
  // Desde a v2.48.4 o selo vale pros dois tipos de perfil, porque o teto também vale.
  const budget = ((ctx.usage && ctx.usage.budgets) || []).find(b => b.id === (info.id || id)) || {};
  if (budget.blocked) return seloOrcamento(budget);
  if (info.codexMode) {
    const ok = ctx.doctor && ctx.doctor.codexChatGPT === true;
    const detail = (ctx.doctor && ctx.doctor.codexLoginDetail) || 'rode codex login e confirme codex login status';
    return ok
      ? '<span class="a-claude ok" title="Codex CLI autenticado no plano ChatGPT">Codex ChatGPT</span>'
      : `<span class="a-claude bad" title="${esc(detail)}">SEM CODEX</span>`;
  }
  if (info.openrouterMode) return '<span class="a-claude ok" title="Claude Code via OpenRouter (Anthropic Skin)">OpenRouter</span>';
  if (info.apiKeyMode) return `<span class="a-claude ok" title="Autenticação por chave de API">🔑 chave configurada</span>`;
  if (info.ready === false) return `<span class="a-claude bad" title="rode claude login nesse diretório">SEM LOGIN</span>`;
  if (info.account) return `<span class="a-claude ok" title="${esc(info.configDir || 'padrão da máquina')}">@${esc(info.account)}</span>`;
  return `<span class="a-claude" title="${esc(info.configDir || 'padrão da máquina')}">${info.configDir ? 'logada' : 'padrão da máquina'}</span>`;
}

/* ---------- editor de orçamento por perfil (v2.50.0) ----------
   Centralizado: o MESMO bloco vale pra perfil de assinatura e de chave de API
   (Claude, OpenRouter, qualquer um), e cada perfil guarda o seu, independente.
   Três granularidades, do geral pro específico, que é a mesma ordem em que o
   dailyCapFor resolve: teto base, teto por dia da semana, teto de uma data só. */
const DIAS_DO_TETO = [
  { dow: '1', nome: 'seg' }, { dow: '2', nome: 'ter' }, { dow: '3', nome: 'qua' },
  { dow: '4', nome: 'qui' }, { dow: '5', nome: 'sex' },
  { dow: '6', nome: 'sáb' }, { dow: '0', nome: 'dom' },
];

const CAP_ORIGEM_LABEL = { data: 'só hoje', semana: 'deste dia da semana', base: 'padrão' };

// valor de input numérico: campo vazio quando não há teto (placeholder explica),
// nunca 0, porque 0 é um teto VÁLIDO que bloqueia tudo e seria mentira mostrá-lo
function valorTeto(v) { return Number.isFinite(v) ? v : ''; }

function linhaGastoHoje(info) {
  if (!info) return '';
  const gasto = fmtMoney(info.today || 0);
  if (!Number.isFinite(info.capHoje)) return `Hoje: ${gasto} (sem teto)`;
  const origem = CAP_ORIGEM_LABEL[info.capOrigem] || '';
  const marca = info.capOrigem === 'base' ? '' : ` · teto ${origem}`;
  return `Hoje: ${gasto} de ${fmtMoney(info.capHoje)}${marca}`;
}

function botaoSugestao(p, info) {
  // some assim que existe teto salvo: sugestão é ajuda pra começar, não conselho
  // permanente, e um botão que reescreve o que a pessoa configurou seria hostil
  const sugestao = info && info.sugestaoDiaria;
  if (!sugestao || Number.isFinite(p.budgetDaily)) return '';
  // arredonda em centavos: o valor cru é uma mediana com 9 casas, e ela ia parar
  // dentro do config.json e do campo da tela do jeito que saiu da conta
  const emCentavos = Math.round(sugestao * 100) / 100;
  return `<button class="btn sm ghost cp-usar-sugerido" data-id="${esc(p.id)}" data-valor="${emCentavos}"
    title="Mediana do que você gastou nos dias úteis dos últimos 30 dias. Só passa a valer depois de salvar.">usar ${esc(fmtMoney(sugestao))}</button>`;
}

function campoDia(p, d) {
  const v = valorTeto((p.budgetByWeekday || {})[d.dow]);
  return `<label class="cp-dow"><span>${esc(d.nome)}</span>
    <input class="cp-budget-dow" type="number" min="0" step="0.01" data-id="${esc(p.id)}" data-dow="${d.dow}" value="${v}" placeholder="padrão"></label>`;
}

function linhaData(p, dia, valor) {
  return `<li><span class="cp-data-dia">${esc(dia)}</span><span class="cp-data-valor">${esc(fmtMoney(valor))}</span>
    <button class="btn icon sm ghost cp-budget-date-del" data-id="${esc(p.id)}" data-dia="${esc(dia)}" title="Remover o teto desta data" aria-label="Remover o teto desta data">✕</button></li>`;
}

function listaDeDatas(p) {
  const datas = Object.entries(p.budgetDates || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (!datas.length) return '<p class="a-hint">Nenhuma data com teto próprio.</p>';
  return `<ul class="cp-datas">${datas.map(([dia, v]) => linhaData(p, dia, v)).join('')}</ul>`;
}

export function budgetEditorHtml(p, info) {
  const id = esc(p.id);
  return `<div class="cp-budget">
    <div class="cp-budget-head"><strong>Orçamento</strong><span class="a-hint">${esc(linhaGastoHoje(info))}</span></div>
    <div class="a-editrow">
      <input class="cp-budget-daily" type="number" min="0" step="0.01" data-id="${id}" value="${valorTeto(p.budgetDaily)}" placeholder="Teto por dia (US$, opcional)">
      ${botaoSugestao(p, info)}
    </div>
    <div class="a-editrow">
      <input class="cp-budget-total" type="number" min="0" step="0.01" data-id="${id}" value="${valorTeto(p.budgetTotal)}" placeholder="Teto total (US$, opcional)">
      <input class="cp-budget-since" type="date" data-id="${id}" value="${esc(p.budgetSince || '')}" title="Contar o teto total a partir desta data">
    </div>
    <details class="cp-budget-mais">
      <summary>Ajustar por dia</summary>
      <div class="a-editrow cp-atalhos">
        <button class="btn sm ghost cp-budget-uteis" data-id="${id}" title="Copia o teto por dia para segunda a sexta">aplicar aos dias úteis</button>
        <button class="btn sm ghost cp-budget-fds" data-id="${id}" title="Copia o teto por dia para sábado e domingo">aplicar ao fim de semana</button>
        <button class="btn sm ghost cp-budget-limpa-dow" data-id="${id}" title="Remove os tetos por dia da semana (volta todos ao padrão)">limpar</button>
      </div>
      <div class="cp-dows">${DIAS_DO_TETO.map(d => campoDia(p, d)).join('')}</div>
      <p class="a-hint">Dia em branco usa o teto por dia lá de cima.</p>
      <div class="a-editrow">
        <input class="cp-budget-date-new" type="date" data-id="${id}" title="Data com teto próprio">
        <input class="cp-budget-date-val" type="number" min="0" step="0.01" data-id="${id}" placeholder="Teto só nesse dia (US$)">
        <button class="btn sm cp-budget-date-add" data-id="${id}">adicionar</button>
      </div>
      ${listaDeDatas(p)}
    </details>
  </div>`;
}

function profileFieldsHtml(p, isApiKey, isCodex, isOpenRouter, camposChave, camposDir, camposOrcamento, camposOpenRouter) {
  if (isCodex) {
    return '<div class="a-hint">Usa o Codex CLI local com login ChatGPT. O Farol registra os tokens das automações, mas o CLI não informa saldo da cota nem custo por sessão. Use o botão de login se o diagnóstico acusar falta de autenticação.</div>';
  }
  if (isOpenRouter) return camposOpenRouter + camposOrcamento;
  if (isApiKey) return camposChave + camposOrcamento;
  return camposDir + camposOrcamento;
}

export function claudeProfilesHtml(ctx) {
  const c = ctx.config || {};
  const profiles = c.claudeProfiles || [];
  // migração: legado preenchido e nenhum perfil salvo ainda -> oferece virar o primeiro perfil
  // o template sai pra um nome porque a interrogacao dentro dele e TEXTO da UI, a
  // pergunta que o cartao faz pra pessoa, e o gate nao distingue prosa de ternario:
  // na mesma linha do ternario, os dois somavam 2
  const cartaoMigracao = `<div class="card acct-add">
    <div class="a-add-title">Perfil atual detectado</div>
    <div class="a-hint">Você já tem um diretório configurado: <code>${esc(c.claudeConfigDir)}</code>. Salvar como o primeiro perfil?</div>
    <div class="a-editrow">
      <input id="claudeMigrateLabel" placeholder="nome do perfil" value="Perfil atual" spellcheck="false">
      <button class="btn sm" id="btnClaudeMigrate">Salvar como perfil</button>
    </div>
  </div>`;
  const migrateCard = (!profiles.length && c.claudeConfigDir) ? cartaoMigracao : '';
  // se o legado (claudeConfigDir) ainda estiver preenchido, "Padrão da máquina" na
  // verdade cai nele por baixo dos panos (ver resolveClaudeConfigDir) - deixa isso
  // visível aqui, já que a Task 6 tirou o campo texto que mostrava esse valor.
  const defaultEmptyLabel = c.claudeConfigDir ? `Padrão da máquina (legado: ${esc(c.claudeConfigDir)})` : 'Padrão da máquina';
  const defaultOptions = [`<option value="">${defaultEmptyLabel}</option>`]
    .concat(profiles.map(p => `<option value="${esc(p.id)}"${sel(c.claudeProfileId === p.id)}>${esc(p.label)}</option>`))
    .join('');
  // botão de login da linha padrão: data-id dinâmico (era fixo "" antes desta feature,
  // então sempre abria o legado ao clicar, mesmo com outro perfil selecionado no dropdown
  // - bug preexistente, corrigido junto por ser exigido pra esconder o botão certo).
  const defaultProfile = profiles.find(p => p.id === (c.claudeProfileId || ''));
  const defaultNeedsClaudeLogin = !defaultProfile
    || (defaultProfile.kind !== 'apikey' && defaultProfile.kind !== 'openrouter');
  const defaultLoginBtn = defaultNeedsClaudeLogin ? `<button class="btn sm cp-login" data-id="${esc(c.claudeProfileId || '')}">Abrir sessão de login</button>` : '';
  const defaultRow = `<div class="card set-row">
    <div class="set-txt">
      <span class="set-title">Perfil padrão do Farol</span>
      <span class="set-desc">Vale pra toda conta do GitHub que não tiver um perfil próprio (painel Contas).</span>
    </div>
    <div class="set-ctl">
      <select id="claudeProfileDefault">${defaultOptions}</select>
      ${defaultLoginBtn}
    </div>
  </div>`;
  const rows = profiles.map(p => {
    const isApiKey = p.kind === 'apikey';
    const isCodex = p.kind === 'codex';
    const isOpenRouter = p.kind === 'openrouter';
    // gasto vem de ctx.usage.budgets (fonte unica do orcamento, viva a cada
    // pushState), nunca mais do cache do doctor, que congelava o "Hoje" daqui
    // enquanto a aba Consumo andava (v2.40.0)
    // desde a v2.48.4 o teto vale pros DOIS tipos de perfil, então o gasto é
    // buscado pros dois (era só apikey: perfil de assinatura não tinha teto)
    const budgetInfo = ((ctx.usage && ctx.usage.budgets) || []).find(x => x.id === p.id);
    // todo o orçamento sai de budgetEditorHtml: um bloco só, igual pros dois
    // tipos de perfil (assinatura e chave), com teto base, por dia da semana e
    // por data única. Duplicar aqui faria um dos tipos envelhecer sozinho.
    const camposOrcamento = budgetEditorHtml(p, budgetInfo);
    const camposChave = `
      <div class="a-editrow">
        <input class="cp-apikey" type="password" data-id="${esc(p.id)}" value="${esc(p.apiKey || '')}" placeholder="chave de API" spellcheck="false" autocomplete="off">
        <button class="btn icon sm ghost cp-toggle-key" data-id="${esc(p.id)}" title="Mostrar/ocultar a chave" aria-label="Mostrar/ocultar a chave">👁</button>
      </div>
      <div class="a-editrow">
        <input class="cp-baseurl" data-id="${esc(p.id)}" value="${esc(p.baseUrl || '')}" placeholder="URL base (opcional, deixe em branco pra usar a Anthropic direto)" spellcheck="false">
      </div>`;
    const camposOpenRouter = `
      <div class="a-editrow">
        <input class="cp-apikey" type="password" data-id="${esc(p.id)}" value="${esc(p.apiKey || '')}" placeholder="chave OpenRouter (sk-or-...)" spellcheck="false" autocomplete="off">
        <button class="btn icon sm ghost cp-toggle-key" data-id="${esc(p.id)}" title="Mostrar/ocultar a chave" aria-label="Mostrar/ocultar a chave">👁</button>
      </div>
      <div class="a-editrow">
        <input class="cp-baseurl" data-id="${esc(p.id)}" value="${esc(p.baseUrl || '')}" placeholder="https://openrouter.ai/api" spellcheck="false">
      </div>
      <div class="a-hint">Usa o Claude Code apontado pro Anthropic Skin do OpenRouter. A chave vai em ANTHROPIC_AUTH_TOKEN; não precisa de claude login.</div>`;
    const camposDir = `
      <div class="a-editrow">
        <input class="cp-dir" data-id="${esc(p.id)}" value="${esc(p.dir || '')}" placeholder="${ctx.ehWin ? 'C:\\Users\\voce\\.claude-perfil' : '~/.claude-perfil'}" spellcheck="false">
      </div>`;
    const fields = profileFieldsHtml(p, isApiKey, isCodex, isOpenRouter, camposChave, camposDir, camposOrcamento, camposOpenRouter);
    const semLogin = isApiKey || isOpenRouter;
    return `<div class="card acct-card">
    <div class="a-body">
      <div class="a-editrow">
        <input class="cp-label" data-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="nome do perfil" spellcheck="false">
        ${claudeAuthBadge(p.id, ctx)}
      </div>
      ${fields}
    </div>
    <div class="a-actions">
      ${semLogin ? '' : `<button class="btn sm cp-login" data-id="${esc(p.id)}">Abrir sessão de login</button>`}
      <button class="btn sm danger-ghost cp-remove" data-id="${esc(p.id)}">Remover</button>
    </div>
  </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar perfil</div>
    <div class="a-editrow">
      <div class="seg" id="cpAddKind" role="group" aria-label="Tipo de perfil">
        <button type="button" class="seg-btn active" data-kind="dir">Login por assinatura</button>
        <button type="button" class="seg-btn" data-kind="apikey">Chave de API</button>
        <button type="button" class="seg-btn" data-kind="openrouter">OpenRouter</button>
        <button type="button" class="seg-btn" data-kind="codex">Codex</button>
      </div>
    </div>
    <div class="a-editrow">
      <input id="cpAddLabel" placeholder="nome (ex.: BIUD Trabalho)" spellcheck="false">
      <input id="cpAddDir" placeholder="diretório de config (ex.: ${ctx.ehWin ? 'C:\\Users\\voce\\.claude-biud-trabalho' : '~/.claude-biud-trabalho'})" spellcheck="false">
      <input id="cpAddApiKey" type="password" placeholder="chave de API" spellcheck="false" autocomplete="off" hidden>
      <input id="cpAddBaseUrl" placeholder="URL base (opcional)" spellcheck="false" hidden>
      <button class="btn sm" id="btnCpAdd">Adicionar</button>
    </div>
    <div class="a-hint" id="cpAddHint">Deixe em branco pra usar a Anthropic direto. Um endpoint customizado precisa falar a API de Mensagens da Anthropic.</div>
    <div class="a-hint" id="cpAddOpenRouterHint" hidden>Chave em openrouter.ai. O Farol aponta o Claude Code pra https://openrouter.ai/api (Anthropic Skin). Modelos não-Anthropic pelo Skin não são garantia do Claude Code.</div>
    <div class="a-hint" id="cpAddCodexHint" hidden>Usa a cota do plano ChatGPT pelo Codex CLI local. API key do Codex não é aceita nesse perfil.</div>
  </div>`;
  return migrateCard + defaultRow + rows + addForm;
}

export function accountsManagerHtml(ctx) {
  // não re-renderiza enquanto você edita um campo (senão apaga o que está digitando)
  const accounts = (ctx.accounts || []);
  const multi = accounts.length > 1;
  const c = ctx.config || {};
  const globalAR = c.autoReview !== false;      // padrão herdado: revisar automaticamente
  const globalCav = c.autoApproveAll !== false; // padrão herdado: aprovar com ressalvas
  const rows = accounts.map(a => {
    const meta = ctx.acct[a.user.toLowerCase()] || {};
    // três estados, um por linha: silenciada ganha de tudo, senão o token decide
  let auth = 'sem token: rode gh auth login';
  if (a.muted) auth = 'silenciada (fora dos avisos e da auto-revisão)';
  else if (a.tokenOk) auth = 'autenticada no gh';
    // os condicionais inline saem pra nomes: o template da linha de conta tinha
    // sete deles e o gate conta interrogacao por statement, sem distinguir markup
    // de logica. Nomeados, da pra ler a linha sem desembaralhar ternario.
    const selo = a.primary ? '<span class="a-tag">primária</span>' : '';
    const classeAuth = (a.tokenOk && !a.muted) ? 'ok' : '';
    const padraoRevisao = globalAR ? 'revisa na hora' : 'só põe na fila';
    const padraoRessalva = globalCav ? 'aprova e destaca as ressalvas' : 'espera você';
    const classeMute = a.muted ? 'ok' : 'ghost';
    const rotuloMute = a.muted ? 'Reativar' : 'Silenciar';
    // a barra de acoes sai pra um nome: e o maior condicional do template e
    // aparecia inteiro no meio do markup da linha
    const barraAcoes = multi ? `<div class="a-actions">
        <button class="btn sm ${classeMute} act-mute" data-user="${esc(a.user)}">${rotuloMute}</button>
        <button class="btn sm danger-ghost acct-remove" data-user="${esc(a.user)}" title="parar de monitorar esta conta no Farol">Remover</button>
      </div>` : '';
    return `<div class="card acct-card ${a.muted ? 'muted' : ''}" style="--ac:${meta.color};--ac-soft:${meta.soft};--ac-ink:${meta.ink};">
      <input type="color" class="acct-color" data-user="${esc(a.user)}" value="${esc(a.color || meta.color || '#ffb454')}" title="cor da conta">
      <div class="a-body">
        <div class="a-editrow">
          <input class="acct-label" data-user="${esc(a.user)}" value="${esc(a.label || a.user)}" placeholder="rótulo" spellcheck="false" title="rótulo da conta">
          <input class="acct-kind" data-user="${esc(a.user)}" list="acctKinds" value="${esc(a.kind || '')}" placeholder="tipo (Pessoal/Trabalho)" spellcheck="false">
          ${selo}
        </div>
        <div class="a-sub"><a class="a-auth ${classeAuth}" href="https://github.com/${encodeURIComponent(a.user)}" target="_blank" rel="noreferrer" title="Abrir @${esc(a.user)} no GitHub">@${esc(a.user)}</a> · ${esc(auth)}</div>
        <div class="a-editrow orgs"><span class="a-fieldlabel">orgs</span>
          <input class="acct-owners" data-user="${esc(a.user)}" value="${esc((a.owners || []).join(', '))}" placeholder="org1, org2" spellcheck="false" title="organizações monitoradas por esta conta"></div>
        <div class="a-pol-note">O que o Farol faz sozinho nos PRs desta conta (o que não escolher, segue o padrão geral):</div>
        <div class="a-policy">
          <div class="a-pol-item"><span class="a-fieldlabel">quando chega um PR pra você</span>
            <select class="acct-autoreview" data-user="${esc(a.user)}" title="Revisar na hora ou só listar e esperar você mandar revisar">
              <option value="">herda o geral: ${padraoRevisao}</option>
              <option value="on"${sel(a.autoReview === true)}>revisa na hora</option>
              <option value="off"${sel(a.autoReview === false)}>só põe na fila (você manda revisar)</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando fica aprovável sem ressalvas</span>
            <select class="acct-onclean" data-user="${esc(a.user)}" title="PR aprovável e sem nenhum ponto de atenção">
              <option value="">herda o geral: aprova sozinho</option>
              <option value="approve"${sel(a.onClean === 'approve')}>aprova sozinho</option>
              <option value="wait"${sel(a.onClean === 'wait')}>espera você aprovar</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando fica aprovável com ressalvas</span>
            <select class="acct-oncaveats" data-user="${esc(a.user)}" title="PR aprovável, mas com pontos de atenção anotados">
              <option value="">herda o geral: ${padraoRessalva}</option>
              <option value="approve"${sel(a.onCaveats === 'approve')}>aprova e destaca as ressalvas</option>
              <option value="wait"${sel(a.onCaveats === 'wait')}>espera você aprovar</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando tem bloqueios</span>
            <select class="acct-onreject" data-user="${esc(a.user)}" title="PR com bloqueios reais (a revisão pediu mudanças)">
              <option value=""${sel(!a.onReject || a.onReject === 'wait')}>espera você (padrão)</option>
              <option value="request_changes"${sel(a.onReject === 'request_changes')}>reprova sozinho (posta pedir mudanças)</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">perfil de IA</span>
            <select class="acct-claudeprofile" data-user="${esc(a.user)}" title="Perfil de IA usado nas sessões desta conta">
              <option value="">usa o perfil padrão do Farol</option>
              ${(ctx.config.claudeProfiles || []).map(p => `<option value="${esc(p.id)}"${sel(a.claudeProfileId === p.id)}>${esc(p.label)}</option>`).join('')}
            </select>
            ${claudeAuthBadge(a.claudeProfileId || ctx.config.claudeProfileId || '', ctx)}
          </div>
          <div class="a-pol-item"><span class="a-fieldlabel">peso na cota do perfil</span>
            <select class="acct-budgetweight" data-user="${esc(a.user)}" title="Quanto esta conta pesa no rateio do teto diario do perfil, quando outra conta divide o mesmo perfil. So vale quando ha disputa: sem ninguem esperando, quem chegar e atendido ate o teto.">
              <option value="">igual as outras (padrao)</option>
              <option value="2"${sel(Number(a.budgetWeight) === 2)}>o dobro</option>
              <option value="3"${sel(Number(a.budgetWeight) === 3)}>o triplo</option>
              <option value="0.5"${sel(Number(a.budgetWeight) === 0.5)}>metade</option>
            </select>
          </div>
        </div>
      </div>
      ${barraAcoes}
    </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar conta</div>
    <div class="a-editrow">
      <input id="acctAddUser" placeholder="login do github" spellcheck="false">
      <input id="acctAddOwners" placeholder="orgs (org1, org2)" spellcheck="false">
      <input id="acctAddLabel" placeholder="rótulo (opcional)" spellcheck="false">
      <button class="btn sm" id="btnAcctAdd">Adicionar</button>
    </div>
    <div class="a-hint">A conta precisa estar logada no <code>gh</code> (<code>gh auth login</code>) pra buscar e postar. Sem token, ela aparece aqui mas sem acesso.</div>
  </div>
  <datalist id="acctKinds"><option value="Pessoal"></option><option value="Trabalho"></option><option value="Teste antigo"></option></datalist>`;
  return (rows || '<div class="empty">Nenhuma conta configurada.</div>') + addForm;
}

/* ---------- Radar: os cards da fila e do panorama ----------
   Saiu do app.js na onda 5, quarto passo. Sao os dois maiores construtores de card
   que sobraram, e a forma e a mesma dos passos anteriores: o render le o estado,
   filtra e seta os contadores; o CARD em si so recebe o PR e um ctx.

   O acctMark ficou no app.js de proposito, e o ctx recebe o RESULTADO dele
   (ctx.mark). Ele depende de SCOPE, TWEAK e da tabela de contas, uma cadeia que
   nao tem a ver com desenhar o card: puxa-la junto arrastaria meio painel de
   contas pra ca sem ganho nenhum de teste. */


/* ---------- editor de reviewers: padrao da org e excecoes por repo ----------
   Saiu do app.js na onda 5, terceiro passo. Diferente dos blocos anteriores, aqui
   nao bastava um parametro: as funcoes liam SETE globais entre config, candidatos
   e tres Sets de estado de tela. Todas so LEEM (quem muta os Sets sao os handlers,
   que ficaram no app.js), entao o que entra e um ctx unico, montado uma vez por
   renderizacao (revCtx no app.js). E o mesmo motivo do peopleOf do primeiro passo:
   os blocos de uma mesma passada tem que enxergar o mesmo estado.

   A extracao foi de BAIXO PRA CIMA: primeiro as folhas (defaultFor, overrideFor,
   reposOfOrg, suggestDefault, addControl), e so entao o renderOrgBlock, que compoe
   todas elas. Tentar o compositor primeiro exigiria arrastar as folhas impuras
   junto.

   Fica de fora o seedException: ele muta os Sets e persiste via API, ou seja, nao e
   render. E o renderReviewersEditor, que escreve no DOM. */


/* ---------- aba Consumo: os construtores de HTML/SVG ----------
   Saiu do app.js na onda 5, segundo passo. O bloco inteiro ja era puro: nao lia
   nenhuma global, so montava string a partir do resumo de uso que o engine manda.
   O que prendia ele no app.js era a forma, nao o conteudo: cada funcao terminava
   atribuindo em `el.innerHTML`, entao parecia render de DOM. Separado o build da
   atribuicao, o app.js fica so com `el.innerHTML = xHtml(...)`.

   Fica de fora, de proposito, o drawUsageTimeline: ele mede `el.clientWidth` e ata
   listener de mouse, ou seja, precisa do elemento de verdade. O que da pra fazer
   por ele e o usageTooltipHtml, que ele chama e que veio junto.

   usageMatrixHtml devolve { html, caption } porque a versao antiga escrevia em DOIS
   lugares (a matriz e a legenda ao lado); um objeto pequeno e o jeito de manter os
   dois sem devolver o elemento. */


/* ---------- perfil de review por pessoa: papel + matriz por domínio ----------
   Molda o TOM e a POSTURA da revisão automática, nunca a decisão.
   Saiu do app.js na onda 5; o mapa de pessoas entra por parâmetro (era lido de
   STATE.config.people, global proibida aqui). Todo o grupo desce de personOf, que
   era a única leitura de global: com `people` no argumento, os cinco viram puros
   de uma vez.

   As três tabelas abaixo DUPLICAM as chaves de lib/taxonomy.js, e a duplicação é
   estrutural, não descuido: o servidor estático só serve UI_DIR (ver o
   startsWith em lib/http-server.js), então o navegador não consegue importar
   lib/. O que impede a duplicação de virar divergência é test/taxonomy-ui.test.js,
   que compara os CONJUNTOS DE CHAVES com o engine. Os rótulos ficam livres de
   propósito: aqui eles são mais curtos pra caber no <select> ("Infra" em vez de
   "Infra/DevOps", "Interm." em vez de "Intermediário"). */

/* ---------- reviewers: rótulo e chip ----------
   Saiu do app.js na onda 5. `cands` é o mapa de candidatos por org (era o global
   reviewerCands): só serve pra achar o NOME de um time a partir do id; sem ele o
   rótulo degrada pro slug do time, que é exatamente o que acontecia enquanto os
   candidatos ainda não tinham carregado. */

/* ---------- chat: o contador de mensagens no card ----------
   Saiu do app.js na onda 5; o mapa de chats entra por parâmetro (era STATE.chats,
   e o `?.` de lá cobria justamente o STATE ainda null antes do primeiro SSE). */

/* ---------- pushback: o controle das Revisões recentes ----------
   Saiu do app.js pra ganhar teste; o mapa de pushbacks entra por parâmetro
   (era lido de STATE, global proibida aqui). */

/* ---------- Revisões recentes: a linha inteira ----------
   Três colunas: ícone | conteúdo | quando + ações. A coluna da direita era só o
   relógio e todo o resto empilhava na do meio, então a metade direita da linha ficava
   em branco em qualquer largura usável. Título do PR, autor e o relatório da revisão
   já chegavam no estado e não apareciam.
   A barra esquerda colorida NÃO entra aqui: ela significa urgência (ver acctMark no
   app.js) e esta seção é histórico resolvido. A cor do desfecho vive no selo.
   O que depende de estado global (chip da conta, contador de chat, mapa de pushbacks)
   entra por ctx já resolvido em valor, porque aqui não se lê global.
   Autor em linha própria (.rr-person), fora do .rr-title: o título tem
   white-space:nowrap + ellipsis, e o autor vivia dentro dele, então um título
   comprido empurrava o autor pra fora e ele sumia sem aviso nenhum (era o bug
   relatado). Foto vem do mesmo avatar() que a fila, "precisa de você",
   destaques e time já usam, fechando a inconsistência visual desta tela com
   o resto do app. */


/* ---------- montagem da aba Entregas v2 (busca, estatísticas, atividade,
   grupos com progresso/rank/paginação). Releitura desenhada no Claude Design,
   projeto "Revisão página entregas" (`Entregas v2.dc.html`). ---------- */


/* ---------- Sistema > Sobre: créditos sincronizados com o GitHub ----------
   Idealizador = dono do repo do update; contribuidores = API de contributors
   do mesmo repo (colaborador novo no git aparece sozinho, sem manutenção).
   Toda pessoa sai por personMention (menção navegável com foto, regra do app).
   Sem dado ainda (boot, gh sem login, rede) = aviso explicativo, nunca vazio
   mudo: silêncio sem explicação é o defeito do check de monitoramento (M-op). */
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

/* ---------- diagnóstico ----------
   O texto que a pessoa copia e cola quando vem pedir ajuda. É a única saída do app que
   alguém lê fora do app, então mudança aqui é mudança de contrato com quem socorre.
   Cada ternário mora no seu próprio `const` porque o ratchet conta '?' por statement e
   este arquivo não tem folga nesse eixo. */

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


/* ---------- site do Jira: o que a tela recusa antes de mandar pro servidor ----------
   O saneador do servidor (normalizeBaseUrl/parseJiraSites, lib/jira/sites.js) não
   corrige nem avisa: URL fora de forma faz o site INTEIRO ser descartado, então
   rótulo, orgs e prefixos somem enquanto a tela diz "Configurações salvas". As
   regras espelhadas aqui são as de lá, e o porquê de cada uma mora naquele arquivo.
   Prefixo é exigência da TELA, não do modelo: sem nenhum, o extractCardKeys aceita
   qualquer PALAVRA-NUMERO do título (UTF-8, SHA-256, ISO-8601), o Farol pede esse
   "card" ao Jira, toma 404 e o PR perde o auto-approve por falha inventada. */
export function jiraBaseUrlProblema(valor) {
  const s = String(valor || '').trim().replace(/\/+$/, '');
  if (!s) return 'Informe a URL base do Jira.';
  let u = null;
  try { u = new URL(s); } catch { return 'URL base inválida: escreva o endereço completo, com https:// na frente.'; }
  if (u.protocol !== 'https:') return 'A URL base precisa começar com https://.';
  if (u.username || u.password) return 'A URL base não pode carregar usuário nem senha.';
  if (u.pathname !== '/' || u.search || u.hash) return 'A URL base é só o endereço do site, sem caminho, parâmetro ou âncora.';
  return '';
}

export function jiraPrefixosProblema(lista) {
  const itens = (Array.isArray(lista) ? lista : []).filter((x) => String(x || '').trim());
  if (!itens.length) return 'Informe ao menos um prefixo de projeto: sem ele o Farol procura no Jira qualquer coisa com hífen e número que apareça no título do PR.';
  return '';
}


/* ---------- U4: o Consumo de todos os aparelhos ----------

   O resumo vem inteiro do engine (consolidatedSummary, em lib/sync/consolidated.js):
   a tela só formata. Envelope com ok:false mostra o MOTIVO, nunca uma tela vazia muda,
   que seria indistinguível de "não gastei nada". */

