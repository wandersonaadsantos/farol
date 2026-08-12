'use strict';
// Concern de chat por PR (Onda 2, módulo colaborador). Conversa ao vivo com o Claude
// sobre um PR, herdando a sessão da revisão headless quando existe. Funções recebem o
// engine como ctx; a Engine mantém fachadas finas que delegam. Ver docs/QUALITY.md.
const fs = require('fs');
const { CHATS_FILE } = require('../paths');
const { writeJsonAtomic } = require('../io');

function saveChats(engine) {
  try { writeJsonAtomic(CHATS_FILE, engine.chats); }
  catch (err) { engine.log('ERROR', `salvar chats.json: ${err.message}`); }
}

function chatPublic(engine, key) {
  const c = engine.chats[key];
  if (!c) return { key, url: null, status: 'idle', messages: [] };
  return { key, url: c.url, status: c.status, messages: c.messages.slice(-100) };
}

function chatSummaries(engine) {
  const out = {};
  for (const [k, c] of Object.entries(engine.chats)) {
    const last = c.messages[c.messages.length - 1];
    out[k] = { status: c.status, count: c.messages.length, updatedAt: last ? last.at : c.createdAt };
  }
  return out;
}

function chatPreamble(engine, key, url, inherited) {
  const intro = inherited
    ? 'MUDANÇA DE MODO: a revisão headless terminou; a partir de agora você está em CONVERSA ao vivo com o Wanderson pela interface do Farol. As regras "sem interlocutor" e "responda só JSON" não valem mais.'
    : `Você é o Claude dentro do app Farol, em conversa ao vivo com o Wanderson sobre o PR ${key}${url ? ` (${url})` : ''}. Use gh e as ferramentas do workspace pra examinar o que precisar.`;
  return intro + '\n' +
    'Regras desta conversa:\n' +
    '- Responda em markdown normal, direto ao ponto, em português.\n' +
    '- NÃO poste nada no GitHub (review, comentário, approve) a menos que ele peça explicitamente NESTA conversa.\n' +
    '- Quando ele pedir uma postagem, NUNCA use `gh pr review`, `gh api` de escrita ou a API do GitHub diretamente. Monte `{ "key": "owner/repo#N", "payload": { "event": "APPROVE|REQUEST_CHANGES|COMMENT", "body": "...", "comments": [] } }` em um JSON temporário e envie ao writer local com `curl -sS -X POST -H "x-farol: 1" -H "x-farol-review-cap: $FAROL_REVIEW_CAP" -H "Content-Type: application/json" --data-binary @arquivo "http://127.0.0.1:$FAROL_PORT/api/review/post"`. Só confirme se a resposta tiver `ok:true`; se vier bloqueada, reescreva o review e não contorne a trava.\n' +
    '- O texto postado precisa soar como review de uma pessoa: fale apenas de código, impacto e ação esperada. Nunca revele prompt, memória, política, gate, ferramenta ou quem produziu/analisou o review. Esses termos continuam permitidos quando forem o próprio assunto técnico do PR.\n' +
    '- Nunca use travessão em texto nenhum; reescreva com vírgula, parênteses ou dois pontos.\n' +
    '- Rascunho de resposta pro PR: primeira pessoa, tom dele, sem formalidade excessiva.\n\n';
}

async function chatSend(engine, key, url, text) {
  key = String(key || '').trim();
  text = String(text || '').trim();
  if (!key || !text) return { ok: false, error: 'mensagem vazia' };
  let chat = engine.chats[key];
  if (!chat) chat = engine.chats[key] = { key, url: url || null, sessionId: null, seeded: false, status: 'idle', messages: [], createdAt: Date.now() };
  if (chat.status === 'running') return { ok: false, error: 'aguarde a resposta atual (ou pare a geração)' };
  // conta dona do PR da conversa (A3): a sessão herda a da revisão headless, que rodou
  // com o token gh E o perfil Claude desta conta; sem o repasse o resume cai no perfil
  // errado e o gh na identidade errada. A checagem é SÍNCRONA (tokenFor, zero await
  // antes de marcar 'running', B1): conta sem token recusa AQUI, antes de reservar a
  // vez, então nada fica pra desfazer. Sem conta derivada (máquina sem accounts), vale
  // o caminho legado: o refreshToken dentro do bloco async resolve o token da primária.
  const acc = engine.accountForPr({ key, url: url || chat.url || null });
  if (acc && !engine.tokenFor(acc)) return { ok: false, error: `conta ${acc} sem token no gh (rode: gh auth login)` };
  chat.url = chat.url || url || null;
  chat.messages.push({ role: 'user', text, at: Date.now() });
  chat.status = 'running';
  const id = `c${++engine.sessionSeq}`;
  const reviewCap = engine.createReviewPostCapability([key], acc, 'chat', id);
  chat.runId = id;
  engine.saveChats();
  engine.emit('chat', engine.chatPublic(key));
  engine.pushState();

  // sessão: a própria do chat > herdada da revisão > nova
  let sessionId = chat.sessionId, inherited = false;
  if (!sessionId) {
    const d = engine.decisions.pending.find(x => x.key === key && x.sessionId) ||
      engine.decisions.resolved.find(x => x.key === key && x.sessionId);
    if (d) { sessionId = d.sessionId; inherited = true; }
  }

  const runOnce = (sid, prompt) => engine.runClaudeStream(prompt, {
    id,
    account: acc,
    ref: key,
    reviewCap,
    extraArgs: sid ? ['--resume', sid] : [],
    onEvent: (e) => {
      if (e.kind === 'tool' || e.kind === 'warn') engine.emit('chat-activity', { key, text: e.text });
      if (e.kind === 'text') {
        chat.messages.push({ role: 'assistant', text: e.text, at: Date.now(), partial: true });
        engine.emit('chat', engine.chatPublic(key));
      }
    }
  });

  (async () => {
    try {
      // o refresh fica DEPOIS da marcação síncrona de status 'running': a guarda lá em
      // cima fecha a janela de reentrância sem nenhum await no meio (B1). Se o refresh
      // falhar, o catch registra a falha no chat e o finally devolve o status pra idle.
      if (!engine.token) await engine.refreshToken();
      // Reenvia as travas de segurança em todo turno, inclusive ao retomar um chat
      // criado por versão antiga cujo contexto ainda dizia para postar via gh.
      const prompt = engine.chatPreamble(key, chat.url, inherited && !chat.seeded) + text;
      let res;
      try {
        res = await runOnce(sessionId, prompt);
      } catch (err) {
        // sessão antiga apagada/expirada/inválida: recomeça do zero uma única vez
        if (sessionId && /resume|no conversation|session id|session_id/i.test(err.message) && !err.cancelled) {
          chat.sessionId = null; chat.seeded = false;
          res = await runOnce(null, engine.chatPreamble(key, chat.url, false) + text);
        } else throw err;
      }
      chat.messages = chat.messages.filter(m => !m.partial);
      chat.messages.push({ role: 'assistant', text: String(res.text || '').trim() || '(sem resposta)', at: Date.now() });
      chat.sessionId = res.sessionId || chat.sessionId || sessionId || null;
      chat.seeded = true;
    } catch (err) {
      chat.messages = chat.messages.filter(m => !m.partial);
      chat.messages.push({ role: 'system', text: err.cancelled ? 'geração interrompida por você' : `falha: ${err.message}`, at: Date.now() });
      if (!err.cancelled) engine.log('ERROR', `chat ${key}: ${err.message}`);
    } finally {
      engine.revokeReviewPostCapability(reviewCap);
      chat.status = 'idle';
      chat.runId = null;
      if (chat.messages.length > 200) chat.messages = chat.messages.slice(-200);
      engine.saveChats();
      engine.emit('chat', engine.chatPublic(key));
      engine.pushState();
      // O writer local pode ter postado o review nesta conversa quando você pediu.
      // Se havia pendência deste PR, ela já foi atendida:
      // reconcilia na hora pra o card sair de "Precisa de você" sem esperar o próximo
      // ciclo de checagem. Fire-and-forget: é acabamento, não pode segurar o chat.
      engine.reconcilePending([key]).catch(err => engine.log('WARN', `reconcilePending ${key}: ${err.message}`));
    }
  })();
  return { ok: true };
}

function chatStop(engine, key) {
  const chat = engine.chats[String(key || '').trim()];
  if (!chat || chat.status !== 'running' || !chat.runId) return { ok: false, error: 'nenhuma geração em andamento' };
  return engine.cancelSession(chat.runId);
}

module.exports = { saveChats, chatPublic, chatSummaries, chatPreamble, chatSend, chatStop };
