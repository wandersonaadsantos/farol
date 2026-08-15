// Farol: engine de monitoramento de PRs + servidor http local da UI.
// Porta a logica do antigo pr-reviewer.ps1: o polling do GitHub roda aqui
// (so comandos gh, sem gastar tokens de IA); a revisao em si abre uma sessao
// interativa do Claude Code em um terminal proprio, com /pr-review <urls>.
// Zero dependencias externas: roda com Node puro (e dentro do Electron).
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

// Camada base: versão, plataforma e caminhos (compartilhada com os módulos de lib/).
const {
  APP_VERSION, APP_NAME, DELIVERIES_LIMIT, IS_WIN, IS_MAC, APP_ROOT,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, BASELINE_FILE,
  INFLIGHT_FILE, CHATS_FILE, SELF_FILE, HIDDEN_FILE, TEMPLATE_DIR, UI_DIR,
} = require('./lib/paths');

// Helpers puros e utilitários movidos pra lib/ (Onda 1 do refactor, ver docs/QUALITY.md).
// A Engine abaixo compõe estes módulos; a decomposição por responsabilidade segue nas ondas 2+.
const { modelLabel, isPermanentBranch } = require('./lib/format');
const { ACCOUNT_PALETTE } = require('./lib/taxonomy'); // resto da taxonomia é usado nos colaboradores (review/pushback)
const { parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  applyClaudeAuthEnv, claudeAuthShellLines,
  sanitizeModel, sanitizeEffort, sanitizeParallelReviews } = require('./lib/parse');
const { ensureDir, readJson, writeJsonAtomic, writeTextAtomic, copyRecursive, detectGitBash, run, runShell } = require('./lib/io');
const updateMod = require('./lib/engine/update');
const chatMod = require('./lib/engine/chat');
const toolsMod = require('./lib/engine/tools');
const pushbackMod = require('./lib/engine/pushback');
const decisionMod = require('./lib/engine/decision');
const ghMod = require('./lib/engine/gh-queries');
const sessionMod = require('./lib/engine/session');
const selfMod = require('./lib/engine/selfpr');
const reviewMod = require('./lib/engine/review');
const usageMod = require('./lib/engine/usage');
const { startServer } = require('./lib/http-server');

// App aberto pelo Finder/Dock herda um PATH minimo (sem /opt/homebrew/bin):
// gh e claude sumiriam. Prependa os diretorios usuais que existirem.
if (!IS_WIN) {
  const extras = ['/opt/homebrew/bin', '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'bin')];
  const current = (process.env.PATH || '').split(':');
  const missing = extras.filter(d => !current.includes(d) && fs.existsSync(d));
  if (missing.length) process.env.PATH = missing.concat(process.env.PATH || '').join(':');
}

// A telemetria do GitHub CLI relanca um "gh send-telemetry" DESTACADO (sem console)
// que roda tzutil /g; como processo destacado nao herda o console oculto do Farol,
// o Windows aloca um console novo VISIVEL e o terminal padrao (Windows Terminal)
// pisca uma janela a cada batch. Todos os filhos herdam process.env (ghEnv espalha,
// e chamadas gh sem env herdam direto), entao UMA linha aqui cobre gh direto, gh
// dentro das sessoes do claude e as sessoes de terminal.
process.env.GH_TELEMETRY = 'false';

const DEFAULTS = {
  ghUser: '',              // vazio = detectar a conta ativa do gh na primeira execucao
  owners: ['biudtech'],
  // multi-conta: observar mais de uma identidade do gh ao mesmo tempo (ex.: conta
  // de trabalho + conta pessoal). Cada item: { user, owners }. Vazio = usa a conta
  // unica legada acima (ghUser + owners). A conta [0] e a primaria (identidade
  // default e usada em chamadas gh nao ligadas a um PR, como update). Cada PR
  // carrega a conta dona; toda operacao gh nesse PR usa o token dela. Os logins
  // ficam so aqui no config local do usuario, nunca no fonte (auditoria do zip).
  accounts: [],
  intervalSeconds: 300,
  autoReview: true,        // revisao autonoma interna (headless); so chama o humano nas excecoes
  parallelReviews: 1,      // revisoes headless SIMULTANEAS por conta (1..4). 1 = serial dentro da conta (o de sempre); subir e opt-in em Sistema (acelera fila cheia, gasta o limite do plano mais rapido)
  autoApproveAll: false,   // OFF = gate estrito (so auto_approve + card comprovado). ON (opt-in em Sistema) = aprova sozinho TODO PR aprovavel, anexando os pontos de atencao ao APPROVE. Default OFF por seguranca (o app e publico/multiusuario; cada um liga se quiser)
  skipPermissions: false,  // vale so pra sessoes no TERMINAL; o modo interno roda sem prompts por design
  soundEnabled: true,
  theme: 'dark',
  autostart: false,
  updateSource: '',        // vazio = fonte de verdade e a release do GitHub (git). So defina um caminho aqui pra testar build local (opt-in de dev)
  // canal de update remoto pras copias distribuidas: releases do GitHub, lidas
  // pelo gh que todo usuario ja tem. So vale quando NAO ha fonte local (a pasta
  // ~/Documents/farol tem precedencia, pro fluxo de dev do mantenedor).
  updateRepo: 'wandersonaadsantos/farol',
  port: 47170,
  // repos onde o botao Merge (Meus PRs) fica desativado, respeitando regras de
  // review do time (ex.: nunca self-merge no biud-frontend). Editavel em Sistema.
  mergeBlockedRepos: ['biudtech/biud-frontend'],
  // reviewers PADRAO por organizacao: { "org": ["login", "org/time", ...] }. E o
  // grupo aplicado a TODOS os repos daquela org quando voce clica em "Reviewers",
  // salvo os repos que tem excecao em projectReviewers. Evita repetir a mesma lista
  // repo a repo (era a maior fonte de poluicao visual da tela de Sistema).
  defaultReviewers: {},
  // EXCECOES por projeto: { "owner/repo": ["login", "org/time", ...] }. Quando um
  // repo esta aqui, essa lista SUBSTITUI o padrao da org (nao soma). Repo sem
  // excecao usa o defaultReviewers da org. Aceita pessoas e times (org/time-slug).
  projectReviewers: {},
  // MODELO das sessoes autonomas do Farol (review/pushback/autoanalise/ferramentas).
  // Default '' = padrao do claude (Opus, MELHOR qualidade). E CONFIGURAVEL em Sistema:
  // quem quiser economizar o limite do plano troca pra sonnet/haiku (gastam bem menos).
  // Qualidade e a prioridade, entao o default e o modelo bom, nao o economico.
  reviewModel: '',
  // ESFORCO de raciocinio das sessoes autonomas (--effort do claude). Vazio = nao passa a
  // flag e o CLI decide pelo modelo, que e o que o Farol sempre fez. Vale pros CINCO
  // caminhos de sessao autonoma (review, autoanalise, pushback, chat, ferramentas); a
  // sessao no TERMINAL nunca e afetada. Niveis validos em lib/parse.js (EFFORT_LEVELS).
  reviewEffort: '',
  // classificacao automatica de pushback (1 sessao Claude por PR contestado). Default ON
  // (a funcionalidade que o Wanderson pediu); quem quiser poupar limite desliga em Sistema.
  autoPushback: true,
  claudeConfigDir: '',
  // NOVO: perfis nomeados de assinatura Claude [{id,label,dir}] (login por assinatura) ou
  // [{id,label,kind:'apikey',apiKey,baseUrl}] (chave de API). Vazio = usa só o
  // claudeConfigDir legado acima (compatibilidade total, nada muda pra quem não adotar
  // o sistema novo). claudeProfileId escolhe o perfil padrão do Farol quando a conta
  // não tiver um claudeProfileId próprio (accounts[].claudeProfileId, opcional).
  claudeProfiles: [],
  claudeProfileId: '',
  // diagnóstico: registra em state/spawns.log cada processo que o Farol dispara (com
  // horário), pra caçar "terminal piscando". Desligado por padrão; ligue em Sistema só
  // pra capturar evidência. Espelhado em process.env.FAROL_DEBUG_SPAWNS pros módulos io/session.
  debugSpawns: false
};

// carência anti-lag do índice de busca do GitHub: logo após EU postar um review, o PR
// ainda ecoa em --review-requested por alguns minutos (a busca é indexação assíncrona).
// Nesse eco, "está pedido" não é o autor re-solicitando, é atraso do índice; sem a
// carência, todo auto-approve virava um segundo review headless completo. Custo do
// trade-off: um re-request REAL feito dentro da janela entra com atraso máximo de
// carência + 1 intervalo de polling.
const REREQ_GRACE_MS = 10 * 60 * 1000;

// --- Engine -----------------------------------------------------------------
class Engine extends EventEmitter {
  constructor() {
    super();
    const warn = (m) => this.log('WARN', m); // corrupção de estado precisa aparecer no farol.log
    this.config = { ...DEFAULTS, ...readJson(CONFIG_FILE, {}, warn) };
    delete this.config.autoOpenReview; // chave antiga (terminal); o modo autonomo tem semantica nova
    this.config.accounts = parseAccounts(this.config.accounts); // normaliza (array de {user,owners})
    // idem accounts/people acima: config.json pode estar malformado (editado à mão,
    // corrompido, versão antiga/incompatível) — normaliza no boot pra nunca derrubar o
    // app (achado de auditoria: claudeProfiles como string/objeto lançava TypeError em
    // resolveClaudeConfigDir/allClaudeAuthInfo/ghEnv, quebrando toda busca de PR).
    this.config.claudeProfiles = normalizeClaudeProfiles(this.config.claudeProfiles);
    this.config.claudeProfileId = normalizeClaudeProfileId(this.config.claudeProfileId);
    this.config.claudeConfigDir = sanitizeClaudeDir(this.config.claudeConfigDir);
    // modelo/esforco entram na linha de comando passada a um shell. Ate aqui so o caminho
    // HTTP validava, entao um config.json editado a mao passava cru. `?? ''` porque
    // sanitize* devolve null pro invalido, e invalido vira o padrao (nao passa flag).
    this.config.reviewModel = sanitizeModel(this.config.reviewModel) ?? '';
    this.config.reviewEffort = sanitizeEffort(this.config.reviewEffort) ?? '';
    // intervalo do polling: o caminho HTTP (updateSettings) já clampa em 60..3600, mas
    // o boot engolia config.json editado à mão. Não numérico virava Math.max(60, NaN)
    // = NaN no schedule(), e setTimeout(fn, NaN) dispara em ~1ms: polling contínuo
    // contra o GitHub até o rate limit. Mesma expressão do updateSettings, de propósito.
    this.config.intervalSeconds = Math.min(3600, Math.max(60, parseInt(this.config.intervalSeconds, 10) || DEFAULTS.intervalSeconds));
    // paralelismo por conta: mesmo tratamento (boot engole config.json editado à mão);
    // o escalonador clampa de novo por defesa em profundidade (parallelLimit em review.js)
    this.config.parallelReviews = sanitizeParallelReviews(this.config.parallelReviews) ?? DEFAULTS.parallelReviews;
    // perfil de review por pessoa (papel + matriz por domínio); migra a senioridade plana antiga pro campo `papel`
    this.config.people = migrateSeniorityToPeople(this.config.seniority, parsePeople(this.config.people));
    delete this.config.seniority;
    process.env.FAROL_DEBUG_SPAWNS = this.config.debugSpawns ? '1' : ''; // espelha pro logger de spawns
    this.tokens = {};                // token por conta (login -> token), preenchido no refreshTokens
    this.status = 'starting';        // starting | checking | idle | error
    this.lastError = null;
    this.lastCheckAt = null;
    this.nextCheckAt = null;
    this.panorama = [];
    this.queue = [];
    this.myPRs = [];                 // PRs abertos de autoria minha (fonte da autoanalise)
    this.selfAnalyses = readJson(SELF_FILE, {}, warn); // key do PR -> resultado da autoanalise
    // key do PR -> { at, updatedAt } dos PRs meus que o usuario mandou sumir da aba.
    // Nao filtra myPRs (quem esconde e a UI); o updatedAt guardado e o que permite o
    // retorno automatico quando o PR recebe atividade nova (reconcileHiddenPRs).
    this.hiddenPRs = readJson(HIDDEN_FILE, {}, warn);
    this.mergeStates = {};            // key do PR -> mergeabilidade real (só p/ aprovaveis)
    this.staleStates = {};            // key do PR -> true quando entrou commit apos a minha review
    this.staleInfo = {};              // key do PR -> { stale, head, lastState } (gate da re-revisao automatica; interno, fora do snapshot)
    this.adminBlockedRepos = {};      // repo -> true quando admin nao fura o ruleset (o UI esconde "Merge admin")
    this.ruleBlockCache = {};         // "repo@base" -> { blocked, at } cache do ruleset bloqueante
    this.reviewerCands = null;        // { at, data:{members,teams} } candidatos p/ o seletor de reviewers
    this.deliveriesCache = {};        // janela (dias) -> { at, data } cache das entregas (PRs mergeados); TTL curto
    this.activeReviews = new Map();  // id -> { keys, label, mode, startedAt }
    this.reviewPostCaps = new Map(); // capabilities efêmeras de escrita de terminal/chat (nunca persistidas nem expostas)
    this.sessionSeq = 0;
    this.headlessQueue = [];
    this.headlessBusyAccounts = new Map(); // conta -> nº de revisões headless rodando (teto = config.parallelReviews, default 1)
    this.decisions = readJson(path.join(STATE_DIR, 'decisions.json'), { pending: [], resolved: [] }, warn);
    this.pushbacks = readJson(path.join(STATE_DIR, 'pushbacks.json'), {}, warn); // { key do PR: { author, outcome, note, at, source, status, confidence } }
    // registros antigos (sem source) eram todos marcados à mão e confirmados
    for (const v of Object.values(this.pushbacks)) { if (v && !v.source) { v.source = 'manual'; v.status = 'confirmed'; } }
    this.pushbackScanned = readJson(path.join(STATE_DIR, 'pushback-scanned.json'), {}, warn); // { key: marcador da última atividade do autor já avaliada }
    this.reReviewLaunched = readJson(path.join(STATE_DIR, 'rereview-launched.json'), {}, warn); // { key: head já relançado pela re-revisão automática (âncora por round) }
    this.toolRuns = readJson(path.join(STATE_DIR, 'tool-results.json'), {}, warn);
    // kudos passou a ser POR CONTA (mapa escopo->execução); migra o formato antigo
    // (execução única, global) pro escopo "todas" ('*') pra não perder o que já existia
    if (this.toolRuns.kudos && typeof this.toolRuns.kudos.status === 'string') this.toolRuns.kudos = { '*': this.toolRuns.kudos };
    if (!this.toolRuns.kudos || typeof this.toolRuns.kudos !== 'object') this.toolRuns.kudos = {};
    const interrupted = { status: 'error', error: 'o app foi reiniciado no meio da execução' };
    if (this.toolRuns.health && this.toolRuns.health.status === 'running') this.toolRuns.health = interrupted;
    for (const key of Object.keys(this.toolRuns.kudos)) {
      if (this.toolRuns.kudos[key] && this.toolRuns.kudos[key].status === 'running') this.toolRuns.kudos[key] = interrupted;
    }
    this.activity = new Map();       // id de sessão -> feed de eventos ao vivo
    this.running = new Map();        // id de sessão -> { child, cancelled } (só headless)
    this.retryAfterNet = new Map();  // key do PR -> { tries, pr } da re-revisão pós-falha transitória
    this.autoReviewParked = new Set(); // keys que falharam sem ser rede (ou foram canceladas): aguardam ação manual, não relançam sozinhas
    this.budgetWarned = new Set(); // ids de perfil apikey já avisados de orçamento estourado, enquanto o estouro persistir (evita repetir o toast a cada checagem)
    this.chats = readJson(CHATS_FILE, {}, warn);
    for (const k of Object.keys(this.chats)) {
      if (this.chats[k].status === 'running') this.chats[k].status = 'idle';
    }
    // registro de consumo de tokens (agregado por dia/tipo/conta/modelo); merge com o
    // default garante que arquivos antigos ganhem os eixos novos sem quebrar.
    this.usage = { ...usageMod.defaultUsage(), ...readJson(usageMod.USAGE_FILE, {}, warn) };
    // log individual de sessoes, permanente (sem poda, decisao consciente: ver
    // docs/superpowers/specs/2026-08-10-consumo-tela-redesign-design.md). Separado
    // do usage.json pra gravacao do agregado nao reserializar um array que so cresce.
    this.usageSessions = { ...usageMod.defaultSessions(), ...readJson(usageMod.SESSIONS_FILE, {}, warn) };
    this.seen = new Set();
    this.reviewedKeys = new Set(); // PRs abertos que eu ja revisei (gh --reviewed-by)
    this.reReviewedKeys = new Set(); // re-requests que ja voltaram pra fila (evita re-surgir todo ciclo)
    // keys pedidos a mim no último ciclo BOM: preserva fila e "é meu" quando as buscas
    // --review-requested falham (falha parcial não zera o radar). De propósito NÃO é
    // persistido: após reinício, um 1º ciclo já com falha preserva um Set vazio, igual
    // ao comportamento antigo nesse canto (seen e baseline cobrem o essencial entre boots).
    this.mineKeys = new Set();
    this.token = null;
    this.tokenOk = false;
    this.doctorInfo = null;
    this.timer = null;
    this.checking = false;
    this.updateApplying = false; // "Atualizar agora" em andamento (guarda de clique duplo; só memória)
    this.gitBash = detectGitBash();

    this.prepareHome();
    this.loadSeen();
    this.recoverInflight();
  }

  // revisões que estavam rodando quando o app morreu: devolve à fila (o PR já
  // tinha sido marcado como visto, então sem isso ele sumiria em silêncio)
  recoverInflight() {
    const inflight = readJson(INFLIGHT_FILE, [], (m) => this.log('WARN', m));
    if (!Array.isArray(inflight) || !inflight.length) return;
    for (const pr of inflight) { if (pr && pr.key) this.unsee(pr.key); }
    try { writeJsonAtomic(INFLIGHT_FILE, []); } catch { }
    // G7: a âncora do round 2 é gravada ANTES de enfileirar; se o app morreu com
    // a re-revisão na fila/rodando, a âncora sem a revisão mataria o round pra
    // sempre naquele head. Poda: o próximo check() re-arma pelo staleInfo.
    let podado = false;
    for (const pr of inflight) {
      if (pr && pr.key && this.reReviewLaunched && this.reReviewLaunched[pr.key] !== undefined) {
        delete this.reReviewLaunched[pr.key]; podado = true;
      }
    }
    if (podado) this.saveReReviewLaunched();
    this.log('WARN', `app reiniciado com revisão em andamento: ${inflight.map(p => p.key).join(', ')} devolvido(s) à fila`);
  }

  writeInflight() {
    try {
      const list = [...this.activeReviews.values()]
        .filter(s => s.mode === 'auto' && s.pr)
        .map(s => s.pr)
        .concat(this.headlessQueue.filter(p => p.kind !== 'self').map(p => ({ key: p.key, url: p.url, title: p.title })));
      writeJsonAtomic(INFLIGHT_FILE, list);
    } catch { /* melhor perder a recuperação que derrubar a revisão */ }
  }

  prepareHome() {
    ensureDir(HOME);
    ensureDir(STATE_DIR);
    ensureDir(path.join(STATE_DIR, 'authors'));
    // semeia o workspace do Claude na primeira execucao
    if (!fs.existsSync(path.join(WORKSPACE, 'CLAUDE.md')) && fs.existsSync(TEMPLATE_DIR)) {
      copyRecursive(TEMPLATE_DIR, WORKSPACE);
    }
    // o template de prompt autonomo pode chegar por atualizacao em workspace ja existente
    if (!fs.existsSync(path.join(WORKSPACE, 'prompts', 'pr-review-auto.md')) &&
        fs.existsSync(path.join(TEMPLATE_DIR, 'prompts'))) {
      copyRecursive(path.join(TEMPLATE_DIR, 'prompts'), path.join(WORKSPACE, 'prompts'));
    }
    // prompts novos (ex.: autoanalise) chegam por atualizacao em workspace ja semeado:
    // copie um a um o que faltar, sem sobrescrever o que o usuario possa ter ajustado
    try {
      const tplPrompts = path.join(TEMPLATE_DIR, 'prompts');
      const wsPrompts = path.join(WORKSPACE, 'prompts');
      if (fs.existsSync(tplPrompts)) {
        ensureDir(wsPrompts);
        for (const f of fs.readdirSync(tplPrompts)) {
          const dst = path.join(wsPrompts, f);
          if (!fs.existsSync(dst)) fs.copyFileSync(path.join(tplPrompts, f), dst);
        }
      }
    } catch { /* semear prompt novo nunca derruba o boot */ }
    // PROTOCOLO de review (formato/tom) é do Farol, não do usuário: mantém sincronizado
    // com a fonte a cada boot, pra mudanças (ex.: review humano/personalizado) chegarem
    // nas cópias já semeadas. NUNCA toca em state/ (dados do usuário) nem em settings.json.
    try {
      const synced = [
        'CLAUDE.md',
        path.join('prompts', 'pr-review-auto.md'),
        path.join('prompts', 'self-review.md'),
        path.join('.claude', 'agents', 'pr-reviewer.md'),
        path.join('.claude', 'commands', 'pr-review.md'),
      ];
      for (const rel of synced) {
        const src = path.join(TEMPLATE_DIR, rel), dst = path.join(WORKSPACE, rel);
        if (fs.existsSync(src)) { ensureDir(path.dirname(dst)); fs.copyFileSync(src, dst); }
      }
    } catch { /* sincronizar o protocolo nunca derruba o boot */ }
    if (!fs.existsSync(CONFIG_FILE)) this.saveConfig();
    this.ensureWorkspaceTrusted();
  }

  // Pre-semeia a confianca do Claude Code neste workspace (~/.claude.json).
  // Sem isso, a primeira sessao para no dialogo "confiar nesta pasta?" e a
  // autonomia quebra. Escreve so o que falta e preserva o resto do arquivo.
  ensureWorkspaceTrusted() {
    try {
      const file = path.join(os.homedir(), '.claude.json');
      let data = {};
      if (fs.existsSync(file)) {
        // parse falhou = arquivo ilegivel: ABORTA, jamais sobrescrever a config do Claude
        try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {
          this.log('WARN', '~/.claude.json ilegivel; nao vou pre-confiar o workspace (primeira sessao pode pedir confianca)');
          return;
        }
      }
      data.projects = data.projects || {};
      // o claude ora registra a chave com \ ora com /: semeia as duas variantes
      const variants = [WORKSPACE, WORKSPACE.replace(/\\/g, '/')];
      let changed = false;
      for (const key of variants) {
        const entry = data.projects[key] || {};
        if (entry.hasTrustDialogAccepted === true && entry.hasCompletedProjectOnboarding === true) continue;
        entry.hasTrustDialogAccepted = true;
        entry.hasCompletedProjectOnboarding = true;
        data.projects[key] = entry;
        changed = true;
      }
      if (!changed) return;
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.farol-bak');
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      this.log('WARN', `nao consegui pre-confiar o workspace no ~/.claude.json: ${err.message}`);
    }
  }

  saveConfig() {
    ensureDir(HOME);
    writeJsonAtomic(CONFIG_FILE, this.config);
  }

  // --- log: so falhas, sem ruido (mesmo contrato do tool antigo) ---
  log(level, msg) {
    try {
      if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 2 * 1024 * 1024) {
        fs.renameSync(LOG_FILE, LOG_FILE + '.1');
      }
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      fs.appendFileSync(LOG_FILE, `[${ts}] [${level}] ${msg}\n`);
    } catch { /* log nunca derruba o app */ }
  }

  // --- seen (mesmo formato do tool antigo: uma key por linha) ---
  loadSeen() {
    try {
      const lines = fs.readFileSync(SEEN_FILE, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      this.seen = new Set(lines.map(l => l.split(/\s+/)[0]));
    } catch { this.seen = new Set(); }
  }

  saveSeen() {
    ensureDir(STATE_DIR);
    writeTextAtomic(SEEN_FILE, [...this.seen].join('\n') + (this.seen.size ? '\n' : ''));
  }

  markSeen(key) { if (!this.seen.has(key)) { this.seen.add(key); this.saveSeen(); } }
  unsee(key) { if (this.seen.delete(key)) this.saveSeen(); }

  // --- GitHub ---
  // lista normalizada de contas monitoradas: [{ user, owners }]. Sem config.accounts,
  // cai na conta unica legada (ghUser + owners). A [0] e a primaria.
  accountList() {
    const raw = Array.isArray(this.config.accounts) ? this.config.accounts : [];
    let base = raw
      .map(a => ({
        user: String((a && a.user) || '').trim(),
        owners: Array.isArray(a && a.owners) ? a.owners.map(String).map(s => s.trim()).filter(Boolean) : [],
        label: (a && a.label != null) ? String(a.label).trim() : '',
        color: (a && a.color != null) ? String(a.color).trim() : '',
        kind: (a && a.kind != null) ? String(a.kind).trim() : '',
        muted: !!(a && a.muted),
        // política de automação por conta (undefined = herda o global)
        autoReview: (a && (a.autoReview === true || a.autoReview === false)) ? a.autoReview : undefined,
        onClean: (a && (a.onClean === 'approve' || a.onClean === 'wait')) ? a.onClean : undefined,
        onCaveats: (a && (a.onCaveats === 'approve' || a.onCaveats === 'wait')) ? a.onCaveats : undefined,
        onReject: (a && (a.onReject === 'request_changes' || a.onReject === 'wait')) ? a.onReject : undefined,
        // perfil de assinatura Claude desta conta (undefined = herda o global/legado)
        claudeProfileId: (a && a.claudeProfileId != null && String(a.claudeProfileId).trim()) ? String(a.claudeProfileId).trim() : undefined
      }))
      .filter(a => a.user);
    if (!base.length) base = [{ user: (this.config.ghUser || '').trim(), owners: this.config.owners || [], label: '', color: '', kind: '', muted: false }];
    // preenche defaults de identidade: rótulo = login (ou org), cor estável por índice
    return base.map((a, i) => ({
      ...a,
      label: a.label || a.user || a.owners[0] || 'conta',
      color: a.color || ACCOUNT_PALETTE[i % ACCOUNT_PALETTE.length],
      muted: !!a.muted
    }));
  }

  // login está numa conta silenciada? (fora do painel Todas, dos avisos e da auto-revisão)
  isMuted(user) {
    const u = String(user || '').toLowerCase();
    return this.accountList().some(a => a.user.toLowerCase() === u && a.muted);
  }

  // política de automação POR CONTA (undefined na conta = herda o global).
  acctPolicy(user) {
    const u = String(user || '').toLowerCase();
    return this.accountList().find(a => a.user.toLowerCase() === u) || {};
  }
  // ao chegar PR nesta conta: revisar sozinho (headless) ou só colocar na fila?
  autoReviewFor(user) {
    const a = this.acctPolicy(user);
    if (a.autoReview === true || a.autoReview === false) return a.autoReview;
    return this.config.autoReview !== false;
  }
  // quando aprovável, a ação: 'approve' (postar sozinho) ou 'wait' (aguardar você).
  // clean = sem ressalvas; senão usa a política de "com ressalvas".
  approvePolicyFor(user, clean) {
    const a = this.acctPolicy(user);
    const cleanPolicy = a.onClean || 'approve';
    if (clean) return cleanPolicy;
    if (a.onCaveats) return a.onCaveats; // valor explícito da conta vale
    // com ressalvas, sem valor próprio: herda o global, MAS nunca mais permissivo que o
    // limpo (um PR com ressalva não pode auto-aprovar se o impecável foi posto pra aguardar)
    const globalCaveats = this.config.autoApproveAll !== false ? 'approve' : 'wait';
    return cleanPolicy === 'wait' ? 'wait' : globalCaveats;
  }
  // quando a revisão pede mudanças (tem bloqueios), a ação da conta:
  // 'request_changes' (reprovar sozinho) ou 'wait' (aguardar você). DEFAULT wait
  // sempre (opt-in por conta; não existe reprovação automática global).
  rejectPolicyFor(user) {
    const a = this.acctPolicy(user);
    return a.onReject === 'request_changes' ? 'request_changes' : 'wait';
  }

  // login da conta primaria (identidade default; chamadas gh nao ligadas a um PR)
  primaryUser() { return (this.accountList()[0] || {}).user || this.config.ghUser || ''; }

  // uniao dos owners de todas as contas (panorama, candidatos de reviewer)
  allOwners() {
    const set = new Set();
    for (const a of this.accountList()) for (const o of a.owners) set.add(o);
    return [...set];
  }

  // conta monitorada dona de um owner (org); fallback = primaria
  accountForOwner(owner) {
    const o = String(owner || '').toLowerCase();
    const hit = this.accountList().find(a => a.owners.some(x => String(x).toLowerCase() === o));
    return (hit && hit.user) || this.primaryUser();
  }

  // conta a usar num PR: a que ele ja veio marcada, senao pela org do repo
  accountForPr(pr) {
    if (pr && pr.account) return pr.account;
    const repo = (pr && (pr.repo || (pr.key || '').split('#')[0])) || '';
    return this.accountForOwner(repo.split('/')[0]);
  }

  // Lista efetiva de reviewers de um repo: a EXCECAO do repo (projectReviewers) se
  // houver, senao o PADRAO da org (defaultReviewers). Vazio se nao houver nenhum.
  // E o que o botao "Reviewers" aplica, entao funciona em qualquer repo da org que
  // tenha padrao, mesmo sem config propria.
  reviewersForRepo(repo) {
    const r = String(repo || '');
    const pr = this.config.projectReviewers || {};
    const hit = pr[r] || pr[r.toLowerCase()];
    if (hit && hit.length) return hit;
    const org = r.split('/')[0];
    const dr = this.config.defaultReviewers || {};
    return dr[org] || dr[org.toLowerCase()] || [];
  }

  // sem conta configurada, detecta a conta ativa do gh desta maquina: cada
  // pessoa do time usa a propria autenticacao, nada viaja com o app
  async resolveAccount() {
    if (this.config.ghUser) return;
    const r = await run('gh', ['api', 'user', '--jq', '.login'], { env: { ...process.env, GH_PAGER: 'cat' } });
    const login = r.ok ? r.stdout.trim() : '';
    if (login) {
      this.config.ghUser = login;
      this.saveConfig();
      this.emit('toast', { kind: 'info', text: `Conta do GitHub detectada: @${login}. Ajuste em Sistema se usar outra.` });
    }
  }

  // token por conta (map login -> token), buscado on-demand do gh (nunca persistido).
  // this.token = token da conta primaria (compat com chamadas gh sem conta).
  async refreshTokens() {
    this.tokens = this.tokens || {};
    const primary = this.primaryUser();
    let primaryOk = false;
    for (const acc of this.accountList()) {
      if (!acc.user) continue;
      const r = await run('gh', ['auth', 'token', '--user', acc.user]);
      const tok = r.ok ? r.stdout.trim() : null;
      if (tok) this.tokens[acc.user] = tok; else delete this.tokens[acc.user];
      if (!tok) this.log('ERROR', `gh auth token --user ${acc.user} falhou: ${r.stderr.trim() || 'sem saida'}`);
      if (acc.user === primary) { this.token = tok; primaryOk = !!tok; }
    }
    this.tokenOk = primaryOk;
    return primaryOk;
  }

  // compat: alguns caminhos chamam refreshToken (singular)
  async refreshToken() { return this.refreshTokens(); }

  // token da conta pedida, SEM herdar identidade (raiz A1): user vazio = primária
  // (único fallback legítimo, pedido explícito da conta padrão, ex.: update.js).
  // Conta pedida sem token = null; quem precisa agir checa isso ANTES de rodar gh.
  tokenFor(user) {
    if (!user) return this.token || null;
    return (this.tokens && this.tokens[user]) || null;
  }

  // env de child-process com o GH_TOKEN da conta pedida (sem user = primaria, o único
  // fallback legítimo, ex.: update.js). Conta pedida SEM token = erro alto (raiz A1):
  // herdar o token de outra conta fazia busca @me, review postado e sessão Claude
  // saírem com a identidade errada. Os call sites de produção pré-checam com tokenFor
  // e caem nos seus caminhos de falha; este throw é a rede de segurança fail-loud
  // (mesma filosofia do ehMac/ehWin da UI). A frase "sem token no gh" é contrato
  // com a classificação de erro transitório do runOneHeadless.
  ghEnv(user) {
    const env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1' };
    const tok = this.tokenFor(user);
    if (user && !tok) throw new Error(`conta ${user} sem token no gh (rode: gh auth login --user ${user})`);
    if (tok) env.GH_TOKEN = tok;
    env.FAROL_PORT = String(this.config.port || 47170);
    if (this.gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = this.gitBash;
    // assinatura do Claude que o Farol usa pra esta conta: ver resolveClaudeAuth
    // (perfil por conta > perfil padrão do Farol > claudeConfigDir legado).
    applyClaudeAuthEnv(env, this.resolveClaudeAuth(user));
    return env;
  }

  // Consultas ao GitHub (leitura, zero IA): colaborador lib/engine/gh-queries.js (Onda 2).
  async searchPRs(extraArgs, user) { return ghMod.searchPRs(this, extraArgs, user); }
  async myAuthoredPRs(user) { return ghMod.myAuthoredPRs(this, user); }
  async prState(pr) { return ghMod.prState(this, pr); }
  async headSha(pr) { return ghMod.headSha(this, pr); }
  deliveriesSince(days) { return ghMod.deliveriesSince(this, days); }
  async fetchDeliveries(days, owner) { return ghMod.fetchDeliveries(this, days, owner); }


  async check(reason = 'timer') {
    if (this.checking) return;
    this.checking = true;
    this.setStatus('checking');
    try {
      // reconcilia budgetWarned com a realidade ATUAL dos perfis, independente da fila
      // ter PR nenhum pra oferecer a chance de "destravar": sem isso, um perfil que
      // estourou com a fila vazia (ou só com PRs excluídos por outro motivo) nunca sai
      // do Set quando o gasto volta a caber, e o próximo estouro de verdade fica mudo
      // (sem toast).
      for (const id of [...this.budgetWarned]) {
        const profile = (this.config.claudeProfiles || []).find(p => p.id === id);
        if (!profile || !this.profileBudgetStatus(profile).blocked) this.budgetWarned.delete(id);
      }
      await this.resolveAccount();
      await this.refreshTokens();
      const accounts = this.accountList();

      // painel: todos os PRs abertos das orgs monitoradas (sem alerta). Cada conta
      // busca nas SUAS orgs com o proprio token; dedup por chave (1a conta vence).
      const seenKeys = new Set();
      const panorama = [];
      let anyOk = false;
      for (const acc of accounts) {
        for (const owner of acc.owners) {
          const list = await this.searchPRs(['--owner', owner], acc.user);
          if (list === null) continue;
          anyOk = true;
          for (const pr of list) {
            if (seenKeys.has(pr.key)) continue;
            seenKeys.add(pr.key);
            panorama.push(pr);
          }
        }
      }

      // alerta + fila: PRs onde sou o revisor pedido, em QUALQUER conta (o @me
      // resolve por token, entao cada conta acha os seus). Dedup por chave.
      let mine = null, mineAnyOk = false;
      const mineMap = new Map();
      for (const acc of accounts) {
        const part = await this.searchPRs(['--review-requested=@me'], acc.user);
        if (part === null) continue;
        mineAnyOk = true;
        for (const pr of part) if (!mineMap.has(pr.key)) mineMap.set(pr.key, pr);
      }
      if (mineAnyOk) mine = [...mineMap.values()];
      if (mine === null && !anyOk) throw new Error('todas as buscas gh falharam (veja o log)');

      // indicador no panorama: PRs que EU ja revisei (qualquer conta, inclusive fora
      // do Farol). Se todas as buscas falharem, preserva o que ja se sabia.
      const revSet = new Set();
      let revAnyOk = false;
      for (const acc of accounts) {
        const part = await this.searchPRs(['--reviewed-by=@me'], acc.user);
        if (part === null) continue;
        revAnyOk = true;
        for (const pr of part) revSet.add(pr.key);
      }
      if (revAnyOk) this.reviewedKeys = revSet;

      // meus PRs abertos (autoanalise), POR CONTA: falha de uma conta preserva
      // o estado dela (G5: any-ok global apagava autoanálises e desocultava
      // hidden da conta que falhou no ciclo)
      let mineAuthored = null;
      const authOk = new Set();
      const authMap = new Map();
      for (const acc of accounts) {
        const part = await this.myAuthoredPRs(acc.user);
        if (part === null) continue;
        authOk.add(String(acc.user).toLowerCase());
        for (const pr of part) if (!authMap.has(pr.key)) authMap.set(pr.key, pr);
      }
      if (authOk.size) {
        // preserva do ciclo anterior os PRs das contas que falharam agora
        for (const pr of (this.myPRs || [])) {
          const dona = String(this.accountForPr(pr) || '').toLowerCase();
          if (!authOk.has(dona) && !authMap.has(pr.key)) authMap.set(pr.key, pr);
        }
        mineAuthored = [...authMap.values()];
        mineAuthored.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        this.myPRs = mineAuthored;
        // poda de autoanálise: só de chave cuja conta dona RESPONDEU neste ciclo
        const openKeys = new Set(mineAuthored.map(p => p.key));
        let pruned = false;
        for (const k of Object.keys(this.selfAnalyses)) {
          if (openKeys.has(k)) continue;
          const dona = String(this.accountForOwner(k.split('/')[0]) || '').toLowerCase();
          if (!authOk.has(dona)) continue; // conta falhou: "sumiu" não prova nada
          delete this.selfAnalyses[k]; pruned = true;
        }
        if (pruned) this.saveSelfAnalyses();
      }
      // ocultos de "Meus PRs" reconciliados com a lista recém-montada: PR com atividade
      // nova volta a aparecer sozinho, e chave órfã (PR que fechou) é limpa. O argumento
      // é o MESMO sinal que decidiu, PR a PR, o que foi substituído e o que foi
      // preservado logo acima: só a chave de conta que respondeu pode ser limpa, senão
      // a queda de rede de UMA conta desocultaria os PRs dela (ver reconcileHiddenPRs).
      this.reconcileHiddenPRs(authOk.size ? authOk : null);

      // falha só das --review-requested (ex.: rate limit da API de search): preserva
      // fila, "é meu" e marcadores do último ciclo bom, no MESMO padrão de reviewedKeys
      // e myPRs logo acima. Zerar aqui apagava reReviewedKeys (markReRequests com Set
      // vazio) e ressuscitava PRs que o usuário ignorou, re-notificando tudo na volta.
      const mineFailed = mine === null;
      const mineList = mineFailed ? [...this.queue] : mine;
      const mineKeys = mineFailed ? this.mineKeys : new Set(mineList.map(p => p.key));
      if (!mineFailed) this.mineKeys = mineKeys;
      for (const pr of panorama) pr.mine = mineKeys.has(pr.key);
      for (const pr of mineList) {
        if (!seenKeys.has(pr.key)) { pr.mine = true; panorama.push(pr); }
      }
      // re-request de review: fui pedido de novo (mine) num PR que EU já revisei
      // (reviewedByMe). No fluxo normal, revisar te tira dos pedidos; voltar aos pedidos
      // = o autor re-solicitou (a review antiga vira DISMISSED no GitHub). markReRequests
      // des-marca esses como "visto" pra voltarem à fila (acionáveis de novo).
      const reReq = this.markReRequests(mineFailed ? null : mineKeys);
      for (const pr of panorama) { pr.reviewedByMe = this.reviewedKeys.has(pr.key); pr.reRequested = reReq.has(pr.key); }
      for (const pr of mineList) pr.reRequested = reReq.has(pr.key);
      panorama.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)));

      // primeira execucao da vida: baseline silencioso (nao notifica o estoque)
      if (!fs.existsSync(BASELINE_FILE)) {
        for (const pr of mineList) this.markSeen(pr.key);
        fs.writeFileSync(BASELINE_FILE, new Date().toISOString() + '\n');
        this.emit('toast', { kind: 'info', text: 'Primeira checagem: PRs atuais marcados como vistos (baseline).' });
      }

      const prevQueue = new Set(this.queue.map(p => p.key));
      const queue = mineList.filter(p => !this.seen.has(p.key));
      const fresh = queue.filter(p => !prevQueue.has(p.key));

      this.panorama = panorama;
      this.queue = queue;
      this.lastCheckAt = Date.now();
      this.lastError = null;

      // contas silenciadas seguem monitoradas (aparecem ao selecionar a conta), mas
      // ficam fora dos avisos de PR novo e da auto-revisão: nada de barulho nem de
      // revisar sozinho o PR-teste abandonado.
      const freshActive = fresh.filter(p => !this.isMuted(this.accountForPr(p)));
      // auto-revisão respeita a política POR CONTA e vale pra TODA a fila elegível,
      // não só os que acabaram de chegar: ligar "revisa na hora" numa conta passa a
      // valer pros PRs que JÁ estavam esperando (era o gap de "configurei e não agiu").
      // Exclui os já em andamento, os "estacionados" (falha não-transitória/cancelados,
      // que aguardam ação manual) e os em retry de rede (repescados no bloco abaixo).
      const inflight = new Set([
        ...this.headlessQueue.map(p => p.key),
        ...[...this.activeReviews.values()].flatMap(s => s.keys || [])
      ]);
      const toReview = this.queue.filter(p => {
        const acct = this.accountForPr(p);
        if (this.isMuted(acct)) return false;
        if (!this.autoReviewFor(acct)) return false;
        if (!this.tokenFor(acct)) return false;
        if (inflight.has(p.key)) return false;
        if (this.autoReviewParked.has(p.key)) return false;
        if (this.retryAfterNet.has(p.key)) return false;
        const blockedProfile = this.budgetBlockedFor(acct);
        if (blockedProfile) {
          if (!this.budgetWarned.has(blockedProfile.id)) {
            this.budgetWarned.add(blockedProfile.id);
            this.emit('toast', { kind: 'error', text: `Orçamento do perfil "${blockedProfile.label}" estourado; automação pausada até liberar (clique manual continua liberado).` });
          }
          return false;
        }
        return true;
      });
      if (freshActive.length > 0) {
        this.emit('new-prs', { items: freshActive, total: queue.filter(p => !this.isMuted(this.accountForPr(p))).length, auto: toReview.length > 0 });
      }
      if (toReview.length) this.launchReview(toReview.map(p => p.url), 'auto');

      // a checagem funcionou = a rede voltou: relança revisões que caíram por algo
      // transitório. Vale pra QUALQUER revisão que caiu (clique no panorama e conta
      // sem autoReview inclusive): a promessa do toast não depende da política da conta.
      if (this.retryAfterNet.size) {
        const retry = this.retryTargets(new Set(fresh.map(f => f.key)), inflight);
        if (retry.length) {
          // poda PRs que foram mergeados/fechados enquanto esperavam no retry,
          // ANTES de notificar e lançar: sem isso cada ciclo gera uma cascata
          // de "relançando..." + "já mergeado, cancelei" pra cada PR fechado
          const stillOpen = [];
          for (const pr of retry) {
            let state = null;
            try { state = await this.prState(pr); } catch {}
            if (state === 'MERGED' || state === 'CLOSED') {
              this.retryAfterNet.delete(pr.key);
            } else {
              stillOpen.push(pr);
            }
          }
          if (stillOpen.length) {
            this.emit('toast', { kind: 'info', text: `Conexão de volta: relançando a revisão de ${stillOpen.map(p => p.key).join(', ')}.` });
            this.launchReview(stillOpen.map(p => p.url), 'auto');
          }
        }
      }
      // branch origem->destino de cada PR meu (o card mostra de/para)
      try { await this.enrichMyPRBranches(); } catch (e) { this.log('WARN', `enrichMyPRBranches: ${e.message}`); }
      // mergeabilidade real dos PRs aprovaveis (gate honesto do botao Merge)
      try { await this.refreshMergeStates(); } catch (e) { this.log('WARN', `refreshMergeStates: ${e.message}`); }
      // stale: PRs que EU revisei e receberam commit novo depois (reativa o "Re-revisar")
      try { await this.refreshStaleStates(); } catch (e) { this.log('WARN', `refreshStaleStates: ${e.message}`); }
      // round 2 sozinho: PR onde EU pedi mudanças e o autor empurrou commit novo volta
      // pra fila de revisão sem esperar clique (âncora por head impede repetição; era o
      // elo manual do ciclo, medido no biud-frontend#756). Depende do staleInfo que o
      // refreshStaleStates acabou de preencher, por isso a ordem aqui importa.
      try { this.launchReReviews(); } catch (e) { this.log('WARN', `re-revisão pós-push: ${e.message}`); }
      // pendência já atendida por fora (review postado pelo chat, pela web do GitHub ou
      // por gh na mão): tira o card de "Precisa de você", que antes ficava preso pra
      // sempre porque só o clique no botão esvaziava decisions.pending
      try { await this.reconcilePending(); } catch (e) { this.log('WARN', `reconcilePending: ${e.message}`); }
      // pushback automático: contestação do autor a um review meu (fire-and-forget:
      // roda em background pra não segurar a checagem, com guarda anti-concorrência)
      this.scanPushbacks().catch(e => this.log('WARN', `scanPushbacks: ${e.message}`));
      // atualizacao (releases do GitHub pras copias distribuidas) a cada ciclo
      this.checkUpdate().catch(() => {});
      this.setStatus('idle');
    } catch (err) {
      this.lastError = err.message;
      this.log('ERROR', `ciclo de monitoramento: ${err.message}`);
      this.setStatus('error');
    } finally {
      this.checking = false;
      this.schedule();
      this.pushState();
    }
  }

  setStatus(s) { this.status = s; this.pushState(); }

  schedule() {
    clearTimeout(this.timer);
    const ms = Math.max(60, this.config.intervalSeconds) * 1000;
    this.nextCheckAt = Date.now() + ms;
    this.timer = setTimeout(() => this.check('timer'), ms);
    if (this.timer.unref) this.timer.unref();
  }

  checkNow() { clearTimeout(this.timer); this.check('manual'); }

  // Re-requests de review: PRs pedidos a mim DE NOVO (mine) que EU já revisei.
  // Sinal do GitHub: revisar te remove dos pedidos; estar pedido de novo = o autor
  // clicou "re-request review" (a review antiga vira DISMISSED). Isso deve voltar
  // pra fila (e reentrar na auto-revisão) mesmo já "visto" na 1ª rodada, então
  // des-marca como visto UMA vez. "Já revisei" vem do HISTÓRICO LOCAL do Farol
  // (reviewActions, sem I/O), não de uma 2ª busca no gh (`--reviewed-by=@me`):
  // essa busca é indexação assíncrona do GitHub e pode ficar atrasada em relação
  // a `--review-requested=@me` no mesmo ciclo, fazendo o re-request nunca bater
  // (bug real reportado: PR pedido de novo não era identificado nem reanalisado
  // sozinho). O histórico local é instantâneo e reflete exatamente o que o Farol
  // postou; "pulado" (Pular) não conta como revisado (nada foi postado no GitHub,
  // então não há como ser re-request de verdade). O marcador reReviewedKeys evita
  // re-surgir todo ciclo (pra você poder ignorar depois) e é limpo quando o PR sai
  // dos pedidos (re-revisado ou fechado). Devolve o conjunto de keys re-solicitadas,
  // pra a UI rotular ("pedida de novo") e a auto-revisão relançar sozinha.
  markReRequests(mineKeys) {
    // null = as buscas --review-requested falharam NESTE ciclo: sem saber quem segue
    // pedido, preserva visto e marcadores e devolve o rótulo do último ciclo bom
    // (cópia, nunca o Set interno). Set VAZIO é outra coisa: "ninguém está mais
    // pedido", e aí limpa como sempre. Sem essa distinção, um rate limit da API de
    // search apagava reReviewedKeys e ressuscitava PRs que o usuário ignorou.
    if (mineKeys === null) return new Set(this.reReviewedKeys);
    const actions = this.reviewActions();
    const reReq = new Set();
    const now = Date.now();
    for (const key of mineKeys) {
      const a = actions[key];
      if (!a || a.kind === 'pending') continue;
      // eco do índice: review MEU recém-postado ainda aparece nos pedidos; não é
      // re-request (ver REREQ_GRACE_MS). Sem carimbo (registro legado), vale o sinal.
      if (a.at && (now - a.at) < REREQ_GRACE_MS) continue;
      reReq.add(key);
    }
    for (const key of reReq) {
      if (this.seen.has(key) && !this.reReviewedKeys.has(key)) { this.unsee(key); this.reReviewedKeys.add(key); }
    }
    for (const k of [...this.reReviewedKeys]) if (!reReq.has(k)) this.reReviewedKeys.delete(k);
    return reReq;
  }

  // --- sessao de revisao no Claude (terminal proprio, interativo) ---
  // O comando vai num .cmd e a janela abre via Start-Process (ShellExecute):
  // e o unico caminho que garante um console NOVO com stdin de verdade, que o
  // claude interativo exige. Spawnar cmd/start direto do Node herda handles
  // nulos (stdio ignore) e o console nasce sem stdin: pause/claude morrem na hora.
  // Sessão/stream (terminal + headless): colaborador lib/engine/session.js (Onda 2).
  buildSessionScript(slash, account, reviewCap = '') { return sessionMod.buildSessionScript(this, slash, account, reviewCap); }
  buildSessionScriptMac(slash, id, user, reviewCap = '') { return sessionMod.buildSessionScriptMac(this, slash, id, user, reviewCap); }
  spawnConsoleMac(slash, label, keys = [], account) { return sessionMod.spawnConsoleMac(this, slash, label, keys, account); }
  sessionExit(id) { return sessionMod.sessionExit(this, id); }
  spawnConsole(slash, label, keys = [], account) { return sessionMod.spawnConsole(this, slash, label, keys, account); }
  handleSessionExit(opts) { return sessionMod.handleSessionExit(this, opts); }
  buildLoginScript(dir) { return sessionMod.buildLoginScript(this, dir); }
  buildLoginScriptMac(dir, id) { return sessionMod.buildLoginScriptMac(this, dir, id); }
  spawnLoginConsoleMac(dir) { return sessionMod.spawnLoginConsoleMac(this, dir); }
  spawnLoginConsole(dir) { return sessionMod.spawnLoginConsole(this, dir); }

  // Pipeline de revisão headless: colaborador lib/engine/review.js (gate intacto, Onda 2).
  prFromUrl(url) { return reviewMod.prFromUrl(this, url); }
  async launchReview(urls, mode = 'auto') { return reviewMod.launchReview(this, urls, mode); }
  enqueueHeadless(pr) { return reviewMod.enqueueHeadless(this, pr); }
  headlessAcct(pr) { return reviewMod.headlessAcct(this, pr); }
  processHeadless() { return reviewMod.processHeadless(this); }
  freeHeadlessSlot(acct) { return reviewMod.freeHeadlessSlot(this, acct); }
  async runOneHeadless(pr, acct) { return reviewMod.runOneHeadless(this, pr, acct); }
  // re-revisão automática pós-push (round 2 sem clique): gate + lançamento + âncora
  reReviewTargets(inflightKeys) { return reviewMod.reReviewTargets(this, inflightKeys); }
  launchReReviews() { return reviewMod.launchReReviews(this); }
  saveReReviewLaunched() { return reviewMod.saveReReviewLaunched(this); }
  // `agora` com default nos DOIS lados de propósito: a fachada repassa o parâmetro
  // (nada é engolido) e o Function.length segue casando com o da implementação, que
  // é o que test/facades.test.js confere lendo este fonte.
  retryTargets(freshKeys, inflightKeys, agora = Date.now()) { return reviewMod.retryTargets(this, freshKeys, inflightKeys, agora); }

  // perfil marcado pra uma pessoa (por login); {} quando não marcada
  // Pushback (memória de contestação do autor): colaborador lib/engine/pushback.js (Onda 2).
  personProfile(login) { return pushbackMod.personProfile(this, login); }
  pushbacksFor(login) { return pushbackMod.pushbacksFor(this, login); }
  recordPushback(body) { return pushbackMod.recordPushback(this, body); }
  savePushbacks() { return pushbackMod.savePushbacks(this); }
  savePushbackScanned() { return pushbackMod.savePushbackScanned(this); }

  // bloco injetado no prompt de revisão: ajusta TOM + POSTURA, nunca a decisão.
  // Papel dá o tom-base; a matriz por domínio calibra a postura por área do PR;
  // o histórico de pushback calibra humildade/assertividade com aquela pessoa.
  personProfileBlock(login) { return reviewMod.personProfileBlock(this, login); }
  reviewFormatBlock() { return reviewMod.reviewFormatBlock(this); }
  thirdPartyReviewBlock() { return reviewMod.thirdPartyReviewBlock(); }
  // A implementação é headlessPromptFor(engine, url, author, lotes, metrics). Esta fachada
  // declarava só (url, author) e ENGOLIA lotes/metrics: o plano de fan-out era calculado
  // em runHeadlessReview e jogado fora, então o bloco de PR grande NUNCA chegou no prompt
  // (defeito desde a v2.26.0). Ver test/review-prompt.test.js, que trava os dois lados.
  headlessPromptFor(url, author, lotes, metrics) { return reviewMod.headlessPromptFor(this, url, author, lotes, metrics); }

  // Grava o nivel do modelo (Opus/Sonnet/...) na sessao ativa pra UI mostrar
  // qual agente esta rodando. O id cru vem do evento system/init da sessao.
  setSessionModel(id, rawModel) { return sessionMod.setSessionModel(this, id, rawModel); }
  pushActivity(id, kind, text) { return sessionMod.pushActivity(this, id, kind, text); }
  toolSummary(name, input) { return sessionMod.toolSummary(this, name, input); }
  killTree(pid) { return sessionMod.killTree(this, pid); }
  cancelSession(id) { return sessionMod.cancelSession(this, id); }
  runClaudeStream(prompt, opts = {}) { return sessionMod.runClaudeStream(this, prompt, opts); }
  parseEnvelope(raw) { return sessionMod.parseEnvelope(this, raw); }
  parseHeadlessResult(raw) { return sessionMod.parseHeadlessResult(this, raw); }

  async runHeadlessReview(pr) { return reviewMod.runHeadlessReview(this, pr); }

  // Candidatos pro seletor de reviewers: membros e times das orgs monitoradas.
  // Cacheado (mudam pouco). Assim a config vira escolha de uma lista, sem digitar
  // handle na mao (e sem typo que zera o pedido).
  // Meus PRs (reviewers, mergeabilidade, autoanálise, merge): colaborador lib/engine/selfpr.js (Onda 2).
  async reviewerCandidates() { return selfMod.reviewerCandidates(this); }
  async setReviewers(url) { return selfMod.setReviewers(this, url); }
  saveSelfAnalyses() { return selfMod.saveSelfAnalyses(this); }
  clearSelfAnalysis(key) { return selfMod.clearSelfAnalysis(this, key); }
  // Ocultar um PR de "Meus PRs" (some da aba, sem tocar no GitHub). Não confundir com
  // o clearSelfAnalysis acima, que só apaga a AUTOANÁLISE. Ocultar se desfaz sozinho
  // quando o PR recebe atividade nova (reconcileHiddenPRs, chamada no check()).
  saveHiddenPRs() { return selfMod.saveHiddenPRs(this); }
  hidePR(key) { return selfMod.hidePR(this, key); }
  unhidePR(key) { return selfMod.unhidePR(this, key); }
  reconcileHiddenPRs(okAccounts) { return selfMod.reconcileHiddenPRs(this, okAccounts); }
  async fetchMergeState(url) { return selfMod.fetchMergeState(this, url); }
  async enrichMyPRBranches() { return selfMod.enrichMyPRBranches(this); }
  async fetchAutoMergeAllowed(repo) { return selfMod.fetchAutoMergeAllowed(this, repo); }
  async fetchRuleBlocked(repo, base) { return selfMod.fetchRuleBlocked(this, repo, base); }
  async refreshMergeStates() { return selfMod.refreshMergeStates(this); }
  async refreshStaleStates() { return selfMod.refreshStaleStates(this); }
  async staleForReview(pr) { return selfMod.staleForReview(this, pr); }

  // --- pushback automático: detecta e classifica a contestação do autor ------
  // Best-effort (como o staleStates): qualquer incerteza não registra nada. O
  // gatilho barato via gh evita acender IA à toa; a classificação é 1 sessão
  // Claude por candidato novo, LEITURA pura (nunca posta), limitada por ciclo.
  async scanPushbacks() { return pushbackMod.scanPushbacks(this); }
  async detectAuthorPushback(pr, seen) { return pushbackMod.detectAuthorPushback(this, pr, seen); }
  async classifyPushback(pr) { return pushbackMod.classifyPushback(this, pr); }

  // --- merge do MEU PR quando a MINHA autoanalise diz "aprovavel" -------------
  // Unica escrita no GitHub partindo de "Meus PRs" (a autoanalise em si continua
  // 100% leitura). Acionada por clique explicito, com gate: so o autor mergeia o
  // proprio PR, so quando aprovavel, so em repo fora da lista bloqueada. Atribui
  // o autor se preciso e deleta a branch de origem SO se for descartavel.
  // mode: 'normal' (merge imediato), 'auto' (--auto: mergeia quando os requisitos
  // passarem, sem burlar protecao) ou 'admin' (--admin: bypassa a protecao agora,
  // so funciona se voce for admin do repo). Quando o merge normal esbarra na
  // protecao de branch, devolve { blocked:'policy' } pra UI oferecer auto/admin.
  async mergeSelfPR(url, opts = {}) { return selfMod.mergeSelfPR(this, url, opts); }
  selfPromptFor(url) { return selfMod.selfPromptFor(this, url); }
  parseSelfResult(raw) { return selfMod.parseSelfResult(this, raw); }
  async launchSelfAnalysis(url) { return selfMod.launchSelfAnalysis(this, url); }
  cancelSelfAnalysis(key) { return selfMod.cancelSelfAnalysis(this, key); }
  async runSelfAnalysis(pr) { return selfMod.runSelfAnalysis(this, pr); }

  // Decisão + postagem no GitHub: colaborador lib/engine/decision.js (gate intacto, Onda 2).
  recordDecision(pr, result, extra) { return decisionMod.recordDecision(this, pr, result, extra); }
  resolveIntoHistory(item) { return decisionMod.resolveIntoHistory(this, item); }
  decisionByKey(key) { return decisionMod.decisionByKey(this, key); }
  reviewActions() { return decisionMod.reviewActions(this); }
  saveDecisions() { return decisionMod.saveDecisions(this); }
  async myReviewsWithTime(pr) { return decisionMod.myReviewsWithTime(this, pr); }
  async myReviewStates(pr, headSha) { return decisionMod.myReviewStates(this, pr, headSha); }
  async reconcilePending(keys) { return decisionMod.reconcilePending(this, keys); }
  shouldAutoApprove(pr, result) { return decisionMod.shouldAutoApprove(this, pr, result); }
  shouldAutoReject(pr, result) { return decisionMod.shouldAutoReject(this, pr, result); }
  rejectBodyWithMark(body) { return decisionMod.rejectBodyWithMark(this, body); }
  attentionPoints(result) { return decisionMod.attentionPoints(this, result); }
  contestations(result) { return decisionMod.contestations(result); }
  coverageGap(result) { return decisionMod.coverageGap(result); }
  checkpointGap(result) { return decisionMod.checkpointGap(result); }
  async postReview(pr, payload) { return decisionMod.postReview(this, pr, payload); }
  async postReviewFromSession(submission, capability) { return decisionMod.postReviewFromSession(this, submission, capability); }
  decisionForUi(item) { return decisionMod.decisionForUi(item); }
  createReviewPostCapability(keys, account, source, ownerId) { return decisionMod.createReviewPostCapability(this, keys, account, source, ownerId); }
  revokeReviewPostCapability(token) { return decisionMod.revokeReviewPostCapability(this, token); }
  revokeReviewPostCapabilitiesByOwner(ownerId) { return decisionMod.revokeReviewPostCapabilitiesByOwner(this, ownerId); }
  writeMemory(result, actionLabel) { return decisionMod.writeMemory(this, result, actionLabel); }
  async decide(id, action) { return decisionMod.decide(this, id, action); }

  // --- chat com o Claude por PR ------------------------------------------------
  // Cada PR tem uma conversa persistente. Quando existe uma revisão headless
  // registrada (pendente ou resolvida), a conversa RETOMA a sessão da revisão
  // (--resume): o Claude chega sabendo o diff, o card e o relatório.
  // Chat por PR: lógica no colaborador lib/engine/chat.js (fachadas finas, Onda 2).
  saveChats() { return chatMod.saveChats(this); }
  chatPublic(key) { return chatMod.chatPublic(this, key); }
  chatSummaries() { return chatMod.chatSummaries(this); }
  chatPreamble(key, url, inherited) { return chatMod.chatPreamble(this, key, url, inherited); }
  async chatSend(key, url, text) { return chatMod.chatSend(this, key, url, text); }
  chatStop(key) { return chatMod.chatStop(this, key); }

  // escopo do kudos: '*' = todas as contas; senão o login (minúsculo) de uma conta
  // Ferramentas (kudos/diagnóstico) + limpeza: colaborador lib/engine/tools.js (Onda 2).
  kudosScopeKey(scope) { return toolsMod.kudosScopeKey(this, scope); }
  scopeLabel(scope) { return toolsMod.scopeLabel(this, scope); }
  ownerFromUrl(url) { return toolsMod.ownerFromUrl(this, url); }
  highlightsForScope(scope) { return toolsMod.highlightsForScope(this, scope); }
  toolPrompt(name, opts) { return toolsMod.toolPrompt(this, name, opts); }
  saveToolRuns() { return toolsMod.saveToolRuns(this); }
  toolRunGet(name, scope) { return toolsMod.toolRunGet(this, name, scope); }
  toolRunSet(name, scope, run) { return toolsMod.toolRunSet(this, name, scope, run); }
  async launchTool(name, scope) { return toolsMod.launchTool(this, name, scope); }
  clearTool(name, scope) { return toolsMod.clearTool(this, name, scope); }
  clearLog() { return toolsMod.clearLog(this); }

  ignore(key) {
    this.markSeen(key);
    this.queue = this.queue.filter(p => p.key !== key);
    this.pushState();
  }

  restore(key) {
    this.unsee(key);
    this.checkNow();
  }

  // --- versao e atualizacao ----------------------------------------------------
  // A "fonte" de atualizacao e a pasta do codigo (por padrao ~/Documents/farol).
  // Atualizar = rodar o installer da fonte, que ja mata as instancias, migra
  // estado e recria os atalhos (sem duplicar instalacao), e reabrir o app.
  // Auto-update: a logica vive no modulo colaborador lib/engine/update.js; estes
  // metodos sao fachadas finas que delegam passando o engine como contexto (Onda 2).
  resolveUpdateSource() { return updateMod.resolveUpdateSource(this); }
  cmpVersion(a, b) { return updateMod.cmpVersion(a, b); }
  async checkUpdate() { return updateMod.checkUpdate(this); }
  async checkUpdateRemote(repo) { return updateMod.checkUpdateRemote(this, repo); }
  async downloadRemoteUpdate() { return updateMod.downloadRemoteUpdate(this); }
  async applyUpdate() { return updateMod.applyUpdate(this); }
  applyUpdateMac() { return updateMod.applyUpdateMac(this); }

  // qual AUTENTICAÇÃO (não só dir) usar pras sessões desta conta GitHub. Cascata:
  // 1) accounts[].claudeProfileId da própria conta; 2) claudeProfileId global (padrão do
  // Farol); 3) sem profiles configurados (ou id não encontrado/perfil sem o campo
  // obrigatório do seu kind), cai no claudeConfigDir legado (sempre kind dir).
  resolveClaudeAuth(user) {
    const acc = (this.config.accounts || []).find(a => a && a.user === user);
    const profiles = this.config.claudeProfiles || [];
    if (profiles.length) {
      const id = acc?.claudeProfileId || this.config.claudeProfileId || '';
      const p = profiles.find(p => p.id === id);
      if (p?.kind === 'apikey' && p.apiKey) return { kind: 'apikey', id: p.id, apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
      if (p && p.kind !== 'apikey' && p.dir) return { kind: 'dir', id: p.id, dir: p.dir };
    }
    return { kind: 'dir', id: '', dir: this.config.claudeConfigDir || '' };
  }

  // compat: quem só quer "o dir, se houver" (nenhum call site de produção deveria
  // sobrar depois da migração das Tasks 2/3/5, mas mantido por garantia). Devolve ''
  // quando o resolvido for kind apikey - nunca confunde os dois formatos de auth.
  resolveClaudeConfigDir(user) {
    const auth = this.resolveClaudeAuth(user);
    return auth.kind === 'apikey' ? '' : (auth.dir || '');
  }

  // dir de um perfil ESPECÍFICO pelo id, pra "abrir sessão de login" sem depender de
  // conta GitHub nenhuma (é uma escolha direta de assinatura, não uma revisão de PR).
  // profileId vazio ou não encontrado cai no mesmo fallback de resolveClaudeConfigDir
  // (claudeConfigDir legado), pra logar no "Padrão da máquina" também funcionar.
  resolveConfigDirForLogin(profileId) {
    const profiles = this.config.claudeProfiles || [];
    const p = profileId ? profiles.find(x => x.id === profileId) : null;
    if (p?.dir) return p.dir;
    return this.config.claudeConfigDir || '';
  }

  // mesma cascata de resolveConfigDirForLogin, mas devolvendo o perfil INTEIRO (com kind),
  // pra openClaudeLoginSession decidir se o perfil resolvido pode logar.
  resolveAuthForLogin(profileId) {
    const profiles = this.config.claudeProfiles || [];
    const p = profileId ? profiles.find(x => x.id === profileId) : null;
    if (p?.kind === 'apikey' && p.apiKey) return { kind: 'apikey', apiKey: p.apiKey, baseUrl: p.baseUrl || '' };
    if (p && p.kind !== 'apikey' && p.dir) return { kind: 'dir', dir: p.dir };
    return { kind: 'dir', dir: this.config.claudeConfigDir || '' };
  }

  // abre a sessão de terminal SÓ pra login (ver Fix 2, lib/engine/session.js). Perfil de
  // chave de API não tem fluxo de claude login (a chave já é a credencial): nem chega a
  // chamar spawnLoginConsole. A UI já esconde o botão nesse caso, isto é o segundo lado
  // da defesa.
  openClaudeLoginSession(profileId) {
    const auth = this.resolveAuthForLogin(profileId);
    if (auth.kind === 'apikey') {
      return { ok: false, error: 'perfis de chave de API não usam login: a chave já é a credencial' };
    }
    return this.spawnLoginConsole(auth.dir);
  }

  // --- diagnostico de pre-requisitos ---
  // assinatura do Claude que as sessões do Farol usam (best-effort, sem segredo):
  // qual config dir e qual conta OAuth está logada ali, pra o doctor/badges mostrarem.
  // Sem argumento, mantém o comportamento legado (lê o claudeConfigDir global); passe um
  // dir explícito (inclusive '') pra checar um perfil específico (ver allClaudeAuthInfo).
  claudeAuthInfo(dir) {
    const d = String(dir != null ? dir : (this.config.claudeConfigDir || '')).trim();
    const jsonPath = d ? path.join(d, '.claude.json') : path.join(os.homedir(), '.claude.json');
    const info = { configDir: d || null, account: null, ready: true };
    try {
      const j = readJson(jsonPath, {});
      info.account = (j && j.oauthAccount && j.oauthAccount.emailAddress) || null;
      // dir próprio precisa do login feito (credencial OAuth). A padrão a gente assume ok.
      if (d) info.ready = fs.existsSync(path.join(d, '.credentials.json')) || !!info.account;
    } catch { /* best-effort */ }
    return info;
  }

  // status de TODOS os perfis salvos, mais uma entrada sintética "Padrão" pro fallback
  // legado (claudeConfigDir global). Essa entrada '' é incluída SEMPRE, mesmo quando já
  // existem perfis salvos: é o que sobra visível quando o perfil padrão do Farol está
  // vazio ("Padrão da máquina" no dropdown) ou uma conta não tem override próprio, sem
  // ela o badge de quem usa esse fallback não tinha nenhum dado pra mostrar (achado da
  // revisão final: legado ficava invisível na UI depois que a Task 6 tirou o campo texto).
  // Perfil apikey não tem OAuth pra ler (claudeAuthInfo lê .credentials.json, que só
  // existe pro caminho dir): status sintético baseado só em "a chave está preenchida?",
  // sem tocar disco.
  allClaudeAuthInfo() {
    const profiles = this.config.claudeProfiles || [];
    const legacy = { id: '', label: 'Padrão', ...this.claudeAuthInfo() };
    if (!profiles.length) return [legacy];
    return [legacy, ...profiles.map(p => ({
      id: p.id,
      label: p.label,
      // orcamento (blocked/today/sinceCutoff) NAO viaja mais aqui: o doctor e um
      // cache (boot/Verificar agora/salvar perfis) e congelava o cartao da aba
      // Consumo enquanto o gate real recalculava ao vivo. A fonte unica do
      // orcamento e usageSummary().budgets, refeita a cada pushState (v2.40.0).
      ...(p.kind === 'apikey'
        ? { configDir: null, account: null, ready: !!p.apiKey, apiKeyMode: true }
        : this.claudeAuthInfo(p.dir))
    }))];
  }

  async doctor() {
    const tokenArgs = ['auth', 'token'];
    const primary = this.primaryUser();
    if (primary) tokenArgs.push('--user', primary);
    const [gh, claude, auth] = await Promise.all([
      run('gh', ['--version']),
      runShell('claude --version'),
      run('gh', tokenArgs)
    ]);
    this.doctorInfo = {
      node: process.version,
      gh: gh.ok ? gh.stdout.split('\n')[0].trim() : null,
      claude: claude.ok ? claude.stdout.trim().split('\n')[0] : null,
      ghAuth: auth.ok && !!auth.stdout.trim(),
      gitBash: this.gitBash,
      home: HOME,
      workspace: WORKSPACE,
      claudeAuth: this.allClaudeAuthInfo(), // status de cada perfil de assinatura Claude salvo
      checkedAt: Date.now()
    };
    this.checkUpdate().catch(() => {});
    this.pushState();
    return this.doctorInfo;
  }

  updateSettings(patch) {
    const allowed = ['ghUser', 'owners', 'accounts', 'intervalSeconds', 'autoReview', 'autoApproveAll', 'parallelReviews', 'skipPermissions',
      'soundEnabled', 'theme', 'autostart', 'updateSource', 'updateRepo', 'mergeBlockedRepos',
      'projectReviewers', 'defaultReviewers', 'people', 'claudeConfigDir', 'claudeProfiles', 'claudeProfileId',
      'reviewModel', 'reviewEffort', 'autoPushback', 'debugSpawns'];
    let intervalChanged = false, userChanged = false;
    for (const k of allowed) {
      if (!(k in patch)) continue;
      let v = patch[k];
      if (k === 'intervalSeconds') { v = Math.min(3600, Math.max(60, parseInt(v, 10) || DEFAULTS.intervalSeconds)); intervalChanged = true; }
      if (k === 'owners') v = Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : String(v).split(/[,;\s]+/).filter(Boolean);
      if (k === 'mergeBlockedRepos') v = Array.isArray(v) ? v.map(s => String(s).trim()).filter(Boolean) : String(v).split(/[,;\s]+/).filter(Boolean);
      if (k === 'projectReviewers') v = parseProjectReviewers(v);
      if (k === 'defaultReviewers') v = parseDefaultReviewers(v);
      if (k === 'people') v = parsePeople(v);
      if (k === 'claudeConfigDir') v = sanitizeClaudeDir(v);
      // perfis nomeados de assinatura Claude: [{id,label,dir}] (login por assinatura) ou
      // [{id,label,kind:'apikey',apiKey,baseUrl}] (chave de API). Descarta entradas sem
      // id ou sem dir/apiKey válido conforme o kind (perfil incompleto não serve pra nada, ver
      // resolveClaudeConfigDir), e sanitiza dir/apiKey/baseUrl (aspa dupla/newline quebrariam os
      // scripts de sessão gerados, ver sanitizeClaudeDir/lib/parse.js).
      if (k === 'claudeProfiles') v = normalizeClaudeProfiles(v);
      if (k === 'claudeProfileId') v = normalizeClaudeProfileId(v);
      // valor invalido MANTEM o anterior (semantica de sempre): a UI mostra o que o
      // engine aceitou no proximo estado, entao nao fica setting fantasma.
      if (k === 'reviewModel') { const s = sanitizeModel(v); v = (s === null) ? this.config.reviewModel : s; }
      if (k === 'reviewEffort') { const s = sanitizeEffort(v); v = (s === null) ? this.config.reviewEffort : s; }
      if (k === 'parallelReviews') { const s = sanitizeParallelReviews(v); v = (s === null) ? this.config.parallelReviews : s; }
      if (k === 'autoPushback') v = !!v;
      if (k === 'debugSpawns') v = !!v;
      if (k === 'accounts') {
        v = parseAccounts(v);
        // só re-autentica se as CONTAS (user/owners) mudaram; editar rótulo, cor,
        // tipo ou silenciar não mexe em token, então não força um re-login/re-check.
        const sig = arr => JSON.stringify((arr || []).map(a => [String(a.user).toLowerCase(), (a.owners || []).map(o => String(o).toLowerCase()).sort()]));
        if (sig(v) !== sig(this.config.accounts)) userChanged = true;
      }
      if (k === 'ghUser') { v = String(v).trim(); userChanged = userChanged || v !== this.config.ghUser; }
      this.config[k] = v;
    }
    process.env.FAROL_DEBUG_SPAWNS = this.config.debugSpawns ? '1' : ''; // liga/desliga o logger na hora
    this.saveConfig();
    if (userChanged) { this.token = null; this.tokenOk = false; this.tokens = {}; }
    if (intervalChanged || userChanged) this.checkNow();
    // perfil (lista ou padrão global) mudou: o badge de assinatura Claude (doctor.claudeAuth)
    // fica desatualizado até o próximo boot ou clique em "Reverificar" - recalcula na hora
    // pra badge refletir o estado real logo após salvar. NÃO inclui 'accounts': editar
    // cor/rótulo/tipo/org/claudeProfileId de uma conta não muda o resultado de
    // allClaudeAuthInfo() (ela só lê claudeProfiles), então redisparar doctor() aqui só
    // gastava 3 subprocessos + 1 chamada de rede (checkUpdate) à toa (achado da revisão final).
    if ('claudeProfiles' in patch || 'claudeProfileId' in patch) {
      this.doctor().catch(() => {});
    }
    this.emit('settings-changed', this.config);
    this.pushState();
  }

  snapshot() {
    return {
      app: { name: APP_NAME, version: APP_VERSION, platform: process.platform },
      status: this.status,
      error: this.lastError,
      account: { user: this.primaryUser(), tokenOk: this.tokenOk },
      accounts: this.accountList().map((a, i) => ({
        user: a.user, owners: a.owners, tokenOk: !!(this.tokens && this.tokens[a.user]),
        label: a.label, color: a.color, kind: a.kind, muted: !!a.muted, primary: i === 0,
        autoReview: a.autoReview, onClean: a.onClean, onCaveats: a.onCaveats, onReject: a.onReject,
        claudeProfileId: a.claudeProfileId
      })),
      pushbacks: this.pushbacks,
      config: { ...this.config },
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
      queue: this.queue,
      panorama: this.panorama,
      myPRs: this.myPRs,
      // só as CHAVES: myPRs vai completo de propósito, porque quem esconde é a UI
      // (que também precisa oferecer "mostrar os ocultos")
      hiddenPRs: Object.keys(this.hiddenPRs),
      selfAnalyses: this.selfAnalyses,
      mergeStates: this.mergeStates,
      staleStates: this.staleStates,
      activeSessions: [...this.activeReviews.values()],
      activity: Object.fromEntries(this.activity),
      headlessWaiting: this.headlessQueue.map(p => p.key),
      chats: this.chatSummaries(),
      toolRuns: this.toolRuns,
      decisions: {
        pending: this.decisions.pending.map(d => decisionMod.decisionForUi(d)),
        // "Revisões recentes": envia as 30 mais recentes (era 8). O histórico no
        // disco guarda até 200 (ver resolveIntoHistory); aqui limita o payload do SSE.
        resolved: this.decisions.resolved.slice(0, 30).map(d => decisionMod.decisionForUi(d))
      },
      reviewActions: this.reviewActions(),
      usage: this.usageSummary(),
      doctor: this.doctorInfo,
      update: this.update || null,
      paths: { home: HOME, workspace: WORKSPACE }
    };
  }

  // Consumo de tokens: colaborador lib/engine/usage.js (registro permanente, sem custo);
  // ref é a referência amigável (PR/chat/ferramenta) que alimenta a tabela de sessões.
  recordUsage(id, account, resultEvent, model, profileId, ref) { return usageMod.recordUsage(this, id, account, resultEvent, model, profileId, ref); }
  usageSummary() { return usageMod.usageSummary(this); }
  profileBudgetStatus(profile) { return usageMod.profileBudgetStatus(profile, this.usage); }

  // devolve o perfil bloqueado por orçamento pra essa conta, ou null se não estiver
  // bloqueada (conta sem perfil apikey, perfil sem teto, ou dentro do teto). Usado em
  // TODO caminho automático de gasto (toReview, retry pós-transitório, scan de
  // pushback), pra nenhum deles vazar gasto quando um perfil já estourou.
  budgetBlockedFor(acct) {
    const auth = this.resolveClaudeAuth(acct);
    if (auth.kind !== 'apikey') return null;
    const profile = (this.config.claudeProfiles || []).find(x => x.id === auth.id);
    return (profile && this.profileBudgetStatus(profile).blocked) ? profile : null;
  }

  pushState() { this.emit('state', this.snapshot()); }

  // Deep-link de alerta: o shell (clique na notificação) pede pra UI levar
  // o usuário direto ao card do PR (a UI rola e destaca via SSE 'focus-pr').
  focusPr(url) { if (url) this.emit('focus-pr', { url }); }

  async start() {
    this.checkUpdate().catch(() => {});
    this.doctor().catch(() => {});
    await this.check('startup');
  }
}

// --- bootstrap ---------------------------------------------------------------

function start(onReady) {
  const engine = new Engine();
  let began = false;
  const server = startServer(engine, (url, err) => {
    // O listen na porta é o lock de instância única (vale também no modo
    // `node server.js`, sem Electron). Com a porta ocupada já existe um Farol
    // usando este ~/.farol: um segundo engine com polling próprio revisaria PR
    // em dobro e escreveria seen/inflight/usage sem lock (A7). Por isso o
    // monitoramento só começa DEPOIS do listen dar certo.
    if (!err && !began) { began = true; engine.schedule(); engine.start(); }
    if (onReady) onReady(url, err);
  });
  return { engine, server, port: engine.config.port };
}

module.exports = { start, HOME, WORKSPACE, Engine, modelLabel, isPermanentBranch, parseProjectReviewers, parseDefaultReviewers, parseAccounts,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId, applyClaudeAuthEnv, claudeAuthShellLines };

// execucao direta: modo servidor (fallback sem Electron, ou desenvolvimento)
if (require.main === module) {
  start((url, err) => {
    if (err) { console.error('[farol] erro ao subir o servidor:', err.message); process.exit(1); }
    console.log(`[farol] monitorando · UI em ${url}`);
    console.log('[farol] Ctrl+C para sair');
  });
}
