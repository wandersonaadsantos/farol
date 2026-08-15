'use strict';
// Parsers/normalizadores de config, puros (texto do textarea de Sistema OU objeto ->
// forma canônica). Sem estado, sem IO. Ver docs/QUALITY.md.
const { PAPEL_LEVELS, DOMAINS, DOMAIN_LEVELS } = require('./taxonomy');

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

// Perfis nomeados de assinatura Claude. Dois shapes, NUNCA misturados no mesmo objeto:
//   dir:    {id, label, dir}                       (o de sempre, sem campo `kind`)
//   apikey: {id, label, kind:'apikey', apiKey, baseUrl}
// O shape dir não carrega `kind` DE PROPÓSITO: preserva byte a byte o formato que já
// existia antes desta função saber o que é apikey, e é o que permite ler QUALQUER perfil
// salvo antes desta feature existir sem migração nenhuma (ver invariante "nenhum código
// checa kind==='dir'" no design). O array de entrada pode vir malformado (config.json
// editado à mão, ou do PATCH /api/settings) e a função devolve SEMPRE um array limpo.
// Não-array (string, número, objeto, null) vira [].
function normalizeClaudeProfiles(val) {
  if (!Array.isArray(val)) return [];
  return val.map(p => {
    const id = String((p && p.id) || '').trim();
    const label = String((p && p.label) || '').trim();
    if (p && p.kind === 'apikey') {
      // apiKey/baseUrl passam pelo MESMO sanitizador anti-injeção do dir: os dois viram
      // valor de variável de shell nos script builders (ver claudeAuthShellLines), o
      // mesmo motivo de segurança (aspa dupla, newline permitiriam escapar da atribuição).
      // Se uma delas foi FORNECIDA mas não passa na sanitização, o perfil inteiro é
      // rejeitado (tratamento agressivo pra segurança: não tenta "corrigir").
      const rawApiKey = p.apiKey;
      const rawBaseUrl = p.baseUrl;
      const apiKey = typeof rawApiKey === 'string' ? sanitizeClaudeDir(rawApiKey) : '';
      const baseUrl = typeof rawBaseUrl === 'string' ? sanitizeClaudeDir(rawBaseUrl) : '';
      // Rejeita se apiKey foi fornecida mas não passou, ou baseUrl foi fornecida mas não passou
      if ((typeof rawApiKey === 'string' && rawApiKey && !apiKey) ||
          (typeof rawBaseUrl === 'string' && rawBaseUrl && !baseUrl)) {
        return null;
      }
      const out = { id, label, kind: 'apikey', apiKey, baseUrl };
      // orçamento: campos opcionais. Número inválido (NaN, negativo) ou data fora do
      // formato YYYY-MM-DD vira ausente (sem teto), nunca lança e nunca aceita lixo.
      // Guard: só aceita número de verdade ou string não-vazia (rejeita array, boolean,
      // objeto, null, string vazia como lixo, mesmo que Number() conseguisse converter).
      const isNumericInput = v => (typeof v === 'number') || (typeof v === 'string' && v.trim() !== '');
      const daily = isNumericInput(p.budgetDaily) ? Number(p.budgetDaily) : NaN;
      if (Number.isFinite(daily) && daily >= 0) out.budgetDaily = daily;
      const total = isNumericInput(p.budgetTotal) ? Number(p.budgetTotal) : NaN;
      if (Number.isFinite(total) && total >= 0) out.budgetTotal = total;
      if (typeof p.budgetSince === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.budgetSince)) {
        out.budgetSince = p.budgetSince;
      }
      return out;
    }
    const dir = typeof (p && p.dir) === 'string' ? sanitizeClaudeDir(p.dir) : '';
    return { id, label, dir };
  }).filter(p => p && p.id && (p.kind === 'apikey' ? p.apiKey : p.dir));
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
  if (auth.kind === 'apikey' && auth.apiKey) {
    env.ANTHROPIC_API_KEY = auth.apiKey;
    if (auth.baseUrl) env.ANTHROPIC_BASE_URL = auth.baseUrl;
  } else if (auth.dir) {
    env.CLAUDE_CONFIG_DIR = auth.dir;
  }
}

// Linhas de script (.cmd no Windows, .command no macOS), SEM o separador de linha (quem
// chama junta com '\r\n' ou '\n' conforme o SO). Usado só por buildSessionScript,
// buildSessionScriptMac (sessão de terminal da fila), a sessão de LOGIN nunca chama isto,
// porque perfil apikey não tem fluxo de login (ver Engine.resolveAuthForLogin,
// openClaudeLoginSession, que barra apikey antes de chegar em qualquer script builder).
// Mesmo escaping de aspa simples que o dir já usa hoje no lado Mac (achado de auditoria
// adversarial documentado no CLAUDE.md: sem escapar, um valor com aspa simples escapava
// da atribuição shell e executava comando arbitrário).
function claudeAuthShellLines(auth, isWin) {
  const esc = s => s.replace(/'/g, "'\\''");
  if (auth.kind === 'apikey' && auth.apiKey) {
    const lines = [isWin ? `set "ANTHROPIC_API_KEY=${auth.apiKey}"` : `export ANTHROPIC_API_KEY='${esc(auth.apiKey)}'`];
    lines.push(auth.baseUrl
      ? (isWin ? `set "ANTHROPIC_BASE_URL=${auth.baseUrl}"` : `export ANTHROPIC_BASE_URL='${esc(auth.baseUrl)}'`)
      : (isWin ? 'rem sem base url propria' : '# sem base url propria'));
    return lines;
  }
  const dir = auth.dir || '';
  return [dir
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
const MODEL_ALIASES = ['best', 'opus', 'sonnet', 'haiku', 'fable'];
// escotilha pra modelo novo sem precisar de release do Farol: aceita nome completo
// (claude-opus-5) escrito a mao no config.json. So [a-z0-9-], zero metacaractere.
const MODEL_FULL_RE = /^claude-[a-z0-9]+(?:-[a-z0-9]+)*$/;
// max e ultracode ficam de fora: sao session-only (nem o settings.json do proprio CLI os
// aceita) e a revisao headless roda desacompanhada com timeout de 30 min, que e o pior
// lugar possivel pra eles.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];

// Devolve o valor limpo, ou null quando invalido (o chamador decide se descarta ou se
// mantem o anterior). '' e valido e significa "nao passa a flag".
function sanitizeModel(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return '';
  if (s.length > 60) return null;
  if (MODEL_ALIASES.includes(s)) return s;
  return MODEL_FULL_RE.test(s) ? s : null;
}

function sanitizeEffort(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return '';
  return EFFORT_LEVELS.includes(s) ? s : null;
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

module.exports = {
  parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
  applyClaudeAuthEnv, claudeAuthShellLines,
  MODEL_ALIASES, EFFORT_LEVELS, sanitizeModel, sanitizeEffort, effortForModel,
  sanitizeParallelReviews,
};
