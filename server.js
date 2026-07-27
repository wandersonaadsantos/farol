// Farol: engine de monitoramento de PRs + servidor http local da UI.
// Porta a logica do antigo pr-reviewer.ps1: o polling do GitHub roda aqui
// (so comandos gh, sem gastar tokens de IA); a revisao em si abre uma sessao
// interativa do Claude Code em um terminal proprio, com /pr-review <urls>.
// Zero dependencias externas: roda com Node puro (e dentro do Electron).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

const APP_VERSION = require('./package.json').version;
const APP_NAME = 'Farol';
// teto de PRs mergeados lidos por org na aba Entregas: 1000 e o maximo que o
// gh search devolve. Alem disso nao ha como paginar por essa API, entao a UI
// avisa (flag capped) e mostra os 1000 mais recentes.
const DELIVERIES_LIMIT = 1000;

// --- Plataforma ---------------------------------------------------------------
// O Farol nasceu no Windows; o suporte a macOS vive nestes branches. Toda
// diferenca de SO passa por IS_WIN/IS_MAC, nunca espalhada em checagens soltas.
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Nome amigavel do modelo (nivel do agente) a partir do id cru que o Claude Code
// reporta no evento system/init. "claude-opus-4-8" vira "Opus 4.8"; se nao
// reconhecer a familia, devolve o id como veio (melhor mostrar algo que nada).
function modelLabel(id) {
  const raw = String(id || '').trim();
  if (!raw) return '';
  const fam = /opus/i.test(raw) ? 'Opus' : /sonnet/i.test(raw) ? 'Sonnet' : /haiku/i.test(raw) ? 'Haiku' : '';
  const ver = (raw.match(/(\d+)-(\d+)/) || [])[0];
  return fam ? `${fam}${ver ? ' ' + ver.replace('-', '.') : ''}` : raw;
}

// Branches permanentes do fluxo (gitflow + ambientes): NUNCA podem ser deletadas
// depois de um merge. Uma promocao develop->release, por exemplo, tem 'develop'
// como head; deletar a branch ali apagaria a develop. Tudo que NAO casar aqui
// (feature/*, fix/*, task-*, hotfix/*, bugfix/*...) e descartavel e pode ser
// limpo pra evitar lixo. Sem nome = trata como permanente por seguranca.
function isPermanentBranch(name) {
  const b = String(name || '').trim().toLowerCase();
  if (!b) return true;
  if (['main', 'master', 'develop', 'dev', 'trunk', 'staging', 'homolog',
    'homologacao', 'hml', 'hmg', 'prod', 'production', 'release'].includes(b)) return true;
  // familias versionadas: release/*, release_1.2, hml-*, hmg-v*, homolog*, prod*, env/*
  if (/^(release|hml|hmg|homolog|prod|production|staging|env)[\/_-]/.test(b)) return true;
  return false;
}

// App aberto pelo Finder/Dock herda um PATH minimo (sem /opt/homebrew/bin):
// gh e claude sumiriam. Prependa os diretorios usuais que existirem.
if (!IS_WIN) {
  const extras = ['/opt/homebrew/bin', '/usr/local/bin',
    path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), 'bin')];
  const current = (process.env.PATH || '').split(':');
  const missing = extras.filter(d => !current.includes(d) && fs.existsSync(d));
  if (missing.length) process.env.PATH = missing.concat(process.env.PATH || '').join(':');
}

// --- Caminhos ---------------------------------------------------------------
// IMPORTANTE: fora do AppData de proposito. O Claude Code pode rodar empacotado
// (MSIX) e ai o %LOCALAPPDATA% e VIRTUALIZADO: o que ele escreve vai pro overlay
// do pacote (Packages\...\LocalCache) e o app nunca ve. ~/.farol nao e virtualizado.
const HOME = process.env.FAROL_HOME || path.join(os.homedir(), '.farol');
const WORKSPACE = path.join(HOME, 'workspace');
const STATE_DIR = path.join(WORKSPACE, 'state');
const CONFIG_FILE = path.join(HOME, 'config.json');
const LOG_FILE = path.join(STATE_DIR, 'farol.log');
const SEEN_FILE = path.join(STATE_DIR, 'seen');
const BASELINE_FILE = path.join(STATE_DIR, 'baselined');
const INFLIGHT_FILE = path.join(STATE_DIR, 'inflight.json');
const CHATS_FILE = path.join(STATE_DIR, 'chats.json');
const SELF_FILE = path.join(STATE_DIR, 'self-analyses.json');
const TEMPLATE_DIR = path.join(__dirname, 'workspace-template');
const UI_DIR = path.join(__dirname, 'ui');

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
  // classificacao automatica de pushback (1 sessao Claude por PR contestado). Default ON
  // (a funcionalidade que o Wanderson pediu); quem quiser poupar limite desliga em Sistema.
  autoPushback: true,
  claudeConfigDir: ''
};

// Parseia a config de reviewers por projeto. Aceita ja um objeto (map) ou o
// texto do textarea de Sistema, uma linha por repo: "owner/repo: login1, org/time".
function parseProjectReviewers(val) {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const out = {};
    for (const k of Object.keys(val)) {
      const list = Array.isArray(val[k]) ? val[k] : String(val[k]).split(/[,;]+/);
      const people = list.map(s => String(s).trim()).filter(Boolean);
      if (people.length) out[k.trim()] = people;
    }
    return out;
  }
  const map = {};
  for (const line of String(val || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([^\s:]+\/[^\s:]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const people = m[2].split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    if (people.length) map[m[1].trim()] = people;
  }
  return map;
}

// Reviewers padrao por org: { "org": [pessoas/times] }. Aceita objeto (map) ou
// texto "org: login1, org/time" (uma linha por org). Chave = org (sem barra).
function parseDefaultReviewers(val) {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const out = {};
    for (const k of Object.keys(val)) {
      const list = Array.isArray(val[k]) ? val[k] : String(val[k]).split(/[,;]+/);
      const people = list.map(s => String(s).trim()).filter(Boolean);
      if (people.length) out[k.trim()] = people;
    }
    return out;
  }
  const map = {};
  for (const line of String(val || '').split(/\r?\n/)) {
    const m = line.match(/^\s*([^\s:/]+)\s*:\s*(.+)$/);
    if (!m) continue;
    const people = m[2].split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    if (people.length) map[m[1].trim()] = people;
  }
  return map;
}

// Parseia a lista de contas monitoradas. Aceita ja um array de { user, owners }
// ou o texto do textarea de Sistema, uma linha por conta: "login: org1, org2".
// A ordem importa: a 1a e a primaria.
function parseAccounts(val) {
  const norm = (user, owners, meta) => {
    const o = {
      user: String(user || '').trim(),
      owners: (Array.isArray(owners) ? owners : String(owners || '').split(/[,;\s]+/))
        .map(s => String(s).trim()).filter(Boolean)
    };
    // metadados de identidade (só quando presentes): rótulo amigável, cor, tipo e
    // o estado "silenciada". Preservados pra o painel separar as contas na UI.
    if (meta) {
      if (meta.label != null && String(meta.label).trim()) o.label = String(meta.label).trim();
      if (meta.color != null && String(meta.color).trim()) o.color = String(meta.color).trim();
      if (meta.kind != null && String(meta.kind).trim()) o.kind = String(meta.kind).trim();
      if (meta.muted) o.muted = true;
      // política de automação por conta (só quando definida; ausente = herda o global):
      //  autoReview bool; onClean/onCaveats = 'approve' | 'wait'; onReject = 'request_changes' | 'wait'
      if (meta.autoReview === true || meta.autoReview === false) o.autoReview = meta.autoReview;
      if (meta.onClean === 'approve' || meta.onClean === 'wait') o.onClean = meta.onClean;
      if (meta.onCaveats === 'approve' || meta.onCaveats === 'wait') o.onCaveats = meta.onCaveats;
      if (meta.onReject === 'request_changes' || meta.onReject === 'wait') o.onReject = meta.onReject;
    }
    return o;
  };
  if (Array.isArray(val)) {
    return val.map(a => norm(a && a.user, a && a.owners, a)).filter(a => a.user);
  }
  const out = [];
  for (const line of String(val || '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i < 0) { const u = line.trim(); if (u) out.push(norm(u, [])); continue; }
    const a = norm(line.slice(0, i), line.slice(i + 1));
    if (a.user) out.push(a);
  }
  return out;
}

// mapa de PERFIL { login(minúsculo): { papel?, dominios?{dominio: nivel} } }, validado.
// A UI manda o mapa inteiro; papel/domínio/nível inválidos são descartados, e a
// pessoa sem nada útil sai do mapa (não guarda entrada vazia).
function parsePeople(val) {
  const out = {};
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    for (const [login, p] of Object.entries(val)) {
      const k = String(login || '').trim().toLowerCase();
      if (!k || !p || typeof p !== 'object') continue;
      const person = {};
      if (PAPEL_LEVELS.includes(p.papel)) person.papel = p.papel;
      if (p.dominios && typeof p.dominios === 'object') {
        const dom = {};
        for (const d of DOMAINS) if (DOMAIN_LEVELS.includes(p.dominios[d])) dom[d] = p.dominios[d];
        if (Object.keys(dom).length) person.dominios = dom;
      }
      if (person.papel || person.dominios) out[k] = person;
    }
  }
  return out;
}

// migra o formato antigo (config.seniority = {login: nivel}) pro perfil novo:
// o nível de senioridade vira o `papel` da pessoa. Idempotente.
function migrateSeniorityToPeople(seniority, people) {
  const out = { ...(people || {}) };
  if (seniority && typeof seniority === 'object' && !Array.isArray(seniority)) {
    for (const [login, lvl] of Object.entries(seniority)) {
      const k = String(login || '').trim().toLowerCase();
      if (!k || !PAPEL_LEVELS.includes(lvl)) continue;
      out[k] = { ...(out[k] || {}), papel: (out[k] && out[k].papel) || lvl };
    }
  }
  return out;
}

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

// --- Utilitarios ------------------------------------------------------------
function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function copyRecursive(src, dst) {
  if (!fs.existsSync(src)) return;
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    ensureDir(dst);
    for (const item of fs.readdirSync(src)) copyRecursive(path.join(src, item), path.join(dst, item));
  } else {
    ensureDir(path.dirname(dst));
    fs.copyFileSync(src, dst);
  }
}

function detectGitBash() {
  if (!IS_WIN) return null; // so faz sentido no Windows (CLAUDE_CODE_GIT_BASH_PATH)
  const candidates = [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'bin', 'bash.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe')
  ];
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// gh e claude no Windows podem ser shims .cmd: resolve via cmd.exe quando preciso.
// No macOS/Linux o equivalente e /bin/sh -lc (login shell, pra carregar o PATH
// do perfil quando o app foi aberto pelo Finder).
function runShell(commandLine, opts = {}) {
  const [cmd, args] = IS_WIN
    ? ['cmd.exe', ['/d', '/s', '/c', commandLine]]
    : ['/bin/sh', ['-lc', commandLine]];
  return new Promise((resolve) => {
    execFile(cmd, args,
      { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsVerbatimArguments: false, ...opts },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}

// --- Engine -----------------------------------------------------------------
class Engine extends EventEmitter {
  constructor() {
    super();
    this.config = { ...DEFAULTS, ...readJson(CONFIG_FILE, {}) };
    delete this.config.autoOpenReview; // chave antiga (terminal); o modo autonomo tem semantica nova
    this.config.accounts = parseAccounts(this.config.accounts); // normaliza (array de {user,owners})
    // perfil de review por pessoa (papel + matriz por domínio); migra a senioridade plana antiga pro campo `papel`
    this.config.people = migrateSeniorityToPeople(this.config.seniority, parsePeople(this.config.people));
    delete this.config.seniority;
    this.tokens = {};                // token por conta (login -> token), preenchido no refreshTokens
    this.status = 'starting';        // starting | checking | idle | error
    this.lastError = null;
    this.lastCheckAt = null;
    this.nextCheckAt = null;
    this.panorama = [];
    this.queue = [];
    this.myPRs = [];                 // PRs abertos de autoria minha (fonte da autoanalise)
    this.selfAnalyses = readJson(SELF_FILE, {}); // key do PR -> resultado da autoanalise
    this.mergeStates = {};            // key do PR -> mergeabilidade real (só p/ aprovaveis)
    this.staleStates = {};            // key do PR -> true quando entrou commit apos a minha review
    this.adminBlockedRepos = {};      // repo -> true quando admin nao fura o ruleset (o UI esconde "Merge admin")
    this.ruleBlockCache = {};         // "repo@base" -> { blocked, at } cache do ruleset bloqueante
    this.reviewerCands = null;        // { at, data:{members,teams} } candidatos p/ o seletor de reviewers
    this.deliveriesCache = {};        // janela (dias) -> { at, data } cache das entregas (PRs mergeados); TTL curto
    this.activeReviews = new Map();  // id -> { keys, label, mode, startedAt }
    this.sessionSeq = 0;
    this.headlessQueue = [];
    this.headlessBusyAccounts = new Set(); // contas com revisão headless em andamento (1 por conta em paralelo)
    this.decisions = readJson(path.join(STATE_DIR, 'decisions.json'), { pending: [], resolved: [] });
    this.pushbacks = readJson(path.join(STATE_DIR, 'pushbacks.json'), {}); // { key do PR: { author, outcome, note, at, source, status, confidence } }
    // registros antigos (sem source) eram todos marcados à mão e confirmados
    for (const v of Object.values(this.pushbacks)) { if (v && !v.source) { v.source = 'manual'; v.status = 'confirmed'; } }
    this.pushbackScanned = readJson(path.join(STATE_DIR, 'pushback-scanned.json'), {}); // { key: marcador da última atividade do autor já avaliada }
    this.toolRuns = readJson(path.join(STATE_DIR, 'tool-results.json'), {});
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
    this.retryAfterNet = new Map();  // key do PR -> tentativas de re-revisão pós-queda de rede
    this.autoReviewParked = new Set(); // keys que falharam sem ser rede (ou foram canceladas): aguardam ação manual, não relançam sozinhas
    this.chats = readJson(CHATS_FILE, {});
    for (const k of Object.keys(this.chats)) {
      if (this.chats[k].status === 'running') this.chats[k].status = 'idle';
    }
    this.seen = new Set();
    this.reviewedKeys = new Set(); // PRs abertos que eu ja revisei (gh --reviewed-by)
    this.token = null;
    this.tokenOk = false;
    this.doctorInfo = null;
    this.timer = null;
    this.checking = false;
    this.gitBash = detectGitBash();

    this.prepareHome();
    this.loadSeen();
    this.recoverInflight();
  }

  // revisões que estavam rodando quando o app morreu: devolve à fila (o PR já
  // tinha sido marcado como visto, então sem isso ele sumiria em silêncio)
  recoverInflight() {
    const inflight = readJson(INFLIGHT_FILE, []);
    if (!Array.isArray(inflight) || !inflight.length) return;
    for (const pr of inflight) { if (pr && pr.key) this.unsee(pr.key); }
    try { fs.writeFileSync(INFLIGHT_FILE, '[]'); } catch { }
    this.log('WARN', `app reiniciado com revisão em andamento: ${inflight.map(p => p.key).join(', ')} devolvido(s) à fila`);
  }

  writeInflight() {
    try {
      const list = [...this.activeReviews.values()]
        .filter(s => s.mode === 'auto' && s.pr)
        .map(s => s.pr)
        .concat(this.headlessQueue.filter(p => p.kind !== 'self').map(p => ({ key: p.key, url: p.url, title: p.title })));
      fs.writeFileSync(INFLIGHT_FILE, JSON.stringify(list));
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
      const synced = ['CLAUDE.md', path.join('prompts', 'pr-review-auto.md'), path.join('prompts', 'self-review.md'), path.join('.claude', 'agents', 'pr-reviewer.md')];
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
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
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
    fs.writeFileSync(SEEN_FILE, [...this.seen].join('\n') + (this.seen.size ? '\n' : ''));
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
        onReject: (a && (a.onReject === 'request_changes' || a.onReject === 'wait')) ? a.onReject : undefined
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

  // env de child-process com o GH_TOKEN da conta pedida (default = primaria)
  ghEnv(user) {
    const env = { ...process.env, GH_PAGER: 'cat', PAGER: 'cat', GH_PROMPT_DISABLED: '1' };
    const tok = (user && this.tokens && this.tokens[user]) || this.token;
    if (tok) env.GH_TOKEN = tok;
    if (this.gitBash) env.CLAUDE_CODE_GIT_BASH_PATH = this.gitBash;
    // assinatura do Claude que o Farol usa: se você apontar um config dir próprio
    // (logado numa conta separada), as sessões headless usam ESSA assinatura, sem
    // mexer no login principal do claude da máquina. Ver "Assinatura do Claude" no CLAUDE.md.
    if (this.config.claudeConfigDir) env.CLAUDE_CONFIG_DIR = this.config.claudeConfigDir;
    return env;
  }

  async searchPRs(extraArgs, user) {
    const args = ['search', 'prs', ...extraArgs, '--state', 'open', '--limit', '100',
      '--json', 'url,title,isDraft,author,number,repository,updatedAt'];
    const r = await run('gh', args, { env: this.ghEnv(user) });
    if (!r.ok) {
      this.log('WARN', `gh search falhou (${user || 'primaria'}: ${extraArgs.join(' ')}): ${r.stderr.trim().slice(0, 300)}`);
      return null;
    }
    let items;
    try { items = JSON.parse(r.stdout || '[]'); } catch { return null; }
    const acc = user || this.primaryUser();
    const me = (acc || '').toLowerCase();
    return items
      .filter(p => !p.isDraft)
      .filter(p => ((p.author && p.author.login) || '').toLowerCase() !== me)
      .map(p => ({
        key: `${p.repository.nameWithOwner}#${p.number}`,
        url: p.url,
        title: p.title,
        author: (p.author && p.author.login) || '',
        repo: p.repository.nameWithOwner,
        number: p.number,
        updatedAt: p.updatedAt,
        account: acc
      }));
  }

  // PRs abertos de AUTORIA minha (fonte da autoanalise). Diferente de searchPRs:
  // nao filtra a mim (obvio) e MANTEM rascunhos (autoanalisar um draft antes de
  // marcar ready e justamente o uso principal). So leitura, zero tokens de IA.
  async myAuthoredPRs(user) {
    const acc = user || this.primaryUser();
    const me = (acc || '').toLowerCase();
    if (!me) return null;
    const r = await run('gh', ['search', 'prs', '--author', '@me', '--state', 'open', '--limit', '50',
      '--json', 'url,title,isDraft,author,number,repository,updatedAt'], { env: this.ghEnv(user) });
    if (!r.ok) {
      this.log('WARN', `gh search prs --author @me (${acc}) falhou: ${r.stderr.trim().slice(0, 300)}`);
      return null;
    }
    let items;
    try { items = JSON.parse(r.stdout || '[]'); } catch { return null; }
    return items.map(p => ({
      key: `${p.repository.nameWithOwner}#${p.number}`,
      url: p.url,
      title: p.title,
      author: (p.author && p.author.login) || me,
      repo: p.repository.nameWithOwner,
      number: p.number,
      updatedAt: p.updatedAt,
      isDraft: !!p.isDraft,
      account: acc
    }));
  }

  // --- entregas: PRs MERGEADOS por repo e por autor (visao read-only) ----------
  // Data de corte (YYYY-MM-DD) da janela: dias=0 = hoje (00:00), senao hoje - dias.
  deliveriesSince(days) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - Math.max(0, parseInt(days, 10) || 0));
    return d.toISOString().slice(0, 10);
  }

  // Busca os PRs mergeados nas orgs monitoradas dentro da janela, por conta (token
  // dela), deduplicando por chave. So leitura: nao passa por gate, nao posta, nao
  // escreve em state/. Cache com TTL por janela (entregas mudam devagar, nao entram
  // no polling de 30s). partial = alguma busca falhou; capped = alguma org bateu o
  // limite de 100 (a UI avisa; nada de corte silencioso).
  async fetchDeliveries(days, owner) {
    days = [0, 7, 15, 30].includes(parseInt(days, 10)) ? parseInt(days, 10) : 7;
    // escopo por org: vazio ou 'all' = todas as orgs monitoradas; senao so a org
    // pedida, buscada com o token da conta dona (accountForOwner).
    const scope = String(owner || '').trim();
    const scoped = scope && scope.toLowerCase() !== 'all' ? scope : '';
    const cacheKey = `${days}:${scoped || 'all'}`;
    const TTL = 5 * 60 * 1000;
    const cached = this.deliveriesCache[cacheKey];
    if (cached && (Date.now() - cached.at) < TTL) return cached.data;
    if (!this.token) await this.refreshTokens();
    const since = this.deliveriesSince(days);
    // alvos: { user (conta dona), owner (org) }. Escopado = so a org pedida.
    const targets = scoped
      ? [{ user: this.accountForOwner(scoped), owner: scoped }]
      : this.accountList().flatMap(acc => acc.owners.map(o => ({ user: acc.user, owner: o })));
    const seen = new Set();
    const items = [];
    let partial = false, capped = false;
    for (const t of targets) {
      const r = await run('gh', ['search', 'prs', `merged:>=${since}`, '--owner', t.owner,
        '--limit', String(DELIVERIES_LIMIT), '--json', 'url,title,author,number,repository,closedAt'], { env: this.ghEnv(t.user) });
      if (!r.ok) { partial = true; this.log('WARN', `gh search entregas (${t.user}/${t.owner}): ${r.stderr.trim().slice(0, 200)}`); continue; }
      let list;
      try { list = JSON.parse(r.stdout || '[]'); } catch { partial = true; continue; }
      if (list.length >= DELIVERIES_LIMIT) capped = true;
      for (const p of list) {
        const key = `${p.repository.nameWithOwner}#${p.number}`;
        if (seen.has(key)) continue;
        seen.add(key);
        items.push({
          key,
          url: p.url,
          title: p.title,
          author: (p.author && p.author.login) || '',
          repo: p.repository.nameWithOwner,
          number: p.number,
          mergedAt: p.closedAt || null // PR mergeado fecha no merge: closedAt = instante do merge
        });
      }
    }
    items.sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
    const data = { since, days, owner: scoped || 'all', items, capped, partial };
    this.deliveriesCache[cacheKey] = { at: Date.now(), data };
    return data;
  }

  async check(reason = 'timer') {
    if (this.checking) return;
    this.checking = true;
    this.setStatus('checking');
    try {
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

      // meus PRs abertos (autoanalise), de todas as contas. Preserva se todas falharem.
      let mineAuthored = null, authAnyOk = false;
      const authMap = new Map();
      for (const acc of accounts) {
        const part = await this.myAuthoredPRs(acc.user);
        if (part === null) continue;
        authAnyOk = true;
        for (const pr of part) if (!authMap.has(pr.key)) authMap.set(pr.key, pr);
      }
      if (authAnyOk) mineAuthored = [...authMap.values()];
      if (mineAuthored !== null) {
        mineAuthored.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        this.myPRs = mineAuthored;
        // limpa autoanalises de PRs que ja fecharam (nao fica lixo pra sempre)
        const openKeys = new Set(mineAuthored.map(p => p.key));
        let pruned = false;
        for (const k of Object.keys(this.selfAnalyses)) {
          if (!openKeys.has(k)) { delete this.selfAnalyses[k]; pruned = true; }
        }
        if (pruned) this.saveSelfAnalyses();
      }

      const mineList = mine || [];
      const mineKeys = new Set(mineList.map(p => p.key));
      for (const pr of panorama) pr.mine = mineKeys.has(pr.key);
      for (const pr of mineList) {
        if (!seenKeys.has(pr.key)) { pr.mine = true; panorama.push(pr); }
      }
      for (const pr of panorama) pr.reviewedByMe = this.reviewedKeys.has(pr.key);
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
      const toReview = this.queue.filter(p =>
        !this.isMuted(this.accountForPr(p)) &&
        this.autoReviewFor(this.accountForPr(p)) &&
        !inflight.has(p.key) &&
        !this.autoReviewParked.has(p.key) &&
        !this.retryAfterNet.has(p.key));
      if (freshActive.length > 0) {
        this.emit('new-prs', { items: freshActive, total: queue.filter(p => !this.isMuted(this.accountForPr(p))).length, auto: toReview.length > 0 });
      }
      if (toReview.length) this.launchReview(toReview.map(p => p.url), 'auto');

      // a checagem funcionou = a rede voltou: relança revisões que caíram por queda de conexão
      if (this.retryAfterNet.size) {
        const retry = this.queue.filter(p => this.retryAfterNet.has(p.key) && !fresh.some(f => f.key === p.key) && !this.isMuted(this.accountForPr(p)) && this.autoReviewFor(this.accountForPr(p)));
        if (retry.length) {
          this.emit('toast', { kind: 'info', text: `Conexão de volta: relançando a revisão de ${retry.map(p => p.key).join(', ')}.` });
          this.launchReview(retry.map(p => p.url), 'auto');
        }
      }
      // branch origem->destino de cada PR meu (o card mostra de/para)
      try { await this.enrichMyPRBranches(); } catch (e) { this.log('WARN', `enrichMyPRBranches: ${e.message}`); }
      // mergeabilidade real dos PRs aprovaveis (gate honesto do botao Merge)
      try { await this.refreshMergeStates(); } catch (e) { this.log('WARN', `refreshMergeStates: ${e.message}`); }
      // stale: PRs que EU revisei e receberam commit novo depois (reativa o "Re-revisar")
      try { await this.refreshStaleStates(); } catch (e) { this.log('WARN', `refreshStaleStates: ${e.message}`); }
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

  // --- sessao de revisao no Claude (terminal proprio, interativo) ---
  // O comando vai num .cmd e a janela abre via Start-Process (ShellExecute):
  // e o unico caminho que garante um console NOVO com stdin de verdade, que o
  // claude interativo exige. Spawnar cmd/start direto do Node herda handles
  // nulos (stdio ignore) e o console nasce sem stdin: pause/claude morrem na hora.
  buildSessionScript(slash) {
    const stub = process.env.FAROL_REVIEW_CMD; // usado so em testes: substitui o claude
    const skip = this.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
    const claudeLine = stub ? `${stub} "${slash}"` : `claude${skip} "${slash}"`;
    const cfgDir = this.config.claudeConfigDir ? `set "CLAUDE_CONFIG_DIR=${this.config.claudeConfigDir}"` : 'rem sem config dir proprio';
    return [
      '@echo off',
      'chcp 65001>nul',
      'title Farol - sessao do Claude',
      `cd /d "${WORKSPACE}"`,
      cfgDir,
      claudeLine,
      'echo.',
      'echo  [Farol] Sessao encerrada. Pressione qualquer tecla para fechar esta janela.',
      'pause>nul'
    ].join('\r\n') + '\r\n';
  }

  // macOS: a sessao interativa abre no Terminal.app via arquivo .command.
  // O "open" retorna na hora (nao da pra acompanhar o processo), entao o
  // proprio script avisa o app quando termina (trap EXIT -> /api/session-exit)
  // e se apaga. O GH_TOKEN e obtido DENTRO do script (nada de token em disco).
  buildSessionScriptMac(slash, id, user) {
    const stub = process.env.FAROL_REVIEW_CMD;
    const skip = this.config.skipPermissions ? ' --dangerously-skip-permissions' : '';
    const claudeLine = stub ? `${stub} '${slash}'` : `claude${skip} '${slash}'`;
    const acc = user || this.primaryUser();
    const userArg = acc ? ` --user '${acc}'` : '';
    return [
      '#!/bin/bash',
      '# Farol: sessao interativa do Claude. Este arquivo se apaga ao terminar.',
      `cd '${WORKSPACE}' || exit 1`,
      'notify() {',
      `  curl -fsS -m 5 -X POST -H 'x-farol: 1' -H 'Content-Type: application/json' \\`,
      `    --data '{"id":"${id}"}' 'http://127.0.0.1:${this.config.port}/api/session-exit' >/dev/null 2>&1`,
      '  rm -f -- "$0"',
      '}',
      'trap notify EXIT',
      'export GH_PAGER=cat PAGER=cat',
      this.config.claudeConfigDir ? `export CLAUDE_CONFIG_DIR='${this.config.claudeConfigDir}'` : '# sem config dir proprio',
      `GH_TOKEN="$(gh auth token${userArg} 2>/dev/null)" && export GH_TOKEN`,
      claudeLine,
      'echo',
      'echo " [Farol] Sessao encerrada. Pode fechar esta janela."'
    ].join('\n') + '\n';
  }

  spawnConsoleMac(slash, label, keys = [], account) {
    const sessionsDir = path.join(HOME, 'sessions');
    ensureDir(sessionsDir);
    const id = `t${++this.sessionSeq}`;
    const script = path.join(sessionsDir, `sessao-${Date.now()}.command`);
    fs.writeFileSync(script, this.buildSessionScriptMac(slash, id, account), { mode: 0o755 });
    this.activeReviews.set(id, { id, keys, label, mode: 'terminal', startedAt: Date.now() });
    const child = spawn('open', ['-a', 'Terminal', script], { stdio: 'ignore' });
    child.on('error', (err) => {
      try { fs.unlinkSync(script); } catch { }
      this.activeReviews.delete(id);
      this.log('ERROR', `falha ao abrir sessao "${label}" no Terminal: ${err.message}`);
      this.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão: ${err.message}` });
      this.pushState();
    });
    this.pushState();
  }

  // chamado pelo script .command do macOS quando a sessao interativa termina
  sessionExit(id) {
    const s = this.activeReviews.get(String(id || ''));
    if (!s) return { ok: true };
    this.activeReviews.delete(s.id);
    this.emit('toast', { kind: 'ok', text: `${s.label}: sessão encerrada. De volta ao monitoramento.` });
    this.pushState();
    if (s.keys && s.keys.length) this.checkNow();
    return { ok: true };
  }

  spawnConsole(slash, label, keys = [], account) {
    if (!IS_WIN) return this.spawnConsoleMac(slash, label, keys, account);
    const sessionsDir = path.join(HOME, 'sessions');
    ensureDir(sessionsDir);
    const script = path.join(sessionsDir, `sessao-${Date.now()}.cmd`);
    fs.writeFileSync(script, this.buildSessionScript(slash));
    const ps = `$p = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/c','"${script}"' ` +
      `-WorkingDirectory '${WORKSPACE}' -PassThru -Wait; exit $p.ExitCode`;
    // sem "detached": DETACHED_PROCESS + CREATE_NO_WINDOW sao flags de console
    // incompativeis e o powershell morre na hora. O console do claude nasce via
    // ShellExecute (Start-Process) e nao depende deste wrapper para viver.
    // o GH_TOKEN vem do env do wrapper (a sessao Windows herda), por isso o token
    // da conta certa e injetado aqui.
    const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      cwd: WORKSPACE,
      env: this.ghEnv(account),
      stdio: 'ignore',
      windowsHide: true
    });
    const id = `t${++this.sessionSeq}`;
    this.activeReviews.set(id, { id, keys, label, mode: 'terminal', startedAt: Date.now() });
    const cleanup = () => { try { fs.unlinkSync(script); } catch { } };
    child.on('exit', (code) => {
      cleanup();
      this.activeReviews.delete(id);
      if (code !== 0 && code !== null) this.log('WARN', `sessao "${label}" saiu com codigo ${code}`);
      this.emit('toast', { kind: 'ok', text: `${label}: sessão encerrada. De volta ao monitoramento.` });
      this.pushState();
      if (keys.length) this.checkNow();
    });
    child.on('error', (err) => {
      cleanup();
      this.activeReviews.delete(id);
      this.log('ERROR', `falha ao abrir sessao "${label}": ${err.message}`);
      this.emit('toast', { kind: 'error', text: `Não consegui abrir a sessão: ${err.message}` });
      this.pushState();
    });
    this.pushState();
  }

  prFromUrl(url) {
    const m = String(url).match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
    if (!m) return null;
    return { key: `${m[1]}#${m[2]}`, url, title: '', author: '', repo: m[1], number: parseInt(m[2], 10) };
  }

  async launchReview(urls, mode = 'auto') {
    if (!urls || !urls.length) return { ok: false, error: 'sem PRs para revisar' };
    if (!this.token) await this.refreshTokens();
    if (!this.tokenOk) {
      this.emit('toast', { kind: 'error', text: `Conta ${this.primaryUser() || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
      return { ok: false, error: 'gh sem token' };
    }
    // requested = o PR pediu a MINHA revisão (fila). Revisão iniciada por clique
    // no panorama (ou por URL avulsa) nunca posta nada sozinha: sempre passa
    // pela seção "Precisa de você". Cada item carrega a conta dona (accountForPr
    // deduz pela org quando veio de URL avulsa) pro token certo em todo o fluxo.
    const items = urls.map(u => {
      const q = this.queue.find(p => p.url === u);
      if (q) return { ...q, account: this.accountForPr(q), requested: true };
      const pano = this.panorama.find(p => p.url === u);
      if (pano) return { ...pano, account: this.accountForPr(pano), requested: !!pano.mine };
      const pr = this.prFromUrl(u);
      return pr ? { ...pr, account: this.accountForPr(pr), requested: false } : null;
    }).filter(Boolean);
    // lançar (manual ou auto) tira o PR do "estacionamento": ele volta a ser elegível
    for (const it of items) { this.markSeen(it.key); this.autoReviewParked.delete(it.key); }
    this.queue = this.queue.filter(p => !urls.includes(p.url));
    this.pushState();

    if (mode === 'terminal') {
      const keys = items.map(p => p.key);
      const label = keys.length === 1 ? `Revisão de ${keys[0]}` : `Revisão de ${urls.length} PRs`;
      // a sessao no terminal usa 1 token; pega a conta do 1o PR (lotes costumam
      // ser da mesma conta). Mistura de contas num mesmo terminal recai na 1a.
      this.spawnConsole(`/pr-review ${urls.join(' ')}`, label, keys, this.accountForPr(items[0]));
      this.emit('toast', { kind: 'ok', text: `${label} aberta no terminal do Claude.` });
      return { ok: true, mode };
    }

    for (const pr of items) this.enqueueHeadless(pr);
    this.emit('toast', {
      kind: 'info',
      text: items.length === 1
        ? `Revisando ${items[0].key} internamente. Te aviso do resultado.`
        : `Revisando ${items.length} PRs internamente (em paralelo por conta, serial dentro da conta).`
    });
    return { ok: true, mode };
  }

  // --- revisao autonoma (headless): 1 revisão por conta em paralelo ----------
  // (contas diferentes rodam juntas; dentro da mesma conta segue serial)
  enqueueHeadless(pr) {
    // não duplica: se já há uma revisão headless deste PR na fila ou rodando, ignora
    // (ex.: clicar Revisar no panorama num PR que o check() já pôs em auto-revisão,
    // ou dois cliques rápidos). O caminho de autoanálise tem o seu próprio dedup.
    const busy = this.headlessQueue.some(p => p.kind !== 'self' && p.key === pr.key) ||
      [...this.activeReviews.values()].some(s => s.mode === 'auto' && (s.keys || []).includes(pr.key));
    if (busy) return;
    this.headlessQueue.push(pr);
    this.writeInflight();
    this.processHeadless();
    this.pushState();
  }

  // conta que "ocupa" o slot da revisão (uma por conta de cada vez)
  headlessAcct(pr) { return String(this.accountForPr(pr) || '').toLowerCase() || '(sem conta)'; }

  // escalonador: dispara quantas revisões der, uma por conta que estiver livre.
  // Síncrono (não await): cada revisão roda em paralelo e reprograma no fim.
  processHeadless() {
    for (; ;) {
      const idx = this.headlessQueue.findIndex(pr => !this.headlessBusyAccounts.has(this.headlessAcct(pr)));
      if (idx < 0) break; // fila vazia ou todas as contas pendentes já ocupadas
      const pr = this.headlessQueue.splice(idx, 1)[0];
      const acct = this.headlessAcct(pr);
      this.headlessBusyAccounts.add(acct);
      this.runOneHeadless(pr, acct);
    }
  }

  async runOneHeadless(pr, acct) {
    // autoanalise: caminho separado, NUNCA posta nem gerencia a fila de revisor.
    // Erro so vira toast (o autor reroda quando quiser); nada volta pra fila.
    if (pr.kind === 'self') {
      try {
        await this.runSelfAnalysis(pr);
      } catch (err) {
        if (err.cancelled) {
          this.emit('toast', { kind: 'info', text: `Autoanálise de ${pr.key} cancelada.` });
        } else {
          this.log('ERROR', `autoanalise ${pr.key}: ${err.message}`);
          this.emit('toast', { kind: 'error', text: `Autoanálise de ${pr.key} falhou: ${err.message}` });
        }
      } finally {
        this.headlessBusyAccounts.delete(acct);
        this.writeInflight();
        this.pushState();
        this.processHeadless();
      }
      return;
    }

    try {
      await this.runHeadlessReview(pr);
      this.retryAfterNet.delete(pr.key);
    } catch (err) {
      this.unsee(pr.key);
      // volta VISÍVEL pra fila na hora (não só no próximo ciclo)
      if (!this.queue.some(p => p.key === pr.key)) this.queue.push(pr);
      const msg = err.message || '';
      // TRANSITÓRIO (se resolve sozinho, não estaciona): queda de rede, limite do
      // plano Claude (reseta), ou o binário do claude quebrado/indisponível.
      const limitErr = /hit your (session|usage|weekly) limit|session limit|usage limit/i.test(msg);
      const netErr = /ECONNRESET|ENOTFOUND|ETIMEDOUT|Connection closed|Unable to connect|fetch failed|network/i.test(msg);
      const toolErr = /não é reconhecido|not recognized|No such file|ENOENT|command not found|saiu com c[óo]digo \d/i.test(msg);
      const transient = limitErr || netErr || toolErr;
      if (err.cancelled) {
        // cancelado por você: estaciona pra não relançar sozinho (você reabre quando quiser)
        this.autoReviewParked.add(pr.key);
        this.emit('toast', { kind: 'info', text: `Revisão de ${pr.key} cancelada. O PR voltou pra sua fila.` });
      } else if (transient) {
        // limite do plano se resolve no reset; rede/binário costumam voltar rápido.
        // Retoma sozinho no próximo ciclo bem-sucedido, até um teto (aí estaciona).
        const cap = limitErr ? 12 : 3;
        const tries = this.retryAfterNet.get(pr.key) || 0;
        this.log('WARN', `revisao ${pr.key} (transitório, tenta de novo): ${msg}`);
        if (tries < cap) {
          this.retryAfterNet.set(pr.key, tries + 1);
          this.emit('toast', { kind: 'error', text: limitErr
            ? `Limite do teu plano Claude atingido. Retomo ${pr.key} sozinho quando resetar; ele está na sua fila.`
            : `Revisão de ${pr.key} caiu por algo transitório; tento de novo no próximo ciclo. Está na sua fila.` });
        } else {
          this.retryAfterNet.delete(pr.key);
          this.autoReviewParked.add(pr.key);
          this.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
          this.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou várias vezes; parei de tentar sozinho. O PR está na sua fila.` });
        }
      } else {
        // falha não-transitória de verdade: estaciona pra não relançar em loop
        this.autoReviewParked.add(pr.key);
        this.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
        this.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou: ${msg}` });
      }
    } finally {
      this.headlessBusyAccounts.delete(acct);
      this.writeInflight();
      this.pushState();
      this.processHeadless();
    }
  }

  // perfil marcado pra uma pessoa (por login); {} quando não marcada
  personProfile(login) {
    const map = (this.config && this.config.people) || {};
    return map[String(login || '').toLowerCase()] || {};
  }
  // pushbacks registrados pra uma pessoa (mais recentes primeiro)
  // pushbacks de uma pessoa que já valem pra calibrar o review: confirmados
  // (manual ou auto de alta confiança). Os "pending" (auto em dúvida) NÃO entram
  // até você confirmar, pra não calibrar em cima de um palpite incerto.
  pushbacksFor(login) {
    const u = String(login || '').toLowerCase();
    return Object.entries(this.pushbacks || {})
      .filter(([, v]) => v && v.status !== 'pending' && String(v.author || '').toLowerCase() === u)
      .map(([key, v]) => ({ ...v, key }))
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }
  // registra/edita/limpa o pushback de um review PELA SUA MÃO (por PR). Sempre
  // confirmado e marcado como manual (é você resolvendo). outcome vazio = limpar.
  recordPushback(body) {
    const key = String((body && body.key) || '').trim();
    if (!key) return { ok: false, error: 'sem PR' };
    const outcome = (body && body.outcome) || '';
    if (!outcome) { delete this.pushbacks[key]; this.savePushbacks(); return { ok: true }; }
    if (!PUSHBACK_OUTCOMES.includes(outcome)) return { ok: false, error: 'desfecho inválido' };
    this.pushbacks[key] = {
      author: String((body && body.author) || (this.pushbacks[key] && this.pushbacks[key].author) || '').trim().toLowerCase(),
      outcome,
      note: String((body && body.note) || '').trim().slice(0, 300),
      at: Date.now(),
      source: 'manual',
      status: 'confirmed'
    };
    this.savePushbacks();
    return { ok: true };
  }
  savePushbacks() {
    try { fs.writeFileSync(path.join(STATE_DIR, 'pushbacks.json'), JSON.stringify(this.pushbacks, null, 2)); }
    catch (err) { this.log('ERROR', `salvar pushbacks.json: ${err.message}`); }
    this.pushState();
  }
  savePushbackScanned() {
    try { fs.writeFileSync(path.join(STATE_DIR, 'pushback-scanned.json'), JSON.stringify(this.pushbackScanned, null, 2)); }
    catch { /* best-effort: perder o marcador só faz reavaliar depois, não quebra */ }
  }

  // bloco injetado no prompt de revisão: ajusta TOM + POSTURA, nunca a decisão.
  // Papel dá o tom-base; a matriz por domínio calibra a postura por área do PR;
  // o histórico de pushback calibra humildade/assertividade com aquela pessoa.
  personProfileBlock(login) {
    const p = this.personProfile(login);
    const papel = PAPEL_LEVELS.includes(p.papel) ? p.papel : '';
    const doms = (p.dominios && typeof p.dominios === 'object') ? p.dominios : {};
    const domEntries = DOMAINS.filter(d => DOMAIN_LEVELS.includes(doms[d]));
    const pushbacks = this.pushbacksFor(login).slice(0, 5);
    if (!papel && !domEntries.length && !pushbacks.length) return ''; // sem perfil nem histórico = tom neutro
    let block = `\n\n## Perfil do autor\n`;
    if (papel) block += `Papel de @${login}: **${PAPEL_LABEL[papel]}** (${PAPEL_TONE[papel]})\n`;
    if (domEntries.length) {
      block += `Competência por domínio (cruze com a área que o PR mexe):\n`;
      for (const d of domEntries) block += `- ${DOMAIN_LABEL[d]} (nível **${DOMAIN_LEVEL_LABEL[doms[d]]}**): ${DOMAIN_POSTURE[doms[d]]}\n`;
    }
    if (pushbacks.length) {
      block += `\nHistórico de pushback com @${login} (revisões suas que ele contestou):\n`;
      for (const pb of pushbacks) block += `- ${pb.key}: ${PUSHBACK_LABEL[pb.outcome] || pb.outcome}${pb.note ? ` (${pb.note})` : ''}\n`;
      block += `Calibre a humildade e a assertividade por isso: onde ele já mostrou que estava certo, seja mais cuidadoso antes de afirmar algo parecido; onde você estava certo, mantenha a posição com clareza.\n`;
    }
    block += `\nAjuste APENAS o TOM e a POSTURA (o quanto explica, o quanto defere, como levanta os pontos) nos corpos dos payloads e nos comentários inline. ` +
      `NÃO mude a decisão técnica: verdict, decision, cardMet, findings e o gate seguem valendo só pelos fatos do código. O perfil muda COMO você escreve, nunca SE aprova ou reprova.\n`;
    return block;
  }

  // Como escrever o corpo POSTADO no PR: humano, personalizado, objetivo e
  // profissional, adaptado à senioridade do autor (usa o Perfil do autor acima).
  // PREVALECE sobre o formato do CLAUDE.md. Injetado SEMPRE, pra o review nunca
  // sair com cara de bot (era a queixa: carimbos e template robótico).
  reviewFormatBlock() {
    return `\n\n## Como escrever o corpo do review postado no PR (PREVALECE sobre o formato do CLAUDE.md)\n` +
      `Escreva como o Wanderson escreveria: uma pessoa sênior revisando o PR de um colega, não uma ferramenta. Personalizado, objetivo e profissional.\n` +
      `- **Sem cara de bot:** NADA de caixas de alerta (\`> [!NOTE]\`/\`> [!WARNING]\`), nem "Placar", nem checklist de critérios com \`- [x]\`, nem os prefixos de Conventional Comments no texto ("🟡 suggestion (non-blocking):", "🔴 issue (blocking):" e afins). NUNCA cite automação, "Farol", "auto-aprovei/não auto-aprovei" nem "revisão automática": o autor não pode perceber que veio de um bot.\n` +
      `- **Use TODO o perfil do autor acima** (papel, competência por domínio, histórico de pushback) pra personalizar tom, profundidade e deferência, e adapte o FORMATO à senioridade:\n` +
      `  - Estágio/Júnior: prosa acolhedora de mentor. Abra reconhecendo o que ficou bom de verdade (específico, com o porquê), explique cada ajuste ensinando ("o que segura o merge é..."), enquadre como "quase lá", feche natural.\n` +
      `  - Pleno/Sênior/Tech Lead/Arquiteto: enxuto e direto, de par pra par. Vá aos pontos técnicos sem preâmbulo nem elogio de consolo, assumindo contexto compartilhado.\n` +
      `  - Especialista: no domínio dele, defira e foque na nuance; fora, trate como par.\n` +
      `  - Sem perfil marcado: tom neutro, direto e cordial.\n` +
      `- **Tom do Wanderson:** direto e claro, sem gíria nem subtexto, **sem travessão** (use vírgula, parênteses ou dois pontos). Elogio só quando sincero e específico (nunca de consolo). Português brasileiro.\n` +
      `- **Substância intacta:** blockers e ressalvas entram no texto de forma natural (o que é, por que importa, o que muda), com \`arquivo:linha\` quando ajudar. Muda só COMO você escreve, nunca a decisão nem o rigor. Comentários inline também sem os prefixos de label: escreva como observação humana.\n`;
  }

  headlessPromptFor(url, author) {
    const candidates = [
      path.join(WORKSPACE, 'prompts', 'pr-review-auto.md'),
      path.join(TEMPLATE_DIR, 'prompts', 'pr-review-auto.md')
    ];
    for (const f of candidates) {
      try { return fs.readFileSync(f, 'utf8').replaceAll('{{URL}}', url) + this.personProfileBlock(author) + this.reviewFormatBlock(); } catch { }
    }
    throw new Error('template prompts/pr-review-auto.md não encontrado');
  }

  // Grava o nivel do modelo (Opus/Sonnet/...) na sessao ativa pra UI mostrar
  // qual agente esta rodando. O id cru vem do evento system/init da sessao.
  setSessionModel(id, rawModel) {
    const sess = this.activeReviews.get(id);
    if (!sess) return;
    sess.model = modelLabel(rawModel);
    sess.modelRaw = rawModel;
    this.pushState();
  }

  // --- feed de atividade ao vivo (streaming das sessões headless) ------------
  pushActivity(id, kind, text) {
    const list = this.activity.get(id);
    if (!list) return;
    const item = { t: Date.now(), k: kind, text: String(text || '').slice(0, 400) };
    list.push(item);
    if (list.length > 120) list.splice(0, list.length - 120);
    this.emit('activity', { id, item });
  }

  toolSummary(name, input) {
    input = input || {};
    if (name === 'Bash') return input.description || String(input.command || '').slice(0, 160);
    if (name === 'Task') return input.description || String(input.prompt || '').slice(0, 160);
    if (name === 'Read' || name === 'Write' || name === 'Edit') return input.file_path || '';
    if (name === 'Grep' || name === 'Glob') return input.pattern || '';
    if (name === 'WebFetch') return input.url || '';
    return input.description || input.file_path || input.url || '';
  }

  killTree(pid) {
    // mata a árvore inteira: o child é o shell (cmd.exe/sh), o claude vive embaixo
    if (IS_WIN) {
      try { execFile('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true }, () => { }); } catch { }
    } else {
      // sessões posix nascem com detached:true = grupo de processo próprio
      try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { } }
    }
  }

  cancelSession(id) {
    const run = this.running.get(id);
    if (!run) return { ok: false, error: 'sessão não encontrada (já terminou?)' };
    run.cancelled = true;
    this.killTree(run.child.pid);
    return { ok: true };
  }

  // Roda o claude headless com --output-format stream-json: cada evento NDJSON
  // vira uma linha do feed de atividade (onEvent) e o resultado final é extraído
  // do evento "result". Compatível com o stub FAROL_HEADLESS_CMD, que imprime um
  // envelope JSON simples (fallback no close).
  runClaudeStream(prompt, opts = {}) {
    const stub = process.env.FAROL_HEADLESS_CMD;
    // modelo leve (Sonnet) nas sessoes autonomas gasta bem menos do limite do plano
    const model = String((this.config && this.config.reviewModel) || '').trim();
    const modelArg = (!stub && model) ? ` --model ${model}` : '';
    const base = (stub || 'claude -p --output-format stream-json --verbose --dangerously-skip-permissions') + modelArg;
    const extra = (opts.extraArgs || []).join(' ');
    const cmdline = extra ? `${base} ${extra}` : base;
    const onEvent = opts.onEvent || (() => { });
    return new Promise((resolve, reject) => {
      const env = this.ghEnv(opts.account);
      const child = IS_WIN
        ? spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], {
          cwd: WORKSPACE,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          windowsVerbatimArguments: true
        })
        // -l pra carregar o PATH do perfil; detached = grupo próprio (killTree)
        : spawn('/bin/sh', ['-lc', cmdline], {
          cwd: WORKSPACE,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true
        });
      const run = { child, cancelled: false };
      if (opts.id) this.running.set(opts.id, run);

      let raw = '', errBuf = '', lineBuf = '';
      let sessionId = null, resultEvent = null;
      const timeout = setTimeout(() => {
        run.cancelled = false; // timeout não é cancelamento do usuário
        this.killTree(child.pid);
        finish(new Error('tempo esgotado (30min) na sessão autônoma'));
      }, 30 * 60 * 1000);

      let done = false;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        if (opts.id) this.running.delete(opts.id);
        if (err) reject(err); else resolve(value);
      };

      const handleEvent = (ev) => {
        if (!ev || typeof ev !== 'object') return;
        if (ev.session_id && !sessionId) sessionId = ev.session_id;
        if (ev.type === 'system' && ev.subtype === 'init') {
          if (ev.model && opts.onModel) opts.onModel(ev.model);
          const lvl = ev.model ? modelLabel(ev.model) : '';
          onEvent({ kind: 'info', text: `sessão do Claude iniciada${lvl ? ` (${lvl})` : ''}` });
        } else if (ev.type === 'system' && ev.subtype === 'api_retry') {
          onEvent({ kind: 'warn', text: `instabilidade na conexão, tentando de novo (${ev.attempt}/${ev.max_retries})` });
        } else if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
          for (const block of ev.message.content) {
            if (block.type === 'text' && String(block.text || '').trim()) {
              onEvent({ kind: 'text', text: block.text });
            } else if (block.type === 'tool_use') {
              const sum = this.toolSummary(block.name, block.input);
              onEvent({ kind: 'tool', text: sum ? `${block.name} · ${sum}` : block.name });
            }
          }
        } else if (ev.type === 'result') {
          resultEvent = ev;
        }
      };

      const handleLine = (line) => {
        line = line.trim();
        if (!line) return;
        try { handleEvent(JSON.parse(line)); } catch { /* linha não-JSON (stub/ruído) */ }
      };

      child.stdout.on('data', (c) => {
        c = String(c);
        if (raw.length < 32 * 1024 * 1024) raw += c;
        lineBuf += c;
        let nl;
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          handleLine(lineBuf.slice(0, nl));
          lineBuf = lineBuf.slice(nl + 1);
        }
      });
      child.stderr.on('data', c => { if (errBuf.length < 1024 * 1024) errBuf += c; });
      child.on('error', e => finish(e));
      child.on('close', (code) => {
        if (lineBuf.trim()) handleLine(lineBuf);
        if (run.cancelled) {
          return finish(Object.assign(new Error('cancelada por você'), { cancelled: true }));
        }
        if (resultEvent) {
          if (resultEvent.is_error) {
            const detail = String(resultEvent.result || (resultEvent.errors || []).join('; ') || errBuf.trim() || resultEvent.subtype);
            return finish(new Error(`sessão retornou erro: ${detail.slice(0, 300)}`));
          }
          return finish(null, { text: String(resultEvent.result ?? ''), sessionId: resultEvent.session_id || sessionId });
        }
        // sem evento result: stub de teste ou CLI antigo — parseia o envelope inteiro
        if (code !== 0 && !raw.trim()) return finish(new Error(`claude saiu com código ${code}: ${errBuf.trim().slice(0, 300)}`));
        try { finish(null, { text: this.parseEnvelope(raw), sessionId }); }
        catch (e) { finish(e); }
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });
  }

  // envelope do --output-format json: { type, subtype, result, is_error, ... }
  parseEnvelope(raw) {
    let text = String(raw).trim();
    try {
      const env = JSON.parse(text);
      if (env && typeof env === 'object' && 'result' in env) {
        if (env.is_error) throw new Error(`sessão retornou erro: ${String(env.result).slice(0, 300)}`);
        text = String(env.result);
      }
    } catch (e) { if (/sessão retornou erro/.test(e.message)) throw e; }
    return text;
  }

  parseHeadlessResult(raw) {
    const text = this.parseEnvelope(raw);
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('a sessão não devolveu JSON');
    const data = JSON.parse(text.slice(a, b + 1));
    if (!data.decision || !data.payloads || !data.reportMarkdown) throw new Error('JSON da sessão fora do contrato');
    return data;
  }

  async runHeadlessReview(pr) {
    const id = `a${++this.sessionSeq}`;
    this.activeReviews.set(id, {
      id, keys: [pr.key], label: `Revisão automática de ${pr.key}`, mode: 'auto',
      startedAt: Date.now(), cancellable: true,
      pr: { key: pr.key, url: pr.url, title: pr.title || '' }
    });
    this.activity.set(id, []);
    this.writeInflight();
    this.pushState();
    try {
      const res = await this.runClaudeStream(this.headlessPromptFor(pr.url, pr.author), {
        id,
        account: this.accountForPr(pr),
        onModel: (m) => this.setSessionModel(id, m),
        onEvent: (e) => this.pushActivity(id, e.kind, e.text)
      });
      const result = this.parseHeadlessResult(res.text);
      result.sessionId = res.sessionId || null;

      // gate do app: aprova sozinho quando aprovável (revisão pedida a mim; clique
      // no panorama nunca auto-posta). Com autoApproveAll (default) qualquer aprovável
      // passa, com os pontos de atenção anexados ao APPROVE; sem, só o gate estrito.
      const canAuto = this.shouldAutoApprove(pr, result);
      const canReject = this.shouldAutoReject(pr, result);
      if (pr.requested === false && (result.verdict === 'approve' || result.verdict === 'request_changes')) {
        result.reasons = ['revisão iniciada por você (não era seu review pedido): nada é postado sem sua decisão',
          ...(result.reasons || [])];
      }

      if (canAuto) {
        // dedup: se eu ja aprovei este PR (review manual ou via chat), nao
        // posta um segundo APPROVE (aconteceu no biud-frontend#635)
        const states = await this.myReviewStates(pr);
        if (states && states.includes('APPROVED')) {
          this.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve' });
          this.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha aprovado no GitHub; não postei de novo.` });
          return;
        }
        // o corpo do APPROVE vai LIMPO, do jeito que o review escreveu (tem que
        // parecer humano, teu). As ressalvas ficam guardadas no app (campo attention,
        // visível em Revisões recentes), não coladas no PR com carimbo de automação.
        const points = this.attentionPoints(result);
        const post = await this.postReview(pr, result.payloads.approve);
        if (post.ok) {
          this.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: points });
          this.writeMemory(result, 'APPROVE');
          this.emit('auto-approved', { pr, result });
          this.emit('toast', { kind: 'ok', text: `✅ ${pr.key} aprovado automaticamente${points.length ? ` (${points.length} ponto(s) de atenção)` : ''}.` });
          return;
        }
        result.reasons = [...(result.reasons || []), `falha ao postar o APPROVE: ${post.error}`];
      }

      // reprova sozinho (opt-in por conta): posta REQUEST_CHANGES com os bloqueios
      // que a revisão levantou. Mesmo gate do approve (review pedido a mim; clique
      // nunca posta) e dedup (não re-pede mudanças se eu já pedi).
      if (canReject) {
        const states = await this.myReviewStates(pr);
        if (states && states.includes('CHANGES_REQUESTED')) {
          this.recordDecision(pr, result, { status: 'already_reviewed', action: 'request_changes' });
          this.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha pedido mudanças no GitHub; não postei de novo.` });
          return;
        }
        const rc = { ...result.payloads.request_changes, body: this.rejectBodyWithMark(result.payloads.request_changes.body) };
        const post = await this.postReview(pr, rc);
        if (post.ok) {
          this.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
          this.writeMemory(result, 'REQUEST_CHANGES');
          this.emit('auto-rejected', { pr, result });
          this.emit('toast', { kind: 'ok', text: `🔴 ${pr.key}: pedido de mudanças postado automaticamente (${(result.reasons || []).length || 'ver'} motivo(s)).` });
          return;
        }
        result.reasons = [...(result.reasons || []), `falha ao postar o REQUEST_CHANGES: ${post.error}`];
      }
      // transparência: se o PR era aprovável e pedido a mim, mas não auto-aprovei
      // por POLÍTICA da conta (não por veredito nem falha de post), deixa claro o porquê,
      // pra você não achar que o Farol ignorou a regra que você configurou.
      const approvable = result.verdict === 'approve' && result.payloads && result.payloads.approve && result.payloads.approve.event === 'APPROVE';
      if (approvable && pr.requested !== false && !canAuto) {
        const acc = this.accountForPr(pr);
        const label = this.scopeLabel(acc) || acc || 'esta conta';
        const clean = this.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
        const why = clean
          ? `aprovável sem ressalvas, mas a política da conta ${label} manda aguardar sua aprovação (ajuste em Sistema > Contas)`
          : `aprovável com ressalvas, e a política da conta ${label} é aguardar você (mude pra "aprova e destaca as ressalvas" em Sistema > Contas se quiser que aprove sozinho)`;
        result.reasons = [why, ...(result.reasons || [])];
      }
      const item = this.recordDecision(pr, result, { status: 'pending' });
      this.emit('needs-decision', { pr, item });
      this.emit('toast', { kind: 'info', text: `🟡 ${pr.key} precisa de você: ${(result.reasons || []).length || 'ver'} motivo(s).` });
    } finally {
      this.activeReviews.delete(id);
      this.activity.delete(id);
      this.writeInflight();
      this.pushState();
    }
  }

  // Candidatos pro seletor de reviewers: membros e times das orgs monitoradas.
  // Cacheado (mudam pouco). Assim a config vira escolha de uma lista, sem digitar
  // handle na mao (e sem typo que zera o pedido).
  async reviewerCandidates() {
    const TTL = 60 * 60 * 1000;
    if (this.reviewerCands && (Date.now() - this.reviewerCands.at) < TTL) return this.reviewerCands.data;
    if (!this.token) await this.refreshTokens();
    // POR ORGANIZAÇÃO: cada org lista só os SEUS membros e times, pra o seletor de
    // reviewers de um projeto não oferecer gente de outra org (não faz sentido pedir
    // review de quem não faz parte daquela org). Formato: { org: { members, teams } }.
    const byOrg = {};
    for (const owner of this.allOwners()) {
      const env = this.ghEnv(this.accountForOwner(owner));
      const members = new Set(), teams = new Map();
      const rm = await run('gh', ['api', `orgs/${owner}/members`, '--paginate', '--jq', '.[].login'], { env });
      if (rm.ok) rm.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(l => members.add(l));
      // slug (id que o gh --add-reviewer usa) + nome (pra exibir); \t separa
      const rt = await run('gh', ['api', `orgs/${owner}/teams`, '--paginate', '--jq', '.[] | .slug + "\\t" + .name'], { env });
      if (rt.ok) rt.stdout.split(/\r?\n/).filter(Boolean).forEach(line => {
        const i = line.indexOf('\t'); const slug = (i < 0 ? line : line.slice(0, i)).trim();
        const name = (i < 0 ? slug : line.slice(i + 1)).trim();
        // times ENTERPRISE (slug com ':', ex.: 'ent:...') NAO podem ser reviewer
        // de PR (o GitHub recusa com "not a collaborator"), entao nao entram no seletor.
        if (slug && !slug.includes(':')) teams.set(`${owner}/${slug}`, name || slug);
      });
      byOrg[owner] = {
        members: [...members].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
        teams: [...teams.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      };
    }
    this.reviewerCands = { at: Date.now(), data: byOrg };
    return byOrg;
  }

  // --- setar reviewers de um PR meu num clique (Meus PRs) --------------------
  // Atribui o autor (voce) e pede review da lista configurada pro repo em
  // config.projectReviewers, sem confirmacao. Aceita pessoas e times (org/time).
  async setReviewers(url) {
    if (!url) return { ok: false, error: 'sem PR' };
    if (!this.token) await this.refreshTokens();
    const m = String(url).match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/i);
    if (!m) return { ok: false, error: 'não reconheci a URL do PR' };
    const repo = m[1];
    const key = `${repo}#${m[2]}`;
    // conta dona deste PR (pela org do repo): token e assignee corretos
    const acc = this.accountForOwner(repo.split('/')[0]);
    const env = this.ghEnv(acc);
    if (!acc || !(this.tokens && this.tokens[acc]) && !this.token) {
      this.emit('toast', { kind: 'error', text: `Conta ${acc || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
      return { ok: false, error: 'gh sem token' };
    }
    const me = (acc || '').toLowerCase();
    const raw = this.reviewersForRepo(repo);
    // nao da pra pedir review de si mesmo; o autor entra como assignee, nao reviewer
    const reviewers = raw.map(String).map(s => s.trim()).filter(r => r && r.toLowerCase() !== me);
    if (!reviewers.length) {
      this.emit('toast', { kind: 'error', text: `Nenhum reviewer configurado pra ${repo} (aba Sistema > Reviewers por projeto).` });
      return { ok: false, error: 'sem reviewers configurados' };
    }
    // 1) me atribui
    const asg = await run('gh', ['pr', 'edit', url, '--add-assignee', acc], { env });
    if (!asg.ok) this.log('WARN', `não consegui me atribuir em ${key}: ${asg.stderr.trim().slice(0, 200)}`);
    // 2) peço review de CADA UM individualmente. O --add-reviewer (e a API de
    //    requested_reviewers atras) e all-or-nothing: um handle invalido (typo,
    //    nao-colaborador, time sem acesso) devolve 422 e zera o pedido inteiro.
    //    Como a lista e texto livre e o botao aplica num clique, pedir um a um
    //    garante que os validos entram mesmo com um invalido no meio.
    const okd = [], failed = [], skipped = [];
    for (const person of reviewers) {
      // time ENTERPRISE (slug com ':'): o GitHub nao aceita como reviewer de PR.
      // pular sem chamar gh (evita o WARN "Could not resolve team" a cada clique).
      if (person.includes('/') && person.split('/').slice(1).join('/').includes(':')) {
        skipped.push(person);
        continue;
      }
      const rv = await run('gh', ['pr', 'edit', url, '--add-reviewer', person], { env });
      if (rv.ok) okd.push(person);
      else { failed.push(person); this.log('WARN', `reviewer ${person} em ${key}: ${(rv.stderr || rv.stdout || '').trim().slice(0, 150)}`); }
    }
    if (skipped.length) this.log('WARN', `reviewers ignorados em ${key} (time enterprise, não pedível): ${skipped.join(', ')}`);
    if (!okd.length) {
      const why = skipped.length ? ` (times enterprise não podem ser reviewer: ${skipped.join(', ')})` : ` Confira os handles em Sistema (falharam: ${failed.join(', ')}).`;
      this.emit('toast', { kind: 'error', text: `Não consegui setar reviewer em ${key}.${why}` });
      return { ok: false, error: 'nenhum reviewer válido', failed, skipped };
    }
    const asgNote = asg.ok ? '' : ' (não consegui te atribuir, confira no GitHub)';
    const notEntered = [...failed, ...skipped];
    const failNote = notEntered.length ? ` Não entraram: ${notEntered.join(', ')}${skipped.length ? ' (time enterprise não pode ser reviewer)' : ''}.` : '';
    this.emit('toast', { kind: notEntered.length ? 'info' : 'ok', text: `👥 ${key}: review pedido de ${okd.join(', ')} e você atribuído${asgNote}.${failNote}` });
    return { ok: true, reviewers: okd, failed, skipped };
  }

  // --- autoanalise: revisa um PR MEU so pra mim, nunca posta nada -------------
  saveSelfAnalyses() {
    try { fs.writeFileSync(SELF_FILE, JSON.stringify(this.selfAnalyses, null, 2)); }
    catch (err) { this.log('ERROR', `salvar self-analyses.json: ${err.message}`); }
  }

  clearSelfAnalysis(key) {
    if (this.selfAnalyses[key]) { delete this.selfAnalyses[key]; this.saveSelfAnalyses(); this.pushState(); }
    return { ok: true };
  }

  // Le a mergeabilidade REAL de um PR no GitHub (mergeable + mergeStateStatus).
  // E o que diz se o Merge e possivel de fato: CLEAN/UNSTABLE = mergeia agora;
  // BLOCKED = protecao exige requisitos (auto/admin); DIRTY = conflito; BEHIND =
  // atras da base; DRAFT = rascunho. Devolve null se nao deu pra ler.
  async fetchMergeState(url) {
    const m = String(url).match(/github\.com\/([^/]+)\//i);
    const r = await run('gh', ['pr', 'view', url, '--json', 'mergeable,mergeStateStatus,isDraft,state'], { env: this.ghEnv(this.accountForOwner(m && m[1])) });
    if (!r.ok) return null;
    try {
      const j = JSON.parse(r.stdout || '{}');
      return { mergeable: j.mergeable || 'UNKNOWN', status: j.mergeStateStatus || 'UNKNOWN', isDraft: !!j.isDraft, state: j.state || '', at: Date.now() };
    } catch { return null; }
  }

  // Anexa a branch de origem/destino em cada "Meu PR" (o gh search prs nao traz
  // branch; so gh pr view). Cacheia por PR pra nao chamar gh toda hora, mas com
  // TTL: a head e imutavel, porem a BASE pode ser retargetada pela UI/API do
  // GitHub num PR aberto, entao o cache expira e rebusca (retarget aparece em ate
  // ~30min). Chave que fechou sai do cache.
  async enrichMyPRBranches() {
    // uma chamada gh por PR meu: branch de origem/destino (o card mostra o de/para)
    // + o SHA do head. O SHA e buscado FRESCO a cada ciclo (muda a cada push, sem
    // cache) e serve pra invalidar a autoanalise quando entra commit novo: se o
    // head mudou desde a analise, a analise vira desatualizada e e descartada, o
    // card volta a "nao analisado" (mostrar veredito velho iludiria). Buscar
    // fresco tambem cobre retarget da base sem depender de TTL.
    let pruned = false;
    for (const pr of (this.myPRs || [])) {
      const r = await run('gh', ['pr', 'view', pr.url, '--json', 'headRefName,baseRefName,headRefOid'], { env: this.ghEnv(this.accountForPr(pr)) });
      if (!r.ok) continue;
      let j; try { j = JSON.parse(r.stdout || '{}'); } catch { continue; }
      pr.head = j.headRefName || ''; pr.base = j.baseRefName || ''; pr.headSha = j.headRefOid || '';
      const a = this.selfAnalyses[pr.key];
      if (a && a.headSha && pr.headSha && a.headSha !== pr.headSha) {
        delete this.selfAnalyses[pr.key];
        delete this.mergeStates[pr.key];
        this.log('WARN', `autoanálise de ${pr.key} descartada: PR mudou (commit novo)`);
        pruned = true;
      }
    }
    if (pruned) this.saveSelfAnalyses();
  }

  // O repo tem "Allow auto-merge" ligado? Sem isso, o botao Auto-merge nao adianta
  // (o gh recusa com enablePullRequestAutoMerge). null = nao deu pra saber.
  async fetchAutoMergeAllowed(repo) {
    const r = await run('gh', ['api', `repos/${repo}`, '--jq', '.allow_auto_merge'], { env: this.ghEnv(this.accountForOwner(String(repo).split('/')[0])) });
    if (!r.ok) return null;
    return String(r.stdout).trim() === 'true';
  }

  // A branch de destino tem REPOSITORY RULESET exigindo revisao/checks? Se sim, o
  // --admin NAO fura (diferente da protecao classica), entao o UI nao deve oferecer
  // "Merge admin". Cache por repo@base (ruleset muda pouco). null = nao deu pra saber.
  async fetchRuleBlocked(repo, base) {
    if (!repo || !base) return null;
    const cacheKey = `${repo}@${base}`;
    const c = this.ruleBlockCache[cacheKey];
    if (c && (Date.now() - c.at) < 30 * 60 * 1000) return c.blocked;
    const r = await run('gh', ['api', `repos/${repo}/rules/branches/${base}`, '--jq', '[.[].type]'], { env: this.ghEnv(this.accountForOwner(String(repo).split('/')[0])) });
    if (!r.ok) return null;
    let blocked = null;
    try {
      const types = JSON.parse(r.stdout || '[]');
      blocked = types.some(t => ['pull_request', 'required_status_checks', 'required_signatures', 'required_deployments'].includes(t));
    } catch { blocked = null; }
    if (blocked !== null) this.ruleBlockCache[cacheKey] = { blocked, at: Date.now() };
    return blocked;
  }

  // Atualiza a mergeabilidade só dos PRs que interessam pro botao Merge: meus,
  // com autoanalise aprovavel e fora da lista bloqueada. Mantem o custo baixo
  // (poucas chamadas gh, auto-merge por repo em cache) e o botao honesto: so
  // aparece quando da pra mergear.
  async refreshMergeStates() {
    const blocked = (this.config.mergeBlockedRepos || []).map(r => String(r).toLowerCase());
    const targets = (this.myPRs || []).filter(pr => {
      const a = this.selfAnalyses[pr.key];
      return a && a.approvable === true && !blocked.includes(String(pr.repo || '').toLowerCase());
    });
    const next = {};
    const autoByRepo = new Map();
    for (const pr of targets) {
      const ms = await this.fetchMergeState(pr.url);
      if (!ms) continue;
      const repo = pr.repo || (pr.key || '').split('#')[0];
      if (!autoByRepo.has(repo)) autoByRepo.set(repo, await this.fetchAutoMergeAllowed(repo));
      ms.autoAllowed = autoByRepo.get(repo);
      // so quando esta BLOCKED (quando auto/admin apareceriam) vale checar o ruleset:
      // se a base tem ruleset bloqueante, o --admin nao fura, entao esconde o admin.
      if (ms.status === 'BLOCKED') {
        const rb = await this.fetchRuleBlocked(repo, pr.base || ms.baseRefName);
        ms.adminBlocked = rb === true || !!this.adminBlockedRepos[repo];
      }
      next[pr.key] = ms;
    }
    this.mergeStates = next;
  }

  // Recalcula quais PRs que EU revisei ganharam commit novo depois da minha review.
  // Só pros PRs abertos do panorama que eu revisei (aprovei/pedi mudanças via Farol,
  // ou o GitHub marcou como revisado por mim): poucos, então o custo é limitado.
  async refreshStaleStates() {
    const acts = this.reviewActions();
    const targets = (this.panorama || []).filter(pr => {
      const a = acts[pr.key];
      return pr.reviewedByMe || (a && (a.kind === 'approve' || a.kind === 'request_changes'));
    });
    const next = {};
    for (const pr of targets) {
      try { next[pr.key] = await this.staleForReview(pr); }
      catch { next[pr.key] = false; }
    }
    this.staleStates = next;
  }

  // true = entrou commit novo depois da SUA última review (approve/changes) neste PR.
  // Best-effort: qualquer incerteza (rede, sem commit registrado na review) devolve
  // false, pra NUNCA reintroduzir o "Re-revisar" indevido num PR estável.
  async staleForReview(pr) {
    const repo = pr.repo || (pr.key || '').split('#')[0];
    const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
    const acc = this.accountForPr(pr);
    const me = (acc || '').toLowerCase();
    if (!repo || !number || !me) return false;
    const env = this.ghEnv(acc);
    const headR = await run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env });
    if (!headR.ok) return false;
    const head = (headR.stdout || '').trim();
    // commit da minha última review que valeu como aprovação ou pedido de mudança
    const revR = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
      '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED")] | sort_by(.submitted_at) | last | .commit_id // ""`], { env });
    if (!revR.ok) return false;
    const revSha = (revR.stdout || '').trim().replace(/^"|"$/g, '');
    if (!head || !revSha) return false;
    return head !== revSha;
  }

  // --- pushback automático: detecta e classifica a contestação do autor ------
  // Best-effort (como o staleStates): qualquer incerteza não registra nada. O
  // gatilho barato via gh evita acender IA à toa; a classificação é 1 sessão
  // Claude por candidato novo, LEITURA pura (nunca posta), limitada por ciclo.
  async scanPushbacks() {
    if (!this.config.autoPushback) return; // opt-in: por padrão não gasta sessão Claude com isso
    if (this.pushbackScanning) return;
    this.pushbackScanning = true;
    try {
      const acts = this.reviewActions();
      const targets = (this.panorama || []).filter(pr => {
        if (this.isMuted(this.accountForPr(pr))) return false;
        const a = acts[pr.key];
        const reviewed = pr.reviewedByMe || (a && (a.kind === 'approve' || a.kind === 'request_changes'));
        if (!reviewed) return false;
        const seen = this.pushbackScanned[pr.key];
        return !seen || (pr.updatedAt && String(pr.updatedAt) > String(seen)); // updatedAt = gate barato
      });
      const MAX_PER_CYCLE = 2; // limita sessões Claude por ciclo (custo / carga da máquina)
      let classified = 0;
      for (const pr of targets) {
        if (classified >= MAX_PER_CYCLE) { this.log('WARN', `scanPushbacks: ${targets.length - classified} candidato(s) ficaram pro próximo ciclo`); break; }
        try {
          const det = await this.detectAuthorPushback(pr);
          if (!det) continue; // não deu pra ler: tenta de novo depois (sem marcar)
          this.pushbackScanned[pr.key] = det.marker; this.savePushbackScanned();
          if (!det.hadActivity) continue; // autor não falou depois do meu review
          classified++;
          const cls = await this.classifyPushback(pr);
          if (!cls || !cls.isPushback || cls.outcome === 'none' || !PUSHBACK_OUTCOMES.includes(cls.outcome)) continue;
          const high = cls.confidence === 'high';
          this.pushbacks[pr.key] = {
            author: String(pr.author || '').toLowerCase(),
            outcome: cls.outcome,
            note: String(cls.note || '').trim().slice(0, 300),
            at: Date.now(), source: 'auto',
            confidence: high ? 'high' : 'low',
            status: high ? 'confirmed' : 'pending'
          };
          this.savePushbacks();
          this.emit('toast', high
            ? { kind: 'info', text: `↩ Pushback em ${pr.key}: ${PUSHBACK_LABEL[cls.outcome] || cls.outcome}.` }
            : { kind: 'info', text: `↩ Possível pushback em ${pr.key}: confirme o desfecho em Revisões recentes.` });
        } catch (e) { this.log('WARN', `scanPushbacks ${pr.key}: ${e.message}`); }
      }
    } finally { this.pushbackScanning = false; }
  }

  // atividade do AUTOR depois do meu último review (gatilho barato). Devolve
  // { marker, hadActivity } ou null quando não dá pra determinar (rede / sem review meu).
  async detectAuthorPushback(pr) {
    const repo = pr.repo || (pr.key || '').split('#')[0];
    const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
    const acc = this.accountForPr(pr);
    const me = (acc || '').toLowerCase();
    const author = String(pr.author || '').toLowerCase();
    if (!repo || !number || !me || !author || author === me) return null;
    const env = this.ghEnv(acc);
    const revR = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
      '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | .submitted_at] | sort | last // ""`], { env });
    if (!revR.ok) return null;
    const myAt = (revR.stdout || '').trim().replace(/^"|"$/g, '');
    if (!myAt) return null; // não tenho review registrado neste PR
    const jq = `[.[] | select((.user.login | ascii_downcase) == "${author}") | .created_at | select(. > "${myAt}")]`;
    const cR = await run('gh', ['api', `repos/${repo}/issues/${number}/comments`, '--jq', jq], { env });
    const rcR = await run('gh', ['api', `repos/${repo}/pulls/${number}/comments`, '--jq', jq], { env });
    const times = [];
    for (const r of [cR, rcR]) if (r.ok) { try { for (const t of JSON.parse(r.stdout || '[]')) times.push(t); } catch { } }
    const marker = times.sort().slice(-1)[0] || myAt; // sem atividade: marca o review (não reavalia até mudar)
    return { marker, hadActivity: times.length > 0 };
  }

  // classifica a thread via Claude (leitura pura). Devolve { isPushback, outcome,
  // confidence, note } ou null se falhar. Não registra em activeReviews (silencioso).
  async classifyPushback(pr) {
    const acc = this.accountForPr(pr);
    const me = acc || '';
    const prompt = `Você está rodando em modo AUTÔNOMO dentro do app Farol, sem ninguém na tela. NÃO faça perguntas, NÃO poste nada (só leitura via gh).\n\n` +
      `Avalie se houve PUSHBACK do autor a um review MEU no PR: ${pr.url}\n` +
      `"Eu" (revisor) sou @${me}; o autor do PR é @${pr.author}. Pushback = o autor CONTESTA/discorda de um ponto do MEU review (não conta só concordar, agradecer ou aplicar a mudança pedida).\n` +
      `Leia a thread (meu review e as respostas do autor DEPOIS dele) e julgue o DESFECHO:\n` +
      `- "author_right": o autor tinha razão (meu ponto não procedia, era intencional, ou eu recuei).\n` +
      `- "we_right": eu tinha razão (o ponto procedia e foi acatado, ou o autor cedeu).\n` +
      `- "mixed": parte de cada.\n` +
      `- "none": não houve pushback de fato.\n` +
      `confidence "high" só quando a thread deixa claro; na dúvida, "low".\n\n` +
      `Sua saída final deve ser APENAS um bloco JSON, sem texto em volta: {"isPushback": true|false, "outcome": "author_right"|"we_right"|"mixed"|"none", "confidence": "high"|"low", "note": "1 linha curta do que foi contestado"}`;
    const id = `pb${++this.sessionSeq}`;
    const res = await this.runClaudeStream(prompt, { id, account: acc });
    const text = this.parseEnvelope(res.text || '');
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
      const d = JSON.parse(text.slice(a, b + 1));
      return { isPushback: !!d.isPushback, outcome: d.outcome, confidence: d.confidence, note: d.note };
    } catch { return null; }
  }

  // --- merge do MEU PR quando a MINHA autoanalise diz "aprovavel" -------------
  // Unica escrita no GitHub partindo de "Meus PRs" (a autoanalise em si continua
  // 100% leitura). Acionada por clique explicito, com gate: so o autor mergeia o
  // proprio PR, so quando aprovavel, so em repo fora da lista bloqueada. Atribui
  // o autor se preciso e deleta a branch de origem SO se for descartavel.
  // mode: 'normal' (merge imediato), 'auto' (--auto: mergeia quando os requisitos
  // passarem, sem burlar protecao) ou 'admin' (--admin: bypassa a protecao agora,
  // so funciona se voce for admin do repo). Quando o merge normal esbarra na
  // protecao de branch, devolve { blocked:'policy' } pra UI oferecer auto/admin.
  async mergeSelfPR(url, opts = {}) {
    const mode = opts.mode === 'auto' ? 'auto' : opts.mode === 'admin' ? 'admin' : 'normal';
    if (!url) return { ok: false, error: 'sem PR para mergear' };
    if (!this.token) await this.refreshTokens();
    const m = String(url).match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/i);
    if (!m) return { ok: false, error: 'não reconheci a URL do PR' };
    const repo = m[1];
    const number = parseInt(m[2], 10);
    const key = `${repo}#${number}`;
    // conta dona deste PR (pela org): token e identidade de autor corretos
    const acc = this.accountForOwner(repo.split('/')[0]);
    const env = this.ghEnv(acc);
    const me = (acc || '').toLowerCase();
    if (!me) return { ok: false, error: 'conta do GitHub não configurada' };
    if (!(this.tokens && this.tokens[acc]) && !this.token) {
      this.emit('toast', { kind: 'error', text: `Conta ${acc || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
      return { ok: false, error: 'gh sem token' };
    }

    // gate 1: so mergeia o que a MINHA autoanalise marcou como aprovavel
    const analysis = this.selfAnalyses[key];
    if (!analysis || analysis.approvable !== true) {
      return { ok: false, error: 'só dá pra mergear quando sua autoanálise marca o PR como aprovável' };
    }

    // gate 2: lista configuravel de repos bloqueados (regras de review do time)
    const blocked = (this.config.mergeBlockedRepos || []).map(r => String(r).toLowerCase());
    if (blocked.includes(repo.toLowerCase())) {
      this.emit('toast', { kind: 'error', text: `Merge de ${repo} está bloqueado pela sua lista (aba Sistema).` });
      return { ok: false, error: 'repo bloqueado para merge' };
    }

    // estado FRESCO do PR (nunca decidir por dado velho da tela)
    const info = await run('gh', ['pr', 'view', url, '--json',
      'state,isDraft,mergeable,author,headRefName,baseRefName,title'], { env });
    if (!info.ok) {
      const msg = (info.stderr || info.stdout || 'erro').trim().slice(0, 200);
      return { ok: false, error: `não consegui ler o PR: ${msg}` };
    }
    let pr;
    try { pr = JSON.parse(info.stdout || '{}'); } catch { return { ok: false, error: 'resposta do gh inválida' }; }

    // gate 3: autor sou eu; PR aberto, ready, sem conflito
    const author = ((pr.author && pr.author.login) || '').toLowerCase();
    if (author && author !== me) {
      return { ok: false, error: `você não é o autor deste PR (autor: ${author}); o Farol só mergeia os seus.` };
    }
    if (pr.state && pr.state !== 'OPEN') return { ok: false, error: `o PR não está aberto (estado: ${pr.state}).` };
    if (pr.isDraft) return { ok: false, error: 'o PR está como rascunho; marque como ready antes de mergear.' };
    if (pr.mergeable === 'CONFLICTING') return { ok: false, error: 'o PR tem conflito com a branch de destino; resolva antes de mergear.' };

    // 1) garantir que estou atribuido; se nao estiver, atribui
    const asg = await run('gh', ['pr', 'edit', url, '--add-assignee', acc], { env });
    if (!asg.ok) this.log('WARN', `não consegui me atribuir em ${key}: ${asg.stderr.trim().slice(0, 200)}`);

    // 2) merge commit (coerente com o fluxo, sem squash/rebase); deleta a branch
    //    de origem SO se for descartavel (nunca develop/release/main/...).
    const canDelete = !isPermanentBranch(pr.headRefName);
    const args = ['pr', 'merge', url, '--merge'];
    if (mode === 'auto') args.push('--auto');
    if (mode === 'admin') args.push('--admin');
    if (canDelete) args.push('--delete-branch');
    const mg = await run('gh', args, { env });
    if (!mg.ok) {
      const raw = (mg.stderr || mg.stdout || 'erro desconhecido').trim().slice(0, 300);
      // Condicoes CONHECIDAS e ja tratadas pelo UI: nao sao bug do Farol, ficam WARN
      // pra nao poluir o log de ERROR com ruido nao-acionavel.
      //  - policyBlock: a protecao da branch exige requisitos (merge NORMAL) → UI oferece auto/admin.
      //  - autoUnavailable: pediu --auto mas o repo nao tem "Allow auto-merge" ligado;
      //    re-tentar nao adianta, a saida e Merge (admin) ou ligar a opcao no repo.
      const policyBlock = mode === 'normal' && /base branch policy|not mergeable|protected|--auto|--admin/i.test(raw);
      const autoUnavailable = mode === 'auto' && /auto[ -]?merge is not allowed|enablePullRequestAutoMerge/i.test(raw);
      //  - ruleBlock: o repo usa REPOSITORY RULESET (nao protecao classica) exigindo
      //    revisao/checks; o --admin NAO fura ruleset sem bypass. Retentar nao adianta,
      //    a saida e uma aprovacao (ou bypass no ruleset). Condicao conhecida = WARN.
      const ruleBlock = /repository rule violations|approving review is required|required status check|changes must be made through a pull request/i.test(raw);
      this.log(policyBlock || autoUnavailable || ruleBlock ? 'WARN' : 'ERROR', `merge de ${key} (${mode}) falhou: ${raw}`);
      if (autoUnavailable) {
        const nice = `Auto-merge não está habilitado em ${repo}. Ligue "Allow auto-merge" nas settings do repo, ou use "Merge (admin)" se você for admin.`;
        this.emit('toast', { kind: 'error', text: `${key}: ${nice}` });
        return { ok: false, blocked: 'autoUnavailable', error: nice };
      }
      if (ruleBlock) {
        // marca o repo: o UI para de oferecer o Merge (admin), que nao resolve aqui
        this.adminBlockedRepos = this.adminBlockedRepos || {};
        this.adminBlockedRepos[repo] = true;
        const nice = `Merge admin não fura o ruleset de ${repo} sem bypass. Precisa de uma aprovação (ou um bypass no ruleset).`;
        this.emit('toast', { kind: 'error', text: `${key}: ${nice}` });
        return { ok: false, blocked: 'rule', error: nice };
      }
      if (!policyBlock) this.emit('toast', { kind: 'error', text: `Merge de ${key} falhou: ${raw}` });
      return { ok: false, blocked: policyBlock ? 'policy' : undefined, error: raw };
    }

    const head = pr.headRefName || '?', base = pr.baseRefName || '?';
    const asgNote = asg.ok ? '' : ' (não consegui te atribuir, confira no GitHub).';

    // auto-merge: o PR NAO foi mergeado ainda (o GitHub mergeia quando os
    // requisitos passarem). Nao limpa nada; o proximo polling remove quando fechar.
    if (mode === 'auto') {
      this.emit('toast', { kind: 'ok', text: `⏳ Auto-merge ativado em ${key}. O GitHub mergeia sozinho quando os requisitos passarem.${asgNote}` });
      return { ok: true, auto: true };
    }

    // normal/admin: mergeou agora. Limpa: o PR foi fechado, sai de Meus PRs e da autoanalise.
    this.myPRs = this.myPRs.filter(p => p.key !== key);
    if (this.selfAnalyses[key]) { delete this.selfAnalyses[key]; this.saveSelfAnalyses(); }
    this.pushState();

    const branchNote = canDelete ? ` Branch ${head} deletada.` : ` Branch ${head} preservada (é do fluxo).`;
    const adminNote = mode === 'admin' ? ' (via admin, proteção bypassada)' : '';
    this.emit('toast', { kind: 'ok', text: `✅ ${key} mergeado${adminNote} (${head}→${base}).${branchNote}${asgNote}` });
    return { ok: true, head, base, deletedBranch: canDelete, admin: mode === 'admin' };
  }

  selfPromptFor(url) {
    const candidates = [
      path.join(WORKSPACE, 'prompts', 'self-review.md'),
      path.join(TEMPLATE_DIR, 'prompts', 'self-review.md')
    ];
    for (const f of candidates) {
      try { return fs.readFileSync(f, 'utf8').replaceAll('{{URL}}', url); } catch { }
    }
    throw new Error('template prompts/self-review.md não encontrado');
  }

  parseSelfResult(raw) {
    const text = this.parseEnvelope(raw);
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('a sessão não devolveu JSON');
    const data = JSON.parse(text.slice(a, b + 1));
    if (typeof data.approvable !== 'boolean' || !data.verdict || !data.reportMarkdown) {
      throw new Error('JSON da autoanálise fora do contrato');
    }
    data.tips = Array.isArray(data.tips) ? data.tips : [];
    data.blockers = Array.isArray(data.blockers) ? data.blockers : [];
    return data;
  }

  async launchSelfAnalysis(url) {
    if (!url) return { ok: false, error: 'sem PR para analisar' };
    if (!this.token) await this.refreshTokens();
    if (!this.tokenOk) {
      this.emit('toast', { kind: 'error', text: `Conta ${this.primaryUser() || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
      return { ok: false, error: 'gh sem token' };
    }
    const found = this.myPRs.find(p => p.url === url) || this.prFromUrl(url);
    if (!found) return { ok: false, error: 'não reconheci esse PR' };
    const pr = { ...found, account: this.accountForPr(found), kind: 'self' };
    // ja tem uma autoanalise deste PR rodando ou na fila? nao duplica
    const busy = [...this.activeReviews.values()].some(s => s.mode === 'self' && (s.keys || []).includes(pr.key)) ||
      this.headlessQueue.some(p => p.kind === 'self' && p.key === pr.key);
    if (busy) return { ok: false, error: 'essa autoanálise já está em andamento' };
    this.headlessQueue.push(pr);
    this.processHeadless();
    this.pushState();
    this.emit('toast', { kind: 'info', text: `Analisando ${pr.key} pra você. Nada é postado, o resultado fica na tela.` });
    return { ok: true };
  }

  async runSelfAnalysis(pr) {
    const id = `s${++this.sessionSeq}`;
    this.activeReviews.set(id, {
      id, keys: [pr.key], label: `Autoanálise de ${pr.key}`, mode: 'self',
      startedAt: Date.now(), cancellable: true,
      pr: { key: pr.key, url: pr.url, title: pr.title || '' }
    });
    this.activity.set(id, []);
    this.pushState();
    try {
      const res = await this.runClaudeStream(this.selfPromptFor(pr.url), {
        id,
        account: this.accountForPr(pr),
        onModel: (m) => this.setSessionModel(id, m),
        onEvent: (e) => this.pushActivity(id, e.kind, e.text)
      });
      const result = this.parseSelfResult(res.text);
      // SHA do commit analisado: se o head mudar depois, a analise vira stale e
      // e descartada no proximo ciclo (enrichMyPRBranches), voltando pra "nao analisado".
      const shaR = await run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: this.ghEnv(this.accountForPr(pr)) });
      const headSha = shaR.ok ? shaR.stdout.trim() : (pr.headSha || null);
      this.selfAnalyses[pr.key] = {
        key: pr.key,
        pr: { repo: pr.repo, number: pr.number, url: pr.url, title: pr.title },
        at: Date.now(),
        headSha,
        sessionId: res.sessionId || null,
        card: result.card || null,
        cardMet: result.cardMet ?? null,
        ciPassing: result.ciPassing ?? null,
        approvable: result.approvable,
        verdict: result.verdict,
        confidence: result.confidence || null,
        summary: result.summary || '',
        blockers: result.blockers,
        tips: result.tips,
        reportMarkdown: result.reportMarkdown || ''
      };
      this.saveSelfAnalyses();
      // se aprovavel e fora de repo bloqueado, ja le a mergeabilidade real pro
      // botao Merge nascer honesto (sem esperar o proximo polling)
      const repoBlocked = (this.config.mergeBlockedRepos || []).map(r => String(r).toLowerCase()).includes(String(pr.repo || '').toLowerCase());
      if (result.approvable && !repoBlocked) {
        const ms = await this.fetchMergeState(pr.url);
        if (ms) { ms.autoAllowed = await this.fetchAutoMergeAllowed(pr.repo || (pr.key || '').split('#')[0]); this.mergeStates[pr.key] = ms; }
        else delete this.mergeStates[pr.key];
      } else {
        delete this.mergeStates[pr.key];
      }
      this.emit('self-analysis-done', { key: pr.key });
      this.emit('toast', {
        kind: result.approvable ? 'ok' : 'info',
        text: result.approvable
          ? `✅ ${pr.key}: aprovável. ${result.tips.length} dica(s) de melhoria.`
          : `🔧 ${pr.key}: precisa de ajuste (${result.blockers.length} ponto(s) antes de pedir review).`
      });
    } finally {
      this.activeReviews.delete(id);
      this.activity.delete(id);
      this.pushState();
    }
  }

  recordDecision(pr, result, extra) {
    const item = {
      id: `d${Date.now()}${Math.floor(Math.random() * 1000)}`,
      createdAt: Date.now(),
      pr: result.pr && result.pr.repo ? result.pr : { repo: pr.repo, number: pr.number, url: pr.url, title: pr.title, author: pr.author },
      key: pr.key,
      card: result.card || null,
      cardMet: result.cardMet,
      sessionId: result.sessionId || null,
      verdict: result.verdict,
      reasons: result.reasons || [],
      reportMarkdown: result.reportMarkdown || '',
      payloads: result.payloads || {},
      memory: result.memory || null,
      ...extra
    };
    if (item.status === 'pending') this.decisions.pending.unshift(item);
    else this.resolveIntoHistory(item);
    this.saveDecisions();
    return item;
  }

  resolveIntoHistory(item) {
    item.resolvedAt = Date.now();
    // historico nao precisa carregar relatorio e payloads inteiros
    const slim = { ...item, reportMarkdown: item.reportMarkdown, payloads: undefined, memory: undefined };
    this.decisions.resolved.unshift(slim);
    this.decisions.resolved = this.decisions.resolved.slice(0, 30);
  }

  // ultima acao do Farol por PR, pro indicador do panorama: o que foi postado
  // (aprovado, mudancas pedidas, comentado) ou "pendente" quando esta na sua mesa.
  // "pulado" nao marca nada: nao foi postado review.
  reviewActions() {
    const map = {};
    for (const d of [...this.decisions.resolved].reverse()) {
      if (d.status === 'auto_approved') map[d.key] = { kind: 'approve', auto: true, at: d.resolvedAt };
      else if (d.status === 'auto_rejected') map[d.key] = { kind: 'request_changes', auto: true, at: d.resolvedAt };
      else if (d.status === 'posted' || d.status === 'already_reviewed') map[d.key] = { kind: d.action, at: d.resolvedAt };
    }
    for (const d of this.decisions.pending) map[d.key] = { kind: 'pending', at: d.createdAt };
    return map;
  }

  saveDecisions() {
    try { fs.writeFileSync(path.join(STATE_DIR, 'decisions.json'), JSON.stringify(this.decisions, null, 2)); }
    catch (err) { this.log('ERROR', `salvar decisions.json: ${err.message}`); }
    this.pushState();
  }

  // estados dos reviews que EU ja postei neste PR (dedup de postagem).
  // null = nao deu pra confirmar (rede etc.); quem chama decide se segue.
  async myReviewStates(pr) {
    const repo = pr.repo || (pr.key || '').split('#')[0];
    const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
    const acc = this.accountForPr(pr);
    const me = (acc || '').toLowerCase();
    if (!repo || !number || !me) return null;
    const r = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
      '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | .state]`], { env: this.ghEnv(acc) });
    if (!r.ok) return null;
    try { return JSON.parse(r.stdout || '[]'); } catch { return null; }
  }

  // Deve auto-aprovar este PR? Aprovável = veredito approve + payload APPROVE.
  // Revisão iniciada por clique (requested === false) NUNCA auto-posta. Com
  // autoApproveAll (default) todo aprovável passa; senão, só o gate estrito
  // (a sessão decidiu auto_approve E o card foi comprovado).
  shouldAutoApprove(pr, result) {
    const approvable = result.verdict === 'approve' &&
      result.payloads && result.payloads.approve && result.payloads.approve.event === 'APPROVE';
    if (!approvable || pr.requested === false) return false;
    // limpo = sem ressalvas (nenhum ponto de atenção) E a sessão decidiu auto_approve;
    // senão é "aprovável com ressalvas". A política da conta dona decide a ação.
    const clean = this.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
    return this.approvePolicyFor(this.accountForPr(pr), clean) === 'approve';
  }

  // Deve reprovar sozinho (postar REQUEST_CHANGES)? Só quando a revisão pediu
  // mudanças (verdict request_changes + payload), foi um review PEDIDO a mim
  // (clique nunca posta) e a conta optou por "reprova sozinho". Opt-in, default não.
  shouldAutoReject(pr, result) {
    const rejectable = result.verdict === 'request_changes' &&
      result.payloads && result.payloads.request_changes && result.payloads.request_changes.event === 'REQUEST_CHANGES';
    if (!rejectable || pr.requested === false) return false;
    return this.rejectPolicyFor(this.accountForPr(pr)) === 'request_changes';
  }

  // Marca o corpo do REQUEST_CHANGES automático, pro autor saber que foi o Farol.
  rejectBodyWithMark(body) {
    // o corpo vai como está: nada de carimbo de "automático", o review tem que
    // parecer o teu, humano. A rastreabilidade de que foi o Farol fica só no app.
    return String(body || '').trim();
  }

  // Pontos de atenção de uma revisão aprovável: as ressalvas que a sessão levantou
  // (result.reasons) mais um aviso quando o card não foi comprovado. É o que a gente
  // deixa claro ao aprovar sozinho, no PR e na tela.
  attentionPoints(result) {
    const pts = [];
    if (result.cardMet === false) pts.push('O card não foi totalmente comprovado na revisão automática, confira se necessário.');
    for (const r of (result.reasons || [])) if (r) pts.push(String(r));
    return pts;
  }


  async postReview(pr, payload) {
    try {
      if (!this.token) await this.refreshTokens();
      const acc = this.accountForPr(pr);
      const file = path.join(STATE_DIR, 'pr-review-payload.json');
      fs.writeFileSync(file, JSON.stringify(payload, null, 2));
      const repo = pr.repo || (pr.key || '').split('#')[0];
      const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
      let r = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: this.ghEnv(acc) });
      if (!r.ok && /line could not be resolved|422/i.test(r.stderr) && (payload.comments || []).length) {
        // ancora inline invalida: recua os pontos pro corpo e tenta de novo
        const fallback = {
          event: payload.event,
          body: payload.body + '\n\n---\n**Pontos inline (linhas fora do diff):**\n' +
            payload.comments.map(c => `- \`${c.path}:${c.line}\` — ${c.body}`).join('\n'),
          comments: []
        };
        fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
        r = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: this.ghEnv(acc) });
      }
      if (!r.ok) {
        const msg = (r.stderr || r.stdout || 'erro desconhecido').trim().slice(0, 300);
        this.log('ERROR', `postar review ${pr.key} (${payload.event}): ${msg}`);
        return { ok: false, error: msg };
      }
      return { ok: true };
    } catch (err) {
      this.log('ERROR', `postar review ${pr.key}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // memoria do time escrita pelo app (deterministica), a partir do JSON da sessao
  writeMemory(result, actionLabel) {
    try {
      const mem = result.memory;
      const login = (mem && mem.author) || (result.pr && result.pr.author);
      if (!login) return;
      const today = new Date().toISOString().slice(0, 10);
      // repo COMPLETO (owner/repo) no ref: assim a memória do time fica atribuível
      // à conta/org dona, pra separar Destaques e Time por conta na UI. Entradas
      // antigas (só nome curto) ficam sem conta até o autor ser re-revisado.
      const ref = result.pr ? `${result.pr.repo}#${result.pr.number}` : '';
      const file = path.join(STATE_DIR, 'authors', `${login}.md`);
      let text = '';
      try { text = fs.readFileSync(file, 'utf8'); } catch { text = `# ${login}\n`; }
      const bullets = (mem && mem.bullets || []).filter(Boolean).map(b => `- ${b}`).join('\n');
      const entry = `## ${today} · ${ref} · ${actionLabel}\n${bullets}${bullets ? '\n' : ''}`;
      const nl = text.indexOf('\n');
      const head = nl >= 0 ? text.slice(0, nl + 1) : text + '\n';
      const rest = nl >= 0 ? text.slice(nl + 1) : '';
      const blocks = rest.split(/^(?=## )/m).filter(s => s.trim());
      blocks.unshift(entry);
      fs.writeFileSync(file, head + '\n' + blocks.slice(0, 10).join('\n').replace(/\n{3,}/g, '\n\n'));
      if (mem && mem.highlight) {
        fs.appendFileSync(path.join(STATE_DIR, 'highlights.md'), '\n' + mem.highlight.trim() + '\n');
      }
    } catch (err) {
      this.log('ERROR', `escrever memoria (${actionLabel}): ${err.message}`);
    }
  }

  async decide(id, action) {
    const idx = this.decisions.pending.findIndex(d => d.id === id);
    if (idx < 0) return { ok: false, error: 'decisão não encontrada (já resolvida?)' };
    const item = this.decisions.pending[idx];
    const labels = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };

    if (action === 'skip') {
      this.decisions.pending.splice(idx, 1);
      this.resolveIntoHistory({ ...item, status: 'skipped', action });
      this.saveDecisions();
      this.emit('toast', { kind: 'info', text: `${item.key} pulado, nada foi postado.` });
      return { ok: true };
    }
    const payload = item.payloads && item.payloads[action];
    if (!payload) return { ok: false, error: `payload de ${action} não disponível` };
    // dedup: review igual ja postado por mim (via chat, manual no GitHub, ou
    // clique repetido apos falha ambigua de rede — caso real do biud-core#215)
    const dupState = { approve: 'APPROVED', request_changes: 'CHANGES_REQUESTED', comment: 'COMMENTED' }[action];
    const states = await this.myReviewStates({ ...item.pr, key: item.key });
    if (states && dupState && states.includes(dupState)) {
      this.decisions.pending.splice(idx, 1);
      this.resolveIntoHistory({ ...item, status: 'already_reviewed', action });
      this.saveDecisions();
      this.emit('toast', { kind: 'info', text: `${item.key}: já havia um ${labels[action]} seu neste PR; não postei de novo.` });
      return { ok: true };
    }
    const post = await this.postReview({ ...item.pr, key: item.key }, payload);
    if (!post.ok) {
      this.emit('toast', { kind: 'error', text: `Falha ao postar em ${item.key}: ${post.error}` });
      return post;
    }
    this.decisions.pending.splice(idx, 1);
    this.resolveIntoHistory({ ...item, status: 'posted', action });
    this.saveDecisions();
    this.writeMemory(item, labels[action] || action.toUpperCase());
    this.emit('toast', { kind: 'ok', text: `${labels[action]} postado em ${item.key}.` });
    return { ok: true };
  }

  // --- chat com o Claude por PR ------------------------------------------------
  // Cada PR tem uma conversa persistente. Quando existe uma revisão headless
  // registrada (pendente ou resolvida), a conversa RETOMA a sessão da revisão
  // (--resume): o Claude chega sabendo o diff, o card e o relatório.
  saveChats() {
    try { fs.writeFileSync(CHATS_FILE, JSON.stringify(this.chats, null, 2)); }
    catch (err) { this.log('ERROR', `salvar chats.json: ${err.message}`); }
  }

  chatPublic(key) {
    const c = this.chats[key];
    if (!c) return { key, url: null, status: 'idle', messages: [] };
    return { key, url: c.url, status: c.status, messages: c.messages.slice(-100) };
  }

  chatSummaries() {
    const out = {};
    for (const [k, c] of Object.entries(this.chats)) {
      const last = c.messages[c.messages.length - 1];
      out[k] = { status: c.status, count: c.messages.length, updatedAt: last ? last.at : c.createdAt };
    }
    return out;
  }

  chatPreamble(key, url, inherited) {
    const intro = inherited
      ? 'MUDANÇA DE MODO: a revisão headless terminou; a partir de agora você está em CONVERSA ao vivo com o Wanderson pela interface do Farol. As regras "sem interlocutor" e "responda só JSON" não valem mais.'
      : `Você é o Claude dentro do app Farol, em conversa ao vivo com o Wanderson sobre o PR ${key}${url ? ` (${url})` : ''}. Use gh e as ferramentas do workspace pra examinar o que precisar.`;
    return intro + '\n' +
      'Regras desta conversa:\n' +
      '- Responda em markdown normal, direto ao ponto, em português.\n' +
      '- NÃO poste nada no GitHub (review, comentário, approve) a menos que ele peça explicitamente NESTA conversa. Quando pedir, poste via gh e confirme o que foi postado.\n' +
      '- Nunca use travessão em texto nenhum; reescreva com vírgula, parênteses ou dois pontos.\n' +
      '- Rascunho de resposta pro PR: primeira pessoa, tom dele, sem formalidade excessiva.\n\n';
  }

  async chatSend(key, url, text) {
    key = String(key || '').trim();
    text = String(text || '').trim();
    if (!key || !text) return { ok: false, error: 'mensagem vazia' };
    let chat = this.chats[key];
    if (!chat) chat = this.chats[key] = { key, url: url || null, sessionId: null, seeded: false, status: 'idle', messages: [], createdAt: Date.now() };
    if (chat.status === 'running') return { ok: false, error: 'aguarde a resposta atual (ou pare a geração)' };
    if (!this.token) await this.refreshToken();
    chat.url = chat.url || url || null;
    chat.messages.push({ role: 'user', text, at: Date.now() });
    chat.status = 'running';
    const id = `c${++this.sessionSeq}`;
    chat.runId = id;
    this.saveChats();
    this.emit('chat', this.chatPublic(key));
    this.pushState();

    // sessão: a própria do chat > herdada da revisão > nova
    let sessionId = chat.sessionId, inherited = false;
    if (!sessionId) {
      const d = this.decisions.pending.find(x => x.key === key && x.sessionId) ||
        this.decisions.resolved.find(x => x.key === key && x.sessionId);
      if (d) { sessionId = d.sessionId; inherited = true; }
    }

    const runOnce = (sid, prompt) => this.runClaudeStream(prompt, {
      id,
      extraArgs: sid ? ['--resume', sid] : [],
      onEvent: (e) => {
        if (e.kind === 'tool' || e.kind === 'warn') this.emit('chat-activity', { key, text: e.text });
        if (e.kind === 'text') {
          chat.messages.push({ role: 'assistant', text: e.text, at: Date.now(), partial: true });
          this.emit('chat', this.chatPublic(key));
        }
      }
    });

    (async () => {
      try {
        const prompt = chat.seeded ? text : this.chatPreamble(key, chat.url, inherited) + text;
        let res;
        try {
          res = await runOnce(sessionId, prompt);
        } catch (err) {
          // sessão antiga apagada/expirada/inválida: recomeça do zero uma única vez
          if (sessionId && /resume|no conversation|session id|session_id/i.test(err.message) && !err.cancelled) {
            chat.sessionId = null; chat.seeded = false;
            res = await runOnce(null, this.chatPreamble(key, chat.url, false) + text);
          } else throw err;
        }
        chat.messages = chat.messages.filter(m => !m.partial);
        chat.messages.push({ role: 'assistant', text: String(res.text || '').trim() || '(sem resposta)', at: Date.now() });
        chat.sessionId = res.sessionId || chat.sessionId || sessionId || null;
        chat.seeded = true;
      } catch (err) {
        chat.messages = chat.messages.filter(m => !m.partial);
        chat.messages.push({ role: 'system', text: err.cancelled ? 'geração interrompida por você' : `falha: ${err.message}`, at: Date.now() });
        if (!err.cancelled) this.log('ERROR', `chat ${key}: ${err.message}`);
      } finally {
        chat.status = 'idle';
        chat.runId = null;
        if (chat.messages.length > 200) chat.messages = chat.messages.slice(-200);
        this.saveChats();
        this.emit('chat', this.chatPublic(key));
        this.pushState();
      }
    })();
    return { ok: true };
  }

  chatStop(key) {
    const chat = this.chats[String(key || '').trim()];
    if (!chat || chat.status !== 'running' || !chat.runId) return { ok: false, error: 'nenhuma geração em andamento' };
    return this.cancelSession(chat.runId);
  }

  // escopo do kudos: '*' = todas as contas; senão o login (minúsculo) de uma conta
  kudosScopeKey(scope) { const s = String(scope || '').trim().toLowerCase(); return (!s || s === '*') ? '*' : s; }
  scopeLabel(scope) {
    const k = this.kudosScopeKey(scope);
    if (k === '*') return '';
    const a = this.accountList().find(x => x.user.toLowerCase() === k);
    return (a && (a.label || a.user)) || String(scope);
  }
  ownerFromUrl(url) { const m = String(url || '').match(/github\.com\/([^/]+)\//i); return m ? m[1] : ''; }
  // destaques visíveis num escopo: '*' pega tudo; conta específica filtra pelo owner do PR
  highlightsForScope(scope) {
    const items = parseHighlights();
    const k = this.kudosScopeKey(scope);
    if (k === '*') return items;
    return items.filter(h => { const owner = this.ownerFromUrl(h.url); return owner && this.accountForOwner(owner).toLowerCase() === k; });
  }

  // ferramentas (kudos, diagnostico) rodam INTERNAS, headless; o resultado
  // aparece na UI, nada de terminal
  toolPrompt(name, opts) {
    opts = opts || {};
    const file = path.join(WORKSPACE, '.claude', 'commands', name === 'kudos' ? 'pr-kudos.md' : 'pr-health.md');
    let body = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '').replace(/\$ARGUMENTS/g, '(padrão)');
    const preamble = 'Você está rodando em modo AUTÔNOMO (headless) dentro do app Farol, sem ninguém na tela. ' +
      'NÃO faça perguntas, NÃO ofereça próximos passos, NÃO espere confirmação.\n\n';
    // kudos de uma conta específica: injeta os destaques já filtrados e proíbe
    // olhar o arquivo global, pra o resumo nunca misturar conteúdo de outra conta
    let scopeBlock = '';
    if (name === 'kudos' && opts.scoped) {
      const line = h => {
        const ref = h.ref ? (h.url ? `[${h.ref}](${h.url})` : h.ref) : '';
        const tail = ref ? `${ref} — ${h.text}` : h.text;
        return '- ' + [h.date, h.author ? '@' + h.author : '', tail].filter(Boolean).join(' · ');
      };
      const list = (opts.list || []).map(line).join('\n');
      scopeBlock = `\n\n### Destaques da conta ${opts.label}\n` +
        `Considere SOMENTE os destaques listados abaixo, já filtrados pra a conta ${opts.label}. ` +
        `NÃO leia o arquivo highlights.md e NÃO inclua nada de outras contas.\n\n${list}\n`;
    }
    const suffix = name === 'kudos'
      ? '\n\nSua saída final deve ser APENAS o texto pronto pra colar (markdown), sem comentários em volta e sem ofertas no final.'
      : '\n\nComo não há interlocutor: aplique só as correções de baixo risco; as de risco maior viram uma seção "Recomendações (não apliquei)". ' +
        'Sua saída final deve ser APENAS o relatório em markdown (falhas → causa → o que mudou / o que recomendo).';
    return preamble + body + scopeBlock + suffix;
  }

  saveToolRuns() {
    try { fs.writeFileSync(path.join(STATE_DIR, 'tool-results.json'), JSON.stringify(this.toolRuns, null, 2)); }
    catch { }
    this.pushState();
  }

  // pega/guarda a execução de uma ferramenta: kudos é por conta (mapa escopo->execução),
  // health é global; centraliza aqui pra não espalhar o if do formato
  toolRunGet(name, scope) { return name === 'kudos' ? this.toolRuns.kudos[this.kudosScopeKey(scope)] : this.toolRuns[name]; }
  toolRunSet(name, scope, run) { if (name === 'kudos') this.toolRuns.kudos[this.kudosScopeKey(scope)] = run; else this.toolRuns[name] = run; }

  async launchTool(name, scope) {
    if (!['kudos', 'health'].includes(name)) return { ok: false, error: 'ferramenta desconhecida' };
    const cur = this.toolRunGet(name, scope);
    if (cur && cur.status === 'running') return { ok: false, error: 'já está rodando' };
    // kudos de uma conta sem destaques não roda (o painel já mostra o vazio)
    let scoped = false, scopedList = null, scopeName = '';
    if (name === 'kudos') {
      const key = this.kudosScopeKey(scope);
      scoped = key !== '*';
      scopeName = this.scopeLabel(scope);
      if (scoped) {
        scopedList = this.highlightsForScope(scope);
        if (!scopedList.length) return { ok: false, error: `sem destaques na conta ${scopeName} ainda` };
      } else if (!parseHighlights().length) {
        return { ok: false, error: 'sem destaques registrados ainda' };
      }
    }
    if (!this.token) await this.refreshToken();
    const label = name === 'kudos' ? `Kudos${scopeName ? ' · ' + scopeName : ''}` : 'Diagnóstico do Farol';
    const id = `f${++this.sessionSeq}`;
    this.activeReviews.set(id, { id, keys: [], label, mode: 'auto', startedAt: Date.now(), cancellable: true });
    this.activity.set(id, []);
    this.toolRunSet(name, scope, { status: 'running', startedAt: Date.now() });
    this.saveToolRuns();
    (async () => {
      try {
        const res = await this.runClaudeStream(this.toolPrompt(name, { scoped, list: scopedList, label: scopeName }), {
          id,
          onEvent: (e) => this.pushActivity(id, e.kind, e.text)
        });
        let text = String(res.text || '').trim();
        // alguns modelos envelopam em cerca de codigo mesmo instruidos a nao fazer
        text = text.replace(/^```[a-z]*\s*\r?\n/i, '').replace(/\r?\n```\s*$/, '').trim();
        if (!text) throw new Error('a sessão não devolveu texto');
        this.toolRunSet(name, scope, { status: 'done', output: text, finishedAt: Date.now() });
        this.emit('tool-done', { name, label });
        this.emit('toast', { kind: 'ok', text: `${label}: pronto.` });
      } catch (err) {
        if (!err.cancelled) this.log('ERROR', `ferramenta ${name}: ${err.message}`);
        this.toolRunSet(name, scope, { status: 'error', error: err.message, finishedAt: Date.now() });
        this.emit('toast', { kind: err.cancelled ? 'info' : 'error', text: err.cancelled ? `${label}: cancelado.` : `${label} falhou: ${err.message}` });
      } finally {
        this.activeReviews.delete(id);
        this.activity.delete(id);
        this.saveToolRuns();
      }
    })();
    return { ok: true };
  }

  // limpa o resultado de uma ferramenta (kudos/diagnostico) depois que os
  // pontos levantados ja foram tratados; nao mexe em nada alem do painel
  clearTool(name, scope) {
    if (!['kudos', 'health'].includes(name)) return { ok: false, error: 'ferramenta desconhecida' };
    const cur = this.toolRunGet(name, scope);
    if (cur && cur.status === 'running') return { ok: false, error: 'ainda está rodando; cancele ou aguarde terminar' };
    if (name === 'kudos') delete this.toolRuns.kudos[this.kudosScopeKey(scope)];
    else delete this.toolRuns[name];
    this.saveToolRuns();
    return { ok: true };
  }

  // zera o log de falhas (inclusive o rotacionado): usado quando um episodio
  // ja foi diagnosticado e encerrado, pro proximo diagnostico partir do zero
  clearLog() {
    try {
      fs.writeFileSync(LOG_FILE, '');
      try { fs.unlinkSync(LOG_FILE + '.1'); } catch { }
      this.pushState();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

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
  resolveUpdateSource() {
    // A pasta local so e fonte de update quando updateSource e definido EXPLICITAMENTE
    // no config. Sem isso (padrao), a fonte de verdade e a RELEASE do GitHub (git):
    // o app instalado nunca "atualiza" pra codigo que ainda nao foi mergeado/publicado,
    // evitando duas fontes de verdade. O caminho local vira opt-in so pra testar build
    // local durante o desenvolvimento.
    const cand = (this.config.updateSource || '').trim();
    if (!cand) return null;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(cand, 'package.json'), 'utf8'));
      if (pkg.name !== 'farol' || !pkg.version) return null;
      // rodando direto da fonte (dev): nao ha o que atualizar
      if (path.resolve(cand).toLowerCase() === path.resolve(__dirname).toLowerCase()) return null;
      return { path: cand, version: pkg.version };
    } catch { return null; }
  }

  cmpVersion(a, b) {
    const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  }

  // Local (pasta-fonte) tem precedencia: e o fluxo do mantenedor e nao gasta gh.
  // Sem fonte local (copias distribuidas), cai pro canal remoto (releases GitHub).
  async checkUpdate() {
    const src = this.resolveUpdateSource();
    if (src) {
      this.update = {
        current: APP_VERSION, channel: 'local',
        source: src.path, sourceVersion: src.version,
        available: this.cmpVersion(src.version, APP_VERSION) > 0,
        checkedAt: Date.now()
      };
      this.pushState();
      return this.update;
    }
    const repo = (this.config.updateRepo || '').trim();
    if (repo) { await this.checkUpdateRemote(repo); }
    else {
      this.update = { current: APP_VERSION, channel: 'none', source: null, sourceVersion: null, available: false, checkedAt: Date.now() };
    }
    this.pushState();
    return this.update;
  }

  // Le a ultima release do repo via gh (o mesmo gh autenticado que o app ja usa).
  async checkUpdateRemote(repo) {
    const r = await run('gh', ['release', 'view', '--repo', repo, '--json', 'tagName,assets'], { env: this.ghEnv() });
    const base = { current: APP_VERSION, channel: 'remote', repo, source: null, checkedAt: Date.now() };
    if (!r.ok) {
      // sem release ainda, sem acesso, ou rede: nao e falha do app, so nao ha update
      this.update = { ...base, sourceVersion: null, available: false, note: 'sem release acessível' };
      return;
    }
    let rel;
    try { rel = JSON.parse(r.stdout || '{}'); } catch { rel = {}; }
    const ver = String(rel.tagName || '').replace(/^v/, '');
    this.update = {
      ...base,
      sourceVersion: ver || null,
      available: !!ver && this.cmpVersion(ver, APP_VERSION) > 0
    };
  }

  // Baixa e extrai o pacote leve (farol-vX.Y.Z.zip) da release; devolve a pasta
  // extraida pra applyUpdate rodar o installer dali. O Electron NAO viaja no
  // update: a copia instalada ja tem, o installer preserva.
  async downloadRemoteUpdate() {
    const repo = (this.config.updateRepo || '').trim();
    const ver = this.update && this.update.sourceVersion;
    if (!repo || !ver) throw new Error('sem release remota pra baixar');
    const base = path.join(HOME, 'sessions', 'update-dl-' + Date.now());
    ensureDir(base);
    const dl = await run('gh', ['release', 'download', 'v' + ver, '--repo', repo,
      '--pattern', 'farol-v*.zip', '--dir', base, '--clobber'], { env: this.ghEnv() });
    if (!dl.ok) throw new Error('falha ao baixar: ' + (dl.stderr || dl.stdout || '').trim().slice(0, 200));
    const zip = fs.readdirSync(base).find(f => /^farol-v.*\.zip$/i.test(f));
    if (!zip) throw new Error('release sem o pacote farol-v*.zip');
    const zipPath = path.join(base, zip);
    const outDir = path.join(base, 'extracted');
    ensureDir(outDir);
    if (IS_WIN) {
      const r = await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${outDir}' -Force`]);
      if (!r.ok) throw new Error('falha ao extrair: ' + (r.stderr || '').trim().slice(0, 200));
    } else {
      const r = await run('unzip', ['-o', zipPath, '-d', outDir]);
      if (!r.ok) throw new Error('falha ao extrair (unzip): ' + (r.stderr || '').trim().slice(0, 200));
    }
    const inst = IS_WIN ? path.join(outDir, 'installer', 'install.ps1') : path.join(outDir, 'installer', 'install.sh');
    if (!fs.existsSync(inst)) throw new Error('pacote baixado sem installer');
    return outDir;
  }

  async applyUpdate() {
    await this.checkUpdate();
    if (!this.update.available) return { ok: false, error: 'nenhuma atualização disponível' };
    if (this.headlessBusyAccounts.size || this.running.size || this.headlessQueue.length) {
      return { ok: false, error: 'há análise ou chat em andamento; termine ou cancele antes de atualizar' };
    }
    // remoto: baixa e extrai a release; aponta a "fonte" pra pasta extraida
    if (this.update.channel === 'remote') {
      try { this.update.source = await this.downloadRemoteUpdate(); }
      catch (e) {
        this.emit('toast', { kind: 'error', text: 'Falha ao baixar a atualização: ' + e.message });
        return { ok: false, error: e.message };
      }
    }
    if (!IS_WIN) return this.applyUpdateMac();
    const installer = path.join(this.update.source, 'installer', 'install.ps1');
    if (!fs.existsSync(installer)) return { ok: false, error: `installer não encontrado em ${this.update.source}\\installer` };
    const lnk = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
      'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Farol.lnk');
    // o script vive num .ps1 proprio e e lancado via Start-Process (ShellExecute)
    // pra sobreviver a morte deste processo (o installer mata o Farol no meio).
    // Nao usar detached+windowsHide direto: as flags de console sao incompativeis.
    const dir = path.join(HOME, 'sessions');
    ensureDir(dir);
    const scriptFile = path.join(dir, `update-${Date.now()}.ps1`);
    fs.writeFileSync(scriptFile, [
      `& '${installer}' *> (Join-Path '${STATE_DIR}' 'update.log')`,
      'Start-Sleep -Seconds 1',
      `explorer.exe '${lnk}'`,
      `Remove-Item -LiteralPath '${scriptFile}' -Force -ErrorAction SilentlyContinue`
    ].join('\r\n'));
    const ps = `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${scriptFile}'`;
    spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      { stdio: 'ignore', windowsHide: true });
    // farol.log é só falha: uma atualização iniciada não é erro, então não loga.
    this.emit('toast', { kind: 'info', text: 'Atualizando: o Farol vai fechar e reabrir sozinho em instantes.' });
    return { ok: true, from: APP_VERSION, to: this.update.sourceVersion };
  }

  // macOS: mesmo contrato do Windows, com install.sh. O bash roda detached
  // (grupo próprio) pra sobreviver quando o installer matar este processo.
  applyUpdateMac() {
    const installer = path.join(this.update.source, 'installer', 'install.sh');
    if (!fs.existsSync(installer)) return { ok: false, error: `installer não encontrado em ${this.update.source}/installer` };
    const dir = path.join(HOME, 'sessions');
    ensureDir(dir);
    const scriptFile = path.join(dir, `update-${Date.now()}.sh`);
    fs.writeFileSync(scriptFile, [
      '#!/bin/bash',
      `bash '${installer}' > '${path.join(STATE_DIR, 'update.log')}' 2>&1`,
      'sleep 1',
      `open "$HOME/Applications/Farol.app" 2>/dev/null || open -a Farol 2>/dev/null`,
      'rm -f -- "$0"'
    ].join('\n') + '\n', { mode: 0o755 });
    spawn('/bin/bash', [scriptFile], { stdio: 'ignore', detached: true }).unref();
    // farol.log é só falha: uma atualização iniciada não é erro, então não loga.
    this.emit('toast', { kind: 'info', text: 'Atualizando: o Farol vai fechar e reabrir sozinho em instantes.' });
    return { ok: true, from: APP_VERSION, to: this.update.sourceVersion };
  }

  // --- diagnostico de pre-requisitos ---
  // assinatura do Claude que as sessões do Farol usam (best-effort, sem segredo):
  // qual config dir e qual conta OAuth está logada ali, pra o doctor mostrar/avisar.
  claudeAuthInfo() {
    const dir = (this.config.claudeConfigDir || '').trim();
    const jsonPath = dir ? path.join(dir, '.claude.json') : path.join(os.homedir(), '.claude.json');
    const info = { configDir: dir || null, account: null, ready: true };
    try {
      const j = readJson(jsonPath, {});
      info.account = (j && j.oauthAccount && j.oauthAccount.emailAddress) || null;
      // dir próprio precisa do login feito (credencial OAuth). A padrão a gente assume ok.
      if (dir) info.ready = fs.existsSync(path.join(dir, '.credentials.json')) || !!info.account;
    } catch { /* best-effort */ }
    return info;
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
      claudeAuth: this.claudeAuthInfo(), // assinatura do Claude (config dir + conta + pronto?)
      checkedAt: Date.now()
    };
    this.checkUpdate().catch(() => {});
    this.pushState();
    return this.doctorInfo;
  }

  updateSettings(patch) {
    const allowed = ['ghUser', 'owners', 'accounts', 'intervalSeconds', 'autoReview', 'autoApproveAll', 'skipPermissions',
      'soundEnabled', 'theme', 'autostart', 'updateSource', 'updateRepo', 'mergeBlockedRepos',
      'projectReviewers', 'defaultReviewers', 'people', 'claudeConfigDir', 'reviewModel', 'autoPushback'];
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
      if (k === 'claudeConfigDir') v = String(v || '').trim();
      if (k === 'reviewModel') { v = String(v || '').trim().toLowerCase(); if (!['', 'sonnet', 'haiku', 'opus'].includes(v)) v = this.config.reviewModel; }
      if (k === 'autoPushback') v = !!v;
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
    this.saveConfig();
    if (userChanged) { this.token = null; this.tokenOk = false; this.tokens = {}; }
    if (intervalChanged || userChanged) this.checkNow();
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
        autoReview: a.autoReview, onClean: a.onClean, onCaveats: a.onCaveats, onReject: a.onReject
      })),
      pushbacks: this.pushbacks,
      config: { ...this.config },
      lastCheckAt: this.lastCheckAt,
      nextCheckAt: this.nextCheckAt,
      queue: this.queue,
      panorama: this.panorama,
      myPRs: this.myPRs,
      selfAnalyses: this.selfAnalyses,
      mergeStates: this.mergeStates,
      staleStates: this.staleStates,
      activeSessions: [...this.activeReviews.values()],
      activity: Object.fromEntries(this.activity),
      headlessWaiting: this.headlessQueue.map(p => p.key),
      chats: this.chatSummaries(),
      toolRuns: this.toolRuns,
      decisions: {
        pending: this.decisions.pending,
        resolved: this.decisions.resolved.slice(0, 8)
      },
      reviewActions: this.reviewActions(),
      doctor: this.doctorInfo,
      update: this.update || null,
      paths: { home: HOME, workspace: WORKSPACE }
    };
  }

  pushState() { this.emit('state', this.snapshot()); }

  async start() {
    this.checkUpdate().catch(() => {});
    this.doctor().catch(() => {});
    await this.check('startup');
  }
}

// --- Leitores de memoria do time ---------------------------------------------
function parseHighlights() {
  let text = '';
  try { text = fs.readFileSync(path.join(STATE_DIR, 'highlights.md'), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^-\s+(.*)$/);
    if (!m) continue;
    const parts = m[1].split('·').map(s => s.trim());
    const entry = { date: null, author: null, ref: null, url: null, text: m[1] };
    if (parts.length >= 3) {
      entry.date = parts[0];
      entry.author = (parts[1] || '').replace(/^@/, '');
      const rest = parts.slice(2).join(' · ');
      const link = rest.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (link) { entry.ref = link[1]; entry.url = link[2]; }
      const sep = rest.indexOf('—');
      entry.text = sep >= 0 ? rest.slice(sep + 1).trim() : rest.replace(/\[([^\]]+)\]\(([^)]+)\)\s*/, '').trim();
    }
    out.push(entry);
  }
  return out.reverse();
}

function parseTeam() {
  const dir = path.join(STATE_DIR, 'authors');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.md')); } catch { return []; }
  const team = [];
  for (const f of files) {
    let text = '';
    try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    const login = f.replace(/\.md$/, '');
    const title = text.match(/^#\s+(.+)$/m);
    const nameM = title ? title[1].match(/\(([^)]+)\)/) : null;
    const entries = [];
    const blocks = text.split(/^##\s+/m).slice(1);
    for (const b of blocks) {
      const lines = b.split(/\r?\n/);
      const head = lines[0].split('·').map(s => s.trim());
      entries.push({
        date: head[0] || '',
        ref: head[1] || '',
        verdict: head[2] || '',
        bullets: lines.slice(1).filter(l => l.trim().startsWith('-')).map(l => l.replace(/^\s*-\s*/, ''))
      });
    }
    team.push({ login, name: nameM ? nameM[1] : login, entries });
  }
  team.sort((a, b) => (b.entries[0] && b.entries[0].date || '').localeCompare(a.entries[0] && a.entries[0].date || ''));
  return team;
}

function tailLog(lines = 300) {
  let text = '';
  try { text = fs.readFileSync(LOG_FILE, 'utf8'); } catch { return []; }
  return text.split(/\r?\n/).filter(Boolean).slice(-lines);
}

// --- HTTP + SSE ---------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 65536) { reject(new Error('body grande demais')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

function startServer(engine, onReady) {
  const sseClients = new Set();

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) { try { res.write(payload); } catch { /* cliente caiu */ } }
  }

  engine.on('state', s => broadcast('state', s));
  engine.on('toast', t => broadcast('toast', t));
  engine.on('new-prs', p => broadcast('new-prs', p));
  engine.on('auto-approved', p => broadcast('auto-approved', p));
  engine.on('auto-rejected', p => broadcast('auto-rejected', p));
  engine.on('needs-decision', p => broadcast('needs-decision', p));
  engine.on('tool-done', p => broadcast('tool-done', p));
  engine.on('activity', p => broadcast('activity', p));
  engine.on('chat', p => broadcast('chat', p));
  engine.on('chat-activity', p => broadcast('chat-activity', p));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };

    try {
      if (p.startsWith('/api/')) {
        if (req.method === 'POST' && req.headers['x-farol'] !== '1') return send(403, { error: 'forbidden' });

        if (p === '/api/state') return send(200, engine.snapshot());
        if (p === '/api/chat' && req.method === 'GET') return send(200, engine.chatPublic(String(url.searchParams.get('key') || '')));
        if (p === '/api/highlights') return send(200, parseHighlights());
        if (p === '/api/team') return send(200, parseTeam());
        if (p === '/api/deliveries') return send(200, await engine.fetchDeliveries(url.searchParams.get('days'), url.searchParams.get('owner')));
        if (p === '/api/log') return send(200, tailLog(parseInt(url.searchParams.get('lines'), 10) || 300));
        if (p === '/api/doctor') return send(200, await engine.doctor());
        if (p === '/api/reviewer-candidates') return send(200, await engine.reviewerCandidates());

        if (p === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`event: state\ndata: ${JSON.stringify(engine.snapshot())}\n\n`);
          sseClients.add(res);
          const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, 25000);
          req.on('close', () => { clearInterval(beat); sseClients.delete(res); });
          return;
        }

        if (req.method !== 'POST') return send(405, { error: 'method' });
        const body = await readBody(req);

        if (p === '/api/check') { engine.checkNow(); return send(200, { ok: true }); }
        if (p === '/api/review') {
          const urls = body.urls || engine.queue.map(q => q.url);
          return send(200, await engine.launchReview(urls, body.mode === 'terminal' ? 'terminal' : 'auto'));
        }
        if (p === '/api/self-review') return send(200, await engine.launchSelfAnalysis(String(body.url || '')));
        if (p === '/api/self-review/clear') return send(200, engine.clearSelfAnalysis(String(body.key || '')));
        if (p === '/api/self-review/merge') return send(200, await engine.mergeSelfPR(String(body.url || ''), { mode: body.mode }));
        if (p === '/api/self-review/reviewers') return send(200, await engine.setReviewers(String(body.url || '')));
        if (p === '/api/decide') return send(200, await engine.decide(String(body.id || ''), String(body.action || '')));
        if (p === '/api/ignore') { engine.ignore(String(body.key || '')); return send(200, { ok: true }); }
        if (p === '/api/restore') { engine.restore(String(body.key || '')); return send(200, { ok: true }); }
        if (p === '/api/settings') { engine.updateSettings(body || {}); return send(200, { ok: true, config: engine.config }); }
        if (p === '/api/pushback') return send(200, engine.recordPushback(body || {}));
        if (p === '/api/tool') return send(200, await engine.launchTool(String(body.name || ''), body.scope));
        if (p === '/api/tool/clear') return send(200, engine.clearTool(String(body.name || ''), body.scope));
        if (p === '/api/log/clear') return send(200, engine.clearLog());
        if (p === '/api/cancel') return send(200, engine.cancelSession(String(body.id || '')));
        if (p === '/api/session-exit') return send(200, engine.sessionExit(String(body.id || '')));
        if (p === '/api/update') return send(200, await engine.applyUpdate());
        if (p === '/api/chat/send') return send(200, await engine.chatSend(body.key, body.url, body.text));
        if (p === '/api/chat/stop') return send(200, engine.chatStop(body.key));
        return send(404, { error: 'not found' });
      }

      // arquivos estaticos da UI
      let file = p === '/' ? '/index.html' : p;
      file = path.normalize(file).replace(/^([.][.][\\/])+/, '');
      const full = path.join(UI_DIR, file);
      if (!full.startsWith(UI_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return send(404, 'não encontrado', 'text/plain; charset=utf-8');
      }
      send(200, fs.readFileSync(full), MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
    } catch (err) {
      engine.log('ERROR', `http ${p}: ${err.message}`);
      send(500, { error: err.message });
    }
  });

  server.listen(engine.config.port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${engine.config.port}`;
    if (onReady) onReady(url);
  });
  server.on('error', (err) => {
    engine.log('ERROR', `servidor http: ${err.message}`);
    if (onReady) onReady(null, err);
  });
  return server;
}

function start(onReady) {
  const engine = new Engine();
  const server = startServer(engine, onReady);
  engine.schedule();
  engine.start();
  return { engine, server, port: engine.config.port };
}

module.exports = { start, HOME, WORKSPACE, Engine, modelLabel, isPermanentBranch, parseProjectReviewers, parseDefaultReviewers, parseAccounts };

// execucao direta: modo servidor (fallback sem Electron, ou desenvolvimento)
if (require.main === module) {
  start((url, err) => {
    if (err) { console.error('[farol] erro ao subir o servidor:', err.message); process.exit(1); }
    console.log(`[farol] monitorando · UI em ${url}`);
    console.log('[farol] Ctrl+C para sair');
  });
}
