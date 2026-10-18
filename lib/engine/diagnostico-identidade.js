// Retrato sob demanda da identidade de uma revisão. Nunca devolve credenciais.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import io from '../io.js';
import { APP_ROOT, APP_VERSION, STATE_DIR } from '../paths.js';
import { prTag } from '../sync/tags.js';

const MAX_ITENS = 60;
const CONSULTA_MS = 10000;
const LOGIN = /^[a-z0-9][a-z0-9-]{0,38}$/i;
const FONTES = ['lib/engine/pr-proprio.js', 'lib/engine/review.js', 'server.js'];

function retrato(engine, pr, fonte) {
  const p = pr || {};
  const identidade = { key: String(p.key || ''), repo: String(p.repo || ''), account: String(p.account || '') };
  return {
    fonte, key: identidade.key, author: String(p.author || ''), authorTipo: typeof p.author, account: identidade.account,
    resolvida: String(engine.accountForPr(identidade) || ''), kind: String(p.kind || ''),
    requested: p.requested === true, manual: p.manual === true, viaAdmin: p.viaAdmin === true,
    viaComando: p.viaComando === true, viaDistribuicao: p.viaDistribuicao === true,
    head: String(p.knownHead || p.headLido || p.headSha || ''),
  };
}

function itensDoEngine(engine) {
  const itens = [];
  for (const fonte of ['queue', 'panorama', 'myPRs', 'headlessQueue']) {
    for (const p of engine[fonte] || []) itens.push(retrato(engine, p, fonte));
  }
  for (const s of (engine.activeReviews || new Map()).values()) {
    itens.push({ ...retrato(engine, s.pr, 'activeReviews'), sessao: String(s.id || ''), contaDaSessao: String(s.account || ''), inicio: Number(s.startedAt) || 0 });
  }
  for (const d of engine.decisions?.pending || []) itens.push(retrato(engine, { ...d.pr, key: d.key }, 'pending'));
  for (const r of (engine.retryAfterNet || new Map()).values()) itens.push(retrato(engine, r.pr, 'retryAfterNet'));
  return itens;
}

function itensDoDisco(engine) {
  const itens = [];
  for (const arquivo of ['inflight.json', 'decisions.json']) {
    const dado = io.readJson(path.join(STATE_DIR, arquivo), null);
    let lista = [];
    if (Array.isArray(dado)) lista = dado;
    else if (Array.isArray(dado?.pending)) lista = dado.pending;
    for (const d of lista) {
      if (!d || typeof d !== 'object') continue;
      itens.push(retrato(engine, d.pr ? { ...d.pr, key: d.key } : d, arquivo));
    }
  }
  return itens;
}

// Capturado na carga do módulo, antes de recoverInflight reconciliar a entrada anterior.
// Só metadados permitidos ficam em memória; o estado original não é alterado.
const ENTRADA_DO_BOOT = itensDoDisco({ accountForPr: () => '' }).slice(0, MAX_ITENS)
  .map(p => ({ ...p, fonte: `boot:${p.fonte}` }));

function fontesDoCodigo() {
  return FONTES.map(arquivo => {
    try { return { arquivo, sha256: createHash('sha256').update(fs.readFileSync(path.join(APP_ROOT, arquivo))).digest('hex') }; }
    catch { return { arquivo, indisponivel: true }; }
  });
}

async function identidadeDaConta(engine, conta, run) {
  const esperada = String(conta.user || '');
  if (!engine.tokenFor(esperada)) return { esperada, estado: 'sem-token' };
  try {
    const r = await run('gh', ['api', 'user', '--jq', '.login'], { env: engine.ghEnv(esperada), timeout: CONSULTA_MS });
    const login = String(r.stdout || '').trim();
    if (!r.ok || !LOGIN.test(login)) return { esperada, estado: 'nao-confirmada' };
    return { esperada, autenticada: login, estado: login.toLowerCase() === esperada.toLowerCase() ? 'confere' : 'divergente' };
  } catch { return { esperada, estado: 'nao-confirmada' }; }
}

async function coletarIdentidade(engine, { tagDoPr = '', kId, agora = Date.now(), run = io.run } = {}) {
  const itens = [...itensDoEngine(engine), ...itensDoDisco(engine), ...ENTRADA_DO_BOOT];
  const emExecucao = new Set(itens.filter(p => ['activeReviews', 'pending', 'headlessQueue', 'retryAfterNet'].includes(p.fonte)).map(p => p.key));
  const selecionados = itens.filter(p => p.key && (tagDoPr ? prTag(kId, p.key) === tagDoPr : emExecucao.has(p.key)));
  const contas = await Promise.all(engine.accountList().map(conta => identidadeDaConta(engine, conta, run)));
  return {
    esquema: 'diagnostico-identidade-1', capturadoEm: agora, versao: APP_VERSION,
    plataforma: process.platform, node: process.version, codigo: fontesDoCodigo(), contas,
    itens: selecionados.slice(0, MAX_ITENS), omitidos: Math.max(0, selecionados.length - MAX_ITENS),
    update: { automatico: engine.config?.autoUpdate !== false, disponivel: !!engine.update?.available, queued: !!engine.updateQueued },
  };
}

export { coletarIdentidade };
