'use strict';
// Concern de decisão + postagem no GitHub (Onda 2, colaborador). Registro das decisões
// (pendentes/histórico), gates de auto-aprovar/auto-reprovar, dedup de postagem, o post
// em si e a memória do time. Funções recebem o engine como ctx; a Engine mantém fachadas
// finas que delegam. Gate de postagem intacto (ver CLAUDE.md, invariante 4). Ver docs/QUALITY.md.
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('../paths');
const { run } = require('../io');

function recordDecision(engine, pr, result, extra) {
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
  if (item.status === 'pending') engine.decisions.pending.unshift(item);
  else engine.resolveIntoHistory(item);
  engine.saveDecisions();
  return item;
}

function resolveIntoHistory(engine, item) {
  item.resolvedAt = Date.now();
  // historico nao precisa carregar relatorio e payloads inteiros
  const slim = { ...item, reportMarkdown: item.reportMarkdown, payloads: undefined, memory: undefined };
  engine.decisions.resolved.unshift(slim);
  // histórico guardado (cada item já é "slim": sem payloads/memory). Mais generoso
  // pra "Revisões recentes" não perder o que você fez faz tempo; a tela recebe um
  // recorte menor (ver snapshot). 200 é barato em disco e no reviewActions().
  engine.decisions.resolved = engine.decisions.resolved.slice(0, 200);
}

// ultima acao do Farol por PR, pro indicador do panorama: o que foi postado
// (aprovado, mudancas pedidas, comentado) ou "pendente" quando esta na sua mesa.
// "pulado" nao marca nada: nao foi postado review.
function reviewActions(engine) {
  const map = {};
  for (const d of [...engine.decisions.resolved].reverse()) {
    if (d.status === 'auto_approved') map[d.key] = { kind: 'approve', auto: true, at: d.resolvedAt };
    else if (d.status === 'auto_rejected') map[d.key] = { kind: 'request_changes', auto: true, at: d.resolvedAt };
    else if (d.status === 'posted' || d.status === 'already_reviewed') map[d.key] = { kind: d.action, at: d.resolvedAt };
  }
  for (const d of engine.decisions.pending) map[d.key] = { kind: 'pending', at: d.createdAt };
  return map;
}

function saveDecisions(engine) {
  try { fs.writeFileSync(path.join(STATE_DIR, 'decisions.json'), JSON.stringify(engine.decisions, null, 2)); }
  catch (err) { engine.log('ERROR', `salvar decisions.json: ${err.message}`); }
  engine.pushState();
}

// estados dos reviews que EU ja postei neste PR (dedup de postagem).
// null = nao deu pra confirmar (rede etc.); quem chama decide se segue.
async function myReviewStates(engine, pr) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = engine.accountForPr(pr);
  const me = (acc || '').toLowerCase();
  if (!repo || !number || !me) return null;
  const r = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`,
    '--jq', `[.[] | select((.user.login | ascii_downcase) == "${me}") | .state]`], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  try { return JSON.parse(r.stdout || '[]'); } catch { return null; }
}

// Deve auto-aprovar este PR? Aprovável = veredito approve + payload APPROVE.
// Revisão iniciada por clique (requested === false) NUNCA auto-posta. Com
// autoApproveAll (default) todo aprovável passa; senão, só o gate estrito
// (a sessão decidiu auto_approve E o card foi comprovado).
function shouldAutoApprove(engine, pr, result) {
  const approvable = result.verdict === 'approve' &&
    result.payloads && result.payloads.approve && result.payloads.approve.event === 'APPROVE';
  if (!approvable || pr.requested === false) return false;
  // limpo = sem ressalvas (nenhum ponto de atenção) E a sessão decidiu auto_approve;
  // senão é "aprovável com ressalvas". A política da conta dona decide a ação.
  const clean = engine.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
  return engine.approvePolicyFor(engine.accountForPr(pr), clean) === 'approve';
}

// Deve reprovar sozinho (postar REQUEST_CHANGES)? Só quando a revisão pediu
// mudanças (verdict request_changes + payload), foi um review PEDIDO a mim
// (clique nunca posta) e a conta optou por "reprova sozinho". Opt-in, default não.
function shouldAutoReject(engine, pr, result) {
  const rejectable = result.verdict === 'request_changes' &&
    result.payloads && result.payloads.request_changes && result.payloads.request_changes.event === 'REQUEST_CHANGES';
  if (!rejectable || pr.requested === false) return false;
  return engine.rejectPolicyFor(engine.accountForPr(pr)) === 'request_changes';
}

// Marca o corpo do REQUEST_CHANGES automático, pro autor saber que foi o Farol.
function rejectBodyWithMark(engine, body) {
  // o corpo vai como está: nada de carimbo de "automático", o review tem que
  // parecer o teu, humano. A rastreabilidade de que foi o Farol fica só no app.
  return String(body || '').trim();
}

// Pontos de atenção de uma revisão aprovável: as ressalvas que a sessão levantou
// (result.reasons) mais um aviso quando o card não foi comprovado. É o que a gente
// deixa claro ao aprovar sozinho, no PR e na tela.
function attentionPoints(engine, result) {
  const pts = [];
  if (result.cardMet === false) pts.push('O card não foi totalmente comprovado na revisão automática, confira se necessário.');
  for (const r of (result.reasons || [])) if (r) pts.push(String(r));
  return pts;
}

async function postReview(engine, pr, payload) {
  try {
    if (!engine.token) await engine.refreshTokens();
    const acc = engine.accountForPr(pr);
    const file = path.join(STATE_DIR, 'pr-review-payload.json');
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    const repo = pr.repo || (pr.key || '').split('#')[0];
    const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
    let r = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
    if (!r.ok && /line could not be resolved|422/i.test(r.stderr) && (payload.comments || []).length) {
      // ancora inline invalida: recua os pontos pro corpo e tenta de novo
      const fallback = {
        event: payload.event,
        body: payload.body + '\n\n---\n**Pontos inline (linhas fora do diff):**\n' +
          payload.comments.map(c => `- \`${c.path}:${c.line}\` — ${c.body}`).join('\n'),
        comments: []
      };
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      r = await run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--input', file], { env: engine.ghEnv(acc) });
    }
    if (!r.ok) {
      const msg = (r.stderr || r.stdout || 'erro desconhecido').trim().slice(0, 300);
      engine.log('ERROR', `postar review ${pr.key} (${payload.event}): ${msg}`);
      return { ok: false, error: msg };
    }
    return { ok: true };
  } catch (err) {
    engine.log('ERROR', `postar review ${pr.key}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// memoria do time escrita pelo app (deterministica), a partir do JSON da sessao
function writeMemory(engine, result, actionLabel) {
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
    engine.log('ERROR', `escrever memoria (${actionLabel}): ${err.message}`);
  }
}

async function decide(engine, id, action) {
  const idx = engine.decisions.pending.findIndex(d => d.id === id);
  if (idx < 0) return { ok: false, error: 'decisão não encontrada (já resolvida?)' };
  const item = engine.decisions.pending[idx];
  const labels = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };

  if (action === 'skip') {
    engine.decisions.pending.splice(idx, 1);
    engine.resolveIntoHistory({ ...item, status: 'skipped', action });
    engine.saveDecisions();
    engine.emit('toast', { kind: 'info', text: `${item.key} pulado, nada foi postado.` });
    return { ok: true };
  }
  const payload = item.payloads && item.payloads[action];
  if (!payload) return { ok: false, error: `payload de ${action} não disponível` };
  // dedup: review igual ja postado por mim (via chat, manual no GitHub, ou
  // clique repetido apos falha ambigua de rede — caso real do biud-core#215)
  const dupState = { approve: 'APPROVED', request_changes: 'CHANGES_REQUESTED', comment: 'COMMENTED' }[action];
  const states = await engine.myReviewStates({ ...item.pr, key: item.key });
  if (states && dupState && states.includes(dupState)) {
    engine.decisions.pending.splice(idx, 1);
    engine.resolveIntoHistory({ ...item, status: 'already_reviewed', action });
    engine.saveDecisions();
    engine.emit('toast', { kind: 'info', text: `${item.key}: já havia um ${labels[action]} seu neste PR; não postei de novo.` });
    return { ok: true };
  }
  const post = await engine.postReview({ ...item.pr, key: item.key }, payload);
  if (!post.ok) {
    engine.emit('toast', { kind: 'error', text: `Falha ao postar em ${item.key}: ${post.error}` });
    return post;
  }
  engine.decisions.pending.splice(idx, 1);
  engine.resolveIntoHistory({ ...item, status: 'posted', action });
  engine.saveDecisions();
  engine.writeMemory(item, labels[action] || action.toUpperCase());
  engine.emit('toast', { kind: 'ok', text: `${labels[action]} postado em ${item.key}.` });
  return { ok: true };
}

module.exports = {
  recordDecision, resolveIntoHistory, reviewActions, saveDecisions, myReviewStates,
  shouldAutoApprove, shouldAutoReject, rejectBodyWithMark, attentionPoints,
  postReview, writeMemory, decide,
};
