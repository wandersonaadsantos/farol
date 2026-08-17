// Concern "Meus PRs" (Onda 2, colaborador): candidatos a reviewer, setar reviewers num
// clique, mergeabilidade real dos meus PRs, autoanálise (só pra mim, nunca posta) e o
// merge do meu próprio PR (única escrita no GitHub partindo daqui, com gates). Funções
// recebem o engine como ctx; a Engine mantém fachadas finas. Ver docs/QUALITY.md e CLAUDE.md.
import fs from 'node:fs';
import path from 'node:path';
import io from '../io.js';
import { writeJsonAtomic } from '../io.js';
import { SELF_FILE, HIDDEN_FILE, WORKSPACE, TEMPLATE_DIR } from '../paths.js';
import { isPermanentBranch } from '../format.js';

// Um byOrg inteiramente vazio é sintoma de falha total do gh (rede/token), não de
// org sem gente: quem chama `gh api orgs/X/members` autenticado enxerga a si mesmo,
// então org monitorada de verdade tem pelo menos 1 membro. Gate do cache do
// reviewerCandidates: falha total NÃO entra no cache de 1 hora (senão o seletor de
// reviewers fica vazio até o TTL vencer). Pura e exportada pra ser testável sem rede.
function temCandidatos(byOrg) {
  return Object.values(byOrg || {}).some(o => o && ((o.members || []).length > 0 || (o.teams || []).length > 0));
}

async function reviewerCandidates(engine) {
  const TTL = 60 * 60 * 1000;
  if (engine.reviewerCands && (Date.now() - engine.reviewerCands.at) < TTL) return engine.reviewerCands.data;
  if (!engine.token) await engine.refreshTokens();
  // POR ORGANIZAÇÃO: cada org lista só os SEUS membros e times, pra o seletor de
  // reviewers de um projeto não oferecer gente de outra org (não faz sentido pedir
  // review de quem não faz parte daquela org). Formato: { org: { members, teams } }.
  const byOrg = {};
  for (const owner of engine.allOwners()) {
    const accOwner = engine.accountForOwner(owner);
    if (!engine.tokenFor(accOwner)) continue; // org daquela conta fica fora do seletor no ciclo
    const env = engine.ghEnv(accOwner);
    const members = new Set(), teams = new Map();
    const rm = await io.run('gh', ['api', `orgs/${owner}/members`, '--paginate', '--jq', '.[].login'], { env });
    if (rm.ok) rm.stdout.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(l => members.add(l));
    // slug (id que o gh --add-reviewer usa) + nome (pra exibir); \t separa
    const rt = await io.run('gh', ['api', `orgs/${owner}/teams`, '--paginate', '--jq', '.[] | .slug + "\\t" + .name'], { env });
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
  if (temCandidatos(byOrg)) engine.reviewerCands = { at: Date.now(), data: byOrg };
  return byOrg;
}

// --- setar reviewers de um PR meu num clique (Meus PRs) --------------------
// Atribui o autor (voce) e pede review da lista configurada pro repo em
// config.projectReviewers, sem confirmacao. Aceita pessoas e times (org/time).
async function setReviewers(engine, url) {
  if (!url) return { ok: false, error: 'sem PR' };
  if (!engine.token) await engine.refreshTokens();
  const m = String(url).match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/i);
  if (!m) return { ok: false, error: 'não reconheci a URL do PR' };
  const repo = m[1];
  const key = `${repo}#${m[2]}`;
  // conta dona deste PR (pela org do repo): token e assignee corretos
  const acc = engine.accountForOwner(repo.split('/')[0]);
  if (!acc || !engine.tokenFor(acc)) {
    engine.emit('toast', { kind: 'error', text: `Conta ${acc || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
    return { ok: false, error: 'gh sem token' };
  }
  const env = engine.ghEnv(acc);
  const me = (acc || '').toLowerCase();
  const raw = engine.reviewersForRepo(repo);
  // nao da pra pedir review de si mesmo; o autor entra como assignee, nao reviewer
  const reviewers = raw.map(String).map(s => s.trim()).filter(r => r && r.toLowerCase() !== me);
  if (!reviewers.length) {
    engine.emit('toast', { kind: 'error', text: `Nenhum reviewer configurado pra ${repo} (aba Sistema > Reviewers por projeto).` });
    return { ok: false, error: 'sem reviewers configurados' };
  }
  // 1) me atribui
  const asg = await io.run('gh', ['pr', 'edit', url, '--add-assignee', acc], { env });
  if (!asg.ok) engine.log('WARN', `não consegui me atribuir em ${key}: ${asg.stderr.trim().slice(0, 200)}`);
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
    const rv = await io.run('gh', ['pr', 'edit', url, '--add-reviewer', person], { env });
    if (rv.ok) okd.push(person);
    else { failed.push(person); engine.log('WARN', `reviewer ${person} em ${key}: ${(rv.stderr || rv.stdout || '').trim().slice(0, 150)}`); }
  }
  if (skipped.length) engine.log('WARN', `reviewers ignorados em ${key} (time enterprise, não pedível): ${skipped.join(', ')}`);
  if (!okd.length) {
    const why = skipped.length ? ` (times enterprise não podem ser reviewer: ${skipped.join(', ')})` : ` Confira os handles em Sistema (falharam: ${failed.join(', ')}).`;
    engine.emit('toast', { kind: 'error', text: `Não consegui setar reviewer em ${key}.${why}` });
    return { ok: false, error: 'nenhum reviewer válido', failed, skipped };
  }
  const asgNote = asg.ok ? '' : ' (não consegui te atribuir, confira no GitHub)';
  const notEntered = [...failed, ...skipped];
  const failNote = notEntered.length ? ` Não entraram: ${notEntered.join(', ')}${skipped.length ? ' (time enterprise não pode ser reviewer)' : ''}.` : '';
  engine.emit('toast', { kind: notEntered.length ? 'info' : 'ok', text: `👥 ${key}: review pedido de ${okd.join(', ')} e você atribuído${asgNote}.${failNote}` });
  return { ok: true, reviewers: okd, failed, skipped };
}

// --- autoanalise: revisa um PR MEU so pra mim, nunca posta nada -------------
function saveSelfAnalyses(engine) {
  try { writeJsonAtomic(SELF_FILE, engine.selfAnalyses); }
  catch (err) { engine.log('ERROR', `salvar self-analyses.json: ${err.message}`); }
}

function clearSelfAnalysis(engine, key) {
  if (engine.selfAnalyses[key]) { delete engine.selfAnalyses[key]; engine.saveSelfAnalyses(); engine.pushState(); }
  return { ok: true };
}

// --- ocultar um PR de "Meus PRs" -------------------------------------------
// Motivacao real: PR pessoal antigo (experimento que nunca vai mergear) ocupa a aba
// pra sempre. O botao "Ocultar" que existia antes some so com a AUTOANALISE
// (clearSelfAnalysis), nunca com o PR, e vivia sendo confundido com isso.
//
// Ocultar NAO e "ignorar a realidade pra sempre": guardamos o updatedAt do PR no
// instante em que ocultou, e o reconcileHiddenPRs traz o PR de volta sozinho quando
// esse carimbo muda (atividade nova). Nada e filtrado no engine: myPRs continua
// completo e quem esconde e a UI, que tambem precisa oferecer "mostrar os ocultos".
function saveHiddenPRs(engine) {
  try { writeJsonAtomic(HIDDEN_FILE, engine.hiddenPRs); }
  catch (err) { engine.log('ERROR', `salvar hidden-prs.json: ${err.message}`); }
}

function hidePR(engine, key) {
  key = String(key || '');
  if (!key) return { ok: false, error: 'sem PR pra ocultar' };
  const pr = (engine.myPRs || []).find(p => p && p.key === key);
  // PR fora da lista (fechou entre o render e o clique, ou chave digitada): guarda
  // updatedAt null. Sem base de comparacao, o retorno automatico nao dispara pra ele.
  engine.hiddenPRs[key] = { at: new Date().toISOString(), updatedAt: (pr && pr.updatedAt) || null };
  saveHiddenPRs(engine);
  engine.pushState();
  return { ok: true };
}

function unhidePR(engine, key) {
  key = String(key || '');
  if (engine.hiddenPRs[key]) { delete engine.hiddenPRs[key]; saveHiddenPRs(engine); engine.pushState(); }
  return { ok: true };
}

// Reconcilia os ocultos com a realidade. Chamado pelo check() DEPOIS de montar
// this.myPRs. `okAccounts` e o conjunto de logins (minusculos) cujas buscas de PRs
// meus FUNCIONARAM neste ciclo, ou null quando nenhuma funcionou. E o mesmo sinal
// que o check() ja usa, PR a PR, pra decidir o que substituiu e o que preservou.
//
// Duas regras, e a segunda e a sutil:
//  1) chave ainda na lista com updatedAt DIFERENTE do guardado = o PR recebeu
//     atividade nova, entao ele volta a aparecer sozinho. Vale sempre, independente
//     do `okAccounts`: aqui ha PROVA (dois carimbos diferentes). Entrada guardada com
//     updatedAt null nunca volta por aqui (nao havia base de comparacao: qualquer
//     valor atual pareceria "diferente" e o oculto duraria um ciclo so).
//  2) chave que sumiu da lista = o PR fechou/mergeou e a entrada virou lixo, mas SO
//     limpamos quando a CONTA DONA daquela chave (pela org do repo) esta em
//     `okAccounts`. E por conta, e nao um booleano global, porque com varias contas
//     a busca de UMA pode cair enquanto a outra responde: pra chave da conta caida,
//     myPRs so tem o que ficou preservado do ciclo anterior (ou nada, logo apos o
//     boot) e "sumiu da lista" nao prova nada. Limpar ali faria a queda de rede de
//     uma conta desocultar TODOS os PRs dela de uma vez, justamente no ciclo em que
//     o usuario nao tem como saber o que aconteceu.
function reconcileHiddenPRs(engine, okAccounts) {
  const abertos = new Map((engine.myPRs || []).filter(p => p && p.key).map(p => [p.key, p]));
  let mudou = false;
  for (const [key, entry] of Object.entries(engine.hiddenPRs)) {
    const pr = abertos.get(key);
    if (pr) {
      if (entry && entry.updatedAt && String(pr.updatedAt) !== String(entry.updatedAt)) {
        delete engine.hiddenPRs[key];
        mudou = true;
      }
      continue;
    }
    if (okAccounts && okAccounts.has(String(engine.accountForOwner(key.split('/')[0]) || '').toLowerCase())) {
      delete engine.hiddenPRs[key]; mudou = true;
    }
  }
  if (mudou) saveHiddenPRs(engine);
  return mudou;
}

// Le a mergeabilidade REAL de um PR no GitHub (mergeable + mergeStateStatus).
// E o que diz se o Merge e possivel de fato: CLEAN/UNSTABLE = mergeia agora;
// BLOCKED = protecao exige requisitos (auto/admin); DIRTY = conflito; BEHIND =
// atras da base; DRAFT = rascunho. Devolve null se nao deu pra ler.
async function fetchMergeState(engine, url) {
  const m = String(url).match(/github\.com\/([^/]+)\//i);
  const acc = engine.accountForOwner(m && m[1]);
  if (!engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['pr', 'view', url, '--json', 'mergeable,mergeStateStatus,isDraft,state,baseRefName'], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.stdout || '{}');
    // baseRefName alimenta o fallback do gate de ruleset em refreshMergeStates
    // (pr.base pode ainda nao ter sido enriquecido quando o PR acabou de ser analisado)
    return { mergeable: j.mergeable || 'UNKNOWN', status: j.mergeStateStatus || 'UNKNOWN', isDraft: !!j.isDraft, state: j.state || '', baseRefName: j.baseRefName || '', at: Date.now() };
  } catch { return null; }
}

// Anexa a branch de origem/destino em cada "Meu PR" (o gh search prs nao traz
// branch; so gh pr view). Cacheia por PR pra nao chamar gh toda hora, mas com
// TTL: a head e imutavel, porem a BASE pode ser retargetada pela UI/API do
// GitHub num PR aberto, entao o cache expira e rebusca (retarget aparece em ate
// ~30min). Chave que fechou sai do cache.
async function enrichMyPRBranches(engine) {
  // uma chamada gh por PR meu: branch de origem/destino (o card mostra o de/para)
  // + o SHA do head. O SHA e buscado FRESCO a cada ciclo (muda a cada push, sem
  // cache) e serve pra invalidar a autoanalise quando entra commit novo: se o
  // head mudou desde a analise, a analise vira desatualizada e e descartada, o
  // card volta a "nao analisado" (mostrar veredito velho iludiria). Buscar
  // fresco tambem cobre retarget da base sem depender de TTL.
  let pruned = false;
  for (const pr of (engine.myPRs || [])) {
    const acc = engine.accountForPr(pr);
    if (!engine.tokenFor(acc)) continue; // conta sem token neste ciclo: PR fica sem branch info
    const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'headRefName,baseRefName,headRefOid'], { env: engine.ghEnv(acc) });
    if (!r.ok) continue;
    let j; try { j = JSON.parse(r.stdout || '{}'); } catch { continue; }
    pr.head = j.headRefName || ''; pr.base = j.baseRefName || ''; pr.headSha = j.headRefOid || '';
    const a = engine.selfAnalyses[pr.key];
    if (a && pr.headSha && (!a.headSha || a.headSha !== pr.headSha)) {
      delete engine.selfAnalyses[pr.key];
      delete engine.mergeStates[pr.key];
      engine.log('WARN', a.headSha
        ? `autoanálise de ${pr.key} descartada: PR mudou (commit novo)`
        : `autoanálise de ${pr.key} descartada: análise sem SHA registrado (não dá pra provar que vale pro commit atual)`);
      pruned = true;
    }
  }
  if (pruned) engine.saveSelfAnalyses();
}

// O repo tem "Allow auto-merge" ligado? Sem isso, o botao Auto-merge nao adianta
// (o gh recusa com enablePullRequestAutoMerge). null = nao deu pra saber.
async function fetchAutoMergeAllowed(engine, repo) {
  const acc = engine.accountForOwner(String(repo).split('/')[0]);
  if (!engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['api', `repos/${repo}`, '--jq', '.allow_auto_merge'], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  return String(r.stdout).trim() === 'true';
}

// A branch de destino tem REPOSITORY RULESET exigindo revisao/checks? Se sim, o
// --admin NAO fura (diferente da protecao classica), entao o UI nao deve oferecer
// "Merge admin". Cache por repo@base (ruleset muda pouco). null = nao deu pra saber.
async function fetchRuleBlocked(engine, repo, base) {
  if (!repo || !base) return null;
  const cacheKey = `${repo}@${base}`;
  const c = engine.ruleBlockCache[cacheKey];
  if (c && (Date.now() - c.at) < 30 * 60 * 1000) return c.blocked;
  const acc = engine.accountForOwner(String(repo).split('/')[0]);
  if (!engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['api', `repos/${repo}/rules/branches/${base}`, '--jq', '[.[].type]'], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  let blocked = null;
  try {
    const types = JSON.parse(r.stdout || '[]');
    blocked = types.some(t => ['pull_request', 'required_status_checks', 'required_signatures', 'required_deployments'].includes(t));
  } catch { blocked = null; }
  if (blocked !== null) engine.ruleBlockCache[cacheKey] = { blocked, at: Date.now() };
  return blocked;
}

// Atualiza a mergeabilidade só dos PRs que interessam pro botao Merge: meus,
// com autoanalise aprovavel e fora da lista bloqueada. Mantem o custo baixo
// (poucas chamadas gh, auto-merge por repo em cache) e o botao honesto: so
// aparece quando da pra mergear.
async function refreshMergeStates(engine) {
  const iniciado = Date.now();
  const blocked = (engine.config.mergeBlockedRepos || []).map(r => String(r).toLowerCase());
  const targets = (engine.myPRs || []).filter(pr => {
    const a = engine.selfAnalyses[pr.key];
    return a && a.approvable === true && !blocked.includes(String(pr.repo || '').toLowerCase());
  });
  const next = {};
  const autoByRepo = new Map();
  for (const pr of targets) {
    const ms = await engine.fetchMergeState(pr.url);
    if (!ms) continue;
    const repo = pr.repo || (pr.key || '').split('#')[0];
    if (!autoByRepo.has(repo)) autoByRepo.set(repo, await engine.fetchAutoMergeAllowed(repo));
    ms.autoAllowed = autoByRepo.get(repo);
    // so quando esta BLOCKED (quando auto/admin apareceriam) vale checar o ruleset:
    // se a base tem ruleset bloqueante, o --admin nao fura, entao esconde o admin.
    if (ms.status === 'BLOCKED') {
      const rb = await engine.fetchRuleBlocked(repo, pr.base || ms.baseRefName);
      ms.adminBlocked = rb === true || !!engine.adminBlockedRepos[repo];
    }
    next[pr.key] = ms;
  }
  // reconcilia em vez de trocar por atacado: runSelfAnalysis grava
  // engine.mergeStates[key] enquanto este loop espera os gh (escrita concorrente)
  // e a troca total engolia a entrada recém-gravada até o próximo polling.
  // Entrada carimbada de "iniciado" pra cá é mais fresca que o snapshot deste
  // ciclo e permanece; o resto segue a regra de sempre (só alvo confirmado fica).
  for (const [k, v] of Object.entries(engine.mergeStates)) {
    if (!v || Number(v.at || 0) < iniciado) continue;
    if (!next[k] || Number(v.at || 0) > Number(next[k].at || 0)) next[k] = v;
  }
  engine.mergeStates = next;
}

// Recalcula quais PRs que EU revisei ganharam commit novo depois da minha review.
// Só pros PRs abertos do panorama que eu revisei (aprovei/pedi mudanças via Farol,
// ou o GitHub marcou como revisado por mim): poucos, então o custo é limitado.
async function refreshStaleStates(engine) {
  const acts = engine.reviewActions();
  const targets = (engine.panorama || []).filter(pr => {
    const a = acts[pr.key];
    return pr.reviewedByMe || (a && (a.kind === 'approve' || a.kind === 'request_changes'));
  });
  // dois mapas do MESMO passe: staleStates segue booleano (contrato da UI, o chip
  // "Re-revisar" no panorama), staleInfo carrega head + estado do último review meu
  // pro gate de re-revisão automática (reReviewTargets em review.js). Não fundir:
  // mudar o shape do staleStates quebraria a UI por um dado que só o engine consome.
  const nextBool = {};
  const nextInfo = {};
  for (const pr of targets) {
    let info;
    try { info = await engine.staleForReview(pr); }
    catch { info = { stale: false, head: '', lastState: '' }; }
    nextBool[pr.key] = !!(info && info.stale);
    nextInfo[pr.key] = info || { stale: false, head: '', lastState: '' };
  }
  engine.staleStates = nextBool;
  engine.staleInfo = nextInfo;
}

// Entrou commit novo depois da SUA última review (approve/changes) neste PR?
// Devolve { stale, head, lastState }: head é o sha atual do PR e lastState o estado
// do último review meu que valeu (APPROVED/CHANGES_REQUESTED), pro relançamento
// automático saber SE relança (só pedido de mudanças) e ancorar POR QUAL head.
// Vem da MESMA chamada gh que já decidia o stale: a re-revisão não custa IO extra.
// Best-effort: qualquer incerteza (rede, sem commit registrado na review) devolve
// stale false, pra NUNCA reintroduzir o "Re-revisar" (nem relançar) num PR estável.
const STALE_INDETERMINADO = { stale: false, head: '', lastState: '' };
async function staleForReview(engine, pr) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = engine.accountForPr(pr);
  const me = (acc || '').toLowerCase();
  if (!repo || !number || !me) return STALE_INDETERMINADO;
  if (!engine.tokenFor(acc)) return STALE_INDETERMINADO; // incerteza NUNCA reativa o Re-revisar
  const env = engine.ghEnv(acc);
  const headR = await io.run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env });
  if (!headR.ok) return STALE_INDETERMINADO;
  const head = (headR.stdout || '').trim();
  // minha última review que valeu como aprovação ou pedido de mudança: o commit
  // dela dá o stale, o estado dela dá o tipo do round aberto
  const revR = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
    '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED")] | sort_by(.submitted_at) | last // {} | {state: (.state // ""), commit: (.commit_id // "")}`], { env });
  if (!revR.ok) return STALE_INDETERMINADO;
  let rev;
  try { rev = JSON.parse(revR.stdout || '{}'); } catch { return STALE_INDETERMINADO; }
  const revSha = String((rev && rev.commit) || '');
  if (!head || !revSha) return STALE_INDETERMINADO;
  return { stale: head !== revSha, head, lastState: String((rev && rev.state) || '') };
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
async function mergeSelfPR(engine, url, opts = {}) {
  const mode = opts.mode === 'auto' ? 'auto' : opts.mode === 'admin' ? 'admin' : 'normal';
  if (!url) return { ok: false, error: 'sem PR para mergear' };
  if (!engine.token) await engine.refreshTokens();
  const m = String(url).match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/i);
  if (!m) return { ok: false, error: 'não reconheci a URL do PR' };
  const repo = m[1];
  const number = parseInt(m[2], 10);
  const key = `${repo}#${number}`;

  // G19: double-click disparava dois merges; o segundo virava toast vermelho e
  // ERROR no log logo depois do sucesso do primeiro
  if (!engine.mergeInFlight) engine.mergeInFlight = new Set();
  if (engine.mergeInFlight.has(key)) return { ok: false, error: 'merge já em andamento' };
  engine.mergeInFlight.add(key);
  try {

    // conta dona deste PR (pela org): token e identidade de autor corretos
    const acc = engine.accountForOwner(repo.split('/')[0]);
    const me = (acc || '').toLowerCase();
    if (!me) return { ok: false, error: 'conta do GitHub não configurada' };
    if (!engine.tokenFor(acc)) {
      engine.emit('toast', { kind: 'error', text: `Conta ${acc || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
      return { ok: false, error: 'gh sem token' };
    }
    const env = engine.ghEnv(acc);

    // gate 1: so mergeia o que a MINHA autoanalise marcou como aprovavel
    const analysis = engine.selfAnalyses[key];
    if (!analysis || analysis.approvable !== true) {
      return { ok: false, error: 'só dá pra mergear quando sua autoanálise marca o PR como aprovável' };
    }

    // gate 2: lista configuravel de repos bloqueados (regras de review do time)
    const blocked = (engine.config.mergeBlockedRepos || []).map(r => String(r).toLowerCase());
    if (blocked.includes(repo.toLowerCase())) {
      engine.emit('toast', { kind: 'error', text: `Merge de ${repo} está bloqueado pela sua lista (aba Sistema).` });
      return { ok: false, error: 'repo bloqueado para merge' };
    }

    // estado FRESCO do PR (nunca decidir por dado velho da tela)
    const info = await io.run('gh', ['pr', 'view', url, '--json',
      'state,isDraft,mergeable,author,headRefOid,headRefName,baseRefName,title'], { env });
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

    // G3: o selo "aprovável" fala de UM estado do PR. Se entrou commit depois da
    // análise, o selo não vale pro que vai ser mergeado (mesma doutrina do dedup
    // por round). Análise antiga sem sha registrado não bloqueia (sem base de
    // comparação), igual ao enrichMyPRBranches.
    if (analysis.headSha && pr.headRefOid && analysis.headSha !== pr.headRefOid) {
      return { ok: false, error: 'o PR recebeu commit depois da sua análise; re-analise antes de mergear.' };
    }

    // 1) garantir que estou atribuido; se nao estiver, atribui
    const asg = await io.run('gh', ['pr', 'edit', url, '--add-assignee', acc], { env });
    if (!asg.ok) engine.log('WARN', `não consegui me atribuir em ${key}: ${asg.stderr.trim().slice(0, 200)}`);

    // 2) merge commit (coerente com o fluxo, sem squash/rebase); deleta a branch
    //    de origem SO se for descartavel (nunca develop/release/main/...).
    const canDelete = !isPermanentBranch(pr.headRefName);
    const args = ['pr', 'merge', url, '--merge'];
    if (mode === 'auto') args.push('--auto');
    if (mode === 'admin') args.push('--admin');
    if (canDelete) args.push('--delete-branch');
    const mg = await io.run('gh', args, { env });
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
      engine.log(policyBlock || autoUnavailable || ruleBlock ? 'WARN' : 'ERROR', `merge de ${key} (${mode}) falhou: ${raw}`);
      if (autoUnavailable) {
        const nice = `Auto-merge não está habilitado em ${repo}. Ligue "Allow auto-merge" nas settings do repo, ou use "Merge (admin)" se você for admin.`;
        engine.emit('toast', { kind: 'error', text: `${key}: ${nice}` });
        return { ok: false, blocked: 'autoUnavailable', error: nice };
      }
      if (ruleBlock) {
        // marca o repo: o UI para de oferecer o Merge (admin), que nao resolve aqui
        engine.adminBlockedRepos = engine.adminBlockedRepos || {};
        engine.adminBlockedRepos[repo] = true;
        const nice = `Merge admin não fura o ruleset de ${repo} sem bypass. Precisa de uma aprovação (ou um bypass no ruleset).`;
        engine.emit('toast', { kind: 'error', text: `${key}: ${nice}` });
        return { ok: false, blocked: 'rule', error: nice };
      }
      if (!policyBlock) engine.emit('toast', { kind: 'error', text: `Merge de ${key} falhou: ${raw}` });
      return { ok: false, blocked: policyBlock ? 'policy' : undefined, error: raw };
    }

    const head = pr.headRefName || '?', base = pr.baseRefName || '?';
    const asgNote = asg.ok ? '' : ' (não consegui te atribuir, confira no GitHub).';

    // auto-merge: o PR NAO foi mergeado ainda (o GitHub mergeia quando os
    // requisitos passarem). Nao limpa nada; o proximo polling remove quando fechar.
    if (mode === 'auto') {
      engine.emit('toast', { kind: 'ok', text: `⏳ Auto-merge ativado em ${key}. O GitHub mergeia sozinho quando os requisitos passarem.${asgNote}` });
      return { ok: true, auto: true };
    }

    // normal/admin: mergeou agora. Limpa: o PR foi fechado, sai de Meus PRs e da autoanalise.
    engine.myPRs = engine.myPRs.filter(p => p.key !== key);
    if (engine.selfAnalyses[key]) { delete engine.selfAnalyses[key]; engine.saveSelfAnalyses(); }
    engine.pushState();

    const branchNote = canDelete ? ` Branch ${head} deletada.` : ` Branch ${head} preservada (é do fluxo).`;
    const adminNote = mode === 'admin' ? ' (via admin, proteção bypassada)' : '';
    engine.emit('toast', { kind: 'ok', text: `✅ ${key} mergeado${adminNote} (${head}→${base}).${branchNote}${asgNote}` });
    return { ok: true, head, base, deletedBranch: canDelete, admin: mode === 'admin' };
  } finally {
    engine.mergeInFlight.delete(key);
  }
}

function selfPromptFor(engine, url) {
  const candidates = [
    path.join(WORKSPACE, 'prompts', 'self-review.md'),
    path.join(TEMPLATE_DIR, 'prompts', 'self-review.md')
  ];
  for (const f of candidates) {
    try { return fs.readFileSync(f, 'utf8').replaceAll('{{URL}}', url); } catch { }
  }
  throw new Error('template prompts/self-review.md não encontrado');
}

function parseSelfResult(engine, raw) {
  const text = engine.parseEnvelope(raw);
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

async function launchSelfAnalysis(engine, url) {
  if (!url) return { ok: false, error: 'sem PR para analisar' };
  const found = engine.myPRs.find(p => p.url === url) || engine.prFromUrl(url);
  if (!found) return { ok: false, error: 'não reconheci esse PR' };
  const pr = { ...found, account: engine.accountForPr(found), kind: 'self' };
  // gate pela conta DONA do PR, não pela primária (M10): é ela que roda a sessão e o gh
  if (!engine.tokenFor(pr.account)) await engine.refreshTokens();
  if (!engine.tokenFor(pr.account)) {
    engine.emit('toast', { kind: 'error', text: `Conta ${pr.account || '(nenhuma)'} não autenticada no gh. Rode: gh auth login` });
    return { ok: false, error: 'gh sem token' };
  }
  // ja tem uma autoanalise deste PR rodando ou na fila? nao duplica
  const busy = [...engine.activeReviews.values()].some(s => s.mode === 'self' && (s.keys || []).includes(pr.key)) ||
    engine.headlessQueue.some(p => p.kind === 'self' && p.key === pr.key);
  if (busy) return { ok: false, error: 'essa autoanálise já está em andamento' };
  engine.headlessQueue.push(pr);
  engine.processHeadless();
  engine.pushState();
  engine.emit('toast', { kind: 'info', text: `Analisando ${pr.key} pra você. Nada é postado, o resultado fica na tela.` });
  return { ok: true };
}

// Cancela a autoanálise de um PR PELO KEY (contrato com o botão Cancelar da UI).
// Por key, não por session id: no momento do clique o item pode estar só na
// headlessQueue, e o id s<seq> só nasce quando o escalonador puxa (runSelfAnalysis).
// Rodando, delega pro cancelSession, e o toast de "cancelada" vem do catch do
// runOneHeadless (err.cancelled), não daqui, pra não avisar duas vezes.
function cancelSelfAnalysis(engine, key) {
  key = String(key || '');
  if (!key) return { ok: false, error: 'sem PR pra cancelar' };
  const idx = engine.headlessQueue.findIndex(p => p.kind === 'self' && p.key === key);
  if (idx >= 0) {
    engine.headlessQueue.splice(idx, 1);
    engine.pushState();
    engine.emit('toast', { kind: 'info', text: `Autoanálise de ${key} cancelada (ainda estava na fila).` });
    return { ok: true };
  }
  const sess = [...engine.activeReviews.values()].find(s => s.mode === 'self' && (s.keys || []).includes(key));
  if (sess) return engine.cancelSession(sess.id);
  return { ok: false, error: 'essa autoanálise não está na fila nem rodando (já terminou?)' };
}

async function runSelfAnalysis(engine, pr) {
  const id = `s${++engine.sessionSeq}`;
  engine.activeReviews.set(id, {
    id, keys: [pr.key], label: `Autoanálise de ${pr.key}`, mode: 'self',
    startedAt: Date.now(), cancellable: true,
    pr: { key: pr.key, url: pr.url, title: pr.title || '' }
  });
  engine.activity.set(id, []);
  engine.pushState();
  try {
    // SHA ANTES da sessão: a análise vale pro commit que ela vai ler. Capturado
    // depois, um push no meio da análise carimbava SHA novo em análise velha
    // (TOCTOU) e a invalidação do enrichMyPRBranches nunca disparava. Conta sem
    // token não roda gh (ghEnv falha alto); cai no fallback pr.headSha.
    const accPr = engine.accountForPr(pr);
    const antesR = engine.tokenFor(accPr)
      ? await io.run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: engine.ghEnv(accPr) })
      : { ok: false };
    const shaAntes = ((antesR.ok ? antesR.stdout : '') || '').trim() || pr.headSha || '';
    const res = await engine.runClaudeStream(engine.selfPromptFor(pr.url), {
      id,
      account: accPr,
      ref: pr.key,
      onModel: (m) => engine.setSessionModel(id, m),
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
    });
    const result = engine.parseSelfResult(res.text);
    // re-checagem DEPOIS: se o head mudou durante a análise, o resultado descreve
    // um código que já não é a ponta da branch. Descarta com registro claro e sem
    // re-enfileirar (relançar é decisão do usuário). Custo: uma chamada gh a mais.
    const depoisR = engine.tokenFor(accPr)
      ? await io.run('gh', ['pr', 'view', pr.url, '--json', 'headRefOid', '--jq', '.headRefOid'], { env: engine.ghEnv(accPr) })
      : { ok: false };
    const shaDepois = ((depoisR.ok ? depoisR.stdout : '') || '').trim();
    if (shaAntes && shaDepois && shaAntes !== shaDepois) {
      engine.log('WARN', `autoanálise de ${pr.key} descartada: commit novo durante a análise (${shaAntes.slice(0, 7)} -> ${shaDepois.slice(0, 7)})`);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: entrou commit novo durante a autoanálise; rode de novo pra valer pro código atual.` });
      return;
    }
    // se as duas leituras falharem (rede), a análise fica sem carimbo (null) e a
    // regra do enrichMyPRBranches descarta no ciclo seguinte (não fica imortal).
    engine.selfAnalyses[pr.key] = {
      key: pr.key,
      pr: { repo: pr.repo, number: pr.number, url: pr.url, title: pr.title },
      at: Date.now(),
      headSha: shaAntes || null,
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
    engine.saveSelfAnalyses();
    // se aprovavel e fora de repo bloqueado, ja le a mergeabilidade real pro
    // botao Merge nascer honesto (sem esperar o proximo polling)
    const repoBlocked = (engine.config.mergeBlockedRepos || []).map(r => String(r).toLowerCase()).includes(String(pr.repo || '').toLowerCase());
    if (result.approvable && !repoBlocked) {
      const ms = await engine.fetchMergeState(pr.url);
      if (ms) { ms.autoAllowed = await engine.fetchAutoMergeAllowed(pr.repo || (pr.key || '').split('#')[0]); engine.mergeStates[pr.key] = ms; }
      else delete engine.mergeStates[pr.key];
    } else {
      delete engine.mergeStates[pr.key];
    }
    engine.emit('self-analysis-done', { key: pr.key });
    engine.emit('toast', {
      kind: result.approvable ? 'ok' : 'info',
      text: result.approvable
        ? `✅ ${pr.key}: aprovável. ${result.tips.length} dica(s) de melhoria.`
        : `🔧 ${pr.key}: precisa de ajuste (${result.blockers.length} ponto(s) antes de pedir review).`
    });
  } finally {
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.pushState();
  }
}

const selfprMod = {
  reviewerCandidates, temCandidatos, setReviewers, saveSelfAnalyses, clearSelfAnalysis,
  saveHiddenPRs, hidePR, unhidePR, reconcileHiddenPRs, fetchMergeState,
  enrichMyPRBranches, fetchAutoMergeAllowed, fetchRuleBlocked, refreshMergeStates,
  refreshStaleStates, staleForReview, mergeSelfPR, selfPromptFor, parseSelfResult,
  launchSelfAnalysis, cancelSelfAnalysis, runSelfAnalysis,
};
export default selfprMod;
export {
  reviewerCandidates, temCandidatos, setReviewers, saveSelfAnalyses, clearSelfAnalysis,
  saveHiddenPRs, hidePR, unhidePR, reconcileHiddenPRs, fetchMergeState,
  enrichMyPRBranches, fetchAutoMergeAllowed, fetchRuleBlocked, refreshMergeStates,
  refreshStaleStates, staleForReview, mergeSelfPR, selfPromptFor, parseSelfResult,
  launchSelfAnalysis, cancelSelfAnalysis, runSelfAnalysis,
};

