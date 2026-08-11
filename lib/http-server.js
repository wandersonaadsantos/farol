'use strict';
// Camada HTTP + SSE (Onda 2, colaborador): serve a UI local e roteia as chamadas /api/*
// pros métodos do engine. É o "adapter" do lace (traduz request -> chamada de domínio ->
// resposta); nenhuma regra de negócio mora aqui. Recebe o engine pronto. Ver docs/QUALITY.md.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { UI_DIR } = require('./paths');
const { parseHighlights, parseTeam, tailLog } = require('./workspace');
const { triage } = require('./log-taxonomy');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 65536) { reject(new Error('body grande demais')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
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

    try {
      if (p.startsWith('/api/')) {
        if (req.method === 'POST' && req.headers['x-farol'] !== '1') return send(403, { error: 'forbidden' });

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
        if (p === '/api/highlights') return send(200, parseHighlights());
        if (p === '/api/team') return send(200, parseTeam());
        if (p === '/api/deliveries') return send(200, await engine.fetchDeliveries(url.searchParams.get('days'), url.searchParams.get('owner')));
        if (p === '/api/log') return send(200, tailLog(parseInt(url.searchParams.get('lines'), 10) || 300));
        // MESMO tail da rota acima, já agrupado por lib/log-taxonomy.js. Existe como rota
        // porque a UI é carregada por <script src> sem build step e não pode dar require
        // num módulo de lib/. A rota crua fica intocada: ela tem consumidor (o logBox) e
        // contrato de array de strings.
        if (p === '/api/log/triage') return send(200, triage(tailLog(parseInt(url.searchParams.get('lines'), 10) || 300)));
        if (p === '/api/doctor') return send(200, await engine.doctor());
        if (p === '/api/reviewer-candidates') return send(200, await engine.reviewerCandidates());

        if (p === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`event: state\ndata: ${JSON.stringify(engine.snapshot())}\n\n`);
          sseClients.add(res);
          const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { } }, 25000);
          req.on('close', () => { clearInterval(beat); sseClients.delete(res); });
          return;
        }

        if (req.method !== 'POST') return send(405, { error: 'method' });
        const body = await readBody(req);

        if (p === '/api/check') { engine.checkNow(); return send(200, { ok: true }); }
        if (p === '/api/review') {
          // contrato explícito: a UI SEMPRE manda a lista de PRs. O fallback antigo
          // (sem urls = fila inteira) fazia um {} acidental revisar PRs de todas as
          // contas, fora do escopo visível (achado B22).
          const urls = Array.isArray(body.urls) ? body.urls.filter(u => typeof u === 'string' && u) : [];
          if (!urls.length) return send(400, { error: 'urls é obrigatório: a lista explícita das URLs dos PRs a revisar' });
          return send(200, await engine.launchReview(urls, body.mode === 'terminal' ? 'terminal' : 'auto'));
        }
        if (p === '/api/claude-login') { engine.openClaudeLoginSession(body.profileId || ''); return send(200, { ok: true }); }
        if (p === '/api/self-review') return send(200, await engine.launchSelfAnalysis(String(body.url || '')));
        if (p === '/api/self-review/clear') return send(200, engine.clearSelfAnalysis(String(body.key || '')));
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
        if (p === '/api/settings') { engine.updateSettings(body || {}); return send(200, { ok: true, config: engine.config }); }
        if (p === '/api/pushback') return send(200, engine.recordPushback(body || {}));
        if (p === '/api/tool') return send(200, await engine.launchTool(String(body.name || ''), body.scope));
        if (p === '/api/tool/clear') return send(200, engine.clearTool(String(body.name || ''), body.scope));
        if (p === '/api/log/clear') return send(200, engine.clearLog());
        if (p === '/api/cancel') return send(200, engine.cancelSession(String(body.id || '')));
        if (p === '/api/session-exit') return send(200, engine.sessionExit(String(body.id || '')));
        if (p === '/api/update') return send(200, await engine.applyUpdate());
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

module.exports = { startServer };
