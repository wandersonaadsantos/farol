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

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Parser seguro pros eventos SSE: evento torto NUNCA derruba o handler; o
// contrato do engenharia-standards é "entrada não confiável se valida, não se
// afirma". Devolve null em vez de lançar; quem chama decide se ignora.
export function safeJsonParse(texto) {
  if (typeof texto !== 'string' || texto === '') return null;
  try { return JSON.parse(texto); } catch { return null; }
}

export function fmtClock(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function fmtTok(n) { return Number(n || 0).toLocaleString('pt-BR'); }

export function fmtCompact(n) {
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
export function stageLabel(s) {
  if (s < 5) return '(iniciando…)';
  if (s < 15) return '(processando…)';
  return '';
}

// escopo salvo no navegador validado contra as contas atuais: conta removida ou
// renomeada deixava um escopo orfao que esvaziava o Radar pra sempre (B15).
// Compara sem caixa e preserva o valor original quando ele e valido.
export function validScope(scope, users) {
  if (!scope || scope === 'all') return 'all';
  const s = String(scope).toLowerCase();
  return (users || []).some(u => String(u).toLowerCase() === s) ? scope : 'all';
}

// abas onde a barra de contas APARECE: so onde o filtro por conta age de verdade
// (Radar, Destaques e Time filtram/agrupam por SCOPE). Allowlist, nao denylist:
// a Entregas nasceu depois e ficou mostrando um filtro que nao filtrava nada (B14);
// aba nova nasce SEM a barra ate alguem decidir que ela respeita o escopo.
export function accountBarVisible(nContas, tab) {
  return nContas >= 2 && (tab === 'radar' || tab === 'destaques' || tab === 'time');
}

// marcadores de sessao do merge (auto-merge/admin recusados) expiram quando chega
// um refresh de mergeStates mais NOVO que a marcacao (B17): o dado fresco do repo
// volta a mandar. Presenca de campo nao serve de gatilho (o mergeStates JA existia
// na hora da recusa); a geracao do refresh (lastCheckAt do engine) serve.
// marks: array de pares [key, marcadoEmMs]; retorna as chaves que expiraram.
export function expiredSessionMarks(marks, lastCheckAt) {
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
export function listViewState({ lastCheckAt, status, length }) {
  if (length > 0) return 'list';
  if (lastCheckAt) return 'empty';
  return status === 'error' ? 'error' : 'loading';
}

// tira acento pra "revisao" achar "Revisão"
export function sysNorm(s) { return String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(); }

/* ---- atribuição de conta pra memória (Destaques/Time) ---- */
export function ownerFromUrl(url) { const m = String(url || '').match(/github\.com\/([^\/]+)\//i); return m ? m[1] : ''; }

// 'https://github.com/owner/repo/pull/123' -> 'owner/repo#123' (o key canônico do app)
export function prKeyFromUrl(url) {
  const m = String(url || '').match(/github\.com\/([^\/]+\/[^\/]+)\/pull\/(\d+)/i);
  return m ? `${m[1]}#${m[2]}` : '';
}

export function repoShort(repo) { return repo.split('/').slice(1).join('/') || repo; }

export function stripFence(s) {
  return String(s || '').trim().replace(/^```[a-z]*\s*\r?\n/i, '').replace(/\r?\n```\s*$/, '').trim();
}

export function hexToRgba(hex, a) {
  const m = String(hex || '').replace('#', '');
  if (m.length !== 6) return `rgba(255,180,84,${a})`;
  const r = parseInt(m.slice(0, 2), 16), g = parseInt(m.slice(2, 4), 16), b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function sameSet(a, b) {
  const A = new Set((a || []).map(s => String(s).toLowerCase())), B = new Set((b || []).map(s => String(s).toLowerCase()));
  if (A.size !== B.size) return false;
  for (const x of A) if (!B.has(x)) return false;
  return true;
}

export function diffVs(base, list) {
  const B = new Set((base || []).map(x => x.toLowerCase())), L = new Set((list || []).map(x => x.toLowerCase()));
  return { added: (list || []).filter(x => !B.has(x.toLowerCase())), removed: (base || []).filter(x => !L.has(x.toLowerCase())) };
}

// maior mergedAt de uma lista (ISO ordena lexicograficamente)
export function lastMerge(list) { return (list.map(x => x.mergedAt || '').sort().slice(-1)[0]) || ''; }

export function groupBy(items, keyFn) {
  const m = new Map();
  for (const it of items) { const k = keyFn(it); (m.get(k) || m.set(k, []).get(k)).push(it); }
  return m;
}

export function usageMetricVal(b, m) {
  b = b || {};
  if (m === 'custo') return b.costUsd || 0;
  if (m === 'input') return b.inputTokens || 0;
  if (m === 'output') return b.outputTokens || 0;
  if (m === 'cache') return (b.cacheReadTokens || 0) + (b.cacheCreationTokens || 0);
  return (b.inputTokens || 0) + (b.outputTokens || 0); // total
}

// path SVG de uma sparkline (linha + area fechada), normalizado pro maior valor
// da serie. w/h em unidades do viewBox (a UI usa 100x26, igual ao mock).
export function sparklinePath(vals, w = 100, h = 26) {
  const n = (vals || []).length;
  if (!n) return { line: '', area: '' };
  const mx = Math.max(1e-9, ...vals);
  const dx = n > 1 ? w / (n - 1) : 0;
  const pts = vals.map((v, i) => `${(i * dx).toFixed(1)},${(h - (h - 2) * (v / mx)).toFixed(1)}`);
  return { line: 'M' + pts.join('L'), area: `M0,${h}L${pts.join('L')}L${w},${h}Z` };
}

// chip de variacao percentual (cur vs prev). Sem base valida (prev ausente ou
// zero) nao da pra comparar, entao nao mostra nada, em vez de "Infinity%".
export function usageDelta(cur, prev) {
  if (!prev || prev <= 0) return '';
  const pc = Math.round(((cur - prev) / prev) * 100);
  return (pc >= 0 ? '↑ ' : '↓ ') + Math.abs(pc) + '%';
}

// camadas de area empilhada + grade, pra linha do tempo do Consumo. `series` e um
// array por dia, cada item um array de valores (1 por camada, MESMA ordem de
// `names`), ja na metrica escolhida (usageMetricVal ja aplicado por quem chama).
export function usageStackLayers(series, names, colors, W, H) {
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
export function usageHoverIndex(mouseX, geo) {
  const n = geo.xs.length;
  if (n <= 1) return 0;
  const step = geo.cw / (n - 1);
  const idx = Math.round((mouseX - geo.padL) / step);
  return Math.max(0, Math.min(n - 1, idx));
}

// matriz Tipo x Modelo pro periodo pedido (dias, as chaves de usageDayKeysBack).
// matrixSeries vem inteiro do backend (usage.js), com granularidade diaria, quem
// soma o periodo escolhido e esta funcao, do mesmo jeito que o resto da tela soma
// series no cliente. Celula sem dado no periodo vem zerada, nao ausente.
export function usageMatrixRows(matrixSeries, kindNames, modelNames, days, metric) {
  const daySet = new Set(days);
  const vals = kindNames.map(() => modelNames.map(() => 0));
  for (const entry of matrixSeries) {
    if (!daySet.has(entry.day)) continue;
    kindNames.forEach((k, i) => {
      const row = entry.cells[k] || {};
      modelNames.forEach((m, j) => { vals[i][j] += usageMetricVal(row[m], metric); });
    });
  }
  const rowTotals = vals.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals = modelNames.map((_, j) => vals.reduce((a, row) => a + row[j], 0));
  const grand = rowTotals.reduce((a, b) => a + b, 0);
  const cellMax = Math.max(1e-9, ...vals.flat());
  const rows = kindNames.map((k, i) => ({
    kind: k,
    cells: modelNames.map((m, j) => ({ model: m, value: vals[i][j], intensity: vals[i][j] / cellMax })),
    total: rowTotals[i],
  }));
  return { rows, colTotals, grand };
}

// _resto e a fatia reconciliada de um dia sem detalhamento (registro anterior aos
// buckets cruzados da v2.38.0, ou sessao gravada por versao antiga no meio do dia):
// o engine garante que soma(camadas) == serie do dia, e essa camada e a diferenca.
export const USAGE_KIND_LABEL = { review: 'Revisão', self: 'Autoanálise', pushback: 'Pushback', tool: 'Ferramentas', chat: 'Chat', outro: 'Outro', _resto: 'Sem detalhamento' };

// o carimbo de versao por sessao (campo `farol`) nasceu na v2.42.0: sessao sem
// o campo e, por definicao, anterior a essa versao. Constante FIXA, nunca
// acompanha a versao atual do app.
export const FAROL_STAMP_SINCE = '2.42.0';
export const FAROL_PRE_STAMP_LABEL = `< ${FAROL_STAMP_SINCE}`;

// linha pronta pra tabela de Sessoes recentes: rotulo de tipo, referencia (com
// fallback sem travessao), tokens somados, custo com 2 casas e o estado (ok/erro).
export function usageSessionRow(s, agora = Date.now()) {
  return {
    whenLabel: fmtWhenDay(s.at, agora),
    kindLabel: USAGE_KIND_LABEL[s.kind] || s.kind,
    ref: s.ref || '(sem referência)',
    model: s.model || '',
    // versao do Farol que gravou a sessao. Sessao antiga (antes desta feature)
    // nao tem o campo: mostra o rotulo de pre-carimbo (regra de EXIBICAO, o
    // registro em usage-sessions.json continua intocado, sem retro-carimbo).
    farol: s.farol || FAROL_PRE_STAMP_LABEL,
    tokLabel: fmtTok((s.inputTokens || 0) + (s.outputTokens || 0)),
    costLabel: (s.costUsd || 0).toFixed(2),
    // 'cancelada' existe desde a v2.40.0 (sessão morta pelo usuário DEPOIS do result:
    // gastou, mas não concluiu); antes caía como 'ok', indistinguível de concluída
    stLabel: s.status === 'erro' ? 'erro' : s.status === 'cancelada' ? 'cancelada' : 'ok',
    stClass: s.status === 'erro' ? 'erro' : s.status === 'cancelada' ? 'cancelada' : 'ok',
  };
}

export function accountSaveArray(list) {
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
// gravado antes do campo existir. "atividade mais recente" (não "mais recentes"):
// o corte do gh é por --sort updated, aproximação de recência, não data de merge.
export function delivCappedMsg(limit) {
  const n = Number(limit) || 1000;
  return `Alguma organização tem mais de ${n} entregas no período; mostrando as ${n} de atividade mais recente (números e gráfico podem subestimar).`;
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
export function fmtLogStamp(ts) {
  const m = String(ts ?? '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : String(ts ?? '');
}

// quantos PRs cabem na linha antes de virar "e mais N": o relatorio de diagnostico e
// copiado e colado, entao tamanho de linha importa.
const LOG_REFS_VISIVEIS = 4;

// uma linha por grupo:
// 70x  Limite do plano Claude  [ambiente/espera-reset]  07/08 17:32 -> 07/08 21:28  (8 PRs: o/r#1, ...)
export function logGroupLine(g) {
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

export function logReadingLine(grupos) {
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
export function logSummaryLines(grupos) {
  const gs = (grupos || []).filter(Boolean);
  if (!gs.length) return [];
  return [...gs.map(logGroupLine), logReadingLine(gs)];
}

// o detalhe cru, limitado: o relatorio e copiado e colado, entao as 159 linhas inteiras
// custavam caro e nao acrescentavam nada depois do resumo. A linha de aviso fica no
// lugar do que foi omitido (no topo), porque o corte guarda as MAIS RECENTES.
export function logTailLines(linhas, max = 40) {
  const l = (Array.isArray(linhas) ? linhas : []).slice();
  const n = Math.max(1, Number(max) || 40);
  if (l.length <= n) return l;
  return [`... e mais ${l.length - n} linhas anteriores`, ...l.slice(-n)];
}

export function plural(n, um, muitos) { return `${n} ${n === 1 ? um : muitos}`; }

// linha unica da aba Sistema: os n maiores grupos com a contagem. Vazio quando nao ha
// falha, pra a linha sumir em vez de mostrar zero.
export function logSummaryShort(grupos, n = 3) {
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
export function splitHiddenPRs(list, hidden) {
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
export function effectiveHidden(doMotor, marcados, reexibidos) {
  const out = new Set([...(doMotor || []), ...(marcados || [])].map(k => String(k).toLowerCase()));
  for (const k of (reexibidos || [])) out.delete(String(k).toLowerCase());
  return [...out];
}

// rodape da secao: "3 PRs ocultos · mostrar". Sem oculto nenhum devolve vazio, pra a
// linha sumir em vez de mostrar zero (mesma regra do logSummaryShort).
export function hiddenFootLabel(n, aberto) {
  n = Number(n) || 0;
  if (n <= 0) return '';
  return `${plural(n, 'PR oculto', 'PRs ocultos')} · ${aberto ? 'ocultar' : 'mostrar'}`;
}

// mensagem do vazio de "Meus PRs". Separa dois vazios que a tela confundia: nao ter PR
// aberto e ter TODOS ocultos (que deixava a lista em branco, sem dizer por que nem como
// desfazer). `vs` vem do listViewState, calculado sobre a lista COMPLETA do motor.
export function myPRsEmptyMsg(vs, { escopoTodas = true, ocultos = 0 } = {}) {
  if (vs === 'loading') return 'Verificando se você tem PRs abertos…';
  if (vs === 'error') return 'Não foi possível confirmar ainda (a checagem falhou; veja o aviso no topo). Vou tentar de novo no próximo ciclo.';
  const n = Number(ocultos) || 0;
  if (n > 0) return `${plural(n, 'PR seu está oculto', 'PRs seus estão ocultos')} e não há mais nenhum aberto. Use "mostrar", no rodapé da seção, pra ver de novo.`;
  return `Você não tem PRs abertos ${escopoTodas ? 'nas organizações monitoradas' : 'nesta conta'}.`;
}

// G19 (I3): a guarda de merge em andamento recusa a SEGUNDA metade de um clique
// duplo. Nada falhou ali: o primeiro merge seguiu em frente e o toast vermelho
// mentia, aparecendo colado no "merge realizado com sucesso" do mesmo clique.
// Recusa benigna informa, nao alarma. Fica aqui, e nao inline no handler, porque
// os tres botoes de merge (normal, auto, admin) passam pela MESMA guarda do
// mergeSelfPR: um so lugar decide a cor.
export const MERGE_EM_ANDAMENTO = 'merge já em andamento';
export function mergeToastKind(erro) {
  return String(erro || '') === MERGE_EM_ANDAMENTO ? 'info' : 'error';
}

/* ---------- folhas com relogio: a hora entra por parametro, com default, pra dar pra testar ---------- */

// `agora` entra por parametro (com default) so pra dar pra testar: todos os chamadores
// passam 1 argumento so, entao nada muda pra eles.
export function fmtRel(iso, agora = Date.now()) {
  if (!iso) return '';
  const s = Math.max(0, (agora - new Date(iso).getTime()) / 1000);
  if (s < 90) return 'agora';
  if (s < 3600) return `${Math.round(s / 60)}min`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

// data e hora completas, pra tooltip: o formato curto do fmtWhenDay nunca esconde
// informação, ela fica aqui.
export function fmtStamp(ts) {
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
export function fmtWhenDay(ts, agora = Date.now()) {
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
export function localDayKey(ts) {
  if (ts == null || ts === '') return '';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// chaves de dia LOCAIS (batendo com o corte do server) dos últimos n dias, incluindo hoje
export function usageDayKeysBack(n, agora = Date.now()) {
  const out = [], d = new Date(agora);
  for (let i = n - 1; i >= 0; i--) out.push(localDayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - i)));
  return out;
}

// conta os resolvidos de HOJE (dia local) que terminaram em APPROVE: alimenta o
// "vazio bom" do Radar. resolvedAt é epoch em ms (Date.now() do engine); a versão
// antiga fatiava String(epoch) contra data ISO e nunca batia (ramo morto da v2.30.0).
export function aprovadosHoje(resolved, agora = Date.now()) {
  const hoje = localDayKey(agora);
  return (resolved || []).filter(r => r && r.action === 'approve' && localDayKey(r.resolvedAt) === hoje).length;
}

/* ---------- ciclo de vida das operacoes (widgets showOp/updateOp/closeOp da UI) ---------- */

// Maquina de estados minima: 'running' e o unico estado que anda; done/error/cancelled
// sao terminais (nao viram um ao outro nem voltam a running: quem quer "de novo"
// cria outra operacao). O DOM do app.js so consome estas duas decisoes.
export function opTransition(atual, proximo) {
  if (atual === 'running' && (proximo === 'done' || proximo === 'error' || proximo === 'cancelled')) return proximo;
  return atual;
}

// prazo de auto-dismiss por estado: running nao some sozinho; done some rapido;
// erro e cancelamento ficam mais tempo na tela pra dar tempo de ler, mas SEMPRE
// somem (pill de erro imortal acumulava uma por tentativa, o M22).
export function opDismissDelay(status) {
  if (status === 'running') return null;
  if (status === 'done') return 3000;
  return 6000;
}

/* ---------- dependem das folhas ---------- */

export function avatar(login, cls = '') {
  const initial = (login || '?').charAt(0).toUpperCase();
  return `<span class="avatar ${cls}">${esc(initial)}<img src="https://github.com/${encodeURIComponent(login)}.png?size=96" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

/* ---------- menções navegáveis: UM primitivo por tipo de coisa ----------
   Regra do app (pedido do Wanderson, 11/08/2026): "se tem menção a uma coisa X
   ou Y eu deveria navegar até aquela coisa por clique". Toda menção passa por
   um destes helpers, pra o destino de cada tipo ser o MESMO em toda tela e
   ninguém precisar reinventar (nem esquecer) o link/foto no próximo painel:

   | menção | helper | destino |
   |---|---|---|
   | pessoa (@login) | personMention | perfil dela no GitHub |
   | repositório (owner/repo) | repoMention | repo no GitHub |
   | PR (owner/repo#N) | prRefMention | o PR no GitHub |
   | ferramenta (Kudos/Diagnóstico) | toolRefGoto | o painel dela no próprio app |
   | ref de sessão (coluna do Consumo) | sessionRefMention | roteia entre os de cima |
   | lugar do próprio app | data-goto (ui/app.js) | aba/seção/grupo, com destaque |

   Pessoa SEMPRE vem com foto: era a assimetria que o Wanderson apontou no
   Panorama (foto em Revisões recentes e Entregas, texto pelado no resto). */
const GH_URL = 'https://github.com/';

// owner/repo#N (o formato de `pr.key` e do `ref` das sessões). Só o que casa
// vira link: ref de ferramenta ("Kudos · BIUD trabalho") e "(sem referência)"
// seguem texto puro, sem inventar URL.
const PR_REF_RE = /^([\w.-]+)\/([\w.-]+)#(\d+)$/;

export function ghPrUrl(ref) {
  const m = PR_REF_RE.exec(String(ref || '').trim());
  return m ? `${GH_URL}${m[1]}/${m[2]}/pull/${m[3]}` : '';
}

// menção de pessoa: foto + @login, clicável pro perfil no GitHub. `cls` entra
// no avatar ('sm' nas linhas compactas). semFoto=true só onde a foto não cabe
// (linha de PR das Entregas, que já roda dentro de um grupo com a foto no topo).
export function personMention(login, cls = '', semFoto = false) {
  const nome = String(login || '').trim();
  if (!nome) return `<span class="person-mention vazio">@(desconhecido)</span>`;
  return `<a class="person-mention" href="${GH_URL}${encodeURIComponent(nome)}" target="_blank" rel="noreferrer" title="Abrir @${esc(nome)} no GitHub">`
    + `${semFoto ? '' : avatar(nome, cls)}<span class="pm-login">@${esc(nome)}</span></a>`;
}

// menção de repositório (owner/repo): leva ao repo no GitHub. `label` permite
// mostrar o nome curto e ainda assim linkar o caminho completo.
export function repoMention(repo, label) {
  const nome = String(repo || '').trim();
  if (!nome) return '';
  return `<a class="repo-mention" href="${GH_URL}${nome.split('/').map(encodeURIComponent).join('/')}" target="_blank" rel="noreferrer" title="Abrir ${esc(nome)} no GitHub">${esc(label || nome)}</a>`;
}

// menção de PR pela referência textual (owner/repo#N): vira link; qualquer
// outra coisa volta como texto escapado, no mesmo lugar, sem link quebrado.
export function prRefMention(ref, cls = '') {
  const url = ghPrUrl(ref);
  const txt = esc(String(ref || ''));
  if (!url) return `<span class="${esc(cls)}">${txt}</span>`;
  return `<a class="${esc(cls)} pr-ref-mention" href="${url}" target="_blank" rel="noreferrer" title="Abrir ${txt} no GitHub">${txt}</a>`;
}

// Lê um valor de data-goto ('tipo:alvo[:seletor]'). O seletor é o RESTO inteiro,
// nunca só o terceiro pedaço: seletor CSS tem ':' (`.acct-label:nth-child(2)`) e
// destino de Entregas tem '/' e ':' no meio.
export function parseGoto(spec) {
  const [tipo, alvo, ...resto] = String(spec ?? '').split(':');
  return { tipo: tipo || '', alvo: alvo || '', seletor: resto.join(':') };
}

// Ferramenta interna: o "lugar" dela não é uma URL, é um painel do próprio app,
// então o destino sai no formato data-goto do ui/app.js. Os rótulos são os que o
// lib/engine/tools.js monta pro ref da sessão ('Kudos', 'Kudos · <escopo>' e
// 'Diagnóstico do Farol'); o escopo é nome de conta, entra no rótulo mas NÃO no
// destino, que é constante.
const TOOL_REF_GOTO = [
  [/^Kudos( · .+)?$/, 'aba:destaques:#kudosPanel'],
  [/^Diagnóstico do Farol$/, 'sys:diag:#healthPanel'],
];

export function toolRefGoto(ref) {
  const s = String(ref ?? '').trim();
  for (const [re, destino] of TOOL_REF_GOTO) if (re.test(s)) return destino;
  return '';
}

// menção do ref de uma sessão (coluna "PR / sessão" do Consumo), que é polimórfico:
// revisão/pushback/chat gravam a chave do PR, ferramenta grava o rótulo dela. Cada
// um vai pro SEU destino; o que não se reconhece continua texto puro, no mesmo
// lugar, sem link quebrado nem clique que não leva a nada.
export function sessionRefMention(ref, cls = '') {
  if (ghPrUrl(ref)) return prRefMention(ref, cls);
  const txt = esc(String(ref || ''));
  const destino = toolRefGoto(ref);
  if (!destino) return `<span class="${esc(cls)}">${txt}</span>`;
  return `<span class="${esc(cls)} is-goto" data-goto="${esc(destino)}" role="button" tabindex="0" title="Abrir ${txt} no Farol">${txt}</span>`;
}

/* ---------- checks de OPERAÇÃO (aba Sistema, ao lado dos de ambiente) ----------
   Os 5 checks que já existiam (gh, conta primária, Claude Code, Git Bash, pasta)
   respondem "o Farol consegue rodar?". Nenhum responde "o Farol vai achar
   alguma coisa?", e essa é a pergunta que fica sem resposta quando a tela vem
   vazia. O caso que motivou (Wanderson, 11/08/2026): conta cadastrada SEM
   organização nenhuma deixa os 5 verdes e o painel vazio pra sempre, porque o
   fan-out da busca é `accountList().flatMap(acc => acc.owners...)`: sem owner,
   a lista de alvos é vazia e o gh nunca é chamado. Silêncio total.

   Um check por conta (dizer QUAL conta é o que torna acionável com várias) mais
   um agregado pro caso de tudo silenciado. Sem conta nenhuma devolve vazio: aí
   quem fala é o banner de boas-vindas, e dois avisos pro mesmo problema é ruído. */
export function operationChecks(accounts) {
  const lista = (Array.isArray(accounts) ? accounts : []).filter(a => a && String(a.user || '').trim());
  if (!lista.length) return [];
  const alvo = u => `sys:accounts:.acct-label[data-user="${String(u).replace(/"/g, '\\"')}"]`;
  const checks = lista.map(a => {
    const orgs = (a.owners || []).filter(Boolean);
    if (!orgs.length) {
      return { ok: false, label: `Monitoramento de @${a.user}`, goto: alvo(a.user),
        detail: 'sem organização monitorada: nenhuma busca é feita por esta conta, e o painel fica vazio sem erro' };
    }
    if (!a.tokenOk) {
      return { ok: false, label: `Monitoramento de @${a.user}`, goto: alvo(a.user),
        detail: `sem token no gh: as buscas de ${orgs.join(', ')} são puladas (rode gh auth login para esta conta)` };
    }
    return { ok: true, label: `Monitoramento de @${a.user}`, goto: alvo(a.user),
      detail: `vigiando ${orgs.join(', ')}${a.muted ? ' (silenciada: não aparece no painel)' : ''}` };
  });
  // silenciar UMA conta é escolha; silenciar todas esvazia o painel inteiro, e aí
  // o vazio volta a não ter explicação, que é justamente o defeito de origem
  if (lista.length && lista.every(a => a.muted)) {
    checks.push({ ok: false, label: 'Painel', goto: 'sys:accounts:#accountsManager',
      detail: 'todas as contas estão silenciadas: nada aparece no painel, mesmo com PR esperando' });
  }
  return checks;
}

/* A célula da coluna "PR / sessão" do Consumo. DOIS destinos no mesmo lugar, e
   por isso dois elementos (a doutrina do app é um destino por elemento): o texto
   leva ao PR no GitHub, o botão ao lado abre a caixa de revisão AQUI DENTRO.
   Só linha de PR ganha o botão: ferramenta e sessão sem referência não têm
   revisão nenhuma pra abrir, e botão que não faz nada é pior que botão nenhum. */
export function sessionRefCell(ref, cls = 'usage-sessions-ref') {
  const mencao = sessionRefMention(ref, cls);
  if (!ghPrUrl(ref)) return `<span class="usage-ref-cell">${mencao}</span>`;
  const k = esc(String(ref));
  return `<span class="usage-ref-cell">${mencao}`
    + `<button class="usage-review-btn" data-review-key="${k}" title="Ver a revisão de ${k} aqui no Farol" aria-label="Ver a revisão de ${k} aqui no Farol">`
    + `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 5h16M4 12h10M4 19h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
    + `</button></span>`;
}

// O conteúdo da caixa de revisão (o mesmo que o card mostra em "Precisa de você"
// e "Revisões recentes"): veredito, PR, autor, pontos de atenção e o relatório.
// Cada ausência vira texto explícito: caixa em branco não distingue "não achei"
// de "achei e está vazio", e é exatamente essa confusão que motivou a feature.
const VERDICT_LABEL = { approve: 'Aprovável', request_changes: 'Com blocker', comment: 'Comentado' };

export function reviewBoxHtml(d) {
  if (!d) return `<div class="empty">Nenhuma revisão registrada pra este PR no histórico do Farol.</div>`;
  const v = VERDICT_LABEL[d.verdict] || d.verdict || 'sem veredito';
  const cls = d.verdict === 'approve' ? 'approve' : 'rc';
  const autor = (d.pr && d.pr.author) || d.author || '';
  const razoes = Array.isArray(d.reasons) ? d.reasons : [];
  return `<div class="review-box">
    <div class="review-box-head">
      <span class="verdict ${cls}">${esc(v)}</span>
      ${prRefMention(d.key || '', 'dec-ref')}
      ${d.card ? `<span class="pill">${esc(d.card)}</span>` : ''}
    </div>
    ${d.pr && d.pr.title ? `<div class="dec-title">${esc(d.pr.title)}</div>` : ''}
    ${autor ? `<div class="dec-author">PR de ${personMention(autor, 'xs')}</div>` : ''}
    ${d.status === 'pending' && razoes.length
      ? `<div class="review-box-context"><strong>Por que precisa de você</strong><ul class="dec-reasons">${razoes.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div>`
      : ''}
    ${d.reportMarkdown
      ? `<div class="report">${md(d.reportMarkdown)}</div>`
      : `<div class="empty">Esta revisão ficou sem relatório gravado.</div>`}
  </div>`;
}

export function md(src) {
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

export function feedLine(it) {
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
export function analysisOpsPlan(ops, snap) {
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

/* ---------- progresso de sessão: a régua ÚNICA do app ----------
   Regra do Wanderson (16/08/2026): previsibilidade com qualidade, centralizada
   e acessível pra todo o sistema. Antes cada fluxo chutava seu percentual (a
   autoanálise ficava em 25% fixo e concluía do nada, o chat idem) e a revisão
   automática nem barra tinha. sessionProgress é a régua única: converte a
   contagem de eventos REAIS da sessão (feed do SSE 'activity', ou contagem
   local no chat) num percentual sempre crescente, assintótico a 90 (os 10
   finais pertencem ao fechamento real, decidido pelo snapshot). Barra nova no
   app usa ESTA função, nunca um número escrito à mão; quem mudar a curva muda
   pra todos os fluxos de uma vez. selfSessionKey acha o PR da sessão de
   autoanálise dona de um evento de atividade (roteio feed -> widget). */
export function selfSessionKey(sessions, id) {
  const s = (sessions || []).find(x => x && x.id === id && x.mode === 'self');
  return (s && s.keys && s.keys[0]) || null;
}
export function sessionProgress(count) {
  const n = Math.max(0, Number(count) || 0);
  return Math.min(90, 5 + Math.round(85 * (1 - Math.exp(-n / 18))));
}

/* ---------- pushback: o controle das Revisões recentes ----------
   Saiu do app.js pra ganhar teste; o mapa de pushbacks entra por parâmetro
   (era lido de STATE, global proibida aqui). */
export const PB_OPTS = [['', 'sem pushback'], ['author_right', 'o autor tinha razão'], ['we_right', 'nós tínhamos razão'], ['mixed', 'meio-termo']];
export const PB_SHORT = { author_right: 'autor tinha razão', we_right: 'nós tínhamos razão', mixed: 'meio-termo' };
export function pushbackControl(r, pushbacks) {
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
   entra por ctx já resolvido em valor, porque aqui não se lê global.
   Autor em linha própria (.rr-person), fora do .rr-title: o título tem
   white-space:nowrap + ellipsis, e o autor vivia dentro dele, então um título
   comprido empurrava o autor pra fora e ele sumia sem aviso nenhum (era o bug
   relatado). Foto vem do mesmo avatar() que a fila, "precisa de você",
   destaques e time já usam, fechando a inconsistência visual desta tela com
   o resto do app. */
const RESOLVED_LABELS = {
  auto_approved: ['✅', 'aprovado sozinho'],
  auto_rejected: ['🔴', 'mudanças pedidas sozinho'],
  posted: ['📬', 'postado por você'],
  already_reviewed: ['✔', 'já revisado por você (não repostei)'],
  already_merged: ['🔀', 'já foi mergeado (cancelei a revisão pendente)'],
  already_closed: ['🚫', 'PR fechado sem merge (cancelei a revisão pendente)'],
  skipped: ['⏭', 'pulado']
};
const RESOLVED_ACTIONS = { approve: 'APPROVE', request_changes: 'REQUEST CHANGES', comment: 'COMMENT' };
// cor do selo pela AÇÃO postada, não pelo status: o desfecho é o que se procura ao
// varrer a lista. Pulado fica neutro de propósito, porque nada foi postado.
const VERDICT_CLASS = { approve: 'rev-ok', request_changes: 'rev-rc', comment: 'rev-cm' };

export function resolvedRow(r, ctx) {
  ctx = ctx || {};
  const [icon, label] = RESOLVED_LABELS[r.status] || ['•', r.status];
  const act = (r.status === 'posted' || r.status === 'already_reviewed')
    ? ` (${RESOLVED_ACTIONS[r.action] || r.action})` : '';
  const url = (r.pr && r.pr.url) || '';
  const title = (r.pr && r.pr.title) || '';
  const author = (r.pr && r.pr.author) || r.author || '';
  // pontos de atenção de um PR resolvido sozinho: ficam claros aqui (expansível).
  // already_reviewed entra na mesma regra desde o #742: "não repostei" significa que o
  // que a revisão achou ficou SÓ no app, então esconder as reasons justo nesse status
  // deixava o achado sem nenhuma superfície (nem no PR, nem na linha). O rótulo dele diz
  // isso na cara, pra não parecer que alguém já leu.
  const COM_REASONS = ['auto_approved', 'auto_rejected', 'already_reviewed'];
  const attn = (r.attention && r.attention.length) ? r.attention
    : (COM_REASONS.includes(r.status) ? (r.reasons || []) : []);
  const plural = attn.length > 1;
  const attnLabel = r.status === 'already_reviewed'
    ? `achado${plural ? 's' : ''} que ${plural ? 'ficaram' : 'ficou'} só aqui`
    : r.status === 'auto_rejected'
      ? `motivo${plural ? 's' : ''} do pedido de mudanças`
      : `ponto${plural ? 's' : ''} de atenção`;
  const vcls = VERDICT_CLASS[r.action] || '';
  const vc = r.verificationCheckpoint;
  const vcConflicts = vc
    ? (Number.isFinite(Number(vc.conflictCount)) ? Number(vc.conflictCount) : (Array.isArray(vc.conflicts) ? vc.conflicts.length : 0))
    : 0;
  const vcLine = (vc && vc.total)
    ? `Verificação de afirmações: ${vc.confirmedCount} confirmadas de ${vc.total}`
      + (vcConflicts ? ` · ⚠ ${vcConflicts} divergência(s) entre passadas` : '')
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
      ${title ? `<div class="rr-title" title="${esc(title)}">${esc(title)}</div>` : ''}
      ${author ? `<div class="rr-person">${personMention(author, 'sm')}</div>` : ''}
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

/* ---------- montagem da aba Entregas v2 (busca, estatísticas, atividade,
   grupos com progresso/rank/paginação). Releitura desenhada no Claude Design,
   projeto "Revisão página entregas" (`Entregas v2.dc.html`). ---------- */

// busca livre por título, autor ou repo, sem diferenciar caixa (mesmo campo
// único do mock; sem acento-folding, igual ao resto do app)
export function delivFilterItems(items, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return items || [];
  return (items || []).filter(it => `${it.title || ''} ${it.author || ''} ${it.repo || ''}`.toLowerCase().includes(q));
}

// buckets diários LOCAIS (mesmo corte de localDayKey/usageDayKeysBack), mais
// antigo primeiro, hoje por último. dias=0 (janela "Hoje") vira 1 bucket só.
export function delivDayBuckets(items, days, agora = Date.now()) {
  const nDias = days === 0 ? 1 : days;
  const counts = new Map();
  for (const it of (items || [])) {
    const k = localDayKey(it.mergedAt);
    if (k) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return usageDayKeysBack(nDias, agora).map(k => {
    const [y, m, d] = k.split('-').map(Number);
    return { dayKey: k, date: new Date(y, m - 1, d), n: counts.get(k) || 0 };
  });
}

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const ddmm = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

// os 4 cartões de estatística do topo. [] quando não há entregas no período
// (a UI então nem desenha a grade). O 4º cartão muda com o período: "Hoje"
// mostra o último merge, os demais mostram a média diária com o pico.
export function delivStats(items, days, agora = Date.now()) {
  const total = (items || []).length;
  if (!total) return [];
  const hoje = localDayKey(agora);
  const deHoje = items.filter(x => localDayKey(x.mergedAt) === hoje).length;
  const porAutor = [...groupBy(items, x => x.author || '(desconhecido)').entries()]
    .sort((a, b) => delivVolumeOrder(a[1], b[1], a[0], b[0]));
  const porRepo = [...groupBy(items, x => x.repo).entries()].sort((a, b) => b[1].length - a[1].length);
  const nDias = days === 0 ? 1 : days;
  const buckets = delivDayBuckets(items, days, agora);
  const pico = buckets.reduce((a, b) => (b.n > a.n ? b : a), buckets[0] || { n: 0 });
  const media = (total / nDias).toFixed(1).replace('.', ',');
  const ultimoItem = items.reduce((a, b) => (new Date(b.mergedAt) > new Date(a.mergedAt) ? b : a), items[0]);

  // `goto` (opcional) faz o subtítulo virar ATALHO pra própria lista abaixo:
  // "@fulano na frente" leva ao grupo dele (trocando pra visão por pessoa),
  // "repo na frente" ao grupo do repo, "+N hoje" ao período Hoje. Menção de
  // pessoa/repo aqui é atalho INTERNO de propósito (o GitHub fica nos nomes
  // dentro da lista), pra o mesmo texto nunca ter dois destinos.
  const quarto = days === 0
    ? {
      rotulo: 'Último merge', valor: fmtRel(ultimoItem.mergedAt, agora),
      sub: 'por @' + (ultimoItem.author || '(desconhecido)'),
      goto: ultimoItem.author ? `deliv:author:${ultimoItem.author}` : ''
    }
    : { rotulo: 'Média por dia', valor: media, sub: pico.n ? `pico de ${pico.n} (${DIAS_SEMANA[pico.date.getDay()]} ${ddmm(pico.date)})` : '' };

  return [
    {
      rotulo: 'PRs mergeados', valor: String(total),
      sub: days === 0 ? 'desde 00:00' : (deHoje > 0 ? `+${deHoje} hoje` : 'nenhum hoje'),
      goto: days !== 0 && deHoje > 0 ? 'deliv:days:0' : ''
    },
    { rotulo: 'Pessoas entregando', valor: String(porAutor.length), sub: '@' + porAutor[0][0] + ' na frente', goto: `deliv:author:${porAutor[0][0]}` },
    { rotulo: 'Repositórios ativos', valor: String(porRepo.length), sub: repoShort(porRepo[0][0]) + ' na frente', goto: `deliv:repo:${porRepo[0][0]}` },
    quarto
  ];
}

export function delivStatsCards(stats) {
  if (!(stats || []).length) return '';
  return `<div class="deliv-stats">${stats.map(s => {
    const sub = s.goto
      ? `<span class="ds-sub is-goto" data-goto="${esc(s.goto)}" role="button" tabindex="0" title="Ir até ${esc(s.sub)}">${esc(s.sub)}</span>`
      : `<span class="ds-sub">${esc(s.sub)}</span>`;
    return `<div class="deliv-stat"><span class="ds-label">${esc(s.rotulo)}</span><b>${esc(s.valor)}</b>${sub}</div>`;
  }).join('')}</div>`;
}

// barras da "Atividade no período": rótulo raro pra não colidir em janelas
// longas (todo dia em 7, a cada 3 em 15, a cada 5 em 30), sempre com "hoje"
// na última barra.
export function delivActivityChart(items, days, agora = Date.now()) {
  const buckets = delivDayBuckets(items, days, agora);
  const max = Math.max(1, ...buckets.map(b => b.n));
  return buckets.map((b, i) => {
    const hojeBar = i === buckets.length - 1;
    let rotulo = '';
    if (days === 7) rotulo = hojeBar ? 'hoje' : DIAS_SEMANA[b.date.getDay()];
    else if (days === 15) rotulo = hojeBar ? 'hoje' : (i % 3 === 0 ? ddmm(b.date) : '');
    else rotulo = hojeBar ? 'hoje' : (i % 5 === 0 ? ddmm(b.date) : '');
    const pct = b.n === 0 ? 0 : Math.max(6, Math.round(b.n / max * 100));
    const dica = `${DIAS_SEMANA[b.date.getDay()]} ${ddmm(b.date)} · ${plural(b.n, 'PR', 'PRs')}`;
    // classe 'zero', NUNCA 'empty': .empty e o estado vazio GLOBAL do app (padding
    // 26px + borda tracejada) e colidia aqui, inflando dia SEM merge pra 54px de
    // altura, a 2a barra mais alta do grafico (as barras escuras do print de 10/08)
    return `<div class="deliv-bar" title="${esc(dica)}">
      <div class="deliv-bar-track"><div class="deliv-bar-fill${b.n === 0 ? ' zero' : ''}" style="height:${pct}%"></div></div>
      <div class="deliv-bar-label">${esc(rotulo)}</div>
    </div>`;
  }).join('');
}

// cartão inteiro do gráfico, ou '' quando não faz sentido mostrar (janela
// "Hoje", sem granularidade diária, ou sem nenhuma entrega no período)
export function delivActivityCard(items, days, agora = Date.now()) {
  if (!(days > 0) || !(items || []).length) return '';
  return `<div class="card deliv-chart-card">
    <div class="deliv-chart-head"><h3>Atividade no período</h3><span class="deliv-chart-note">merges por dia</span></div>
    <div class="deliv-bars">${delivActivityChart(items, days, agora)}</div>
  </div>`;
}

// fatia as linhas de um grupo respeitando o teto de PRs visíveis. Legenda de
// repo (linha ehCap, só na visão por pessoa) não conta no teto, mas só entra
// se o PR dela entrou: uma legenda que sobra sozinha no fim é descartada.
export function delivSliceRows(rows, teto, expanded) {
  if (expanded) return { visiveis: rows, resto: 0 };
  const out = []; let prs = 0, resto = 0;
  for (const r of rows) {
    if (r.ehPr) { if (prs < teto) { out.push(r); prs++; } else resto++; }
    else if (prs < teto) out.push(r);
  }
  if (out.length && !out[out.length - 1].ehPr) out.pop();
  return { visiveis: out, resto };
}

function delivPrRowV2(it, comAutor) {
  const num = String(it.key || '').split('#')[1] || it.number;
  return `<div class="row">
    <span class="ref"><a href="${esc(it.url)}" target="_blank" rel="noreferrer">#${esc(num)}</a></span>
    <span class="title" title="${esc(it.title)}">${esc(it.title)}</span>
    ${comAutor ? `<span class="who">${personMention(it.author, 'xs', true)}</span>` : ''}
    <span class="when">${fmtRel(it.mergedAt)}</span>
  </div>`;
}

// corpo de um grupo: linhas fatiadas + botão "mostrar mais/menos" quando cabe
function delivGroupBody(rows, teto, expandedKeys, groupKey) {
  const expanded = !!(expandedKeys && expandedKeys.has(groupKey));
  const { visiveis, resto } = delivSliceRows(rows, teto, expanded);
  const rowsHtml = visiveis.map(r => r.ehCap
    ? `<div class="deliv-caption">${repoMention(r.cap)}</div>`
    : delivPrRowV2(r.item, r.comAutor)
  ).join('');
  const totalPr = rows.filter(r => r.ehPr).length;
  const mostraBotao = resto > 0 || (expanded && totalPr > teto);
  const botao = mostraBotao
    ? `<button type="button" class="deliv-mais" data-deliv-group="${esc(groupKey)}">${resto > 0 ? `mostrar mais ${resto}` : 'mostrar menos'}</button>`
    : '';
  return `<div class="rows">${rowsHtml}</div>${botao}`;
}

function delivGroupCardV2(head, count, pct, bodyHtml, opts = {}) {
  // grupo pequeno arredonda pra 0% mas a barra tem piso visual de 3%: o tooltip
  // diz "<1%" em vez de afirmar "0%" com preenchimento a mostra
  const pctLabel = pct < 1 ? '<1' : String(pct);
  const open = opts.open !== false;
  return `<div class="card deliv-card">
    <details data-deliv-group="${esc(opts.groupKey || '')}"${open ? ' open' : ''}>
      <summary class="deliv-sum">${head}<span class="deliv-progress" title="${pctLabel}% das entregas do período"><span class="deliv-progress-fill" style="width:${Math.max(pct, 3)}%"></span></span><span class="count">${count}</span></summary>
      ${bodyHtml}
    </details>
  </div>`;
}

// Regra única do ranking por volume. Recência desempata e o nome torna o
// resultado determinístico quando até o último merge coincide (payload do gh
// não é contrato de ordenação para um empate completo).
function delivVolumeOrder(aList, bList, aKey, bKey) {
  return bList.length - aList.length
    || String(lastMerge(bList)).localeCompare(String(lastMerge(aList)))
    || String(aKey).localeCompare(String(bKey));
}

export function deliveriesByRepo(items, opts = {}) {
  const teto = opts.teto || 4;
  const expandedKeys = opts.expandedKeys || new Set();
  const totalPeriodo = items.length;
  const groups = [...groupBy(items, it => it.repo).entries()].map(([repo, list]) => {
    const autores = new Set(list.map(x => x.author).filter(Boolean)).size;
    const ordenado = [...list].sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
    const rows = ordenado.map(item => ({ ehPr: true, ehCap: false, item, comAutor: true }));
    const head = `<span class="deliv-name">${repoMention(repo)}</span><span class="deliv-meta">${plural(autores, 'autor', 'autores')} · último ${fmtRel(lastMerge(list))}</span>`;
    return { repo, list, last: lastMerge(list), head, rows, groupKey: 'repo:' + repo };
  });
  // mais ATUAL primeiro (decisão do Wanderson, 10/08/2026): quem mergeou por
  // último abre a lista, e desce até o grupo parado há mais tempo; contagem só
  // desempata. Os cartões "na frente" seguem por volume, papel deles.
  groups.sort((a, b) => String(b.last).localeCompare(String(a.last)) || b.list.length - a.list.length);
  return groups.map(g => delivGroupCardV2(
    g.head, g.list.length, Math.round(g.list.length / totalPeriodo * 100),
    delivGroupBody(g.rows, teto, expandedKeys, g.groupKey),
    { groupKey: g.groupKey, open: true }
  )).join('');
}

export function deliveriesByAuthor(items, opts = {}) {
  const teto = opts.teto || 4;
  const expandedKeys = opts.expandedKeys || new Set();
  const openKeys = opts.openKeys || new Set();
  const totalPeriodo = items.length;
  const groups = [...groupBy(items, it => it.author || '(desconhecido)').entries()].map(([login, list]) => {
    const repos = new Set(list.map(x => x.repo)).size;
    const subRepos = [...groupBy(list, x => x.repo).entries()]
      .map(([repo, prs]) => ({ repo, prs, last: lastMerge(prs) }))
      // mesma regra dos grupos: o repo com merge mais recente da pessoa vem antes
      .sort((a, b) => String(b.last).localeCompare(String(a.last)) || b.prs.length - a.prs.length);
    const rows = [];
    for (const sg of subRepos) {
      rows.push({ ehPr: false, ehCap: true, cap: sg.repo });
      const ordenado = [...sg.prs].sort((a, b) => String(b.mergedAt).localeCompare(String(a.mergedAt)));
      for (const item of ordenado) rows.push({ ehPr: true, ehCap: false, item, comAutor: false });
    }
    const head = `<span class="deliv-name">${personMention(login)}</span><span class="deliv-meta">${plural(repos, 'repo', 'repos')} · último ${fmtRel(lastMerge(list))}</span>`;
    return { login, list, last: lastMerge(list), head, rows, groupKey: 'author:' + login };
  });
  // Na visão por pessoa, volume é a pergunta principal: quem entregou mais no
  // recorte visível vem antes. Recência e login servem só de desempate.
  groups.sort((a, b) => delivVolumeOrder(a.list, b.list, a.login, b.login));
  return groups.map(g => delivGroupCardV2(
    g.head, g.list.length, Math.round(g.list.length / totalPeriodo * 100),
    delivGroupBody(g.rows, teto, expandedKeys, g.groupKey),
    { groupKey: g.groupKey, open: openKeys.has(g.groupKey) }
  )).join('');
}

// estado vazio: some pra ampliar o período (só quando dá pra ampliar) e some
// pra limpar a busca (só quando há busca ativa)
export function delivEmptyState(opts = {}) {
  const query = opts.query || '';
  const titulo = query ? `Nada com “${query}” neste período.` : 'Nenhum PR mergeado neste período.';
  // "organizações monitoradas em Sistema" leva ATÉ a linha das orgs (regra das
  // menções: citou um lugar do app, clicou, chegou lá)
  const sub = query
    ? 'Tente outro termo ou amplie o período.'
    : `Amplie o período ou confira as <span class="is-goto" data-goto="sys:connections:#sys-row-orgs" role="button" tabindex="0">organizações monitoradas em Sistema</span>.`;
  const subHtml = query ? esc(sub) : sub;
  const botoes = [];
  if (opts.canExpand) botoes.push(`<button type="button" class="btn sm" data-deliv-action="ver30">Ver 30 dias</button>`);
  if (opts.canClear) botoes.push(`<button type="button" class="btn sm ghost" data-deliv-action="limpar-busca">Limpar busca</button>`);
  return `<div class="empty deliv-empty"><span class="big">📦</span>${esc(titulo)}<br><small>${subHtml}</small>${botoes.length ? `<div class="deliv-empty-actions">${botoes.join('')}</div>` : ''}</div>`;
}

/* ---------- Sistema > Sobre: créditos sincronizados com o GitHub ----------
   Idealizador = dono do repo do update; contribuidores = API de contributors
   do mesmo repo (colaborador novo no git aparece sozinho, sem manutenção).
   Toda pessoa sai por personMention (menção navegável com foto, regra do app).
   Sem dado ainda (boot, gh sem login, rede) = aviso explicativo, nunca vazio
   mudo: silêncio sem explicação é o defeito do check de monitoramento (M-op). */
export function creditsHtml(credits) {
  if (!credits || !credits.owner || !credits.owner.login) {
    return `<div class="credits-wait">Buscando os contribuidores no GitHub… precisa do <code>gh</code> autenticado; a lista aparece sozinha quando a busca responder.</div>`;
  }
  const own = credits.owner;
  const ownName = own.name && own.name.toLowerCase() !== own.login.toLowerCase() ? `<span class="credits-name">${esc(own.name)}</span>` : '';
  // o idealizador tem card próprio; na lista geral ele não repete
  const rest = (credits.contributors || []).filter(c => (c.login || '').toLowerCase() !== own.login.toLowerCase());
  const linhas = rest.map(c =>
    `<div class="credits-item">${personMention(c.login, 'sm')}<span class="credits-meta">${plural(c.contributions | 0, 'contribuição', 'contribuições')}</span></div>`
  ).join('');
  return `
    <div class="credits-founder">
      ${personMention(own.login)}
      <span class="credits-role">Idealizador e mantenedor${ownName ? ' · ' : ''}${ownName}</span>
    </div>
    ${rest.length ? `<div class="credits-sub">Contribuidores</div><div class="credits-grid">${linhas}</div>` : ''}
    <div class="credits-foot">Lista sincronizada com ${repoMention(credits.repo)} no GitHub: quem contribui no repositório entra aqui automaticamente.</div>`;
}

// Monta um prompt pronto pra colar no chat que está resolvendo o PR, a partir
// dos pontos da autoanálise (blockers = travam a aprovação; tips = melhorias).
// PURA: recebe os dados já coletados do STATE/DOM (o app.js faz essa coleta),
// devolve só a string do prompt. Migrada do app.js na Task 12.
export function buildFixPrompt(args = {}) {
  const { key, url, title, card, summary, blockers: rawBlockers, tips: rawTips } = args;
  const blockers = (rawBlockers || []).filter(Boolean);
  const tips = (rawTips || []).filter(Boolean);
  const abre = blockers.length
    ? `Preciso que você corrija os pontos levantados na revisão do PR ${key}, começando pelo que trava a aprovação.`
    : `Preciso que você aplique as melhorias sugeridas na revisão do PR ${key}.`;
  const linhas = [abre, ''];
  if (url) linhas.push(`PR: ${url}`);
  if (title) linhas.push(`Título: ${title}`);
  if (card) linhas.push(`Card: ${card}`);
  if (summary) { linhas.push('', `Resumo da revisão: ${summary}`); }
  if (blockers.length) { linhas.push('', 'Pendências que travam a aprovação (prioridade):', ...blockers.map(b => `- ${b}`)); }
  if (tips.length) { linhas.push('', 'Melhorias sugeridas:', ...tips.map(t => `- ${t}`)); }
  linhas.push('', 'Implemente as correções no código, rode os testes e o lint que fizerem sentido, e no final me diga o que mudou e por quê.');
  return linhas.join('\n');
}
