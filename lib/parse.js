// Parsers/normalizadores de config, puros (texto do textarea de Sistema OU objeto ->
// forma canônica). Sem estado, sem IO. Ver docs/QUALITY.md.
import { PAPEL_LEVELS, DOMAINS, DOMAIN_LEVELS } from './taxonomy.js';

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
      // perfil de assinatura Claude desta conta (id de config.claudeProfiles). Ausente/vazio
      // = herda o claudeProfileId global do Farol (ver Engine.resolveClaudeConfigDir).
      if (meta.claudeProfileId != null && String(meta.claudeProfileId).trim()) o.claudeProfileId = String(meta.claudeProfileId).trim();
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

// Caracteres sem uso legítimo em diretório, chave, URL e que quebram os scripts de sessão
// gerados (.cmd no Windows: aspa dupla + newline permitem injeção de comando; .command no
// mac: idem). Nome ficou "ClaudeDir" por ter nascido só pro dir, hoje sanitiza qualquer
// valor que vira variável de shell (dir, apiKey, baseUrl, ver normalizeClaudeProfiles).
// Rejeita em vez de tentar escapar aqui, não existe path, chave ou URL real que precise
// desses caracteres, e a Task de fix do .command trata aspa simples via escaping de
// verdade, não rejeição, por ser um caractere que PODE aparecer legitimamente (raro).
function sanitizeClaudeDir(v) {
  let s = String(v == null ? '' : v).trim();
  // "Copiar como caminho" do Explorer do Windows vem com aspas duplas envolvendo o valor
  // inteiro (ex.: "C:\Users\voce\.claude") - tira só esse par externo antes de validar,
  // senão todo mundo que colar assim perde o perfil silenciosamente. Aspas no MEIO do
  // valor continuam rejeitadas (motivo de segurança, ver injecao de shell no .cmd).
  const wrapped = s.match(/^"(.*)"$/s);
  if (wrapped) s = wrapped[1].trim();
  if (/["\r\n]/.test(s)) return '';
  return s;
}

// Perfis nomeados de executor. Tres shapes, NUNCA misturados no mesmo objeto:
//   dir:    {id, label, dir}                       (o de sempre, sem campo `kind`)
//   apikey: {id, label, kind:'apikey', apiKey, baseUrl}
//   codex:  {id, label, kind:'codex'}              (login ChatGPT local do Codex CLI)
// O shape dir não carrega `kind` DE PROPÓSITO: preserva byte a byte o formato que já
// existia antes desta função saber o que é apikey, e é o que permite ler QUALQUER perfil
// salvo antes desta feature existir sem migração nenhuma (ver invariante "nenhum código
// checa kind==='dir'" no design). O array de entrada pode vir malformado (config.json
// editado à mão, ou do PATCH /api/settings) e a função devolve SEMPRE um array limpo.
// Não-array (string, número, objeto, null) vira [].
// orçamento: campos opcionais, iguais nos dois shapes. Número inválido (NaN,
// negativo) ou data fora do formato YYYY-MM-DD vira ausente (sem teto), nunca
// lança e nunca aceita lixo. Guard: só aceita número de verdade ou string
// não-vazia (rejeita array, boolean, objeto, null e string vazia, mesmo quando
// Number() conseguiria converter). Muta e devolve o objeto de saída.
// teto em dinheiro: número de verdade ou string não-vazia, finito e >= 0. Qualquer
// outra coisa (array, boolean, objeto, null, string vazia, negativo) vira NaN e o
// campo fica AUSENTE, que significa "sem teto". Nunca lança, nunca aceita lixo.
function tetoValido(v) {
  const eNumero = (typeof v === 'number') || (typeof v === 'string' && String(v).trim() !== '');
  const n = eNumero ? Number(v) : NaN;
  return (Number.isFinite(n) && n >= 0) ? n : NaN;
}

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

// mapa de teto por chave (dia da semana '0'..'6', ou data 'YYYY-MM-DD'), filtrado
// por um validador de chave. Entrada não-objeto vira undefined (campo ausente), e
// chave ou valor inválido é DESCARTADO em silêncio sem levar o resto junto: config
// editada à mão com uma linha torta não pode apagar as outras seis.
function mapaDeTetos(val, chaveValida) {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(val)) {
    if (!chaveValida(k)) continue;
    const n = tetoValido(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return Object.keys(out).length ? out : undefined;
}

function aplicaOrcamento(out, p) {
  const daily = tetoValido(p && p.budgetDaily);
  if (Number.isFinite(daily)) out.budgetDaily = daily;
  const total = tetoValido(p && p.budgetTotal);
  if (Number.isFinite(total)) out.budgetTotal = total;
  if (typeof (p && p.budgetSince) === 'string' && DATA_ISO.test(p.budgetSince)) {
    out.budgetSince = p.budgetSince;
  }
  // teto por DIA DA SEMANA ('0' domingo .. '6' sábado) e por DATA ÚNICA.
  // Os dois são overrides opcionais do budgetDaily; quem resolve a precedência é
  // dailyCapFor (lib/engine/usage.js), fonte única pros dois tipos de perfil.
  const porDia = mapaDeTetos(p && p.budgetByWeekday, k => /^[0-6]$/.test(k));
  if (porDia) out.budgetByWeekday = porDia;
  const porData = mapaDeTetos(p && p.budgetDates, k => DATA_ISO.test(k));
  if (porData) out.budgetDates = porData;
  return out;
}

// Base URL do "Anthropic Skin" do OpenRouter (Messages API nativa). Sem /v1:
// com /v1 o Claude Code responde model-not-found. Fonte:
// https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration
const OPENROUTER_DEFAULT_BASE = 'https://openrouter.ai/api';

function sanitizaParChaveUrl(rawApiKey, rawBaseUrl) {
  const apiKey = typeof rawApiKey === 'string' ? sanitizeClaudeDir(rawApiKey) : '';
  const baseUrl = typeof rawBaseUrl === 'string' ? sanitizeClaudeDir(rawBaseUrl) : '';
  if ((typeof rawApiKey === 'string' && rawApiKey && !apiKey) ||
      (typeof rawBaseUrl === 'string' && rawBaseUrl && !baseUrl)) {
    return null;
  }
  return { apiKey, baseUrl };
}

function normalizeClaudeProfiles(val) {
  if (!Array.isArray(val)) return [];
  return val.map(p => {
    const id = String((p && p.id) || '').trim();
    const label = String((p && p.label) || '').trim();
    if (p && (p.kind === 'apikey' || p.kind === 'openrouter')) {
      // apiKey/baseUrl passam pelo MESMO sanitizador anti-injeção do dir: os dois viram
      // valor de variável de shell nos script builders (ver claudeAuthShellLines), o
      // mesmo motivo de segurança (aspa dupla, newline permitiriam escapar da atribuição).
      // Se uma delas foi FORNECIDA mas não passa na sanitização, o perfil inteiro é
      // rejeitado (tratamento agressivo pra segurança: não tenta "corrigir").
      const par = sanitizaParChaveUrl(p.apiKey, p.baseUrl);
      if (!par) return null;
      const baseUrl = par.baseUrl || (p.kind === 'openrouter' ? OPENROUTER_DEFAULT_BASE : '');
      return aplicaOrcamento({ id, label, kind: p.kind, apiKey: par.apiKey, baseUrl }, p);
    }
    if (p && p.kind === 'codex') {
      return aplicaOrcamento({ id, label, kind: 'codex' }, p);
    }
    const dir = typeof (p && p.dir) === 'string' ? sanitizeClaudeDir(p.dir) : '';
    // o shape dir também carrega orçamento desde a v2.48.4. Continua SEM o campo
    // `kind` (ver o parágrafo acima), e continua nascendo sem teto: perfil salvo
    // antes disso não ganha campo nenhum, então a leitura segue sem migração.
    return aplicaOrcamento({ id, label, dir }, p);
  }).filter(p => {
    if (!p || !p.id) return false;
    if (p.kind === 'codex') return true;
    if (p.kind === 'apikey' || p.kind === 'openrouter') return !!p.apiKey;
    return !!p.dir;
  });
}

function normalizeClaudeProfileId(val) {
  return String(val || '').trim();
}

// Objeto env (JS): usado só por Engine.ghEnv (server.js), que por sua vez alimenta as
// sessões headless E o processo que abre a sessão de terminal da fila.
//
// Limpa as 3 chaves ANTES de setar só a(s) do kind resolvido, CRÍTICO, não é enfeite.
// ghEnv parte de `{ ...process.env }`: se a própria máquina já tiver ANTHROPIC_API_KEY
// setada no ambiente (uso pessoal do claude CLI fora do Farol, por exemplo), um perfil
// dir (assinatura) seria silenciosamente ANULADO, a ordem de precedência oficial do
// claude CLI dá a API key do ambiente por cima do login OAuth, sem erro nenhum aparecer.
function applyClaudeAuthEnv(env, auth) {
  delete env.CLAUDE_CONFIG_DIR;
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  if (auth.kind === 'openrouter' && auth.apiKey) {
    // OpenRouter + Claude Code: AUTH_TOKEN = chave, API_KEY tem que ser string
    // VAZIA (não unset), senão o CLI tenta autenticar na Anthropic direto.
    env.ANTHROPIC_AUTH_TOKEN = auth.apiKey;
    env.ANTHROPIC_API_KEY = '';
    env.ANTHROPIC_BASE_URL = auth.baseUrl || OPENROUTER_DEFAULT_BASE;
  } else if (auth.kind === 'apikey' && auth.apiKey) {
    env.ANTHROPIC_API_KEY = auth.apiKey;
    if (auth.baseUrl) env.ANTHROPIC_BASE_URL = auth.baseUrl;
  } else if (auth.dir) {
    env.CLAUDE_CONFIG_DIR = auth.dir;
  }
}

// Escaping de aspa simples pra valor que entra numa atribuição shell (achado de auditoria
// adversarial documentado no CLAUDE.md: sem escapar, um valor com aspa simples escapava da
// atribuição e executava comando arbitrário). Compartilhado pelos dois montadores posix.
const shEsc = s => String(s).replace(/'/g, "'\\''");

// As MESMAS quatro vars que applyClaudeAuthEnv apaga do env: as três da API (`ANTHROPIC_*`)
// mais o CLAUDE_CONFIG_DIR, que decide qual conta OAuth está logada. applyClaudeAuthEnv já
// as apaga do env do filho, mas no posix isso não basta: o profile do usuário é sourceado
// DEPOIS do env montado (o -l do `/bin/sh -lc` no headless, o login shell do Terminal.app
// antes de executar o .command), então um `export ANTHROPIC_API_KEY` perdido no ~/.profile
// re-injeta a chave POR CIMA do perfil resolvido e anula em silêncio o perfil de assinatura
// do Farol. Por isso o unset é emitido DENTRO do shell, depois de qualquer sourcing e antes
// do exec do claude (G21). No Windows não existe esse sourcing (cmd.exe não lê profile
// nenhum), então lá o env limpo é suficiente.
//
// A lista cobre as quatro, e não só as duas de credencial, porque as outras duas são a mesma
// classe de furo: ANTHROPIC_BASE_URL redireciona o endpoint (mandaria credencial de
// assinatura pra host de terceiro) e CLAUDE_CONFIG_DIR troca a conta logada. O shell cobrir
// menos que o env seria uma inconsistência sem razão.
const POSIX_AUTH_UNSET = 'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CONFIG_DIR';

// Prefixo da linha headless posix (`/bin/sh -lc "<isto><comando>"`).
//
// Aqui o unset SOZINHO não serve: diferente dos scripts .command, o headless não tem arquivo
// nenhum re-exportando o perfil resolvido, o dir viaja SÓ pelo env. Um unset seco apagaria o
// dir do caminho feliz junto com o do profile, trocando um bug por outro pior (toda sessão
// cairia no login default da máquina). Por isso o dir do perfil é re-exportado logo depois,
// escapado; sem dir (perfil legado vazio, "padrão da máquina") fica só o unset, que é o
// comportamento certo: nada re-exportado, login default do claude.
//
// Perfil de chave de API fica de FORA de propósito: a chave dele viaja pelo env, e re-setá-la
// aqui a colocaria na linha de comando, visível no `ps` de qualquer processo da máquina (o
// dir não tem esse problema, é caminho, não credencial). Nos scripts isso não se aplica,
// porque lá a chave já está no arquivo, então claudeAuthShellLines emite o unset pros dois
// kinds e o perfil de chave re-seta a própria chave logo depois.
function claudeAuthPosixPrefix(auth) {
  // chave (Anthropic ou OpenRouter) viaja só pelo env: re-exportar na cmdline
  // colocaria o segredo no `ps` e no spawns.log.
  if (auth && (auth.kind === 'apikey' || auth.kind === 'openrouter') && auth.apiKey) return '';
  const dir = (auth && auth.dir) || '';
  return `${POSIX_AUTH_UNSET};${dir ? ` export CLAUDE_CONFIG_DIR='${shEsc(dir)}';` : ''} `;
}

// Linhas de script (.cmd no Windows, .command no macOS), SEM o separador de linha (quem
// chama junta com '\r\n' ou '\n' conforme o SO). Usado por buildSessionScript e
// buildSessionScriptMac (sessão de terminal da fila) e, desde o G21, também por
// buildLoginScriptMac, que passa sempre {kind:'dir'}: perfil apikey não tem fluxo de login
// (ver Engine.resolveAuthForLogin, openClaudeLoginSession, que barra apikey antes de chegar
// em qualquer script builder), então o ramo apikey daqui nunca é alcançado pelo login.
// Mesmo escaping de aspa simples que o dir já usa hoje no lado Mac (ver shEsc acima).
function claudeAuthShellLines(auth, isWin) {
  const esc = shEsc;
  // no posix o unset abre a lista SEMPRE: o que vem depois é o perfil resolvido (dir ou a
  // chave do próprio perfil), que tem que vencer o que o profile do usuário tenha exportado.
  // Sem perfil próprio nada é re-exportado, e é isso mesmo: "padrão da máquina" quer dizer o
  // login default do claude, não o que o ~/.profile do usuário tiver deixado no ambiente.
  const head = isWin ? [] : [POSIX_AUTH_UNSET];
  if (auth.kind === 'openrouter' && auth.apiKey) {
    const base = auth.baseUrl || OPENROUTER_DEFAULT_BASE;
    // API_KEY vazia de propósito (contrato OpenRouter): no cmd `set "X="` zera;
    // no posix `export X=` exporta string vazia, que é o que o CLI exige.
    // Sem ternário na mesma statement (gate ternarioAninhado conta '?' por ';').
    const lines = [...head];
    if (isWin) {
      lines.push(`set "ANTHROPIC_AUTH_TOKEN=${auth.apiKey}"`);
      lines.push('set "ANTHROPIC_API_KEY="');
      lines.push(`set "ANTHROPIC_BASE_URL=${base}"`);
    } else {
      lines.push(`export ANTHROPIC_AUTH_TOKEN='${esc(auth.apiKey)}'`);
      lines.push('export ANTHROPIC_API_KEY=');
      lines.push(`export ANTHROPIC_BASE_URL='${esc(base)}'`);
    }
    return lines;
  }
  if (auth.kind === 'apikey' && auth.apiKey) {
    const lines = [...head, isWin ? `set "ANTHROPIC_API_KEY=${auth.apiKey}"` : `export ANTHROPIC_API_KEY='${esc(auth.apiKey)}'`];
    lines.push(auth.baseUrl
      ? (isWin ? `set "ANTHROPIC_BASE_URL=${auth.baseUrl}"` : `export ANTHROPIC_BASE_URL='${esc(auth.baseUrl)}'`)
      : (isWin ? 'rem sem base url propria' : '# sem base url propria'));
    return lines;
  }
  const dir = auth.dir || '';
  return [...head, dir
    ? (isWin ? `set "CLAUDE_CONFIG_DIR=${dir}"` : `export CLAUDE_CONFIG_DIR='${esc(dir)}'`)
    : (isWin ? 'rem sem config dir proprio' : '# sem config dir proprio')];
}

// --- modelo e esforco das sessoes autonomas ---------------------------------
// Estes dois valores entram na LINHA DE COMANDO montada por concatenacao e passada a um
// shell (cmd.exe /d /s /c no Windows, /bin/sh -lc no mac). Sao a unica config do Farol
// nessa posicao, entao a validacao aqui e por allowlist, nunca por escaping.
//
// Fora da lista de proposito:
//  - opusplan: alterna Opus no plan mode e Sonnet na execucao, e `claude -p` nao tem plan
//    mode. A sessao inteira cairia pra Sonnet sob um rotulo que diz Opus.
//  - default: so se distingue de '' quando existe ANTHROPIC_MODEL ou model no settings.json,
//    e o Farol nunca seta nenhum dos dois. Seriam duas opcoes indistinguiveis.
//  - opus[1m] / sonnet[1m]: colchete e glob pro /bin/sh. Rodando com cwd no WORKSPACE, a
//    palavra `opus[1m]` casaria com um arquivo chamado `opus1` e viraria outro argumento,
//    calado. Sem match o sh deixa passar, entao "funciona quase sempre", que e pior.
// 'auto' é alias do Farol (roteador por métricas do PR), nunca flag do CLI.
const MODEL_ALIASES = ['best', 'opus', 'sonnet', 'haiku', 'fable', 'auto'];
// escotilha pra modelo novo sem precisar de release do Farol: aceita nome completo
// (claude-opus-5) escrito a mao no config.json. So [a-z0-9-], zero metacaractere.
const MODEL_FULL_RE = /^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODEX_MODEL_RE = /^gpt-[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
// O caminho Claude filtra esta lista depois; max/ultra entram para o Codex sem
// transformar um perfil Claude em linha de comando invalida.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];
const CODEX_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

// Devolve o valor limpo, ou null quando invalido (o chamador decide se descarta ou se
// mantem o anterior). '' e valido e significa "nao passa a flag".
function sanitizeModel(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return '';
  if (s.length > 60) return null;
  if (MODEL_ALIASES.includes(s)) return s;
  return (MODEL_FULL_RE.test(s) || CODEX_MODEL_RE.test(s)) ? s : null;
}

function sanitizeEffort(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return '';
  return CODEX_EFFORT_LEVELS.includes(s) ? s : null;
}

function sanitizeClaudeModel(v) {
  const s = sanitizeModel(v);
  if (!s || CODEX_MODEL_RE.test(s)) return '';
  // auto é resolvido em lib/engine/model-router.js antes do spawn; mandar
  // --model auto pro claude seria modelo inválido e mataria a sessão.
  if (s === 'auto') return '';
  return s;
}

function sanitizeClaudeEffort(v) {
  const s = sanitizeEffort(v);
  return EFFORT_LEVELS.includes(s) ? s : '';
}

function sanitizeCodexModel(v) {
  const s = sanitizeModel(v);
  if (!s || MODEL_ALIASES.includes(s) || MODEL_FULL_RE.test(s)) return '';
  return s;
}

function sanitizeCodexEffort(v) {
  const s = sanitizeEffort(v);
  return CODEX_EFFORT_LEVELS.includes(s) ? s : '';
}

// Revisões headless simultâneas por conta: inteiro 1..4, null pro inválido (o
// chamador mantém o anterior/padrão). Diferente de modelo/esforço, NÃO entra em
// linha de shell (só controla o escalonador), então clamp simples basta. O teto 4
// segue a régua do MAX_LOTES do fan-out: acima disso o gargalo vira a máquina.
function sanitizeParallelReviews(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(4, Math.max(1, n));
}

// Nem todo modelo aceita todo nivel de esforco. O alias so diz a FAMILIA, nao a versao
// concreta (o alias `opus` pode resolver num Opus 4.6, que nao tem xhigh), entao o Farol
// nao adivinha: filtra so o caso afirmavel pelo alias, que e o Haiku (nenhum Haiku aparece
// na matriz de esforco). Nos demais, deixa o CLI decidir.
function effortForModel(model, effort) {
  if (!effort) return '';
  return model === 'haiku' ? '' : effort;
}

// Chave de card no formato PROJETO-NUMERO. O texto vem em maiúscula porque a
// branch quase sempre nasce minúscula, e a chave é a mesma coisa nos dois casos.
// O limite de 6 dígitos evita casar número de versão colado num identificador.
const CHAVE_CARD = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;

function extractCardKeys(texto, projectKeys = []) {
  const permitidos = new Set((projectKeys || []).map((p) => String(p).toUpperCase()));
  const vistos = new Set();
  const saida = [];
  for (const m of String(texto || '').toUpperCase().matchAll(CHAVE_CARD)) {
    const chave = `${m[1]}-${m[2]}`;
    if (permitidos.size && !permitidos.has(m[1])) continue;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(chave);
  }
  return saida;
}

const parse = {
  parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  applyClaudeAuthEnv, claudeAuthShellLines, claudeAuthPosixPrefix, shEsc,
  MODEL_ALIASES, EFFORT_LEVELS, sanitizeModel, sanitizeEffort, effortForModel,
  sanitizeClaudeModel, sanitizeClaudeEffort, sanitizeCodexModel, sanitizeCodexEffort,
  sanitizeParallelReviews, extractCardKeys, OPENROUTER_DEFAULT_BASE,
};
export default parse;
export {
  parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  applyClaudeAuthEnv, claudeAuthShellLines, claudeAuthPosixPrefix, shEsc,
  MODEL_ALIASES, EFFORT_LEVELS, sanitizeModel, sanitizeEffort, effortForModel,
  sanitizeClaudeModel, sanitizeClaudeEffort, sanitizeCodexModel, sanitizeCodexEffort,
  sanitizeParallelReviews, extractCardKeys, OPENROUTER_DEFAULT_BASE,
};
