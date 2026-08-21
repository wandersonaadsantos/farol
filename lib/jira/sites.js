// Modelo do site do Jira e a resolução org do GitHub -> site. Puro: sem rede,
// sem disco, sem process.env, pra dar teste direto e pra este arquivo poder ser
// importado tanto pelo servidor quanto pelo processo do MCP.
//
// Este arquivo é a BORDA do recurso, e é aqui que os dois valores perigosos são
// barrados. Quem consome (cache, compositor, cliente) tem defesa própria como
// segunda camada, mas quem diz não é aqui.

// O id vira NOME DE ARQUIVO (config do mcp e cache do card) e entra numa linha de
// shell: o runClaudeStream faz extraArgs.join(' ') (session.js:610) e entrega a
// linha a cmd.exe /d /s /c e a /bin/sh -lc. Por isso a defesa é allowlist de
// formato, nunca escaping, e é rejeitar em vez de sanear: sanear em silêncio faria
// dois ids distintos colidirem no mesmo arquivo. O id nascido na tela já casa.
const ID_SITE = /^[A-Za-z0-9_-]{1,64}$/;

// Origem pura e nada mais: userinfo, caminho, query ou fragmento mudam o destino
// REAL da requisição, e é pra esse destino que o header Basic com o token do
// Atlassian viaja. Validar só o esquema deixa https://a.atlassian.net@evil.com
// passar como se fosse o Jira da empresa (o host que o fetch usa é evil.com), e o
// rótulo da tela não denunciaria, porque ele corta o prefixo e mostra o resto.
// Só https: permitir http seria oferecer a credencial em texto claro na rede.
// u.host, não u.hostname: preserva porta explícita, que instância própria usa.
function normalizeBaseUrl(valor) {
  const s = String(valor || '').trim().replace(/\/+$/, '');
  let u;
  try { u = new URL(s); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password) return '';
  if (u.pathname !== '/' || u.search || u.hash) return '';
  return `https://${u.host}`;
}

function listaDeTexto(valor, transformar) {
  if (!Array.isArray(valor)) return [];
  const saida = [];
  for (const item of valor) {
    const t = transformar(String(item || '').trim());
    if (t && !saida.includes(t)) saida.push(t);
  }
  return saida;
}

function umSite(item, vistos) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').trim();
  const baseUrl = normalizeBaseUrl(item.baseUrl);
  if (!ID_SITE.test(id) || !baseUrl || vistos.has(id)) return null;
  vistos.add(id);
  return {
    id,
    label: String(item.label || '').trim() || baseUrl.replace('https://', ''),
    baseUrl,
    owners: listaDeTexto(item.owners, (s) => s.toLowerCase()),
    projectKeys: listaDeTexto(item.projectKeys, (s) => s.toUpperCase()),
  };
}

function parseJiraSites(raw) {
  if (!Array.isArray(raw)) return [];
  const vistos = new Set();
  const saida = [];
  for (const item of raw) {
    const site = umSite(item, vistos);
    if (site) saida.push(site);
  }
  return saida;
}

// Sem fallback de propósito: org sem site é card não verificável, nunca "tenta o
// site padrão". Ler o Jira de outra empresa e achar um card homônimo é a falha
// silenciosa que este recurso inteiro existe pra impedir.
function siteForOwner(sites, owner) {
  const alvo = String(owner || '').trim().toLowerCase();
  if (!alvo || !Array.isArray(sites)) return null;
  return sites.find((s) => s.owners.includes(alvo)) || null;
}

// Whitelist declarativa de saída: a tela recebe a existência da credencial, nunca
// o valor. O config.json inteiro trafega pra UI, então tudo que entra nele circula.
function maskJiraSites(sites, temCredencial) {
  if (!Array.isArray(sites)) return [];
  return sites.map((s) => ({
    id: s.id,
    label: s.label,
    baseUrl: s.baseUrl,
    owners: s.owners,
    projectKeys: s.projectKeys,
    hasCredential: !!temCredencial(s.id),
  }));
}

export default { parseJiraSites, siteForOwner, maskJiraSites };
export { parseJiraSites, siteForOwner, maskJiraSites };
