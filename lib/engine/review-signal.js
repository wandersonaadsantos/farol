/* Sinal de "revisão em andamento" por REF GIT customizada (28/08/2026).

   A história: em 28/08/2026 o Wanderson viu no biudtech/biud-frontend#845 a label
   pública `thiagocarvalho-dev:revisando` e decidiu que a revisão do Farol tem que
   parecer 100% humana, ou seja, NENHUM rastro de automação pode aparecer
   publicamente no GitHub. A auditoria confirmou dois vazamentos no caminho
   automático: a label `<conta>:revisando` (visível enquanto a sessão roda, e os
   eventos de add/remove ficam PARA SEMPRE na timeline do PR) e o comentário
   template do pulo de "um Farol por PR" (a mesma frase, palavra por palavra,
   saindo de contas diferentes minutos depois da label alheia subir, denuncia a
   ferramenta). As labels foram apagadas dos repos à mão; este módulo é o
   substituto do sinal.

   Por que ref git: refs fora de refs/heads e refs/tags são INVISÍVEIS em toda a
   interface do GitHub (página do PR, timeline, branches, tags) e fora do alcance
   dos rulesets, que só alvejam branch e tag (conferido nos rulesets reais da
   biudtech). O nome é `refs/farol/revisando/<numero>/<login>/<epoch-ms>`, sempre
   com 3 segmentos sob revisando/: criar uma ref folha em
   `refs/farol/revisando/<numero>` bloquearia o namespace por conflito
   diretório/arquivo do git.

   TTL dos dois lados do relógio: entrada com |agora - epoch| > TTL é IGNORADA na
   leitura, senão uma máquina com relógio adiantado produziria uma ref imortal. A
   coleta de lixo só apaga o que está comprovadamente no PASSADO além do TTL
   (relógio alheio adiantado não é lixo comprovado, então "do futuro" é só
   ignorado). Qualquer conta com push pode apagar ref órfã de outra conta, e isso
   é desejado.

   Transição: colegas ainda rodam versões antigas que ESCREVEM labels e SÓ LEEM
   labels. A versão nova lê os dois sinais (labels legadas via `gh search prs` e
   as refs daqui) e escreve só refs. A união mora em outrosRevisando
   (lib/engine/skip-review.js). */
import io from '../io.js';
import { TEMPOS } from '../constants.js';

const PREFIXO = 'farol/revisando/';
const LOGIN_RE = /^[A-Za-z0-9-]+$/;
// as 3 partes sob revisando/: numero do PR, login do GitHub, epoch em ms
const REF_RE = /^(?:refs\/)?farol\/revisando\/(\d+)\/([A-Za-z0-9-]+)\/(\d+)$/;

// repo dono do PR pros endpoints de ref: o objeto do panorama carrega `repo`
// (owner/repo); o fallback extrai da key ("owner/repo#N"). Formato inválido
// devolve '' e nada acontece (melhor não sinalizar que sinalizar no lugar errado).
function repoDoPr(pr) {
  const repo = String((pr && pr.repo) || '').trim() || String((pr && pr.key) || '').split('#')[0].trim();
  return /^[^\s/]+\/[^\s/]+$/.test(repo) ? repo : '';
}

// número do PR: o campo `number` quando existe, senão o sufixo da key.
function numeroDoPr(pr) {
  const n = pr && pr.number;
  if (Number.isInteger(n) && n > 0) return n;
  const daKey = parseInt(String((pr && pr.key) || '').split('#')[1], 10);
  return (Number.isInteger(daKey) && daKey > 0) ? daKey : 0;
}

/* ---------- nome da ref (PURA) ---------- */

// Compõe `refs/farol/revisando/<numero>/<login>/<epoch>`. Entrada torta devolve
// '' (número não inteiro positivo, login fora do formato de conta do GitHub,
// epoch que não é inteiro positivo): melhor não criar que criar ref inendereçável.
function signalRefName(number, login, epochMs) {
  if (!Number.isInteger(number) || number <= 0) return '';
  const l = String(login || '').trim();
  if (!l || !LOGIN_RE.test(l)) return '';
  if (!Number.isInteger(epochMs) || epochMs <= 0) return '';
  return `refs/${PREFIXO}${number}/${l}/${epochMs}`;
}

// Desmonta o nome (com ou sem o prefixo `refs/`). Forma torta devolve null:
// ref alheia no mesmo namespace não pode derrubar a leitura.
function parseSignalRef(ref) {
  const m = String(ref || '').match(REF_RE);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  const epochMs = parseInt(m[3], 10);
  if (!Number.isInteger(number) || number <= 0 || !Number.isInteger(epochMs) || epochMs <= 0) return null;
  return { number, login: m[2], epochMs };
}

// O sinal ainda vale? TTL dos DOIS lados do relógio (ver o cabeçalho): passado
// demais é sessão morta, futuro demais é relógio alheio adiantado.
function sinalVivo(epochMs, agora, ttlMs) {
  return Number.isFinite(epochMs) && Math.abs(agora - epochMs) <= ttlMs;
}

/* ---------- escrita (best-effort, nunca toca a revisão em si) ---------- */

// Cria a ref no início da revisão headless. Guardas iguais às da label antiga
// (raiz A1: sem conta resolvida, sem token, sem url, sem repo válido, o gh NUNCA
// é chamado) mais uma nova: sem headSha não há SHA existente pra ancorar o POST,
// então também não roda. Devolve o nome criado ('' em falha), pra remoção só
// acontecer depois de criação comprovada. `run` é injetável só pra teste.
async function addReviewSignal(engine, pr, headSha, run = io.run) {
  const acc = engine.accountForPr(pr);
  const repo = repoDoPr(pr);
  const sha = String(headSha || '').trim();
  const ref = signalRefName(numeroDoPr(pr), acc, Date.now());
  if (!ref || !pr.url || !engine.tokenFor(acc) || !repo || !sha) return '';
  try {
    const r = await run('gh', ['api', '-X', 'POST', `repos/${repo}/git/refs`,
      '-f', `ref=${ref}`, '-f', `sha=${sha}`], { env: engine.ghEnv(acc) });
    return r.ok ? ref : '';
  } catch { return ''; }
}

// Remove a ref no finally da revisão. No-op sem criação comprovada (refName
// vazio). Falha DEPOIS de uma criação comprovada vira WARN: a ref órfã morre
// pelo TTL (e pelo GC de qualquer Farol), mas é melhor avisar.
async function removeReviewSignal(engine, pr, refName, run = io.run) {
  if (!refName) return;
  try {
    const acc = engine.accountForPr(pr);
    const repo = repoDoPr(pr);
    const alvo = String(refName).replace(/^refs\//, '');
    const r = await run('gh', ['api', '-X', 'DELETE', `repos/${repo}/git/refs/${alvo}`], { env: engine.ghEnv(acc) });
    if (!r.ok) engine.log('WARN', `sinal ${refName} não saiu de ${pr.key}: ${String(r.stderr || '').trim().slice(0, 200)}`);
  } catch (err) {
    engine.log('WARN', `sinal ${refName} não saiu de ${pr.key}: ${err.message}`);
  }
}

/* ---------- leitura por repo (uma chamada por repo por ciclo) ---------- */

// Lista as refs de sinal do repo. `--paginate` é OBRIGATÓRIO: o endpoint pagina
// de 30 em 30 e refs órfãs empurrariam as vivas pra fora da página 1. O --jq
// (embutido no gh, sem dependência) achata as páginas em um nome por linha, que
// é o único jeito estável de consumir --paginate de endpoint que devolve array.
// Falha devolve null e o chamador PRESERVA o snapshot anterior daquele repo,
// mesma filosofia do ciclo de busca (falta de dado não apaga o que se sabia).
async function fetchSignalsDoRepo(engine, repo, acc, run = io.run) {
  if (!repo || !engine.tokenFor(acc)) return null;
  try {
    const r = await run('gh', ['api', '--paginate', `repos/${repo}/git/matching-refs/${PREFIXO}`,
      '--jq', '.[].ref'], { env: engine.ghEnv(acc) });
    if (!r.ok) return null;
    const entries = [];
    for (const linha of String(r.stdout || '').split('\n')) {
      const ref = linha.trim();
      if (!ref) continue;
      const info = parseSignalRef(ref);
      if (info) entries.push({ ref, number: info.number, login: info.login, epochMs: info.epochMs });
    }
    return entries;
  } catch { return null; }
}

// Coleta de lixo: apaga best-effort as refs com epoch no PASSADO além do TTL
// (sessão que morreu sem remover o próprio sinal). Refs "do futuro" além do TTL
// são só ignoradas na leitura, nunca apagadas: relógio alheio adiantado não é
// lixo comprovado. Qualquer conta com push pode apagar ref órfã de outra conta.
async function gcSignals(engine, repo, acc, entries, agora, run = io.run) {
  const ttl = TEMPOS.SINAL_REVISAO_TTL_MS;
  for (const e of entries || []) {
    if (!e || !(agora - e.epochMs > ttl)) continue;
    const alvo = String(e.ref).replace(/^refs\//, '');
    try { await run('gh', ['api', '-X', 'DELETE', `repos/${repo}/git/refs/${alvo}`], { env: engine.ghEnv(acc) }); }
    catch { /* best-effort: a leitura já ignora o expirado de qualquer jeito */ }
  }
}

/* ---------- o refresh do ciclo ---------- */

// Repos que interessam NESTE ciclo: os dos PRs da fila (candidatos do toReview),
// os das pendências bloqueadas por stale_head e os dos PRs do panorama que o
// staleInfo marca como stale (os dois últimos alimentam o launchReReviews).
// Dedup por minúsculas, guardando um PR de exemplo pra resolver a conta.
function reposDeInteresse(engine) {
  const porRepo = new Map();
  const considera = (pr) => {
    const repo = repoDoPr(pr);
    if (repo && !porRepo.has(repo.toLowerCase())) porRepo.set(repo.toLowerCase(), { repo, pr });
  };
  for (const pr of engine.queue || []) considera(pr);
  for (const d of (((engine.decisions || {}).pending) || [])) {
    if (d.blockedKind !== 'stale_head') continue;
    considera({ ...(d.pr || {}), key: d.key });
  }
  for (const pr of engine.panorama || []) {
    const info = (engine.staleInfo || {})[pr.key];
    if (info && info.stale === true) considera(pr);
  }
  return porRepo;
}

// Atualiza engine.reviewSignals (Map repoLower -> entries), UMA chamada gh por
// repo de interesse, com o GC embutido. Falha de um repo preserva a entrada
// anterior do Map (mesma filosofia do ciclo de busca). Nada aqui pode lançar:
// o sinal é cortesia de coordenação, nunca pré-requisito do polling.
async function refreshReviewSignals(engine, run = io.run) {
  try {
    if (!(engine.reviewSignals instanceof Map)) engine.reviewSignals = new Map();
    const agora = Date.now();
    for (const { repo, pr } of reposDeInteresse(engine).values()) {
      const acc = engine.accountForPr(pr);
      const entries = await fetchSignalsDoRepo(engine, repo, acc, run);
      if (entries === null) continue;
      await gcSignals(engine, repo, acc, entries, agora, run);
      engine.reviewSignals.set(repo.toLowerCase(), entries);
    }
  } catch (err) {
    try { engine.log('WARN', `sinal de revisão (refresh): ${err.message}`); }
    catch { /* nem o log pode derrubar o ciclo */ }
  }
}

const signalMod = {
  repoDoPr, numeroDoPr, signalRefName, parseSignalRef, sinalVivo,
  addReviewSignal, removeReviewSignal, fetchSignalsDoRepo, gcSignals,
  reposDeInteresse, refreshReviewSignals,
};
export default signalMod;
export {
  repoDoPr, numeroDoPr, signalRefName, parseSignalRef, sinalVivo,
  addReviewSignal, removeReviewSignal, fetchSignalsDoRepo, gcSignals,
  reposDeInteresse, refreshReviewSignals,
};
