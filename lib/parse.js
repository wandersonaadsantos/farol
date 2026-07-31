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

// Caracteres sem uso legítimo em caminho de diretório e que quebram os scripts de sessão
// gerados (.cmd no Windows: aspa dupla + newline permitem injeção de comando; .command no
// mac: idem). Rejeita em vez de tentar escapar aqui — não existe path real que precise
// desses caracteres, e a Task de fix do .command (abaixo) trata aspa simples via escaping
// de verdade, não rejeição, por ser um caractere que PODE aparecer legitimamente (raro).
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

// Perfis nomeados de assinatura Claude: [{id,label,dir}]. Aceita array cru (de
// config.json, possivelmente malformado, ou do PATCH /api/settings) e devolve SEMPRE um
// array limpo: id/label como string trimada, dir sanitizado (sanitizeClaudeDir), entradas
// sem id ou sem dir válido descartadas. Não-array (string, número, objeto, null) vira [].
// Usado tanto no construtor da Engine (config.json pode estar malformado) quanto em
// updateSettings (patch do usuário) — mesma função, uma fonte de verdade só.
function normalizeClaudeProfiles(val) {
  if (!Array.isArray(val)) return [];
  return val.map(p => ({
    id: String((p && p.id) || '').trim(),
    label: String((p && p.label) || '').trim(),
    // dir precisa já vir como string: um objeto/array viraria "[object Object]"/
    // vírgulas via String() sem cair no filtro de aspas/newline do sanitizeClaudeDir,
    // um caminho sem sentido nenhum (achado de auditoria) — descarta direto.
    dir: typeof (p && p.dir) === 'string' ? sanitizeClaudeDir(p.dir) : ''
  })).filter(p => p.id && p.dir);
}

function normalizeClaudeProfileId(val) {
  return String(val || '').trim();
}

module.exports = {
  parseProjectReviewers, parseDefaultReviewers, parseAccounts, parsePeople, migrateSeniorityToPeople,
  sanitizeClaudeDir, normalizeClaudeProfiles, normalizeClaudeProfileId,
};
