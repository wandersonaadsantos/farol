'use strict';
// Concern de pushback (Onda 2, colaborador): memória de quando o autor contesta um
// review meu. Calibra TOM/POSTURA das revisões futuras, NUNCA a decisão. Registro à
// mão (manual+confirmed) ou automático (scan barato via gh + 1 classificação Claude
// leitura pura). Só confirmados calibram. Funções recebem o engine como ctx. Ver
// docs/QUALITY.md e CLAUDE.md ("Memória de pushback").
const fs = require('fs');
const path = require('path');
const { STATE_DIR } = require('../paths');
const { run, writeJsonAtomic } = require('../io');
const { PUSHBACK_OUTCOMES, PUSHBACK_LABEL } = require('../taxonomy');

function personProfile(engine, login) {
  const map = (engine.config && engine.config.people) || {};
  return map[String(login || '').toLowerCase()] || {};
}

// pushbacks de uma pessoa que já valem pra calibrar o review: confirmados
// (manual ou auto de alta confiança). Os "pending" (auto em dúvida) NÃO entram
// até você confirmar, pra não calibrar em cima de um palpite incerto.
function pushbacksFor(engine, login) {
  const u = String(login || '').toLowerCase();
  return Object.entries(engine.pushbacks || {})
    .filter(([, v]) => v && v.status !== 'pending' && String(v.author || '').toLowerCase() === u)
    .map(([key, v]) => ({ ...v, key }))
    .sort((a, b) => (b.at || 0) - (a.at || 0));
}

// registra/edita/limpa o pushback de um review PELA SUA MÃO (por PR). Sempre
// confirmado e marcado como manual (é você resolvendo). outcome vazio = limpar.
function recordPushback(engine, body) {
  const key = String((body && body.key) || '').trim();
  if (!key) return { ok: false, error: 'sem PR' };
  const outcome = (body && body.outcome) || '';
  if (!outcome) { delete engine.pushbacks[key]; engine.savePushbacks(); return { ok: true }; }
  if (!PUSHBACK_OUTCOMES.includes(outcome)) return { ok: false, error: 'desfecho inválido' };
  engine.pushbacks[key] = {
    author: String((body && body.author) || (engine.pushbacks[key] && engine.pushbacks[key].author) || '').trim().toLowerCase(),
    outcome,
    note: String((body && body.note) || '').trim().slice(0, 300),
    at: Date.now(),
    source: 'manual',
    status: 'confirmed'
  };
  engine.savePushbacks();
  return { ok: true };
}

function savePushbacks(engine) {
  try { writeJsonAtomic(path.join(STATE_DIR, 'pushbacks.json'), engine.pushbacks); }
  catch (err) { engine.log('ERROR', `salvar pushbacks.json: ${err.message}`); }
  engine.pushState();
}

function savePushbackScanned(engine) {
  try { writeJsonAtomic(path.join(STATE_DIR, 'pushback-scanned.json'), engine.pushbackScanned); }
  catch { /* best-effort: perder o marcador só faz reavaliar depois, não quebra */ }
}

// Pushback só faz sentido quando EU contestei ou ressalvei algo: bloqueio
// (request_changes) ou aprovação COM ressalva. Aprovação limpa (sem ponto de atenção) não
// gera pushback, então não gasta scan. A resposta do autor em si (o "recebeu resposta") é
// o gate hadActivity, que vem depois, no detectAuthorPushback.
function isPushbackTarget(action) {
  if (!action) return false; // sem ação registrada do Farol neste PR
  return action.kind === 'request_changes' || (action.kind === 'approve' && !!action.caveats);
}

// Quem entra no scan deste ciclo. SÍNCRONA e sem IO de propósito: é o gate que decide
// gastar (ou não) uma sessão do Claude, e antes vivia enterrado dentro do scanPushbacks
// async, onde só dava pra testar copiando a regra à mão pro teste. Mesmo motivo do
// buildModelFlags em session.js.
function pushbackTargets(engine, acts) {
  return (engine.panorama || []).filter(pr => {
    if (engine.isMuted(engine.accountForPr(pr))) return false;
    // perfil de chave de API com orçamento estourado: mesmo gate do toReview e do
    // retryTargets (budgetBlockedFor), pra o scan não gastar sessão Claude de conta
    // pausada por gasto.
    if (engine.budgetBlockedFor(engine.accountForPr(pr))) return false;
    if (!isPushbackTarget(acts[pr.key])) return false;
    // registro manual confirmado é palavra final (contrato do CLAUDE.md: recordPushback
    // é override): o scan não gasta gh nem sessão Claude com quem você já resolveu à mão
    const atual = (engine.pushbacks || {})[pr.key];
    if (atual && atual.source === 'manual') return false;
    const seen = engine.pushbackScanned[pr.key];
    return !seen || (pr.updatedAt && String(pr.updatedAt) > String(seen)); // updatedAt = gate barato
  });
}

async function scanPushbacks(engine) {
  if (!engine.config.autoPushback) return; // opt-in: por padrão não gasta sessão Claude com isso
  if (engine.pushbackScanning) return;
  engine.pushbackScanning = true;
  try {
    const targets = pushbackTargets(engine, engine.reviewActions());
    const MAX_PER_CYCLE = 2; // limita sessões Claude por ciclo (custo / carga da máquina)
    let classified = 0;
    for (const pr of targets) {
      if (classified >= MAX_PER_CYCLE) { engine.log('WARN', `scanPushbacks: ${targets.length - classified} candidato(s) ficaram pro próximo ciclo`); break; }
      try {
        const det = await engine.detectAuthorPushback(pr);
        if (!det) continue; // não deu pra ler: tenta de novo depois (sem marcar)
        if (!det.hadActivity) {
          // autor não falou depois do meu review: marca e não gasta sessão
          engine.pushbackScanned[pr.key] = det.marker; engine.savePushbackScanned();
          continue;
        }
        classified++;
        const cls = await engine.classifyPushback(pr);
        // sessão caiu (rede/limite): NÃO marca, senão a comparação estrita do gate
        // (updatedAt > marcador) nunca reabre e o pushback se perde em definitivo
        if (!cls) continue;
        engine.pushbackScanned[pr.key] = det.marker; engine.savePushbackScanned();
        if (!cls.isPushback || cls.outcome === 'none' || !PUSHBACK_OUTCOMES.includes(cls.outcome)) continue;
        const high = cls.confidence === 'high';
        const prev = engine.pushbacks[pr.key];
        if (prev && prev.source === 'manual') continue; // marcou à mão durante o scan: manual prevalece
        engine.pushbacks[pr.key] = {
          author: String(pr.author || '').toLowerCase(),
          outcome: cls.outcome,
          note: String(cls.note || '').trim().slice(0, 300),
          at: Date.now(), source: 'auto',
          confidence: high ? 'high' : 'low',
          status: high ? 'confirmed' : 'pending'
        };
        engine.savePushbacks();
        engine.emit('toast', high
          ? { kind: 'info', text: `↩ Pushback em ${pr.key}: ${PUSHBACK_LABEL[cls.outcome] || cls.outcome}.` }
          : { kind: 'info', text: `↩ Possível pushback em ${pr.key}: confirme o desfecho em Revisões recentes.` });
      } catch (e) { engine.log('WARN', `scanPushbacks ${pr.key}: ${e.message}`); }
    }
  } finally { engine.pushbackScanning = false; }
}

// atividade do AUTOR depois do meu último review (gatilho barato). Devolve
// { marker, hadActivity } ou null quando não dá pra determinar (rede / sem review meu).
async function detectAuthorPushback(engine, pr) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = engine.accountForPr(pr);
  const me = (acc || '').toLowerCase();
  const author = String(pr.author || '').toLowerCase();
  if (!repo || !number || !me || !author || author === me) return null;
  if (!engine.tokenFor(acc)) return null; // sem token da conta: não dá pra determinar
  const env = engine.ghEnv(acc);
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
async function classifyPushback(engine, pr) {
  const acc = engine.accountForPr(pr);
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
  const id = `pb${++engine.sessionSeq}`;
  const res = await engine.runClaudeStream(prompt, { id, account: acc, ref: pr.key });
  const text = engine.parseEnvelope(res.text || '');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const d = JSON.parse(text.slice(a, b + 1));
    return { isPushback: !!d.isPushback, outcome: d.outcome, confidence: d.confidence, note: d.note };
  } catch { return null; }
}

module.exports = {
  personProfile, pushbacksFor, recordPushback, savePushbacks, savePushbackScanned,
  scanPushbacks, detectAuthorPushback, classifyPushback,
  isPushbackTarget, pushbackTargets,
};
