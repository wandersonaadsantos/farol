// Dublê do GitHub para a bancada, carregado com `node --import` em cada instância do Farol.
//
// FRONTEIRA SIMULADA, declarada: toda chamada `gh` do processo é respondida aqui, sem rede e
// sem credencial real. O dublê responde SÓ consultas de leitura dos PRs sintéticos e registra
// tudo o que não sabe responder, para a fronteira ficar visível. Ele não decide nada de
// distribuição, transferência, tomada, admissão ou posse: isso é o engine real do Farol.
//
// A lista de PRs é lida do arquivo FAROL_GH_PRS a CADA chamada, para a bancada revelar um PR
// novo sem reiniciar aparelho nenhum (reiniciar mudaria o estado que estamos medindo).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const raiz = process.env.FAROL_RAIZ;
const registro = process.env.FAROL_GH_LOG || '';
const listaPrs = process.env.FAROL_GH_PRS || '';
const io = (await import(pathToFileURL(path.join(raiz, 'lib', 'io.js')).href)).default;

const HEAD = 'a'.repeat(40);

function anotar(o) {
  if (!registro) return;
  try { fs.appendFileSync(registro, `${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`); } catch { /* registro é best-effort */ }
}

function prsAgora() {
  try { return JSON.parse(fs.readFileSync(listaPrs, 'utf8')); } catch { return []; }
}

function resposta(stdout, ok = true, stderr = '') {
  return Promise.resolve({ ok, code: ok ? 0 : 1, stdout, stderr: ok ? '' : (stderr || 'gh falso da bancada: chamada nao simulada') });
}

const ARQUIVOS = [{ filename: 'lib/exemplo.js', additions: 12, deletions: 3, changes: 15, status: 'modified', patch: '@@ -1 +1 @@\n-antigo\n+novo\n' }];

function detalheDoPr(args) {
  const m = /pull\/(\d+)|#(\d+)|\/pulls\/(\d+)/.exec(args) || [];
  const numero = Number(m[1] || m[2] || m[3] || 0);
  const pr = prsAgora().find((p) => p.number === numero) || prsAgora()[0] || {};
  return { state: 'OPEN', mergeable: 'MERGEABLE', headRefName: 'feature/exemplo', baseRefName: 'main', isDraft: false, reviews: [], statusCheckRollup: [], labels: [], title: pr.title || '', author: pr.author || { login: 'ana-exemplo' }, number: pr.number || numero };
}

function responder(args) {
  const a = args.join(' ');
  if (a.startsWith('auth token')) return resposta('token-falso-da-bancada\n');
  if (a.startsWith('auth status')) return resposta('Logged in to github.com as alice\n');
  if (a.startsWith('search prs') && a.includes('--review-requested=@me')) return resposta(JSON.stringify(prsAgora()));
  // PRs de autoria da pessoa (a aba Meus PRs), do mesmo arquivo: os marcados com `meu`
  if (a.startsWith('search prs') && a.includes('--author @me')) return resposta(JSON.stringify(prsAgora().filter((p) => p.meu === true)));
  if (a.startsWith('search prs')) return resposta('[]');
  if (a.startsWith('pr view') && a.includes('headRefOid')) return resposta(`${HEAD}\n`);
  if (a.startsWith('pr view') && a.includes('state')) return resposta(JSON.stringify({ state: 'OPEN' }));
  if (a.startsWith('pr view')) return resposta(JSON.stringify(detalheDoPr(a)));
  if (/\/pulls\/\d+\/files/.test(a)) return resposta(JSON.stringify(ARQUIVOS));
  if (/\/pulls\/\d+\/reviews/.test(a)) return resposta('[]');
  if (a.includes('/commits/') || a.includes('check-runs') || a.includes('/status')) return resposta(JSON.stringify({ check_runs: [], state: 'success', statuses: [] }));
  if (a.startsWith('api') && a.includes('--method POST')) { anotar({ recusado: 'postagem', args }); return resposta('', false, 'a bancada nao posta no GitHub'); }
  anotar({ naoSimulado: args });
  return resposta('', false);
}

const runReal = io.run;
io.run = (cmd, args, opts) => (cmd === 'gh' ? responder(args || []) : runReal(cmd, args, opts));
const shellReal = io.runShell;
io.runShell = (linha, opts) => {
  if (!/^\s*gh\s/.test(String(linha))) return shellReal(linha, opts);
  anotar({ naoSimuladoShell: String(linha).slice(0, 200) });
  return resposta('', false);
};
