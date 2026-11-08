// A faixa de prontidão de um PR (07/11/2026): checks obrigatórios, reviewers e merge, lidos
// do GitHub sem abrir o PR. PURO: recebe o nó GraphQL do PR, a regra da branch e quem lê, e
// devolve o registro que vai ao snapshot em `prontidao[key]`. A tela (ui/pure/prontidao.js)
// só traduz o registro em pílulas e textos; a tabela de estados mora aqui.
//
// Spec: docs/superpowers/specs/2026-11-07-meus-prs-prontidao-design.md (tabela "Pílula").
// Tons: ok (resolvido), run (o GitHub está rodando), wait (espera alguém), fail (trava),
// none (não se aplica). A tela mapeia para --ok, --info, --accent, --danger e --muted.
//
// A pílula INFORMA; quem autoriza o botão Merge continua sendo a autoanálise elegível
// (canMergeSelfAnalysis). Nada daqui decide postagem nem merge.
import { ultimaRodadaPorNome, ehVeredictoDeReview, estadoDaRodada } from './checks-exigidos.js';

// O mesmo fragmento serve à busca dos meus PRs (meus-prs-base.js) e à leitura em lote dos PRs
// do Panorama e de Pra mim (prontidao-pr.js): um interpretador, uma forma de dado.
const FRAGMENTO_PRONTIDAO = `fragment Prontidao on PullRequest{
  number updatedAt isDraft mergeable mergeStateStatus reviewDecision baseRefName headRefName headRefOid
  author{login} repository{nameWithOwner}
  reviewRequests(first:20){nodes{requestedReviewer{__typename ... on User{login} ... on Team{slug}}}}
  latestReviews(first:20){nodes{author{login} state submittedAt commit{oid}}}
  commits(last:1){nodes{commit{statusCheckRollup{contexts(first:100){nodes{__typename
    ... on CheckRun{name status conclusion startedAt} ... on StatusContext{context state createdAt}}}}}}}
}`;

// review de ferramenta nunca conta como pessoa (mesma régua do skip-review.js para o acrity)
const LOGIN_DE_FERRAMENTA = /\[bot\]$|^acrity/i;
const MERGE_PRONTO = new Set(['CLEAN', 'UNSTABLE', 'HAS_HOOKS']);

function nos(conexao) { return Array.isArray(conexao && conexao.nodes) ? conexao.nodes.filter(Boolean) : []; }
function minusculo(s) { return String(s || '').toLowerCase(); }

// O rollup do último commit, no formato que ultimaRodadaPorNome entende (StatusContext não
// tem startedAt; o createdAt ocupa o lugar para "a rodada mais recente vence").
function rollupDoHead(no) {
  const commit = nos(no && no.commits)[0];
  const rollup = commit && commit.commit && commit.commit.statusCheckRollup;
  if (!rollup) return [];
  return nos(rollup.contexts).map(c => (c.__typename === 'StatusContext' ? { ...c, startedAt: c.createdAt } : c));
}

function tomDosChecks(lista) {
  const tem = estado => lista.some(c => c.estado === estado);
  if (tem('falhou')) return 'fail';
  if (tem('rodando')) return 'run';
  if (tem('ausente')) return 'wait';
  return 'ok';
}

// Checks obrigatórios no head: só os que a regra da branch exige, fora o veredito de bot de
// review (acrity/review), que o detalhe cita à parte. `exigidos` null = regra não legível.
function checksDaProntidao(no, exigidos) {
  const legivel = Array.isArray(exigidos);
  const nomes = legivel ? exigidos.map(String).filter(Boolean) : [];
  const foraDaConta = nomes.filter(ehVeredictoDeReview);
  const contados = nomes.filter(n => !ehVeredictoDeReview(n));
  if (!contados.length) {
    return { tom: 'none', total: 0, verdes: 0, lista: [], foraDaConta, semExigencia: true, regraLegivel: legivel };
  }
  const porNome = ultimaRodadaPorNome(rollupDoHead(no));
  const lista = contados.map(nome => {
    const c = porNome.get(nome);
    return { nome, estado: c ? estadoDaRodada(c) : 'ausente' };
  });
  return {
    tom: tomDosChecks(lista), total: lista.length, verdes: lista.filter(c => c.estado === 'verde').length,
    lista, foraDaConta, semExigencia: false, regraLegivel: true,
  };
}

// estado de uma pessoa: mudança pedida segura sempre (pedir de novo não derruba no GitHub);
// pedida de novo depois de revisar volta a "aguardando"; aprovação só conta no head
function estadoDoReviewer(review, pedido, head) {
  if (review && review.state === 'CHANGES_REQUESTED') return 'mudanca';
  if (pedido) return 'aguardando';
  if (!review) return 'aguardando';
  if (review.state === 'APPROVED') return review.commit && review.commit.oid === head ? 'aprovou' : 'aprovou-antigo';
  return 'comentou';
}

function listaDeReviewers(no, eu) {
  const head = (no && no.headRefOid) || '';
  const autor = minusculo(no && no.author && no.author.login);
  const pedidos = new Map();
  for (const r of nos(no && no.reviewRequests)) {
    const rr = r.requestedReviewer || {};
    const time = rr.__typename === 'Team';
    const quem = time ? rr.slug : rr.login;
    if (quem) pedidos.set(minusculo(quem), { quem, time });
  }
  const reviews = new Map();
  for (const r of nos(no && no.latestReviews)) {
    const login = r.author && r.author.login;
    if (!login || LOGIN_DE_FERRAMENTA.test(login) || minusculo(login) === autor) continue;
    if (r.state === 'PENDING' || r.state === 'DISMISSED') continue;
    reviews.set(minusculo(login), { login, review: r });
  }
  const chaves = [...new Set([...pedidos.keys(), ...reviews.keys()])];
  return chaves.map(k => {
    const p = pedidos.get(k), r = reviews.get(k);
    return {
      quem: (p && p.quem) || r.login, time: !!(p && p.time), voce: !!eu && k === minusculo(eu),
      estado: estadoDoReviewer(r && r.review, !!p, head),
    };
  });
}

// Tom dos reviewers. Com regra de ruleset legível, a conta é a de aprovações no head contra o
// exigido; sem ela (proteção clássica ou leitura que falhou), o reviewDecision do GitHub manda.
function tomDosReviewers(r, decisao) {
  if (r.mudancaPedida > 0) return 'fail';
  const aguardando = r.lista.some(x => x.estado === 'aguardando');
  if (r.exigidas === null) {
    if (decisao === 'APPROVED') return 'ok';
    if (decisao === 'REVIEW_REQUIRED') return 'wait';
    if (decisao === 'CHANGES_REQUESTED') return 'fail';
  } else if (r.exigidas > 0) {
    if (r.aprovadasNoHead < r.exigidas) return 'wait';
    return r.codeOwner && decisao === 'REVIEW_REQUIRED' ? 'wait' : 'ok';
  }
  if (aguardando) return 'wait';
  return r.aprovadasNoHead > 0 ? 'ok' : 'none';
}

function reviewersDaProntidao(no, regra, eu) {
  const lista = listaDeReviewers(no, eu);
  const decisao = (no && no.reviewDecision) || null;
  const temRegra = !!(regra && regra.legivel && regra.temRegraDeReview);
  const r = {
    lista, decisao,
    exigidas: temRegra ? Math.max(0, Number(regra.aprovacoes) || 0) : null,
    codeOwner: temRegra && regra.codeOwner === true,
    aprovadasNoHead: lista.filter(x => x.estado === 'aprovou').length,
    aprovadasAntigas: lista.filter(x => x.estado === 'aprovou-antigo').length,
    mudancaPedida: lista.filter(x => x.estado === 'mudanca').length,
    // proteção clássica não é legível pelo rules/branches: o GitHub exige algo que a regra não diz
    regraLegivel: temRegra || !decisao,
  };
  r.tom = tomDosReviewers(r, decisao);
  if (r.exigidas !== null) r.faltam = Math.max(0, r.exigidas - r.aprovadasNoHead);
  return r;
}

// Os motivos de um BLOCKED, na ordem em que a pílula fala: o que trava primeiro, depois quem
// falta aprovar, e por último o que só espera o GitHub terminar de rodar.
function motivosDoBloqueio(checks, reviewers) {
  const m = [];
  if (checks.tom === 'fail') m.push('check-falhando');
  if (reviewers.mudancaPedida > 0) m.push('mudanca-pedida');
  if (reviewers.tom === 'wait') m.push('falta-aprovacao');
  if (checks.tom === 'wait') m.push('check-ausente');
  if (checks.tom === 'run') m.push('esperando-checks');
  return m;
}

function tomDoBloqueio(motivos) {
  if (motivos.includes('check-falhando') || motivos.includes('mudanca-pedida')) return 'fail';
  if (motivos.includes('falta-aprovacao') || motivos.includes('check-ausente')) return 'wait';
  return motivos.includes('esperando-checks') ? 'run' : 'wait';
}

// A pílula Merge a partir do estado do merge do GitHub e das outras duas pílulas. Exportada
// para a projeção trocar o status pelo do refreshMergeStates quando ele for mais recente.
function mergeDaProntidao(ms, checks, reviewers) {
  const status = String((ms && ms.status) || 'UNKNOWN').toUpperCase();
  const mergeable = String((ms && ms.mergeable) || 'UNKNOWN').toUpperCase();
  const base = { status, mergeable, motivos: [] };
  if ((ms && ms.isDraft) || status === 'DRAFT') return { ...base, tom: 'none', motivo: 'rascunho' };
  if (mergeable === 'CONFLICTING' || status === 'DIRTY') return { ...base, tom: 'fail', motivo: 'conflito' };
  if (status === 'BEHIND') return { ...base, tom: 'wait', motivo: 'atras' };
  if (MERGE_PRONTO.has(status)) return { ...base, tom: 'ok', motivo: 'pronto' };
  if (status !== 'BLOCKED') return { ...base, tom: 'none', motivo: 'verificando' };
  const motivos = motivosDoBloqueio(checks, reviewers);
  return { ...base, tom: tomDoBloqueio(motivos), motivo: motivos[0] || 'bloqueado', motivos, faltam: reviewers.faltam };
}

// A regra da branch lida de `repos/{repo}/rules/branches/{base}` (lista de regras de ruleset
// com `type` e `parameters`): checks exigidos, aprovações exigidas e code owner. Resposta que
// não é lista vira null (não legível). Lista vazia é legível e não exige nada pelo ruleset.
function regraDaResposta(lista) {
  if (!Array.isArray(lista)) return null;
  const doTipo = tipo => lista.filter(r => r && r.type === tipo).map(r => r.parameters || {});
  const checks = doTipo('required_status_checks')
    .flatMap(p => (Array.isArray(p.required_status_checks) ? p.required_status_checks : []).map(c => c && c.context))
    .filter(Boolean);
  const prs = doTipo('pull_request');
  return {
    legivel: true, checks: [...new Set(checks)], temRegraDeReview: prs.length > 0,
    aprovacoes: prs.reduce((max, p) => Math.max(max, Number(p.required_approving_review_count) || 0), 0),
    codeOwner: prs.some(p => p.require_code_owner_review === true),
  };
}

// O registro inteiro. `ctx`: { exigidos (lista ou null), regra ({ legivel, temRegraDeReview,
// aprovacoes, codeOwner } ou null), eu (login de quem lê, para "falta você"), at }.
function interpretarProntidao(no, ctx = {}) {
  if (!no || typeof no !== 'object') return null;
  const checks = checksDaProntidao(no, ctx.exigidos === undefined ? null : ctx.exigidos);
  const reviewers = reviewersDaProntidao(no, ctx.regra || null, ctx.eu || '');
  const merge = mergeDaProntidao({ status: no.mergeStateStatus, mergeable: no.mergeable, isDraft: no.isDraft }, checks, reviewers);
  return {
    at: Number(ctx.at) || Date.now(), headSha: no.headRefOid || '', updatedAt: no.updatedAt || '',
    base: no.baseRefName || '', head: no.headRefName || '', checks, reviewers, merge,
  };
}

// Registro que ainda espera o GitHub (check rodando ou nunca reportado, merge em cálculo):
// relido no próximo ciclo mesmo sem o PR mudar, porque check que termina não muda o updatedAt.
function emTransicao(reg) {
  if (!reg) return true;
  return reg.checks.tom === 'run' || reg.checks.tom === 'wait' || reg.merge.tom === 'run' || reg.merge.motivo === 'verificando';
}

// O que vai ao snapshot. Quando o refreshMergeStates leu o merge DEPOIS do registro (a
// autoanálise grava no meio do ciclo), o estado mais recente vence, pelo `at`.
function projetarProntidao(prontidao, mergeStates) {
  const out = {};
  for (const [key, reg] of Object.entries(prontidao || {})) {
    const ms = (mergeStates || {})[key];
    if (!reg || !ms || !(Number(ms.at) > Number(reg.at))) { out[key] = reg; continue; }
    out[key] = { ...reg, merge: mergeDaProntidao(ms, reg.checks, reg.reviewers) };
  }
  return out;
}

const prontidaoEstado = { FRAGMENTO_PRONTIDAO, regraDaResposta, interpretarProntidao, mergeDaProntidao, emTransicao, projetarProntidao };
export default prontidaoEstado;
export { FRAGMENTO_PRONTIDAO, regraDaResposta, interpretarProntidao, mergeDaProntidao, emTransicao, projetarProntidao };
