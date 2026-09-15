// Contas, perfis do Claude e orçamento: escopo e barra de contas, banner do topo, selo de
// autenticação, editor de orçamento por perfil, gerenciador de contas e a validação do site
// do Jira antes de salvar. Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo
// não mudou.
//
// Banner do topo: os três avisos (sem conta, conta sem token, falha na última checagem)
// são decisão de TEXTO, não de DOM. A forma é `if` plano de propósito, e sem `?.` também
// de propósito: snapshot sem `account` tem que explodir alto em vez de virar
// silenciosamente "Nenhuma conta detectada".
//
// Painel de perfis e contas: o render lê o estado e atribui; o CONSTRUTOR só recebe um ctx
// e devolve string. Ficaram no app.js, por serem DOM e não markup, o guarda de foco e o
// `hint.hidden = true` do fim dos perfis.
//
// Editor de orçamento (v2.50.0): o MESMO bloco vale para perfil de assinatura e de chave de
// API, cada perfil com o seu. Três granularidades, do geral para o específico, na mesma
// ordem em que o dailyCapFor resolve: teto base, por dia da semana, de uma data só.
//
// Site do Jira: o saneador do servidor (lib/jira/sites.js) não corrige nem avisa, URL fora
// de forma faz o site INTEIRO ser descartado enquanto a tela diz "Configurações salvas".
// As regras espelhadas aqui são as de lá. Prefixo é exigência da TELA: sem nenhum, o
// extractCardKeys aceita qualquer PALAVRA-NUMERO do título (UTF-8, SHA-256), o Farol pede
// esse "card" ao Jira, toma 404 e o PR perde o auto-approve por falha inventada.

// escopo salvo no navegador validado contra as contas atuais: conta removida ou
// renomeada deixava um escopo orfao que esvaziava o Radar pra sempre (B15).
// Compara sem caixa e preserva o valor original quando ele e valido.
import { esc, fmtMoney } from './comum.js';

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
