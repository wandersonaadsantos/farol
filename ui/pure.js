'use strict';
/* Funcoes PURAS da UI: so dependem dos argumentos. Nao tocam DOM, nao leem STATE nem
   nenhuma global mutavel, e por isso sao as unicas do front que da pra testar com
   `node --test`. Sairam do ui/app.js, que tem ~2700 linhas e nunca teve teste nenhum
   (e a Onda 4 do docs/QUALITY.md).

   Carregado das duas pontas, sem build step: o navegador le por <script src> antes do
   app.js (as funcoes ficam no escopo global, exatamente como estavam), e o node le pelo
   rodape CommonJS la embaixo. `typeof module` no navegador e 'undefined' e nao lanca.

   REGRA: so entra aqui o que for puro. Funcao que precise de STATE, SCOPE ou document
   fica no app.js; se quiser trazer, passe o que ela le como parametro primeiro. */

/* ---------- folhas: sem dependencia nenhuma ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtClock(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function fmtTok(n) { return Number(n || 0).toLocaleString('pt-BR'); }

function fmtCompact(n) {
  n = Number(n) || 0;
  // a fronteira do M acompanha o ARREDONDAMENTO do k: de 999500 pra cima o k
  // viraria "1000k", então já promove pra "1,0M"
  if (n >= 999500) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace('.', ',') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}

// rotulo de estagio de uma sessao headless pelo tempo de vida em segundos. O card
// nao re-renderiza a cada segundo, entao quem chama e o ticker do app (tickElapsed),
// no mesmo padrao data-started do .session-elapsed (B13: congelava no 1o paint).
function stageLabel(s) {
  if (s < 5) return '(iniciando…)';
  if (s < 15) return '(processando…)';
  return '';
}

// escopo salvo no navegador validado contra as contas atuais: conta removida ou
// renomeada deixava um escopo orfao que esvaziava o Radar pra sempre (B15).
// Compara sem caixa e preserva o valor original quando ele e valido.
function validScope(scope, users) {
  if (!scope || scope === 'all') return 'all';
  const s = String(scope).toLowerCase();
  return (users || []).some(u => String(u).toLowerCase() === s) ? scope : 'all';
}

// abas onde a barra de contas APARECE: so onde o filtro por conta age de verdade
// (Radar, Destaques e Time filtram/agrupam por SCOPE). Allowlist, nao denylist:
// a Entregas nasceu depois e ficou mostrando um filtro que nao filtrava nada (B14);
// aba nova nasce SEM a barra ate alguem decidir que ela respeita o escopo.
function accountBarVisible(nContas, tab) {
  return nContas >= 2 && (tab === 'radar' || tab === 'destaques' || tab === 'time');
}

// marcadores de sessao do merge (auto-merge/admin recusados) expiram quando chega
// um refresh de mergeStates mais NOVO que a marcacao (B17): o dado fresco do repo
// volta a mandar. Presenca de campo nao serve de gatilho (o mergeStates JA existia
// na hora da recusa); a geracao do refresh (lastCheckAt do engine) serve.
// marks: array de pares [key, marcadoEmMs]; retorna as chaves que expiraram.
function expiredSessionMarks(marks, lastCheckAt) {
  const ref = Number(lastCheckAt) || 0;
  if (!ref) return [];
  return (marks || []).filter(([, at]) => ref > (Number(at) || 0)).map(([k]) => k);
}

// decide o que uma lista vinda do motor (myPRs/queue/panorama) deve mostrar quando
// esta vazia: 'loading' (nenhum ciclo terminou ainda desde o boot), 'error' (o
// PRIMEIRO ciclo da vida falhou sem nunca ter confirmado nada) ou 'empty' (pelo
// menos um ciclo terminou com sucesso e a lista, de fato, veio vazia). Uma lista
// com item sempre vira 'list', mesmo se o ciclo mais recente falhou: o motor ja
// preserva o ultimo dado bom (nao some so porque a rede caiu depois).
function listViewState({ lastCheckAt, status, length }) {
  if (length > 0) return 'list';
  if (lastCheckAt) return 'empty';
  return status === 'error' ? 'error' : 'loading';
}

// tira acento pra "revisao" achar "Revisão"
function sysNorm(s) { return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }

/* ---- atribuição de conta pra memória (Destaques/Time) ---- */
function ownerFromUrl(url) { const m = String(url || '').match(/github\.com\/([^\/]+)\//i); return m ? m[1] : ''; }

// 'https://github.com/owner/repo/pull/123' -> 'owner/repo#123' (o key canônico do app)
function prKeyFromUrl(url) {
  const m = String(url || '').match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/i);
  return m ? `${m[1]}#${m[2]}` : '';
}

function repoShort(repo) { return repo.split('/').slice(1).join('/') || repo; }

function stripFence(s) {
  return String(s || '').trim().replace(/^```[a-z]*\s*\r?\n/i, '').replace(/\r?\n```\s*$/, '').trim();
}

function hexToRgba(hex, a) {
  const m = String(hex || '').replace('#', '');
  if (m.length !== 6) return `rgba(255,180,84,${a})`;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function sameSet(a, b) {
  const A = new Set((a || []).map(s => String(s).toLowerCase())), B = new Set((b || []).map(s => String(s).toLowerCase()));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

function diffVs(base, list) {
  const B = new Set((base || []).map(x => x.toLowerCase())), L = new Set((list || []).map(x => x.toLowerCase()));
  return { added: (list || []).filter(x => !B.has(x.toLowerCase())), removed: (base || []).filter(x => !L.has(x.toLowerCase())) };
}

// maior mergedAt de uma lista (ISO ordena lexicograficamente)
function lastMerge(list) { return (list.map(x => x.mergedAt || '').sort().slice(-1)[0]) || ''; }

function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); (m.get(k) || m.set(k, []).get(k)).push(it); }
  return m;
}

function usageMetricVal(b, m) {
  b = b || {};
  if (m === 'custo') return b.costUsd || 0;
  if (m === 'input') return b.inputTokens || 0;
  if (m === 'output') return b.outputTokens || 0;
  if (m === 'cache') return (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0);
  return (b.inputTokens || 0) + (b.outputTokens || 0); // total
}

// path SVG de uma sparkline (linha + area fechada), normalizado pro maior valor
// da serie. w/h em unidades do viewBox (a UI usa 100x26, igual ao mock).
function sparklinePath(vals, w = 100, h = 26) {
  const n = (vals || []).length;
  if (!n) return { line: '', area: '' };
  const mx = Math.max(1e-9, ...vals);
  const dx = n > 1 ? w / (n - 1) : 0;
  const pts = vals.map((v, i) => `${(i * dx).toFixed(1)},${(h - (h - 2) * (v / mx)).toFixed(1)}`);
  return { line: 'M' + pts.join('L'), area: `M0,${h}L${pts.join('L')}L${w},${h}Z` };
}

// chip de variacao percentual (cur vs prev). Sem base valida (prev ausente ou
// zero) nao da pra comparar, entao nao mostra nada, em vez de "Infinity%".
function usageDelta(cur, prev) {
  if (!prev || prev <= 0) return '';
  const pc = Math.round(((cur - prev) / prev) * 100);
  return (pc >= 0 ? '↑ ' : '↓ ') + Math.abs(pc) + '%';
}

// camadas de area empilhada + grade, pra linha do tempo do Consumo. `series` e um
// array por dia, cada item um array de valores (1 por camada, MESMA ordem de
// `names`), ja na metrica escolhida (usageMetricVal ja aplicado por quem chama).
function usageStackLayers(series, names, colors, W, H) {
  const padL = 46, padR = 14, padT = 12, padB = 22;
  const cw = W - padL - padR, ch = H - padT - padB, n = series.length;
  // serie vazia: retorna resultado vazio sem tentar calcular paths com undefined
  if (n === 0) {
    return { layers: [], xs: [], grid: [], padL, padT, padB, cw, ch, W, H, peakIndex: 0, dayTotals: [], maxV: 1e-9 };
  }
  const dayTotals = series.map(vals => vals.reduce((a, b) => a + b, 0));
  const maxV = Math.max(1e-9, ...dayTotals) * 1.06;
  const yOf = v => padT + ch * (1 - v / maxV);
  const xs = (n > 1 ? series.map((_, i) => padL + i * (cw / (n - 1))) : [padL + cw / 2]);
  const r1 = v => Math.round(v * 10) / 10;
  const cum = series.map(() => 0);
  const layers = names.map((name, li) => {
    const base = cum.slice();
    for (let i = 0; i < n; i++) cum[i] += (series[i][li] || 0);
    let d = 'M' + r1(xs[0]) + ',' + r1(yOf(cum[0]));
    for (let i = 1; i < n; i++) d += 'L' + r1(xs[i]) + ',' + r1(yOf(cum[i]));
    for (let i = n - 1; i >= 0; i--) d += 'L' + r1(xs[i]) + ',' + r1(yOf(base[i]));
    return { name, color: colors[li % colors.length], d: d + 'Z' };
  });
  const grid = [maxV, maxV / 2, 0].map(v => ({ y: r1(yOf(v)), value: v }));
  let peakIndex = 0;
  for (let i = 1; i < n; i++) if (dayTotals[i] > dayTotals[peakIndex]) peakIndex = i;
  return { layers, xs: xs.map(r1), grid, padL, padT, padB, cw, ch, W, H, peakIndex, dayTotals, maxV };
}

// indice do dia mais proximo de um X de mouse (coordenadas do MESMO viewBox usado
// em usageStackLayers), limitado as bordas da serie.
function usageHoverIndex(mouseX, geo) {
  const n = geo.xs.length;
  if (n <= 1) return 0;
  const step = geo.cw / (n - 1);
  const idx = Math.round((mouseX - geo.padL) / step);
  return Math.max(0, Math.min(n - 1, idx));
}

function accountSaveArray(list) {
  return (list || []).map(a => {
    const o = { user: a.user, owners: a.owners || [], label: a.label, color: a.color, kind: a.kind || '', muted: !!a.muted };
    if (a.autoReview === true || a.autoReview === false) o.autoReview = a.autoReview;
    if (a.onClean === 'approve' || a.onClean === 'wait') o.onClean = a.onClean;
    if (a.onCaveats === 'approve' || a.onCaveats === 'wait') o.onCaveats = a.onCaveats;
    if (a.onReject === 'request_changes' || a.onReject === 'wait') o.onReject = a.onReject;
    if (a.claudeProfileId) o.claudeProfileId = a.claudeProfileId;
    return o;
  });
}

// aviso de teto da aba Entregas: o gh search corta em DELIVERIES_LIMIT por org e o
// server manda o limite no payload (fonte única do número; a mensagem antiga
// afirmava 100 com o teto real em 1000). Fallback 1000 cobre payload em cache
// gravado antes do campo existir.
function delivCappedMsg(limit) {
  const n = Number(limit) || 1000;
  return `Alguma organização tem mais de ${n} entregas no período; mostrando as ${n} mais recentes.`;
}

function delivGroupCard(head, count, bodyHtml) {
  return `<div class="card deliv-card">
    <details>
      <summary class="deliv-sum">${head}<span class="count">${count}</span></summary>
      ${bodyHtml}
    </details>
  </div>`;
}

/* ---------- log de falhas agrupado (Diagnostico e aba Sistema) ----------
   O agrupamento em si e do lib/log-taxonomy.js (triage), servido em /api/log/triage:
   a UI nao pode dar require num modulo de lib/ (carrega por <script src>, sem build
   step), entao ela consome o JSON. O que mora aqui e SO a formatacao.

   Motivo de existir: o farol.log real tinha 159 linhas que eram 146 eventos de 4
   episodios (70 de limite de plano, 35 de assinatura desligada, 16 de credencial e
   credito, 13 de rede). O Diagnostico despejava as 159 cruas, e "1 problema repetido
   70 vezes" ficava indistinguivel de "70 problemas". */

// '2026-08-07 17:32:15' -> '07/08 17:32'. RECORTE DE TEXTO de proposito: o farol.log
// ja grava em horario LOCAL, entao passar por new Date() so criaria chance de mover a
// hora que a pessoa le no arquivo. Carimbo que nao casa volta como veio, nunca vira
// "Invalid Date" na tela.
function fmtLogStamp(ts) {
  const m = String(ts ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(ts ?? '');
}

// quantos PRs cabem na linha antes de virar "e mais N": o relatorio de diagnostico e
// copiado e colado, entao tamanho de linha importa.
const LOG_REFS_VISIVEIS = 4;

// uma linha por grupo:
// 70x  Limite do plano Claude  [ambiente/espera-reset]  07/08 17:32 -> 07/08 21:28  (8 PRs: o/r#1, ...)
function logGroupLine(g) {
  g = g || {};
  const ini = fmtLogStamp(g.first), fim = fmtLogStamp(g.last);
  // episodio de um instante so nao vira "x -> x" (a comparacao e do texto ja formatado:
  // segundos diferentes dentro do mesmo minuto sao o mesmo instante pra quem le)
  const quando = (!fim || ini === fim) ? ini : `${ini} -> ${fim}`;
  const refs = Array.isArray(g.refs) ? g.refs : [];
  const mostra = refs.slice(0, LOG_REFS_VISIVEIS);
  const resto = refs.length - mostra.length;
  const prs = refs.length
    ? `  (${refs.length} ${refs.length === 1 ? 'PR' : 'PRs'}: ${mostra.join(', ')}${resto ? ` e mais ${resto}` : ''})`
    : '';
  return `${g.count}x  ${g.label}  [${g.grupo}/${g.kind}]  ${quando}${prs}`;
}

// kinds que passam sozinhos (ver lib/log-taxonomy.js): espera-reset espera a hora dela,
// transitorio passa rapido. O resto que nao for operacional exige gente, inclusive kind
// novo que apareca depois: falha nao classificada nunca some da conta.
const LOG_KINDS_SOZINHO = ['transitorio', 'espera-reset'];

function logReadingLine(grupos) {
  let sozinho = 0, humano = 0, operacional = 0;
  for (const g of (grupos || [])) {
    const n = Number(g && g.count) || 0;
    if (g && g.kind === 'operacional') operacional += n;
    else if (g && LOG_KINDS_SOZINHO.includes(g.kind)) sozinho += n;
    else humano += n;
  }
  return `Leitura: ${sozinho} evento(s) se resolvem sozinhos, ${humano} exigem ação humana, ${operacional} são operacionais.`;
}

// o bloco de resumo do Diagnostico: uma linha por grupo (a ordem ja vem por volume do
// triage) e a leitura no fim. Sem grupo, sem bloco.
function logSummaryLines(grupos) {
  const gs = (grupos || []).filter(Boolean);
  if (!gs.length) return [];
  return [...gs.map(logGroupLine), logReadingLine(gs)];
}

// o detalhe cru, limitado: o relatorio e copiado e colado, entao as 159 linhas inteiras
// custavam caro e nao acrescentavam nada depois do resumo. A linha de aviso fica no
// lugar do que foi omitido (no topo), porque o corte guarda as MAIS RECENTES.
function logTailLines(linhas, max = 40) {
  const l = (Array.isArray(linhas) ? linhas : []).slice();
  const n = Math.max(1, Number(max) || 40);
  if (l.length <= n) return l;
  return [`... e mais ${l.length - n} linhas anteriores`, ...l.slice(-n)];
}

function plural(n, um, muitos) { return `${n} ${n === 1 ? um : muitos}`; }

// linha unica da aba Sistema: os n maiores grupos com a contagem. Vazio quando nao ha
// falha, pra a linha sumir em vez de mostrar zero.
function logSummaryShort(grupos, n = 3) {
  const gs = (grupos || []).filter(Boolean);
  if (!gs.length) return '';
  const total = gs.reduce((a, g) => a + (Number(g.count) || 0), 0);
  const top = gs.slice(0, n).map(g => `${g.count}x ${g.label}`).join(' · ');
  const resto = gs.length - Math.min(n, gs.length);
  return `${plural(total, 'falha', 'falhas')} em ${plural(gs.length, 'grupo', 'grupos')}: ${top}`
    + (resto ? ` · e mais ${plural(resto, 'grupo', 'grupos')}` : '');
}

/* ---------- "Meus PRs": PR oculto ----------
   Motivo: experimento velho que nunca vai mergear ficava pra sempre na aba (havia PR
   pessoal parado ha 750 dias) e nao existia jeito de tirar da frente. O motor guarda as
   chaves ocultas (snapshot.hiddenPRs) e continua mandando myPRs COMPLETO: quem esconde
   e a UI, e por isso a separacao mora aqui, pura e testada.
   Ocultar nao e pra sempre: atividade nova no PR faz o motor reexibir sozinho. */

// separa a lista do motor em visiveis e ocultos. Comparacao SEM CAIXA, como no
// validScope/sameSet: o GitHub trata owner/repo sem distinguir maiuscula e uma chave
// gravada com caixa diferente nao pode reaparecer como se nunca tivesse sido ocultada.
function splitHiddenPRs(list, hidden) {
  const H = new Set([...(hidden || [])].map(k => String(k).toLowerCase()));
  const visiveis = [], ocultos = [];
  for (const pr of (list || [])) {
    (H.has(String((pr && pr.key) ?? '').toLowerCase()) ? ocultos : visiveis).push(pr);
  }
  return { visiveis, ocultos };
}

// o conjunto de ocultos que a tela usa AGORA: o que o motor confirmou, mais o que a
// pessoa acabou de ocultar (otimista, some na hora do clique), menos o que ela acabou
// de reexibir. Sem isso o card so sumiria no proximo push de estado, e o clique
// pareceria ter falhado.
function effectiveHidden(doMotor, marcados, reexibidos) {
  const out = new Set([...(doMotor || []), ...(marcados || [])].map(k => String(k).toLowerCase()));
  for (const k of (reexibidos || [])) out.delete(String(k).toLowerCase());
  return [...out];
}

// rodape da secao: "3 PRs ocultos · mostrar". Sem oculto nenhum devolve vazio, pra a
// linha sumir em vez de mostrar zero (mesma regra do logSummaryShort).
function hiddenFootLabel(n, aberto) {
  n = Number(n) || 0;
  if (n <= 0) return '';
  return `${plural(n, 'PR oculto', 'PRs ocultos')} · ${aberto ? 'ocultar' : 'mostrar'}`;
}

// mensagem do vazio de "Meus PRs". Separa dois vazios que a tela confundia: nao ter PR
// aberto e ter TODOS ocultos (que deixava a lista em branco, sem dizer por que nem como
// desfazer). `vs` vem do listViewState, calculado sobre a lista COMPLETA do motor.
function myPRsEmptyMsg(vs, { escopoTodas = true, ocultos = 0 } = {}) {
  if (vs === 'loading') return 'Verificando se você tem PRs abertos…';
  if (vs === 'error') return 'Não foi possível confirmar ainda (a checagem falhou; veja o aviso no topo). Vou tentar de novo no próximo ciclo.';
  const n = Number(ocultos) || 0;
  if (n > 0) return `${plural(n, 'PR seu está oculto', 'PRs seus estão ocultos')} e não há mais nenhum aberto. Use "mostrar", no rodapé da seção, pra ver de novo.`;
  return `Você não tem PRs abertos ${escopoTodas ? 'nas organizações monitoradas' : 'nesta conta'}.`;
}

/* ---------- folhas com relogio: a hora entra por parametro, com default, pra dar pra testar ---------- */

// `agora` entra por parametro (com default) so pra dar pra testar: todos os chamadores
// passam 1 argumento so, entao nada muda pra eles.
function fmtRel(iso, agora = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (agora - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'agora';
  if (s < 3600) return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// data e hora completas, pra tooltip: o formato curto do fmtWhenDay nunca esconde
// informação, ela fica aqui.
function fmtStamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "hoje 17:51", "ontem 16:29", "01/08 15:35", "24/07/2025 09:12". O fmtClock sozinho
// (o que a linha das Revisões recentes usava) dava a hora sem o dia, e numa lista de 30
// revisões a maioria não é de hoje: o número não localizava nada no tempo. O ano só
// aparece quando não é o corrente, senão "24/07" seria ambíguo. A comparação de dia é
// LOCAL (localDayKey, mesmo corte do resto do app) e "ontem" é a data local menos um
// dia CONSTRUÍDA, não uma subtração de 86400s, que escorrega o rótulo na virada de
// fuso. `agora` entra por parâmetro com default só pra dar pra testar, igual ao fmtRel.
function fmtWhenDay(ts, agora = Date.now()) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const ref = new Date(agora);
  const chave = localDayKey(d);
  if (chave === localDayKey(ref)) return `hoje ${hora}`;
  if (chave === localDayKey(new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() - 1))) return `ontem ${hora}`;
  const dia = `${p(d.getDate())}/${p(d.getMonth() + 1)}`;
  return d.getFullYear() === ref.getFullYear() ? `${dia} ${hora}` : `${dia}/${d.getFullYear()} ${hora}`;
}

// chave de dia LOCAL (YYYY-MM-DD) de um timestamp/ISO; '' quando não há data
// válida. Espelha o corte de dia do server (localDay em lib/engine/usage.js, no
// fuso do processo): nunca UTC cru, que zerava o "Hoje" às 21h de Brasília.
function localDayKey(ts) {
  if (ts == null || ts === '') return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// chaves de dia LOCAIS (batendo com o corte do server) dos últimos n dias, incluindo hoje
function usageDayKeysBack(n, agora = Date.now()) {
  const out = [], d = new Date(agora);
  for (let i = n - 1; i >= 0; i--) out.push(localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i)));
  return out;
}

// conta os resolvidos de HOJE (dia local) que terminaram em APPROVE: alimenta o
// "vazio bom" do Radar. resolvedAt é epoch em ms (Date.now() do engine); a versão
// antiga fatiava String(epoch) contra data ISO e nunca batia (ramo morto da v2.30.0).
function aprovadosHoje(resolved, agora = Date.now()) {
  const hoje = localDayKey(agora);
  return (resolved || []).filter(r => r && r.action === 'approve' && localDayKey(r.resolvedAt) === hoje).length;
}

/* ---------- ciclo de vida das operacoes (widgets showOp/updateOp/closeOp da UI) ---------- */

// Maquina de estados minima: 'running' e o unico estado que anda; done/error/cancelled
// sao terminais (nao viram um ao outro nem voltam a running: quem quer "de novo"
// cria outra operacao). O DOM do app.js so consome estas duas decisoes.
function opTransition(atual, proximo) {
  if (atual === 'running' && (proximo === 'done' || proximo === 'error' || proximo === 'cancelled')) return proximo;
  return atual;
}

// prazo de auto-dismiss por estado: running nao some sozinho; done some rapido;
// erro e cancelamento ficam mais tempo na tela pra dar tempo de ler, mas SEMPRE
// somem (pill de erro imortal acumulava uma por tentativa, o M22).
function opDismissDelay(status) {
  if (status === 'running') return null;
  if (status === 'done') return 3000;
  return 6000;
}

/* ---------- dependem das folhas ---------- */

function avatar(login, cls = '') {
  const initial = (login || '?').charAt(0).toUpperCase();
  return `<span class="avatar ${cls}">${esc(initial)}<img src="https://github.com/${encodeURIComponent(login)}.png?size=96" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

function md(src) {
  const lines = esc(String(src || '')).split(/\r?\n/);
  const out = [];
  let list = null, table = null;
  const closeAll = () => {
    if (list) { out.push(`</${list}>`); list = null; }
    if (table) { out.push('</tbody></table>'); table = null; }
  };
  const inline = (s) => {
    // código sai primeiro e PROTEGIDO: o conteúdo de `...` vai pra uma lista e só
    // volta no fim, senão bold/itálico/link reformatam DENTRO do <code> já emitido
    // (f(*args, **kwargs) virava markup corrompido). Sentinela em Private Use Area:
    // não colide com texto de review nem com dígitos soltos.
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(`<code>${c}</code>`); return `\uE000${codes.length - 1}\uE001`; });
    s = s
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/^\[!(NOTE|WARNING|IMPORTANT)\]\s*/i, '');
    return s.replace(/\uE000(\d+)\uE001/g, (m, i) => codes[i]);
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { closeAll(); out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); continue; }
    if (/^(---+|\*\*\*+)$/.test(l.trim())) { closeAll(); out.push('<hr>'); continue; }
    if (/^&gt;\s?/.test(l.trim())) { closeAll(); out.push(`<blockquote>${inline(l.trim().replace(/^&gt;\s?/, ''))}</blockquote>`); continue; }
    if (/^\|.*\|$/.test(l.trim())) {
      const cells = l.trim().slice(1, -1).split('|').map(c => c.trim());
      if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue; // linha separadora
      if (!table) { table = true; out.push('<table><tbody>'); }
      out.push('<tr>' + cells.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>');
      continue;
    } else if (table) { out.push('</tbody></table>'); table = null; }
    const li = l.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (list !== 'ul') { closeAll(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(li[1].replace(/^\[([ x])\]\s*/i, (m, c) => c.toLowerCase() === 'x' ? '☑ ' : '☐ '))}</li>`);
      continue;
    }
    closeAll();
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  closeAll();
  return out.join('\n');
}

function feedLine(it) {
  const icon = { tool: '⚙', text: '💬', warn: '⚠', info: '·' }[it.k] || '·';
  return `<div class="feed-line k-${esc(it.k)}"><span class="feed-t">${fmtClock(it.t)}</span><span class="feed-i">${icon}</span><span class="feed-x">${esc(it.text)}</span></div>`;
}

/* ---------- ops de autoanálise: decisão de fechamento ----------
   A UI cria um widget por análise lançada (opId 'analysis-<key>'), mas quem sabe o FIM
   é o snapshot do SSE: a análise some de activeSessions (mode self) e de
   headlessWaiting quando termina. Protocolo seen/close por causa da corrida: um state
   emitido antes do servidor enfileirar pode chegar depois do clique, e sem o `seen` o
   widget recém-nascido fecharia como "concluído". headlessWaiting também carrega keys
   de revisão normal, sem colisão na prática (o GitHub não pede review pro autor). */
function analysisOpsPlan(ops, snap) {
  snap = snap || {};
  const presentes = new Set();
  for (const s of (snap.activeSessions || [])) {
    if (s && s.mode === 'self') for (const k of (s.keys || [])) presentes.add(k);
  }
  for (const k of (snap.headlessWaiting || [])) presentes.add(k);
  const markSeen = [], close = [];
  for (const op of (ops || [])) {
    if (presentes.has(op.key)) { if (!op.seen) markSeen.push(op.id); }
    else if (op.seen) close.push(op.id);
  }
  return { markSeen, close };
}

/* ---------- pushback: o controle das Revisões recentes ----------
   Saiu do app.js pra ganhar teste; o mapa de pushbacks entra por parâmetro
   (era lido de STATE, global proibida aqui). */
const PB_OPTS = [['', 'sem pushback'], ['author_right', 'o autor tinha razão'], ['we_right', 'nós tínhamos razão'], ['mixed', 'meio-termo']];
const PB_SHORT = { author_right: 'autor tinha razão', we_right: 'nós tínhamos razão', mixed: 'meio-termo' };
function pushbackControl(r, pushbacks) {
  const author = (r.pr && r.pr.author) || r.author || '';
  if (!author) return '';
  const pb = (pushbacks || {})[r.key] || null;
  const pending = pb && pb.status === 'pending';    // auto em dúvida: pede confirmação
  const sum = pending ? `↩ confirmar: ${esc(PB_SHORT[pb.outcome] || 'pushback')}?`
    : pb ? `↩ ${esc(PB_SHORT[pb.outcome] || 'pushback')}${pb.source === 'auto' ? ' (auto)' : ''}`
      : '↩ pushback?';
  const title = pending ? 'O Farol suspeita de pushback aqui; confirme ou corrija o desfecho'
    : 'Marque se o autor contestou este review, pra calibrar os reviews futuros dele';
  return `<details class="pushback"${pb ? ' data-set="1"' : ''}${pending ? ' data-pending="1" open' : ''}>
    <summary title="${title}">${sum}</summary>
    <div class="pb-body">
      ${pending ? `<span class="pb-hint">O Farol detectou possível pushback${pb.note ? ` (${esc(pb.note)})` : ''}. Confirme o desfecho:</span>` : ''}
      <select class="pb-outcome" data-key="${esc(r.key)}" data-author="${esc(author)}">
        ${PB_OPTS.map(([v, t]) => `<option value="${v}"${pb && pb.outcome === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <input class="pb-note" data-key="${esc(r.key)}" data-author="${esc(author)}" value="${esc(pb && pb.note || '')}" placeholder="nota curta (opcional)" spellcheck="false" maxlength="300">
      ${pending ? `<button class="btn sm primary pb-confirm" data-key="${esc(r.key)}" data-author="${esc(author)}" title="Grava o desfecho selecionado como confirmado (re-selecionar a mesma opção não dispara change; com '' confirma que NÃO houve pushback)">Confirmar</button>` : ''}
    </div>
  </details>`;
}

/* ---------- Revisões recentes: a linha inteira ----------
   Três colunas: ícone | conteúdo | quando + ações. A coluna da direita era só o
   relógio e todo o resto empilhava na do meio, então a metade direita da linha ficava
   em branco em qualquer largura usável. Título do PR, autor e o relatório da revisão
   já chegavam no estado e não apareciam.
   A barra esquerda colorida NÃO entra aqui: ela significa urgência (ver acctMark no
   app.js) e esta seção é histórico resolvido. A cor do desfecho vive no selo.
   O que depende de estado global (chip da conta, contador de chat, mapa de pushbacks)
   entra por ctx já resolvido em valor, porque aqui não se lê global. */
const RESOLVED_LABELS = {
  auto_approved: ['✅', 'aprovado sozinho'],
  auto_rejected: ['🔴', 'mudanças pedidas sozinho'],
  posted: ['📬', 'postado por você'],
  already_reviewed: ['✔', 'já revisado por você (não repostei)'],
  skipped: ['⏭', 'pulado']
};
const RESOLVED_ACTIONS = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };
// cor do selo pela AÇÃO postada, não pelo status: o desfecho é o que se procura ao
// varrer a lista. Pulado fica neutro de propósito, porque nada foi postado.
const VERDICT_CLASS = { approve: 'rev-ok', request_changes: 'rev-rc', comment: 'rev-cm' };

function resolvedRow(r, ctx) {
  ctx = ctx || {};
  const [icon, label] = RESOLVED_LABELS[r.status] || ['•', r.status];
  const act = (r.status === 'posted' || r.status === 'already_reviewed')
    ? ` (${RESOLVED_ACTIONS[r.action] || r.action})` : '';
  const url = (r.pr && r.pr.url) || '';
  const title = (r.pr && r.pr.title) || '';
  const author = (r.pr && r.pr.author) || r.author || '';
  // pontos de atenção de um PR resolvido sozinho: ficam claros aqui (expansível)
  const attn = (r.attention && r.attention.length) ? r.attention
    : ((r.status === 'auto_approved' || r.status === 'auto_rejected') ? (r.reasons || []) : []);
  const attnLabel = r.status === 'auto_rejected'
    ? `motivo${attn.length > 1 ? 's' : ''} do pedido de mudanças`
    : `ponto${attn.length > 1 ? 's' : ''} de atenção`;
  const vcls = VERDICT_CLASS[r.action] || '';
  const vc = r.verificationCheckpoint;
  const vcLine = (vc && vc.total)
    ? `Verificação de afirmações: ${vc.confirmedCount} confirmadas de ${vc.total}`
      + (Array.isArray(vc.conflicts) && vc.conflicts.length ? ` · ⚠ ${vc.conflicts.length} divergência(s) entre passadas` : '')
    : '';
  return `<div class="rrow${attn.length ? ' has-attn' : ''}">
    <span class="rr-icon" aria-hidden="true">${icon}</span>
    <div class="rr-main">
      <div class="rr-head">
        <a class="rr-ref" href="${esc(url || '#')}" target="_blank" rel="noreferrer">${esc(r.key)}</a>
        ${ctx.chip || ''}
        ${r.card ? `<span class="pill">${esc(r.card)}</span>` : ''}
        <span class="rr-verdict${vcls ? ` ${vcls}` : ''}">${label}${act}</span>
      </div>
      ${title || author ? `<div class="rr-title" title="${esc(title)}">${esc(title)}${author ? `<span class="rr-author">${title ? '· ' : ''}@${esc(author)}</span>` : ''}</div>` : ''}
      <div class="rr-disc">
        ${vcLine ? `<div class="rr-verification">${esc(vcLine)}</div>` : ''}
        ${attn.length ? `<details class="resolved-attn"><summary>⚠ ${attn.length} ${attnLabel}</summary><ul class="dec-reasons">${attn.map(p => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
        ${r.reportMarkdown ? `<details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(r.reportMarkdown)}</div></details>` : ''}
        ${pushbackControl(r, ctx.pushbacks)}
      </div>
    </div>
    <div class="rr-side">
      <span class="rr-when" title="${esc(fmtStamp(r.resolvedAt))}">${esc(fmtWhenDay(r.resolvedAt, ctx.agora))}</span>
      <div class="rr-acts">
        <button class="btn icon sm ghost act-chat" data-key="${esc(r.key)}" data-url="${esc(url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar sobre este PR">💬${ctx.chatBadge || ''}</button>
        ${url ? `<button class="btn icon sm ghost act-review" data-url="${esc(url)}" title="Revisar de novo" aria-label="Revisar de novo">↻</button>` : ''}
        <button class="btn icon sm ghost rr-copy" data-url="${esc(url)}" data-key="${esc(r.key)}" title="Copiar a URL do PR" aria-label="Copiar a URL do PR">⧉</button>
        <a class="btn icon sm ghost" href="${esc(url || '#')}" target="_blank" rel="noreferrer" title="Abrir no GitHub" aria-label="Abrir no GitHub">↗</a>
      </div>
    </div>
  </div>`;
}

function delivPrRow(it) {
  return `<div class="row">
    <span class="ref"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">${esc(it.key)}</a></span>
    <span class="title" title="${esc(it.title)}">${esc(it.title)}</span>
    <span class="who">@${esc(it.author)}</span>
    <span class="when">${fmtRel(it.mergedAt)}</span>
  </div>`;
}

// linha de PR dentro de um sub-grupo por repo (o repo já é o cabeçalho, então
// mostra só o número e omite o @autor, que é o dono do card na visão por pessoa)
function delivPrRowInRepo(it) {
  const num = String(it.key).split('#')[1] || it.number;
  return `<div class="row">
    <span class="ref"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">#${esc(num)}</a></span>
    <span class="title" title="${esc(it.title)}">${esc(it.title)}</span>
    <span class="when">${fmtRel(it.mergedAt)}</span>
  </div>`;
}

/* ---------- montagem da aba Entregas (agrupa, ordena e formata) ---------- */

// corpo agrupado por projeto (repo): usado na visão por responsável
function delivRepoSubgroups(list) {
  const groups = [...groupBy(list, it => it.repo).entries()].map(([repo, prs]) => ({ repo, prs, last: lastMerge(prs) }));
  groups.sort((a, b) => b.prs.length - a.prs.length || String(b.last).localeCompare(String(a.last)));
  return groups.map(g => `
    <details class="deliv-subgroup" open>
      <summary class="deliv-subhead"><span class="deliv-subname">${esc(g.repo)}</span><span class="count sm">${g.prs.length}</span></summary>
      <div class="rows">${g.prs.map(delivPrRowInRepo).join('')}</div>
    </details>`).join('');
}

function deliveriesByRepo(items) {
  const groups = [...groupBy(items, it => it.repo).entries()].map(([repo, list]) => {
    const autores = new Set(list.map(x => x.author).filter(Boolean)).size;
    return { list, last: lastMerge(list), head: `<span class="deliv-name">${esc(repo)}</span><span class="deliv-meta">${autores} ${autores === 1 ? 'autor' : 'autores'} · último ${fmtRel(lastMerge(list))}</span>` };
  });
  groups.sort((a, b) => b.list.length - a.list.length || String(b.last).localeCompare(String(a.last)));
  return groups.map(g => delivGroupCard(g.head, g.list.length, `<div class="rows">${g.list.map(delivPrRow).join('')}</div>`)).join('');
}

function deliveriesByAuthor(items) {
  const groups = [...groupBy(items, it => it.author || '(desconhecido)').entries()].map(([login, list]) => {
    const repos = new Set(list.map(x => x.repo)).size;
    return { list, last: lastMerge(list), head: `${avatar(login)}<span class="deliv-name">@${esc(login)}</span><span class="deliv-meta">${repos} ${repos === 1 ? 'repo' : 'repos'} · último ${fmtRel(lastMerge(list))}</span>` };
  });
  groups.sort((a, b) => b.list.length - a.list.length || String(b.last).localeCompare(String(a.last)));
  return groups.map(g => delivGroupCard(g.head, g.list.length, delivRepoSubgroups(g.list))).join('');
}

/* Rodape CommonJS: so o node entra aqui. No navegador estas funcoes ja estao no
   escopo global por terem sido declaradas no topo deste arquivo. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    esc, fmtClock, fmtTok, fmtCompact, sysNorm, ownerFromUrl, prKeyFromUrl, repoShort, stripFence, hexToRgba,
    sameSet, diffVs, lastMerge, groupBy, usageMetricVal, sparklinePath, usageDelta, usageStackLayers, usageHoverIndex, accountSaveArray, delivGroupCard, delivCappedMsg, fmtRel,
    usageDayKeysBack, localDayKey, aprovadosHoje, avatar, md, feedLine, analysisOpsPlan, delivPrRow, delivPrRowInRepo, delivRepoSubgroups,
    deliveriesByRepo, deliveriesByAuthor, pushbackControl, PB_OPTS, PB_SHORT,
    fmtStamp, fmtWhenDay, resolvedRow,
    fmtLogStamp, logGroupLine, logReadingLine, logSummaryLines, logTailLines, logSummaryShort,
    opTransition, opDismissDelay, stageLabel, validScope, accountBarVisible, expiredSessionMarks, listViewState,
    plural, splitHiddenPRs, effectiveHidden, hiddenFootLabel, myPRsEmptyMsg
  };
}
