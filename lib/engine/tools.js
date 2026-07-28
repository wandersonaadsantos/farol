'use strict';
// Concern de ferramentas internas (kudos + diagnóstico) e limpeza (Onda 2, colaborador).
// Rodam headless, resultado aparece na UI, nada de terminal. Funções recebem o engine
// como ctx; a Engine mantém fachadas finas que delegam. Ver docs/QUALITY.md.
const fs = require('fs');
const path = require('path');
const { WORKSPACE, STATE_DIR, LOG_FILE } = require('../paths');
const { parseHighlights } = require('../workspace');

// escopo do kudos: '*' = todas as contas; senão o login (minúsculo) de uma conta
function kudosScopeKey(engine, scope) { const s = String(scope || '').trim().toLowerCase(); return (!s || s === '*') ? '*' : s; }

function scopeLabel(engine, scope) {
  const k = engine.kudosScopeKey(scope);
  if (k === '*') return '';
  const a = engine.accountList().find(x => x.user.toLowerCase() === k);
  return (a && (a.label || a.user)) || String(scope);
}

function ownerFromUrl(engine, url) { const m = String(url || '').match(/github\.com\/([^/]+)\//i); return m ? m[1] : ''; }

// destaques visíveis num escopo: '*' pega tudo; conta específica filtra pelo owner do PR
function highlightsForScope(engine, scope) {
  const items = parseHighlights();
  const k = engine.kudosScopeKey(scope);
  if (k === '*') return items;
  return items.filter(h => { const owner = engine.ownerFromUrl(h.url); return owner && engine.accountForOwner(owner).toLowerCase() === k; });
}

// ferramentas (kudos, diagnostico) rodam INTERNAS, headless; o resultado
// aparece na UI, nada de terminal
function toolPrompt(engine, name, opts) {
  opts = opts || {};
  const file = path.join(WORKSPACE, '.claude', 'commands', name === 'kudos' ? 'pr-kudos.md' : 'pr-health.md');
  let body = fs.readFileSync(file, 'utf8').replace(/^---[\s\S]*?---\s*/, '').replace(/\$ARGUMENTS/g, '(padrão)');
  const preamble = 'Você está rodando em modo AUTÔNOMO (headless) dentro do app Farol, sem ninguém na tela. ' +
    'NÃO faça perguntas, NÃO ofereça próximos passos, NÃO espere confirmação.\n\n';
  // kudos de uma conta específica: injeta os destaques já filtrados e proíbe
  // olhar o arquivo global, pra o resumo nunca misturar conteúdo de outra conta
  let scopeBlock = '';
  if (name === 'kudos' && opts.scoped) {
    const line = h => {
      const ref = h.ref ? (h.url ? `[${h.ref}](${h.url})` : h.ref) : '';
      const tail = ref ? `${ref} — ${h.text}` : h.text;
      return '- ' + [h.date, h.author ? '@' + h.author : '', tail].filter(Boolean).join(' · ');
    };
    const list = (opts.list || []).map(line).join('\n');
    scopeBlock = `\n\n### Destaques da conta ${opts.label}\n` +
      `Considere SOMENTE os destaques listados abaixo, já filtrados pra a conta ${opts.label}. ` +
      `NÃO leia o arquivo highlights.md e NÃO inclua nada de outras contas.\n\n${list}\n`;
  }
  const suffix = name === 'kudos'
    ? '\n\nSua saída final deve ser APENAS o texto pronto pra colar (markdown), sem comentários em volta e sem ofertas no final.'
    : '\n\nComo não há interlocutor: aplique só as correções de baixo risco; as de risco maior viram uma seção "Recomendações (não apliquei)". ' +
      'Sua saída final deve ser APENAS o relatório em markdown (falhas → causa → o que mudou / o que recomendo).';
  return preamble + body + scopeBlock + suffix;
}

function saveToolRuns(engine) {
  try { fs.writeFileSync(path.join(STATE_DIR, 'tool-results.json'), JSON.stringify(engine.toolRuns, null, 2)); }
  catch { }
  engine.pushState();
}

// pega/guarda a execução de uma ferramenta: kudos é por conta (mapa escopo->execução),
// health é global; centraliza aqui pra não espalhar o if do formato
function toolRunGet(engine, name, scope) { return name === 'kudos' ? engine.toolRuns.kudos[engine.kudosScopeKey(scope)] : engine.toolRuns[name]; }
function toolRunSet(engine, name, scope, run) { if (name === 'kudos') engine.toolRuns.kudos[engine.kudosScopeKey(scope)] = run; else engine.toolRuns[name] = run; }

async function launchTool(engine, name, scope) {
  if (!['kudos', 'health'].includes(name)) return { ok: false, error: 'ferramenta desconhecida' };
  const cur = engine.toolRunGet(name, scope);
  if (cur && cur.status === 'running') return { ok: false, error: 'já está rodando' };
  // kudos de uma conta sem destaques não roda (o painel já mostra o vazio)
  let scoped = false, scopedList = null, scopeName = '';
  if (name === 'kudos') {
    const key = engine.kudosScopeKey(scope);
    scoped = key !== '*';
    scopeName = engine.scopeLabel(scope);
    if (scoped) {
      scopedList = engine.highlightsForScope(scope);
      if (!scopedList.length) return { ok: false, error: `sem destaques na conta ${scopeName} ainda` };
    } else if (!parseHighlights().length) {
      return { ok: false, error: 'sem destaques registrados ainda' };
    }
  }
  if (!engine.token) await engine.refreshToken();
  const label = name === 'kudos' ? `Kudos${scopeName ? ' · ' + scopeName : ''}` : 'Diagnóstico do Farol';
  const id = `f${++engine.sessionSeq}`;
  engine.activeReviews.set(id, { id, keys: [], label, mode: 'auto', startedAt: Date.now(), cancellable: true });
  engine.activity.set(id, []);
  engine.toolRunSet(name, scope, { status: 'running', startedAt: Date.now() });
  engine.saveToolRuns();
  (async () => {
    try {
      const res = await engine.runClaudeStream(engine.toolPrompt(name, { scoped, list: scopedList, label: scopeName }), {
        id,
        onEvent: (e) => engine.pushActivity(id, e.kind, e.text)
      });
      let text = String(res.text || '').trim();
      // alguns modelos envelopam em cerca de codigo mesmo instruidos a nao fazer
      text = text.replace(/^```[a-z]*\s*\r?\n/i, '').replace(/\r?\n```\s*$/, '').trim();
      if (!text) throw new Error('a sessão não devolveu texto');
      engine.toolRunSet(name, scope, { status: 'done', output: text, finishedAt: Date.now() });
      engine.emit('tool-done', { name, label });
      engine.emit('toast', { kind: 'ok', text: `${label}: pronto.` });
    } catch (err) {
      if (!err.cancelled) engine.log('ERROR', `ferramenta ${name}: ${err.message}`);
      engine.toolRunSet(name, scope, { status: 'error', error: err.message, finishedAt: Date.now() });
      engine.emit('toast', { kind: err.cancelled ? 'info' : 'error', text: err.cancelled ? `${label}: cancelado.` : `${label} falhou: ${err.message}` });
    } finally {
      engine.activeReviews.delete(id);
      engine.activity.delete(id);
      engine.saveToolRuns();
    }
  })();
  return { ok: true };
}

// limpa o resultado de uma ferramenta (kudos/diagnostico) depois que os
// pontos levantados ja foram tratados; nao mexe em nada alem do painel
function clearTool(engine, name, scope) {
  if (!['kudos', 'health'].includes(name)) return { ok: false, error: 'ferramenta desconhecida' };
  const cur = engine.toolRunGet(name, scope);
  if (cur && cur.status === 'running') return { ok: false, error: 'ainda está rodando; cancele ou aguarde terminar' };
  if (name === 'kudos') delete engine.toolRuns.kudos[engine.kudosScopeKey(scope)];
  else delete engine.toolRuns[name];
  engine.saveToolRuns();
  return { ok: true };
}

// zera o log de falhas (inclusive o rotacionado): usado quando um episodio
// ja foi diagnosticado e encerrado, pro proximo diagnostico partir do zero
function clearLog(engine) {
  try {
    fs.writeFileSync(LOG_FILE, '');
    try { fs.unlinkSync(LOG_FILE + '.1'); } catch { }
    engine.pushState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = {
  kudosScopeKey, scopeLabel, ownerFromUrl, highlightsForScope, toolPrompt,
  saveToolRuns, toolRunGet, toolRunSet, launchTool, clearTool, clearLog,
};
