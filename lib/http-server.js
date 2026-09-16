// Camada HTTP + SSE (Onda 2, colaborador): serve a UI local e roteia as chamadas /api/*
// pros métodos do engine. É o "adapter" do lace (traduz request -> chamada de domínio ->
// resposta); nenhuma regra de negócio mora aqui. Recebe o engine pronto. Ver docs/QUALITY.md.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { UI_DIR } from './paths.js';
import { TEMPOS } from './constants.js';
import { parseHighlights, parseTeam, tailLog } from './workspace.js';
import { triage } from './log-taxonomy.js';
import { validarHostEOrigem } from './http-guard.js';
import acesso from './local-auth/acesso.js';

// O schema público limita o texto agregado a 200 kB. A rota mantém folga para
// paths, envelope JSON e UTF-8, além de um teto absoluto contra body sem limite.
const MAX_HTTP_BODY = 3 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (Buffer.byteLength(data, 'utf8') > MAX_HTTP_BODY) { reject(new Error('body grande demais')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

// Corpo das duas respostas de credencial, fora do dispatch de rotas: o literal
// nasce aqui, num nível raso, pra não empilhar mais um objeto na árvore de ifs
// já funda da rota (regra de profundidade do gate de qualidade).
function okResponse(value) { return { ok: !!value }; }
function jiraCredentialResult(ok) { return ok ? { ok: true } : { ok: false, error: 'dados incompletos' }; }

// Sincronização entre dispositivos: o corpo das respostas é allowlist, pelo mesmo
// motivo das credenciais do Jira acima. Nunca ecoa o que veio no corpo (a senha do
// login) nem o e-mail ou o uid: o estado completo chega à tela pelo snapshot, que já
// passa pela projeção de statusForUi.
function syncCredenciais(body) { return { email: String(body.email || ''), password: String(body.password || '') }; }
function syncFalha(r) { return { ok: false, code: String((r && r.code) || 'falha_interna'), motivo: String((r && r.motivo) || '') }; }
function syncResult(r) { return r && r.ok ? { ok: true } : syncFalha(r); }
function syncTestResult(r) { return r && r.ok ? { ok: true, devices: Number(r.devices) || 0 } : syncFalha(r); }
function syncConsolidatedResult(r) { return r && r.ok ? { ok: true, resumo: r.resumo } : syncFalha(r); }
function syncConsolidateResult(r) { return r && r.ok ? { ok: true, enfileirados: Number(r.enfileirados) || 0, pendentes: Number(r.pendentes) || 0 } : syncFalha(r); }

async function deliveriesFor(engine, url) {
  if (engine.config.deliveriesEnabled !== true) return { items: [], disabled: true };
  return engine.fetchDeliveries(url.searchParams.get('days'), url.searchParams.get('owner'));
}

function startServer(engine, onReady) {
  const sseClients = new Set();

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseClients) { try { res.write(payload); } catch { /* cliente caiu */ } }
  }

  engine.on('state', s => broadcast('state', s));
  engine.on('toast', t => broadcast('toast', t));
  engine.on('new-prs', p => broadcast('new-prs', p));
  engine.on('auto-approved', p => broadcast('auto-approved', p));
  engine.on('auto-rejected', p => broadcast('auto-rejected', p));
  engine.on('needs-decision', p => broadcast('needs-decision', p));
  engine.on('focus-pr', p => broadcast('focus-pr', p));
  engine.on('tool-done', p => broadcast('tool-done', p));
  engine.on('activity', p => broadcast('activity', p));
  engine.on('chat', p => broadcast('chat', p));
  engine.on('chat-activity', p => broadcast('chat-activity', p));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = url.pathname;

    const send = (code, data, type = 'application/json') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(type === 'application/json' ? JSON.stringify(data) : data);
    };

    // C1a: Host e Origin passam pela allowlist ANTES de qualquer rota, estáticos e SSE
    // inclusive. A porta é a EFETIVA do socket, não a da config (config 0 = efêmera).
    // Fica fora do try de propósito: a função é pura e não lança, e address() nulo
    // (socket já fechado) vira porta inválida e recusa, em vez de derrubar o processo.
    // A recusa não leva cabeçalho CORS, então nenhuma origem de fora ganha leitura.
    const endereco = server.address();
    const guarda = validarHostEOrigem({ host: req.headers.host, origin: req.headers.origin, porta: endereco && endereco.port });
    if (!guarda.ok) return send(403, { error: 'forbidden', motivo: guarda.motivo });

    try {
      if (p.startsWith('/api/')) {
        if (req.method === 'POST' && req.headers['x-farol'] !== '1') return send(403, { error: 'forbidden' });

        // A4: no modo que exige, todo /api/* pede Authorization válido, exceto o
        // pareamento e o status (lib/local-auth/inventario.js). Fica depois da allowlist
        // de Host (C1a) e do x-farol, para o pareamento herdar as duas proteções, e antes
        // de qualquer rota, para nenhuma leitura, SSE ou ação escapar.
        const recusa = acesso.recusaSemCredencial(req, p, engine.config);
        if (recusa) return send(recusa.status, recusa.body);
        if (p === '/api/auth/status' && req.method === 'GET') return send(200, acesso.statusAutenticacao(req, engine.config));

        if (p === '/api/state') return send(200, engine.snapshot());
        if (p === '/api/chat' && req.method === 'GET') return send(200, engine.chatPublic(String(url.searchParams.get('key') || '')));
        // caixa de revisão por chave: o snapshot manda só as 30 mais recentes (com
        // relatório, cada decisão pesa ~5 KB), então a revisão antiga vem por aqui,
        // sob demanda. Responde ENVELOPE (`{found, decision}`), nunca a decisão
        // crua nem 404: o get() da UI devolve null em qualquer falha, então sem o
        // envelope "não existe essa revisão" e "a busca falhou" ficariam
        // indistinguíveis, que é o M18 (404 engolido) de novo, com outra roupa.
        if (p === '/api/decision' && req.method === 'GET') {
          const d = engine.decisionByKey(String(url.searchParams.get('key') || ''));
          return send(200, { found: !!d, decision: d });
        }
        if (p === '/api/highlights') return send(200, engine.config.teamHighlights === true ? parseHighlights() : []);
        if (p === '/api/team') return send(200, parseTeam());
        if (p === '/api/deliveries') return send(200, await deliveriesFor(engine, url));
        if (p === '/api/log') return send(200, tailLog(parseInt(url.searchParams.get('lines'), 10) || 300));
        // MESMO tail da rota acima, já agrupado por lib/log-taxonomy.js. Existe como rota
        // porque a UI é carregada por <script src> sem build step e não pode dar require
        // num módulo de lib/. A rota crua fica intocada: ela tem consumidor (o logBox) e
        // contrato de array de strings.
        if (p === '/api/log/triage') return send(200, triage(tailLog(parseInt(url.searchParams.get('lines'), 10) || 300)));
        if (p === '/api/doctor') return send(200, await engine.doctor());
        // consumo de todos os aparelhos (lib/engine/sync-usage.js): envelope, nunca o resumo cru
        if (p === '/api/sync/consolidated' && req.method === 'GET') return send(200, syncConsolidatedResult(await engine.syncConsolidated(url.searchParams.get('days'))));
        if (p === '/api/reviewer-candidates') return send(200, await engine.reviewerCandidates());

        if (p === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`event: state\ndata: ${JSON.stringify(engine.snapshot())}\n\n`);
          sseClients.add(res);
          const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, TEMPOS.SSE_PING_MS);
          req.on('close', () => { clearInterval(beat); sseClients.delete(res); });
          return;
        }

        if (req.method !== 'POST') return send(405, { error: 'method' });
        const body = await readBody(req);

        // o token de sessão sai SÓ aqui, no corpo da resposta; nunca em cabeçalho,
        // cookie, URL ou log
        if (p === '/api/auth/pair') return send(200, acesso.parear(body));

        if (p === '/api/check') { engine.checkNow(); return send(200, { ok: true }); }
        // POST nas duas, nunca DELETE: a linha 98 acima responde 405 ANTES do corpo
        // ser lido, e o guarda de origem (x-farol) só cobre POST. Nunca ecoe o token
        // na resposta nem no log. `body` vai inteiro pro setCredential porque ele só
        // lê .email/.token (lib/jira/credentials.js); o resto é ignorado.
        if (p === '/api/jira/credential') return send(200, jiraCredentialResult(engine.setJiraCredential(String(body.siteId || ''), body)));
        if (p === '/api/jira/credential/remove') return send(200, okResponse(engine.removeJiraCredential(String(body.siteId || ''))));
        // resposta com ENVELOPE, nunca o objeto cru: a tela precisa distinguir
        // "testou e falhou" de "a chamada não chegou" (o get da UI engole erro).
        if (p === '/api/jira/test') return send(200, await engine.testarJiraSite(String(body.siteId || '')));
        // sincronização entre dispositivos (lib/engine/sync.js); ver syncResult acima
        if (p === '/api/sync/login') return send(200, syncResult(await engine.syncLogin(syncCredenciais(body))));
        if (p === '/api/sync/logout') return send(200, syncResult(engine.syncLogout()));
        if (p === '/api/sync/test') return send(200, syncTestResult(await engine.syncTest()));
        // CT-ENV: aparelho logado antes da feature digita a senha uma vez para abrir a
        // chave do conjunto. Só a senha entra, e ela não volta em nenhuma resposta.
        if (p === '/api/sync/unlock') return send(200, syncResult(await engine.syncUnlock(syncCredenciais(body))));
        // ato explícito do dono quando a chave do conjunto ficou indisponível: abre uma
        // época nova para o conteúdo futuro, sem apagar o que está cifrado com a antiga
        if (p === '/api/sync/new-epoch') return send(200, syncResult(await engine.syncGerarChaveNova(syncCredenciais(body))));
        if (p === '/api/sync/redo') return send(200, syncResult(await engine.syncRedoReceipt(String(body.key || ''))));
        if (p === '/api/sync/consolidate') return send(200, syncConsolidateResult(await engine.syncConsolidate()));
        if (p === '/api/review') {
          // contrato explícito: a UI SEMPRE manda a lista de PRs. O fallback antigo
          // (sem urls = fila inteira) fazia um {} acidental revisar PRs de todas as
          // contas, fora do escopo visível (achado B22).
          const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
          if (!urls.length) return send(400, { error: 'urls é obrigatório: a lista explícita das URLs dos PRs a revisar' });
          // 'clique': veio de um humano apertando Revisar, então nunca é barrado
          // pela saída de cena (e desfaz a saída). Ver enqueueHeadless. Os overrides da
          // coordenação entre aparelhos só valem com true de verdade: a confirmação da
          // tela manda booleano, e qualquer outro valor não pode contornar nada.
          const extras = { semCoordenacao: body.semCoordenacao === true, ignorarRecibo: body.ignorarRecibo === true };
          return send(200, await engine.launchReview(urls, body.mode === 'terminal' ? 'terminal' : 'auto', 'clique', extras));
        }
        if (p === '/api/claude-login') { engine.openClaudeLoginSession(body.profileId || ''); return send(200, { ok: true }); }
        if (p === '/api/self-review') return send(200, await engine.launchSelfAnalysis(String(body.url || '')));
        if (p === '/api/self-review/visibility') return send(200, engine.setSelfAnalysisVisibility(String(body.key || ''), body.hidden === true));
        if (p === '/api/self-review/merge') return send(200, await engine.mergeSelfPR(String(body.url || ''), { mode: body.mode }));
        if (p === '/api/self-review/reviewers') return send(200, await engine.setReviewers(String(body.url || '')));
        if (p === '/api/self-review/cancel') return send(200, engine.cancelSelfAnalysis(String(body.key || '')));
        // ocultar/mostrar um PR meu na aba "Meus PRs". Nada é tocado no GitHub: é só
        // estado local, e se desfaz sozinho quando o PR recebe atividade nova.
        if (p === '/api/pr/hide') return send(200, engine.hidePR(String(body.key || '')));
        if (p === '/api/pr/unhide') return send(200, engine.unhidePR(String(body.key || '')));
        if (p === '/api/decide') return send(200, await engine.decide(String(body.id || ''), String(body.action || '')));
        if (p === '/api/ignore') { engine.ignore(String(body.key || '')); return send(200, { ok: true }); }
        if (p === '/api/restore') { engine.restore(String(body.key || '')); return send(200, { ok: true }); }
        if (p === '/api/settings') { const r = engine.updateSettings(body || {}); return send(200, { ...r, config: engine.config }); }
        if (p === '/api/pushback') return send(200, engine.recordPushback(body || {}));
        if (p === '/api/team/remove') return send(200, engine.removeTeamMember((body || {}).login));
        if (p === '/api/tool') return send(200, await engine.launchTool(String(body.name || ''), body.scope));
        if (p === '/api/tool/clear') return send(200, engine.clearTool(String(body.name || ''), body.scope));
        if (p === '/api/log/clear') return send(200, engine.clearLog());
        if (p === '/api/cancel') return send(200, engine.cancelSession(String(body.id || '')));
        if (p === '/api/session-exit') return send(200, engine.sessionExit(String(body.id || '')));
        if (p === '/api/update') return send(200, await engine.applyUpdate());
        if (p === '/api/review/post') {
          const capability = String(req.headers['x-farol-review-cap'] || '');
          return send(200, await engine.postReviewFromSession(body || {}, capability));
        }
        if (p === '/api/chat/send') return send(200, await engine.chatSend(body.key, body.url, body.text));
        if (p === '/api/chat/stop') return send(200, engine.chatStop(body.key));
        return send(404, { error: 'not found' });
      }

      // arquivos estaticos da UI
      let file = p === '/' ? '/index.html' : p;
      file = path.normalize(file).replace(/^([.][.][\\/])+/, '');
      const full = path.join(UI_DIR, file);
      if (!full.startsWith(UI_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
        return send(404, 'não encontrado', 'text/plain; charset=utf-8');
      }
      send(200, fs.readFileSync(full), MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
    } catch (err) {
      engine.log('ERROR', `http ${p}: ${err.message}`);
      send(500, { error: err.message });
    }
  });

  server.listen(engine.config.port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${engine.config.port}`;
    if (onReady) onReady(url);
  });
  server.on('error', (err) => {
    engine.log('ERROR', `servidor http: ${err.message}`);
    if (onReady) onReady(null, err);
  });
  return server;
}

export default { startServer };
export { startServer };
