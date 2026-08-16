'use strict';
// Camada de consulta ao GitHub via gh (Onda 2, colaborador). O análogo dos "selectors"
// do lace: só leitura, zero tokens de IA, devolve estrutura normalizada. Funções recebem
// o engine como ctx (pra token/conta/cache); a Engine mantém fachadas finas. Ver docs/QUALITY.md.
const { run } = require('../io');
const { DELIVERIES_LIMIT } = require('../paths');

async function searchPRs(engine, extraArgs, user) {
  // conta pedida sem token: NÃO busca com outra identidade (o @me resolveria na conta
  // errada e o resultado pareceria válido, M11). Trata como falha de busca (null),
  // que o check() já preserva. A frase "sem token no gh" é contrato (retry transitório).
  if (!engine.tokenFor(user)) {
    engine.log('WARN', `gh search pulado (${user || 'primaria'} sem token no gh)`);
    return null;
  }
  const args = ['search', 'prs', ...extraArgs, '--state', 'open', '--limit', '100',
    '--json', 'url,title,isDraft,author,number,repository,updatedAt'];
  const r = await run('gh', args, { env: engine.ghEnv(user) });
  if (!r.ok) {
    engine.log('WARN', `gh search falhou (${user || 'primaria'}: ${extraArgs.join(' ')}): ${r.stderr.trim().slice(0, 300)}`);
    return null;
  }
  let items;
  try { items = JSON.parse(r.stdout || '[]'); } catch { return null; }
  // o gh corta no --limit sem avisar e, com best-match como ordenação, QUAIS 100
  // entram é imprevisível: um PR pedido a mim pode ficar fora do radar em silêncio.
  // O teto é da API de search (não dá pra subir), então pelo menos deixa rastro.
  // Medido nos itens CRUS (antes dos filtros): o corte aconteceu no gh, não aqui.
  // fetchDeliveries abaixo sinaliza o análogo no retorno (capped); aqui o retorno
  // fica intacto (4 chamadores no check()) e o sinal vai pro log.
  if (items.length >= 100) {
    engine.log('WARN', `gh search no teto do --limit 100 (${user || 'primaria'}: ${extraArgs.join(' ')}): pode haver PRs fora do radar`);
  }
  const acc = user || engine.primaryUser();
  const me = (acc || '').toLowerCase();
  // rascunhos ENTRAM no radar e na fila (pedido do Wanderson em 15/08/2026, fluxo
  // da empresa: PR nasce draft e o review precisa acontecer antes do ready). O
  // isDraft viaja no objeto pro selo "rascunho" na UI; o merge de rascunho segue
  // bloqueado no mergeSelfPR, que revalida pelo estado real na hora do clique.
  return items
    .filter(p => ((p.author && p.author.login) || '').toLowerCase() !== me)
    .map(p => ({
      key: `${p.repository.nameWithOwner}#${p.number}`,
      url: p.url,
      title: p.title,
      author: (p.author && p.author.login) || '',
      repo: p.repository.nameWithOwner,
      number: p.number,
      updatedAt: p.updatedAt,
      isDraft: !!p.isDraft,
      account: acc
    }));
}

// PRs abertos de AUTORIA minha (fonte da autoanalise). Diferente de searchPRs:
// nao filtra a mim (obvio) e MANTEM rascunhos (autoanalisar um draft antes de
// marcar ready e justamente o uso principal). So leitura, zero tokens de IA.
async function myAuthoredPRs(engine, user) {
  const acc = user || engine.primaryUser();
  const me = (acc || '').toLowerCase();
  if (!me) return null;
  if (!engine.tokenFor(user)) {
    engine.log('WARN', `gh search prs --author @me pulado (${acc} sem token no gh)`);
    return null;
  }
  const r = await run('gh', ['search', 'prs', '--author', '@me', '--state', 'open', '--limit', '50',
    '--json', 'url,title,isDraft,author,number,repository,updatedAt'], { env: engine.ghEnv(user) });
  if (!r.ok) {
    engine.log('WARN', `gh search prs --author @me (${acc}) falhou: ${r.stderr.trim().slice(0, 300)}`);
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
// Corte da janela em UTC COM HORA, ancorado na meia-noite LOCAL: dias=0 = hoje
// 00:00 local; senao o primeiro dos `dias` dias-calendario que o grafico desenha
// (hoje - (dias-1)). Era data seca (YYYY-MM-DD), que o GitHub corta em 00:00 UTC
// (21:00 locais da vespera em UTC-3): a janela ganhava 1 dia local INTEIRO + uma
// franja de 3h que os cartoes contavam e o grafico nunca desenhava (auditoria de
// 10/08/2026: 50 merges invisiveis numa janela de 30 dias, media inflada de 24,0
// pra 25,6, e "Hoje desde 00:00" contando merge de ontem as 21h52).
function deliveriesSince(engine, days) {
  const n = Math.max(0, parseInt(days, 10) || 0);
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (n === 0 ? 0 : n - 1));
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Busca os PRs mergeados nas orgs monitoradas dentro da janela, por conta (token
// dela), deduplicando por chave. So leitura: nao passa por gate, nao posta, nao
// escreve em state/. Cache com TTL por janela (entregas mudam devagar, nao entram
// no polling de 30s). partial = alguma busca falhou; capped = alguma org bateu o
// limite (a UI avisa; nada de corte silencioso).
async function fetchDeliveries(engine, days, owner) {
  days = [0, 7, 15, 30].includes(parseInt(days, 10)) ? parseInt(days, 10) : 7;
  // escopo por org: vazio ou 'all' = todas as orgs monitoradas; senao so a org
  // pedida, buscada com o token da conta dona (accountForOwner).
  const scope = String(owner || '').trim();
  const scoped = scope && scope.toLowerCase() !== 'all' ? scope : '';
  // o corte entra na CHAVE do cache: sem ele, o TTL de 5 min atravessava a virada
  // da meia-noite servindo a janela de ontem como se fosse a de hoje
  const since = engine.deliveriesSince(days);
  const cacheKey = `${days}:${scoped || 'all'}:${since}`;
  const TTL = 5 * 60 * 1000;
  const cached = engine.deliveriesCache[cacheKey];
  if (cached && (Date.now() - cached.at) < TTL) return cached.data;
  if (!engine.token) await engine.refreshTokens();
  // alvos: { user (conta dona), owner (org) }. Escopado = so a org pedida.
  const targets = scoped
    ? [{ user: engine.accountForOwner(scoped), owner: scoped }]
    : engine.accountList().flatMap(acc => acc.owners.map(o => ({ user: acc.user, owner: o })));
  const seen = new Set();
  const items = [];
  let partial = false, capped = false;
  for (const t of targets) {
    if (!engine.tokenFor(t.user)) {
      partial = true;
      engine.log('WARN', `entregas puladas (${t.user || 'primaria'} sem token no gh)`);
      continue;
    }
    // --sort updated (desc): quando a org passa do teto, o corte fica ~pelas mais
    // recentes; o default do gh search e "best match" (relevancia), que cortava um
    // subconjunto arbitrario da janela e furava o grafico em dias aleatorios
    const r = await run('gh', ['search', 'prs', `merged:>=${since}`, '--owner', t.owner,
      '--sort', 'updated', '--order', 'desc',
      '--limit', String(DELIVERIES_LIMIT), '--json', 'url,title,author,number,repository,closedAt'], { env: engine.ghEnv(t.user) });
    if (!r.ok) { partial = true; engine.log('WARN', `gh search entregas (${t.user}/${t.owner}): ${r.stderr.trim().slice(0, 200)}`); continue; }
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
  const data = { since, days, owner: scoped || 'all', items, capped, partial, limit: DELIVERIES_LIMIT };
  engine.deliveriesCache[cacheKey] = { at: Date.now(), data };
  return data;
}

// Estado atual do PR no GitHub (OPEN/CLOSED/MERGED). null = nao deu pra confirmar
// (sem token da conta ou falha de rede/gh): quem chama NUNCA trata null como "ainda
// aberto" nem como "mergeado", só como "sem prova ainda" (mesma regra de
// myReviewsWithTime em decision.js). Existe pra runOneHeadless e reconcilePending
// cancelarem revisão/pendência de PR que já foi mergeado por fora (outro revisor,
// merge manual, self-merge), em vez de postar review num PR fechado.
async function prState(engine, pr) {
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return null;
  const url = pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`;
  const r = await run('gh', ['pr', 'view', url, '--json', 'state'], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  try { return String(JSON.parse(r.stdout || '{}').state || '') || null; } catch { return null; }
}

// SHA do head atual do PR. '' = nao deu pra confirmar (sem token, rede, gh), e quem
// chama trata isso como "nao sei separar rodada" e degrada pro comportamento anterior,
// nunca como "head novo" (que faria repostar review a cada falha de rede).
// Existe pra dar NOCAO DE ROUND a quem precisa: o dedup de postagem compara este sha
// com o commit_id do review que eu ja postei, e o carimbo do checkpoint de verificacao
// sai daqui tambem (antes o runHeadlessReview montava a mesma chamada na mao).
async function headSha(engine, pr) {
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return '';
  const url = pr.url || `https://github.com/${pr.repo}/pull/${pr.number}`;
  const r = await run('gh', ['pr', 'view', url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: engine.ghEnv(acc) });
  if (!r.ok) return '';
  return String(r.stdout || '').trim();
}

// --- créditos: contribuidores do repositório do Farol (Sistema > Sobre) ------
// Fonte: a API de contributors do GitHub, no MESMO repo do auto-update
// (config.updateRepo), então a lista se mantém sozinha: colaborador novo que
// entrar no git aparece nos créditos sem release nem edição manual, e um fork
// mostra os créditos do próprio fork. Só leitura, best-effort: falha de rede
// mantém a última lista boa em memória em vez de esvaziar a seção.
const CONTRIB_TTL_MS = 24 * 60 * 60 * 1000;   // sucesso: revalida 1x por dia
const CONTRIB_RETRY_MS = 60 * 60 * 1000;      // falha: tenta de novo em 1h, não a cada ciclo
async function refreshContributors(engine) {
  const repo = (engine.config.updateRepo || '').trim();
  if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) return;
  if (engine.credits && engine.credits.repo === repo && (Date.now() - engine.credits.at) < CONTRIB_TTL_MS) return;
  if ((Date.now() - (engine.creditsTriedAt || 0)) < CONTRIB_RETRY_MS) return;
  const user = engine.primaryUser();
  // sem gh autenticado ainda: a UI explica e o próximo ciclo re-tenta (o carimbo de
  // backoff fica DEPOIS deste return de propósito: logar no gh não pode esperar 1h)
  if (!engine.tokenFor(user)) return;
  engine.creditsTriedAt = Date.now();
  const env = engine.ghEnv(user);
  const r = await run('gh', ['api', `repos/${repo}/contributors?per_page=100`], { env });
  if (!r.ok) {
    engine.log('WARN', `créditos: contributors de ${repo} falhou: ${r.stderr.trim().slice(0, 200)}`);
    return;
  }
  let list;
  try { list = JSON.parse(r.stdout || '[]'); } catch { return; }
  if (!Array.isArray(list)) return;
  const contributors = list
    .filter(c => c && c.login && String(c.type || '') !== 'Bot' && !/\[bot\]$/i.test(c.login))
    .map(c => ({ login: c.login, contributions: c.contributions | 0 }));
  // idealizador = dono do repo; nome de exibição é best-effort (login cobre se faltar)
  const owner = repo.split('/')[0];
  let ownerName = '';
  const ro = await run('gh', ['api', `users/${owner}`, '--jq', '.name // ""'], { env });
  if (ro.ok) ownerName = String(ro.stdout || '').trim();
  engine.credits = { at: Date.now(), repo, owner: { login: owner, name: ownerName }, contributors };
  engine.pushState();
}

module.exports = { searchPRs, myAuthoredPRs, deliveriesSince, fetchDeliveries, prState, headSha, refreshContributors };
