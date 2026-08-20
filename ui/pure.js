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
  const alvo = u => `sys:accounts:.acct-label[data-user="${escAttrSelector(u)}"]`;
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

/* ---------- os três eixos de "por que isto está na sua mesa" ----------
   A pergunta que o agrupamento responde é a que o biud-frontend#774 deixou sem
   resposta: dos N motivos listados, quais foram JULGAMENTO da revisão, quais são
   regra deliberada do app e qual foi só a rede caindo? Numa lista plana os três
   se confundiam, e um 503 do GitHub lia igual a uma ressalva técnica sobre o
   código, o que fazia a automação parecer quebrada quando não estava.
   A ordem é a de quem lê: falha técnica primeiro (é a única acionável agora e
   costuma ser a que segurou tudo), regra depois (explica o comportamento), e o
   que a revisão achou por último (é o conteúdo, não o motivo do bloqueio). */
const REASON_GROUPS = [
  ['infra', '🔌', 'falha técnica ao postar'],
  ['gate', '📏', 'regra do app'],
  ['content', '🧭', 'ponto que a revisão levantou'],
];

export function reasonGroups(reasons) {
  const porKind = new Map();
  for (const r of (Array.isArray(reasons) ? reasons : [])) {
    if (!r) continue;
    // string solta = decisão gravada antes da v2.48.0: entra como 'content', a
    // leitura conservadora (nunca inventa gate nem falha de infra que não houve)
    const text = (typeof r === 'object') ? r.text : r;
    const kind = (typeof r === 'object' && r.kind) ? r.kind : 'content';
    if (!text) continue;
    if (!porKind.has(kind)) porKind.set(kind, []);
    porKind.get(kind).push(text);
  }
  return REASON_GROUPS
    .filter(([kind]) => porKind.has(kind))
    .map(([kind, icon, label]) => ({ kind, icon, label, items: porKind.get(kind) }));
}

// Uma linha por grupo, com os motivos daquele grupo embaixo. `postRetry` (já
// projetado por decisionForUi) só decora o grupo de infra: é ali que "o app ainda
// vai tentar sozinho" muda o que VOCÊ precisa fazer, que é nada.
// Texto de UM motivo, aceitando as duas formas: { text, kind } (v2.48.0+) e string
// solta (histórico gravado antes). Existe porque nem todo consumidor mostra a lista
// agrupada: o toast e a notificação do sistema mostram só o primeiro motivo, e
// interpolar o objeto direto imprimia "[object Object]" na cara do usuário.
export function reasonText(r) {
  if (r && typeof r === 'object') return String(r.text || '');
  return String(r || '');
}

export function reasonGroupsHtml(reasons, postRetry) {
  const grupos = reasonGroups(reasons);
  if (!grupos.length) return '';
  return `<div class="reason-groups">${grupos.map(g => {
    let nota = '';
    if (g.kind === 'infra' && postRetry) {
      nota = postRetry.exhausted
        ? `<span class="reason-note">desisti de tentar sozinho depois de ${postRetry.attempts} tentativa(s)</span>`
        : `<span class="reason-note">tentando de novo sozinho</span>`;
    }
    return `<div class="reason-group rg-${esc(g.kind)}">`
      + `<div class="reason-group-head"><span aria-hidden="true">${g.icon}</span> ${esc(g.label)}${nota}</div>`
      + `<ul class="dec-reasons">${g.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`
      + `</div>`;
  }).join('')}</div>`;
}

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
      ? `<div class="review-box-context"><strong>Por que precisa de você</strong>${reasonGroupsHtml(razoes, d.postRetry)}</div>`
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

// duração humana curta: "38s", "4m10s", "1h02m". Zero/inválido vira ''.
export function fmtDur(ms) {
  const s = Math.round(Number(ms) / 1000);
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), resto = s % 60;
  if (m < 60) return resto ? `${m}m${String(resto).padStart(2, '0')}s` : `${m}m`;
  const h = Math.floor(m / 60), mm = m % 60;
  return mm ? `${h}h${String(mm).padStart(2, '0')}m` : `${h}h`;
}

// linha "Tempo por etapa" das Revisões recentes, a partir do resumo persistido
// na decisão (stageSummaryFrom, lib/engine/review.js). Vazio quando não há traço.
export function stagesLine(st) {
  if (!st || !Array.isArray(st.stages) || !st.stages.length) return '';
  const partes = st.stages.map(s => `${s.label} ${fmtDur(s.ms) || '0s'}`);
  const total = fmtDur(st.totalMs);
  return `Tempo por etapa: ${partes.join(' · ')}${total ? ` (total ${total})` : ''}`;
}

/* ---------- esteira de etapas da revisão ao vivo (estilo n8n) ----------
   Os itens do feed chegam ESTAMPADOS com a etapa (item.s, decidido no engine em
   stageOfLine; a UI nunca reclassifica). O tempo entre dois itens pertence à
   etapa do item que o encerra; item sem estampa (linha informativa do app) herda
   a etapa corrente. A etapa do último item é a ATIVA e acumula até `agora`. */
export const STAGE_FLOW_ORDER = [
  ['preparo', 'preparo'], ['leitura', 'leitura'], ['card', 'card'],
  ['verificacao', 'verificação'], ['raciocinio', 'raciocínio'], ['redacao', 'redação'],
];

export function stageFlowFrom(items, startedAt, agora = Date.now()) {
  const linhas = (items || []).filter(i => i && i.t);
  if (!startedAt) return [];
  const ms = {};
  let prev = startedAt, atual = null;
  for (const it of linhas) {
    const s = it.s || atual || 'preparo';
    ms[s] = (ms[s] || 0) + Math.max(0, it.t - prev);
    prev = it.t; atual = s;
  }
  if (atual) ms[atual] = (ms[atual] || 0) + Math.max(0, agora - prev);
  return STAGE_FLOW_ORDER.map(([id, label]) => {
    const passada = ms[id] ? 'done' : 'pending';
    return { id, label, ms: ms[id] || 0, state: id === atual ? 'active' : passada };
  });
}

// vazio até o primeiro evento (a esteira só aparece com traço de verdade)
export function stageFlowHtml(flow) {
  if (!flow || !flow.length || !flow.some(s => s.ms)) return '';
  return flow.map(s => {
    const dur = s.ms ? fmtDur(s.ms) : '';
    const titulo = dur ? `${s.label} · ${dur}` : s.label;
    const durHtml = dur ? `<span class="sf-ms">${esc(dur)}</span>` : '';
    return `<span class="sf-node sf-${esc(s.state)}" title="${esc(titulo)}">` +
      `<span class="sf-dot"></span><span class="sf-lbl">${esc(s.label)}</span>${durHtml}</span>`;
  }).join('<span class="sf-link"></span>');
}

// tooltip do badge 👥 do card de sessão: uma linha por subagente, com a tarefa
// e o estado. PURA (texto de atributo title, sem HTML, então sem esc aqui).
export function agentsTitle(lista) {
  return (lista || []).map(a => {
    const desc = a.desc ? `: ${a.desc}` : '';
    const situacao = a.done ? 'concluído' : 'trabalhando';
    return `${a.label}${desc} (${situacao})`;
  }).join('\n');
}

export function feedLine(it) {
  const icon = { tool: '⚙', text: '💬', warn: '⚠', info: '·' }[it.k] || '·';
  // it.a = rótulo do subagente dono da linha (fan-out de leitura/verificação):
  // a linha ganha a etiqueta 👤 pra distinguir do trabalho da sessão principal
  const ag = it.a ? `<span class="feed-agent" title="linha de um subagente">👤 ${esc(it.a)}</span>` : '';
  return `<div class="feed-line k-${esc(it.k)}${it.a ? ' from-agent' : ''}"><span class="feed-t">${fmtClock(it.t)}</span><span class="feed-i">${icon}</span>${ag}<span class="feed-x">${esc(it.text)}</span></div>`;
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





/* ---------- fila: o vazio que CONFIRMA ----------
   Sexto passo da onda 5. Vazio bom merece confirmar o que o app fez, nao so dizer que
   nao tem nada: quantos PRs foram aprovados sozinhos hoje, quais orgs sao monitoradas
   e de quanto em quanto tempo. Tudo isso e texto derivado de estado, entao e puro.

   `aprovadosHoje` continua no pure.js e e chamada pelo app.js, nao aqui: ela le
   `decisions.resolved`, que e estado, e o construtor recebe so o numero pronto. */
export function queueEmptyOkHtml(ctx = {}) {
  const aprovados = ctx.aprovados || 0;
  const orgs = (ctx.owners || []).map(o => `<b>${esc(o)}</b>`).join(', ');
  const min = Math.round((ctx.intervalSeconds || 300) / 60);
  const plural = aprovados === 1 ? 'PR' : 'PRs';
  const feito = aprovados
    ? `O Farol aprovou ${aprovados} ${plural} sozinho hoje e monitora `
    : 'O Farol monitora ';
  const quem = orgs || 'as organizações configuradas';
  const cadencia = min === 1 ? 'minuto' : 'minutos';
  return `<div class="empty-ok">
      <div class="eo-check" aria-hidden="true">✓</div>
      <div class="eo-title">Nada esperando por você</div>
      <p class="eo-sub">${feito}${quem} a cada ${min} ${cadencia}. Quando pedirem sua revisão, o card aparece aqui.</p>
      <div class="eo-acts">
        <button class="btn sm eo-resolved">Ver o que foi aprovado</button>
        <button class="btn sm ghost eo-check-now">Verificar agora</button>
      </div>
    </div>`;
}

/* ---------- banner do topo ----------
   Sexto passo da onda 5. Os tres avisos que o banner pode mostrar (sem conta, conta
   sem token, falha na ultima checagem) sao decisao de TEXTO, nao de DOM: quem esconde
   e mostra o elemento continua no app.js.

   A forma e `if` plano de proposito, nao ternario encadeado: medido com scanFile, a
   escada de ternarios subiria o ternarioAninhado do pure.js de 16 pra 17, e o arquivo
   nao tem folga nenhuma nesse eixo.

   Sem `?.` tambem de proposito: snapshot sem `account` tem que explodir alto, como
   explode hoje, em vez de virar silenciosamente "Nenhuma conta detectada" e mentir
   pra quem esta olhando. */
export function statusBannerHtml(s = {}) {
  const partindo = s.status === 'starting';
  if (!s.account.user && !partindo) {
    return 'Bem-vindo ao Farol! Nenhuma conta do GitHub foi detectada. Rode <code>gh auth login</code> no terminal (conta de trabalho) e clique em Verificar agora.';
  }
  if (!s.account.tokenOk && !partindo) {
    return `A conta <b>${esc(s.account.user)}</b> não está autenticada no GitHub CLI. Rode <code>gh auth login</code> no terminal e clique em Verificar agora.`;
  }
  if (s.status === 'error' && s.error) {
    return `Falha na última checagem: ${esc(s.error)}. Vou tentar de novo no próximo ciclo.`;
  }
  return '';
}

/* ---------- painel Sistema: perfis do Claude e contas ----------
   Saiu do app.js na onda 5, quinto passo. Mesmo padrão dos anteriores: o render lê o
   estado e atribui; o CONSTRUTOR só recebe um ctx e devolve string.

   Dois pedaços ficaram no app.js de propósito, porque são DOM e não markup: o guarda
   de foco (não reconstruir enquanto a pessoa digita num campo do bloco) e o
   `hint.hidden = true` do fim dos perfis, que o listener do seletor desfaz. */

// ` selected` de <option>: o padrão aparecia doze vezes no mesmo template da linha
// de conta, e cada repetição contava como ternário no gate. Um nome resolve as doze
// e o markup fica legível: `${sel(a.onClean === 'approve')}` em vez do ternário inteiro.
function sel(cond) { return cond ? ' selected' : ''; }

// Selo do teto estourado. Os motivos `-previsto` dizem que o gasto ainda NÃO
// passou do teto, mas a próxima revisão passaria: é a diferença entre "acabou" e
// "a próxima não cabe", e a ação de quem lê é diferente em cada caso.
function seloOrcamento(budget) {
  const eixo = String(budget.reason || '').startsWith('total') ? 'orçamento total' : 'orçamento diário';
  if (String(budget.reason || '').endsWith('-previsto')) {
    const custo = Number(budget.tipicoReview || 0).toFixed(2);
    return `<span class="a-claude bad" title="a próxima revisão (US$ ${custo} em média) passaria do ${eixo}, então a automação pausou antes de gastar (clique manual continua liberado)">🔴 ${eixo} no limite</span>`;
  }
  return `<span class="a-claude bad" title="${eixo} estourado, automação pausada (clique manual continua liberado)">🔴 ${eixo} estourado</span>`;
}

export function claudeAuthBadge(id, ctx) {
  const all = (ctx.doctor && ctx.doctor.claudeAuth) || [];
  // servidor sempre inclui a entrada '' (padrão da máquina/legado), mesmo com perfis
  // salvos - então id === '' (padrão global sem override, ou conta sem claudeProfileId
  // próprio) acha essa entrada direto. all[0] fica só como último recurso pra doctorInfo
  // ainda não ter chegado num formato esperado (nunca devolve string vazia à toa).
  const info = all.find(x => x.id === id) || all.find(x => x.id === '') || all[0] || null;
  if (!info) return '';
  if (info.apiKeyMode && !info.ready) return `<span class="a-claude bad" title="Perfil de chave de API sem chave preenchida">SEM CHAVE</span>`;
  // bloqueio de orçamento vem de ctx.usage.budgets (fonte única, viva a cada
  // pushState, v2.40.0); o doctor parou de carregar blocked/reason, e este selo
  // lia de lá (achado da revisão adversarial: o ramo tinha virado código morto).
  // Desde a v2.48.4 o selo vale pros dois tipos de perfil, porque o teto também vale.
  const budget = ((ctx.usage && ctx.usage.budgets) || []).find(b => b.id === (info.id || id)) || {};
  if (budget.blocked) return seloOrcamento(budget);
  if (info.apiKeyMode) return `<span class="a-claude ok" title="Autenticação por chave de API">🔑 chave configurada</span>`;
  if (info.ready === false) return `<span class="a-claude bad" title="rode claude login nesse diretório">SEM LOGIN</span>`;
  if (info.account) return `<span class="a-claude ok" title="${esc(info.configDir || 'padrão da máquina')}">@${esc(info.account)}</span>`;
  return `<span class="a-claude" title="${esc(info.configDir || 'padrão da máquina')}">${info.configDir ? 'logada' : 'padrão da máquina'}</span>`;
}

export function claudeProfilesHtml(ctx) {
  const c = ctx.config || {};
  const profiles = c.claudeProfiles || [];
  // migração: legado preenchido e nenhum perfil salvo ainda -> oferece virar o primeiro perfil
  // o template sai pra um nome porque a interrogacao dentro dele e TEXTO da UI, a
  // pergunta que o cartao faz pra pessoa, e o gate nao distingue prosa de ternario:
  // na mesma linha do ternario, os dois somavam 2
  const cartaoMigracao = `<div class="card acct-add">
    <div class="a-add-title">Perfil atual detectado</div>
    <div class="a-hint">Você já tem um diretório configurado: <code>${esc(c.claudeConfigDir)}</code>. Salvar como o primeiro perfil?</div>
    <div class="a-editrow">
      <input id="claudeMigrateLabel" placeholder="nome do perfil" value="Perfil atual" spellcheck="false">
      <button class="btn sm" id="btnClaudeMigrate">Salvar como perfil</button>
    </div>
  </div>`;
  const migrateCard = (!profiles.length && c.claudeConfigDir) ? cartaoMigracao : '';
  // se o legado (claudeConfigDir) ainda estiver preenchido, "Padrão da máquina" na
  // verdade cai nele por baixo dos panos (ver resolveClaudeConfigDir) - deixa isso
  // visível aqui, já que a Task 6 tirou o campo texto que mostrava esse valor.
  const defaultEmptyLabel = c.claudeConfigDir ? `Padrão da máquina (legado: ${esc(c.claudeConfigDir)})` : 'Padrão da máquina';
  const defaultOptions = [`<option value="">${defaultEmptyLabel}</option>`]
    .concat(profiles.map(p => `<option value="${esc(p.id)}"${sel(c.claudeProfileId === p.id)}>${esc(p.label)}</option>`))
    .join('');
  // botão de login da linha padrão: data-id dinâmico (era fixo "" antes desta feature,
  // então sempre abria o legado ao clicar, mesmo com outro perfil selecionado no dropdown
  // - bug preexistente, corrigido junto por ser exigido pra esconder o botão certo).
  const defaultProfile = profiles.find(p => p.id === (c.claudeProfileId || ''));
  const defaultIsApiKey = defaultProfile && defaultProfile.kind === 'apikey';
  const defaultLoginBtn = defaultIsApiKey ? '' : `<button class="btn sm cp-login" data-id="${esc(c.claudeProfileId || '')}">Abrir sessão de login</button>`;
  const defaultRow = `<div class="card set-row">
    <div class="set-txt">
      <span class="set-title">Perfil padrão do Farol</span>
      <span class="set-desc">Vale pra toda conta do GitHub que não tiver um perfil próprio (painel Contas).</span>
    </div>
    <div class="set-ctl">
      <select id="claudeProfileDefault">${defaultOptions}</select>
      ${defaultLoginBtn}
    </div>
  </div>`;
  const rows = profiles.map(p => {
    const isApiKey = p.kind === 'apikey';
    // gasto vem de ctx.usage.budgets (fonte unica do orcamento, viva a cada
    // pushState), nunca mais do cache do doctor, que congelava o "Hoje" daqui
    // enquanto a aba Consumo andava (v2.40.0)
    // desde a v2.48.4 o teto vale pros DOIS tipos de perfil, então o gasto é
    // buscado pros dois (era só apikey: perfil de assinatura não tinha teto)
    const budgetInfo = ((ctx.usage && ctx.usage.budgets) || []).find(x => x.id === p.id);
    // uma pergunta por linha, em vez de encadear os ternários dentro do template:
    // primeiro o gasto, depois o teto diário, depois o total
    const tetoDia = p.budgetDaily != null ? ` de US$ ${p.budgetDaily.toFixed(2)}` : '';
    const gastoTotal = budgetInfo ? (budgetInfo.sinceCutoff || 0) : 0;
    // o fallback e uma STRING de um caractere, e o gate conta esse caractere por
    // statement sem distinguir string de ternario: inline, os dois somavam 2 na mesma
    // linha. O texto NAO muda, a constante guarda exatamente o que estava ali.
    const SEM_DATA = '?';
    const desde = p.budgetSince || SEM_DATA;
    const tetoTotal = p.budgetTotal != null
      ? ` · Desde ${desde}: US$ ${gastoTotal.toFixed(2)} de US$ ${p.budgetTotal.toFixed(2)}`
      : '';
    let budgetStatusText = '';
    if (budgetInfo) budgetStatusText = `Hoje: US$ ${(budgetInfo.today || 0).toFixed(2)}${tetoDia}` + tetoTotal;
    // cada ramo num nome proprio: juntos num ternario so, os dois templates
    // somavam interrogacoes de statement e estouravam o gate
    // os dois `value` saem pra nomes: dentro do template eles somavam com o
    // ternario do budgetStatusText no mesmo statement
    const valorTetoDia = p.budgetDaily != null ? p.budgetDaily : '';
    const valorTetoTotal = p.budgetTotal != null ? p.budgetTotal : '';
    // os campos de teto são os MESMOS nos dois tipos de perfil, então saem de um
    // lugar só: duplicar o bloco faria o de assinatura envelhecer sozinho
    const camposOrcamento = `
      <div class="a-editrow">
        <input class="cp-budget-daily" type="number" min="0" step="0.01" data-id="${esc(p.id)}" value="${valorTetoDia}" placeholder="Orçamento diário (US$, opcional)">
        <input class="cp-budget-total" type="number" min="0" step="0.01" data-id="${esc(p.id)}" value="${valorTetoTotal}" placeholder="Orçamento total (US$, opcional)">
        <input class="cp-budget-since" type="date" data-id="${esc(p.id)}" value="${esc(p.budgetSince || '')}" title="Contar o total a partir de">
      </div>
      ${budgetStatusText ? `<div class="a-hint">${esc(budgetStatusText)}</div>` : ''}`;
    const camposChave = `
      <div class="a-editrow">
        <input class="cp-apikey" type="password" data-id="${esc(p.id)}" value="${esc(p.apiKey || '')}" placeholder="chave de API" spellcheck="false" autocomplete="off">
        <button class="btn icon sm ghost cp-toggle-key" data-id="${esc(p.id)}" title="Mostrar/ocultar a chave" aria-label="Mostrar/ocultar a chave">👁</button>
      </div>
      <div class="a-editrow">
        <input class="cp-baseurl" data-id="${esc(p.id)}" value="${esc(p.baseUrl || '')}" placeholder="URL base (opcional, deixe em branco pra usar a Anthropic direto)" spellcheck="false">
      </div>`;
    const camposDir = `
      <div class="a-editrow">
        <input class="cp-dir" data-id="${esc(p.id)}" value="${esc(p.dir || '')}" placeholder="${ctx.ehWin ? 'C:\\Users\\voce\\.claude-perfil' : '~/.claude-perfil'}" spellcheck="false">
      </div>`;
    const fields = (isApiKey ? camposChave : camposDir) + camposOrcamento;
    return `<div class="card acct-card">
    <div class="a-body">
      <div class="a-editrow">
        <input class="cp-label" data-id="${esc(p.id)}" value="${esc(p.label)}" placeholder="nome do perfil" spellcheck="false">
        ${claudeAuthBadge(p.id, ctx)}
      </div>
      ${fields}
    </div>
    <div class="a-actions">
      ${isApiKey ? '' : `<button class="btn sm cp-login" data-id="${esc(p.id)}">Abrir sessão de login</button>`}
      <button class="btn sm danger-ghost cp-remove" data-id="${esc(p.id)}">Remover</button>
    </div>
  </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar perfil</div>
    <div class="a-editrow">
      <div class="seg" id="cpAddKind" role="group" aria-label="Tipo de perfil">
        <button type="button" class="seg-btn active" data-kind="dir">Login por assinatura</button>
        <button type="button" class="seg-btn" data-kind="apikey">Chave de API</button>
      </div>
    </div>
    <div class="a-editrow">
      <input id="cpAddLabel" placeholder="nome (ex.: BIUD Trabalho)" spellcheck="false">
      <input id="cpAddDir" placeholder="diretório de config (ex.: ${ctx.ehWin ? 'C:\\Users\\voce\\.claude-biud-trabalho' : '~/.claude-biud-trabalho'})" spellcheck="false">
      <input id="cpAddApiKey" type="password" placeholder="chave de API" spellcheck="false" autocomplete="off" hidden>
      <input id="cpAddBaseUrl" placeholder="URL base (opcional)" spellcheck="false" hidden>
      <button class="btn sm" id="btnCpAdd">Adicionar</button>
    </div>
    <div class="a-hint" id="cpAddHint">Deixe em branco pra usar a Anthropic direto. Um endpoint customizado precisa falar a API de Mensagens da Anthropic, não é garantia de que qualquer provedor (ex.: OpenRouter) funcione sem um proxy tradutor.</div>
  </div>`;
  return migrateCard + defaultRow + rows + addForm;
}

export function accountsManagerHtml(ctx) {
  // não re-renderiza enquanto você edita um campo (senão apaga o que está digitando)
  const accounts = (ctx.accounts || []);
  const multi = accounts.length > 1;
  const c = ctx.config || {};
  const globalAR = c.autoReview !== false;      // padrão herdado: revisar automaticamente
  const globalCav = c.autoApproveAll !== false; // padrão herdado: aprovar com ressalvas
  const rows = accounts.map(a => {
    const meta = ctx.acct[a.user.toLowerCase()] || {};
    // três estados, um por linha: silenciada ganha de tudo, senão o token decide
  let auth = 'sem token: rode gh auth login';
  if (a.muted) auth = 'silenciada (fora dos avisos e da auto-revisão)';
  else if (a.tokenOk) auth = 'autenticada no gh';
    // os condicionais inline saem pra nomes: o template da linha de conta tinha
    // sete deles e o gate conta interrogacao por statement, sem distinguir markup
    // de logica. Nomeados, da pra ler a linha sem desembaralhar ternario.
    const selo = a.primary ? '<span class="a-tag">primária</span>' : '';
    const classeAuth = (a.tokenOk && !a.muted) ? 'ok' : '';
    const padraoRevisao = globalAR ? 'revisa na hora' : 'só põe na fila';
    const padraoRessalva = globalCav ? 'aprova e destaca as ressalvas' : 'espera você';
    const classeMute = a.muted ? 'ok' : 'ghost';
    const rotuloMute = a.muted ? 'Reativar' : 'Silenciar';
    // a barra de acoes sai pra um nome: e o maior condicional do template e
    // aparecia inteiro no meio do markup da linha
    const barraAcoes = multi ? `<div class="a-actions">
        <button class="btn sm ${classeMute} act-mute" data-user="${esc(a.user)}">${rotuloMute}</button>
        <button class="btn sm danger-ghost acct-remove" data-user="${esc(a.user)}" title="parar de monitorar esta conta no Farol">Remover</button>
      </div>` : '';
    return `<div class="card acct-card ${a.muted ? 'muted' : ''}" style="--ac:${meta.color};--ac-soft:${meta.soft};--ac-ink:${meta.ink};">
      <input type="color" class="acct-color" data-user="${esc(a.user)}" value="${esc(a.color || meta.color || '#ffb454')}" title="cor da conta">
      <div class="a-body">
        <div class="a-editrow">
          <input class="acct-label" data-user="${esc(a.user)}" value="${esc(a.label || a.user)}" placeholder="rótulo" spellcheck="false" title="rótulo da conta">
          <input class="acct-kind" data-user="${esc(a.user)}" list="acctKinds" value="${esc(a.kind || '')}" placeholder="tipo (Pessoal/Trabalho)" spellcheck="false">
          ${selo}
        </div>
        <div class="a-sub"><a class="a-auth ${classeAuth}" href="https://github.com/${encodeURIComponent(a.user)}" target="_blank" rel="noreferrer" title="Abrir @${esc(a.user)} no GitHub">@${esc(a.user)}</a> · ${esc(auth)}</div>
        <div class="a-editrow orgs"><span class="a-fieldlabel">orgs</span>
          <input class="acct-owners" data-user="${esc(a.user)}" value="${esc((a.owners || []).join(', '))}" placeholder="org1, org2" spellcheck="false" title="organizações monitoradas por esta conta"></div>
        <div class="a-pol-note">O que o Farol faz sozinho nos PRs desta conta (o que não escolher, segue o padrão geral):</div>
        <div class="a-policy">
          <div class="a-pol-item"><span class="a-fieldlabel">quando chega um PR pra você</span>
            <select class="acct-autoreview" data-user="${esc(a.user)}" title="Revisar na hora ou só listar e esperar você mandar revisar">
              <option value="">herda o geral: ${padraoRevisao}</option>
              <option value="on"${sel(a.autoReview === true)}>revisa na hora</option>
              <option value="off"${sel(a.autoReview === false)}>só põe na fila (você manda revisar)</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando fica aprovável sem ressalvas</span>
            <select class="acct-onclean" data-user="${esc(a.user)}" title="PR aprovável e sem nenhum ponto de atenção">
              <option value="">herda o geral: aprova sozinho</option>
              <option value="approve"${sel(a.onClean === 'approve')}>aprova sozinho</option>
              <option value="wait"${sel(a.onClean === 'wait')}>espera você aprovar</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando fica aprovável com ressalvas</span>
            <select class="acct-oncaveats" data-user="${esc(a.user)}" title="PR aprovável, mas com pontos de atenção anotados">
              <option value="">herda o geral: ${padraoRessalva}</option>
              <option value="approve"${sel(a.onCaveats === 'approve')}>aprova e destaca as ressalvas</option>
              <option value="wait"${sel(a.onCaveats === 'wait')}>espera você aprovar</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">quando tem bloqueios</span>
            <select class="acct-onreject" data-user="${esc(a.user)}" title="PR com bloqueios reais (a revisão pediu mudanças)">
              <option value=""${sel(!a.onReject || a.onReject === 'wait')}>espera você (padrão)</option>
              <option value="request_changes"${sel(a.onReject === 'request_changes')}>reprova sozinho (posta pedir mudanças)</option>
            </select></div>
          <div class="a-pol-item"><span class="a-fieldlabel">perfil Claude</span>
            <select class="acct-claudeprofile" data-user="${esc(a.user)}" title="Assinatura Claude usada nas sessões desta conta">
              <option value="">usa o perfil padrão do Farol</option>
              ${(ctx.config.claudeProfiles || []).map(p => `<option value="${esc(p.id)}"${sel(a.claudeProfileId === p.id)}>${esc(p.label)}</option>`).join('')}
            </select>
            ${claudeAuthBadge(a.claudeProfileId || ctx.config.claudeProfileId || '', ctx)}
          </div>
        </div>
      </div>
      ${barraAcoes}
    </div>`;
  }).join('');
  const addForm = `<div class="card acct-add">
    <div class="a-add-title">Adicionar conta</div>
    <div class="a-editrow">
      <input id="acctAddUser" placeholder="login do github" spellcheck="false">
      <input id="acctAddOwners" placeholder="orgs (org1, org2)" spellcheck="false">
      <input id="acctAddLabel" placeholder="rótulo (opcional)" spellcheck="false">
      <button class="btn sm" id="btnAcctAdd">Adicionar</button>
    </div>
    <div class="a-hint">A conta precisa estar logada no <code>gh</code> (<code>gh auth login</code>) pra buscar e postar. Sem token, ela aparece aqui mas sem acesso.</div>
  </div>
  <datalist id="acctKinds"><option value="Pessoal"></option><option value="Trabalho"></option><option value="Teste antigo"></option></datalist>`;
  return (rows || '<div class="empty">Nenhuma conta configurada.</div>') + addForm;
}

/* ---------- Radar: os cards da fila e do panorama ----------
   Saiu do app.js na onda 5, quarto passo. Sao os dois maiores construtores de card
   que sobraram, e a forma e a mesma dos passos anteriores: o render le o estado,
   filtra e seta os contadores; o CARD em si so recebe o PR e um ctx.

   O acctMark ficou no app.js de proposito, e o ctx recebe o RESULTADO dele
   (ctx.mark). Ele depende de SCOPE, TWEAK e da tabela de contas, uma cadeia que
   nao tem a ver com desenhar o card: puxa-la junto arrastaria meio painel de
   contas pra ca sem ganho nenhum de teste. */

export function reviewChip(pr, actions) {
  const a = (actions || {})[pr.key];
  if (a) {
    if (a.kind === 'pending') return '<span class="badge rev-pend" title="A análise terminou e está esperando a sua decisão em Precisa de você">🟡 aguardando você</span>';
    if (a.kind === 'approve') return `<span class="badge rev-ok" title="APPROVE postado${a.auto ? ' automaticamente pelo protocolo' : ' por você'} via Farol">✅ você aprovou</span>`;
    if (a.kind === 'request_changes') return '<span class="badge rev-rc" title="REQUEST CHANGES postado por você via Farol">✋ você pediu mudanças</span>';
    if (a.kind === 'comment') return '<span class="badge rev-cm" title="COMMENT postado por você via Farol">💬 você comentou</span>';
  }
  if (pr.reviewedByMe) return '<span class="badge rev-ok" title="Você já revisou este PR no GitHub">✔ revisado por você</span>';
  return '';
}

export function queueCardHtml(pr, ctx) {
  const m = ctx.mark;
  // os selos inline saem do template: dentro dele o gate conta todos os ternarios
  // do literal como um statement so, e o template fica ilegivel de tao denso
  const seloRascunho = pr.isDraft ? '<span class="badge">rascunho</span>' : '';
  const seloRepedida = pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : '';
  const papel = pr.author ? ` ${papelPicker(pr.author, ctx.people)}` : '';
  return `
    <div class="card pr-card urgent" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" style="${m.style}">
      ${m.dot}${avatar(pr.author)}
      <div class="info">
        <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>${m.chip}${seloRascunho}${seloRepedida}</div>
        <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
        <div class="pr-sub">${personMention(pr.author, 'xs')} · atualizado ${fmtRel(pr.updatedAt)}${papel}</div>
      </div>
      <div class="pr-actions">
        <button class="btn primary sm act-review" data-url="${esc(pr.url)}">Revisar</button>
        <button class="btn icon sm ghost act-chat" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar com o Claude sobre este PR">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H4l2.5-2.7A8 8 0 1 1 21 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
        </button>
        <button class="btn icon sm ghost act-more" data-key="${esc(pr.key)}" title="Mais ações" aria-label="Mais ações" aria-expanded="false">···</button>
      </div>
      <!-- O menu abre DENTRO do card, empurrando o conteúdo, em vez de flutuar por cima:
           num card já estreito, dropdown flutuante sai da tela ou cobre o card vizinho.
           Terminal e Ignorar vieram pra cá porque Ignorar é destrutivo e estava a um
           toque de distância do Revisar. -->
      <div class="pr-menu" data-menu="${esc(pr.key)}" hidden>
        <button class="act-terminal" data-url="${esc(pr.url)}">Revisar no terminal (interativo)</button>
        <a href="${esc(pr.url)}" target="_blank" rel="noreferrer">Abrir no GitHub ↗</a>
        <button class="danger act-ignore" data-key="${esc(pr.key)}">Marcar como visto sem revisar</button>
      </div>
    </div>`;
}

export function panoramaRowHtml(pr, ctx) {
  const chip = reviewChip(pr, ctx.actions);
  const m = ctx.mark;
    // estado da SUA revisão: aprovado/mudanças pedidas = resolvido (sem botão de
    // re-revisar); pendente = já na fila de decisão; senão, dá pra revisar.
  const ra = (ctx.actions || {})[pr.key];
  // sem registro nosso, "revisado por mim no GitHub" conta como approve
  let kind = null;
  if (ra) kind = ra.kind;
  else if (pr.reviewedByMe) kind = 'approve';
    // re-request (o autor pediu sua revisão DE NOVO): não é mais "resolvido/aguardando o
    // autor", voltou a ser acionável (a review antiga foi dismissed no GitHub).
    const reviewed = (kind === 'approve' || kind === 'request_changes') && !pr.reRequested;
    const isPending = kind === 'pending';
    // stale = você revisou e entrou commit novo depois: o "Re-revisar" volta a valer
  const stale = reviewed && !!(ctx.staleStates || {})[pr.key];
    // roda de verdade x só espera a vez: mesma distinção do "Meus PRs", pra não
    // rotular de "Revisando…" um PR que ainda nem começou (B: fila e panorama divergiam)
  const running = (ctx.running || new Set()).has(pr.key);
  const qpos = running ? 0 : (ctx.waiting || []).indexOf(pr.key) + 1;
    const queued = qpos > 0;
    const showBtn = (!reviewed || stale) && !isPending && !running && !queued;
  // tres estados excludentes, um por linha. A cadeia de ternarios escondia qual
  // deles ganhava quando mais de um parecia valer.
  let settledLabel = '';
  if (kind === 'request_changes') settledLabel = 'aguardando o autor';
  else if (isPending) settledLabel = 'aguardando você';
  else if (reviewed) settledLabel = 'nada a fazer';
  // mesma regra do settledLabel: a ordem de precedencia (rodando > na fila >
  // botao > estado final) agora esta na sequencia dos if, nao aninhada num ternario.
  const BTN_RODANDO = '<button class="btn sm ghost pano-review" disabled>Revisando…</button>';
  const btnFila = `<button class="btn sm ghost pano-review" disabled>Na fila (${qpos})</button>`;
  // quatro motivos possiveis pra este botao existir, e o tooltip diz qual e. Como
  // cadeia de ternario dentro do template eles ficavam ilegiveis e ainda somavam
  // no gate; nomeados, da pra ler a precedencia de cima pra baixo.
  let tituloRevisar = 'Revisar sob demanda: o resultado sempre passa por você, nada é postado sozinho';
  if (pr.reRequested) tituloRevisar = 'O autor pediu sua revisão de novo (re-request): a review anterior foi dispensada';
  else if (stale) tituloRevisar = 'Entrou commit novo depois da sua review: revisar de novo';
  else if (pr.mine) tituloRevisar = 'Revisar (seu review pedido)';
  const rotuloRevisar = (stale || pr.reRequested) ? 'Re-revisar' : 'Revisar';
  const btnRevisar = `<button class="btn sm ghost act-review pano-review" data-url="${esc(pr.url)}" title="${tituloRevisar}">${rotuloRevisar}</button>`
  const clsMine = pr.mine ? 'mine' : '';
  const clsRev = chip ? 'reviewed' : '';
  let seloConta = '';
  if (ctx.todasContas && m.chip) seloConta = m.chip;
  else if (pr.mine) seloConta = '<span class="badge">sua revisão</span>';
  const seloRascunhoP = pr.isDraft ? '<span class="badge">rascunho</span>' : '';
  const seloRepedidaP = pr.reRequested ? '<span class="badge rev-pend">pedida de novo</span>' : '';
  const sepTitulo = pr.title ? '<span class="pw-sep">·</span>' : '';
  let tail = `<span class="settled">${esc(settledLabel)}</span>`;
  if (running) tail = BTN_RODANDO;
  else if (queued) tail = btnFila;
  else if (showBtn) tail = btnRevisar;
    return `
    <div class="prow ${clsMine} ${clsRev}" style="${m.varStyle}${m.dim}">
      <span class="status-dot" aria-hidden="true"></span>
      <div class="pw-main">
        <div class="pw-head">
          <a class="pw-ref" href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>
          ${seloConta}
          ${seloRascunhoP}
          ${seloRepedidaP}
          ${chip}
        </div>
        <div class="pw-title">
          <span class="pw-title-txt" title="${esc(pr.title)}">${esc(pr.title)}</span>
          ${sepTitulo}${personMention(pr.author, 'xs')}
        </div>
      </div>
      <div class="pw-side">
        <span class="pw-when">${fmtRel(pr.updatedAt)}</span>
        <div class="pw-acts">
          <button class="btn icon sm ghost act-chat" data-key="${esc(pr.key)}" data-url="${esc(pr.url)}" title="Conversar com o Claude sobre este PR" aria-label="Conversar sobre este PR">💬${chatBadge(pr.key, ctx.chats)}</button>
          ${tail}
          <button class="btn icon sm ghost rr-copy" data-url="${esc(pr.url)}" data-key="${esc(pr.key)}" title="Copiar a URL do PR" aria-label="Copiar a URL do PR">⧉</button>
          <a class="btn icon sm ghost" href="${esc(pr.url)}" target="_blank" rel="noreferrer" title="Abrir no GitHub" aria-label="Abrir no GitHub">↗</a>
        </div>
      </div>
    </div>`;
}

/* ---------- editor de reviewers: padrao da org e excecoes por repo ----------
   Saiu do app.js na onda 5, terceiro passo. Diferente dos blocos anteriores, aqui
   nao bastava um parametro: as funcoes liam SETE globais entre config, candidatos
   e tres Sets de estado de tela. Todas so LEEM (quem muta os Sets sao os handlers,
   que ficaram no app.js), entao o que entra e um ctx unico, montado uma vez por
   renderizacao (revCtx no app.js). E o mesmo motivo do peopleOf do primeiro passo:
   os blocos de uma mesma passada tem que enxergar o mesmo estado.

   A extracao foi de BAIXO PRA CIMA: primeiro as folhas (defaultFor, overrideFor,
   reposOfOrg, suggestDefault, addControl), e so entao o renderOrgBlock, que compoe
   todas elas. Tentar o compositor primeiro exigiria arrastar as folhas impuras
   junto.

   Fica de fora o seedException: ele muta os Sets e persiste via API, ou seja, nao e
   render. E o renderReviewersEditor, que escreve no DOM. */

export function defaultFor(org, ctx) { const d = ctx.defaults || {}; return d[org] || d[(org || '').toLowerCase()] || []; }

export function overrideFor(repo, ctx) { const p = ctx.projects || {}; return p[repo] || p[(repo || '').toLowerCase()] || null; }

export function reposOfOrg(org, ctx) {
  const o = String(org).toLowerCase(), set = new Set();
  const add = k => { const r = String(k || ''); if (r.split('/')[0].toLowerCase() === o) set.add(r); };
  // prKeys ja vem achatado do app.js (myPRs + panorama): aqui nao se sabe de onde
  // a chave veio, so que ela e "owner/repo#N"
  (ctx.prKeys || []).forEach(k => add(String(k).split('#')[0]));
  Object.keys(ctx.projects || {}).forEach(add);
  [...(ctx.pendentes || [])].forEach(add);
  return [...set].filter(Boolean).sort();
}

export function suggestDefault(org, ctx) {
  const lists = reposOfOrg(org, ctx).map(repo => overrideFor(repo, ctx)).filter(l => l && l.length);
  if (lists.length < 2) return [];
  const count = {}, rep = {};
  for (const list of lists) for (const rv of new Set(list)) { const k = rv.toLowerCase(); count[k] = (count[k] || 0) + 1; rep[k] = rv; }
  const th = Math.ceil(lists.length / 2);
  return Object.keys(count).filter(k => count[k] >= th).map(k => rep[k]).sort();
}

export function addControl(cls, dataAttrs, list, org, ctx) {
  const c = (ctx.cands || {})[org] || { members: [], teams: [] };
  const me = ((ctx.owner2user || {})[String(org || '').toLowerCase()] || ctx.ghUser || '').toLowerCase();
  const has = v => (list || []).some(l => l.toLowerCase() === String(v).toLowerCase());
  if (!ctx.candsLoaded) return `<select class="rev-add ${cls}" ${dataAttrs}><option value="">carregando…</option></select>`;
  if (!c.members.length && !c.teams.length) return `<input class="rev-add rev-manual ${cls}" ${dataAttrs} placeholder="+ digite um handle e Enter…" spellcheck="false">`;
  const opts = [
    ...c.members.filter(x => x.toLowerCase() !== me && !has(x)).map(x => `<option value="${esc(x)}">${esc(x)}</option>`),
    ...c.teams.filter(t => !has(t.id)).map(t => `<option value="${esc(t.id)}">${esc(t.name)} (time)</option>`)
  ].join('');
  return `<select class="rev-add ${cls}" ${dataAttrs}><option value="">+ adicionar…</option>${opts}</select>`;
}

export function renderOrgBlock(org, accent, ctx) {
  const def = defaultFor(org, ctx);
  const repos = reposOfOrg(org, ctx);
  const isExc = r => { const o = overrideFor(r, ctx); return (o && !sameSet(o, def)) || ctx.abertas.has(r) || ctx.pendentes.has(r); };
  const excRepos = repos.filter(isExc);
  const following = repos.filter(r => !excRepos.includes(r));

  // card do padrão
  let defCard;
  if (def.length) {
    const chips = def.map(rv => chipHtml(rv, 'rev-def-x', `data-org="${esc(org)}" data-rv="${esc(rv)}"`, ctx.cands)).join('');
    defCard = `<div class="rev-default">
      <div class="rev-default-top"><span class="t">Reviewers padrão</span><span class="scope">${esc(org)}</span></div>
      <div class="rev-chips">${chips}${addControl('rev-def-add', `data-org="${esc(org)}"`, def, org, ctx)}</div>
      <div class="rev-hint">Aplicado a todos os projetos de <code>${esc(org)}</code> quando você clica em "👥 Reviewers", salvo as exceções abaixo.</div>
    </div>`;
  } else {
    const sug = suggestDefault(org, ctx);
    const sugChips = sug.map(rv => `<span class="rev-chip ghost">${esc(reviewerLabel(rv, ctx.cands).label)}</span>`).join('');
    defCard = `<div class="rev-default empty">
      <div class="rev-default-top"><span class="t">Reviewers padrão</span><span class="scope">${esc(org)}</span></div>
      ${sug.length
        ? `<div class="rev-hint">Detectei ${sug.length} reviewers comuns nos seus projetos de ${esc(org)}. Vira o padrão num clique, e os projetos iguais colapsam:</div>
           <div class="rev-chips">${sugChips}</div>
           <button class="btn sm ok rev-make-default" data-org="${esc(org)}">Criar padrão com estes ${sug.length}</button>`
        : `<div class="rev-chips">${addControl('rev-def-add', `data-org="${esc(org)}"`, [], org, ctx)}</div>
           <div class="rev-hint">Escolha os reviewers padrão de <code>${esc(org)}</code>.</div>`}
    </div>`;
  }

  // exceções
  const excHtml = excRepos.map(repo => {
    const list = overrideFor(repo, ctx) || (ctx.pendentes.has(repo) ? [...def] : []);
    if (ctx.abertas.has(repo)) {
      const chips = list.map(rv => chipHtml(rv, 'rev-exc-x', `data-repo="${esc(repo)}" data-rv="${esc(rv)}"`, ctx.cands)).join('');
      return `<div class="rev-exc open" data-repo="${esc(repo)}">
        <div class="rev-exc-head"><code>${esc(repoShort(repo))}</code>
          <button class="rev-exc-reset" data-repo="${esc(repo)}" title="remover a exceção e voltar ao padrão da org">voltar ao padrão</button>
          <button class="rev-exc-toggle" data-repo="${esc(repo)}">fechar</button></div>
        <div class="rev-chips">${chips || '<span class="rev-empty">sem reviewers</span>'}${addControl('rev-exc-add', `data-repo="${esc(repo)}"`, list, repo.split('/')[0], ctx)}</div>
      </div>`;
    }
    const d = diffVs(def, list);
    const pills = '<span class="rev-pill base">padrão</span>'
      + d.added.map(x => `<span class="rev-pill add">+ ${esc(reviewerLabel(x, ctx.cands).label)}</span>`).join('')
      + d.removed.map(x => `<span class="rev-pill rem">− ${esc(reviewerLabel(x, ctx.cands).label)}</span>`).join('');
    return `<div class="rev-exc" data-repo="${esc(repo)}"><code>${esc(repoShort(repo))}</code><div class="rev-diff">${def.length ? pills : list.map(x => `<span class="rev-pill add">${esc(reviewerLabel(x, ctx.cands).label)}</span>`).join('')}</div><button class="rev-exc-toggle" data-repo="${esc(repo)}">editar</button></div>`;
  }).join('');

  // colapsado: projetos que seguem o padrão
  const open = ctx.expandidas.has(org);
  // os quatro ternarios que estavam nesta expressao (tem projeto? singular ou
  // plural? aberto ou fechado? mostra a lista?) viraram quatro nomes: era o ponto
  // com mais ternario aninhado do arquivo, e nenhum deles dizia o que decidia.
  const rotuloSegue = following.length === 1 ? 'projeto segue' : 'projetos seguem';
  const rotuloBotao = open ? 'ocultar' : 'ver';
  const miniRepos = following.map(r => `<span class="rev-repo-mini">${esc(repoShort(r))}<button class="rev-mk-exc" data-repo="${esc(r)}" title="criar exceção pra este projeto">+</button></span>`).join('');
  const listaAberta = open ? `<div class="rev-folded-list">${miniRepos}</div>` : '';
  const followHtml = !following.length ? '' : `<div class="rev-folded">
      <span><span class="count">${following.length}</span> ${rotuloSegue} o padrão</span>
      <button class="rev-fold-toggle" data-org="${esc(org)}">${rotuloBotao}</button>
    </div>${listaAberta}`;

  // criar exceção pra um projeto (só quando há padrão)
  const dl = following.map(r => `<option value="${esc(r)}"></option>`).join('');
  const newExc = def.length ? `<div class="rev-newexc">
      <input class="rev-newexc-input" list="revExcList-${esc(org)}" placeholder="owner/repo, exceção" spellcheck="false">
      <datalist id="revExcList-${esc(org)}">${dl}</datalist>
      <button class="btn sm rev-newexc-go" data-org="${esc(org)}">+ criar exceção</button>
    </div>` : '';

  return `<div class="rev-org" data-org="${esc(org)}" style="--ac:${accent}">${defCard}${excRepos.length ? `<div class="rev-sec-title">Exceções (${excRepos.length})</div>${excHtml}` : ''}${followHtml}${newExc}</div>`;
}

/* Valor de string dentro de seletor de atributo CSS: [data-id="AQUI"].
   Escapa a barra invertida ANTES da aspa, e a ordem e o ponto: fazendo so a aspa
   (como era ate a onda 5), um id terminado em barra produz [data-id="a\\"], onde a
   barra escapa a aspa de fechamento e o seletor inteiro fica invalido. O clique
   entao nao navega pra lugar nenhum, sem erro visivel. O CSS.escape do navegador
   resolveria, mas nao existe aqui: o pure.js roda tambem no node --test. */
export function escAttrSelector(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/* ---------- aba Consumo: os construtores de HTML/SVG ----------
   Saiu do app.js na onda 5, segundo passo. O bloco inteiro ja era puro: nao lia
   nenhuma global, so montava string a partir do resumo de uso que o engine manda.
   O que prendia ele no app.js era a forma, nao o conteudo: cada funcao terminava
   atribuindo em `el.innerHTML`, entao parecia render de DOM. Separado o build da
   atribuicao, o app.js fica so com `el.innerHTML = xHtml(...)`.

   Fica de fora, de proposito, o drawUsageTimeline: ele mede `el.clientWidth` e ata
   listener de mouse, ou seja, precisa do elemento de verdade. O que da pra fazer
   por ele e o usageTooltipHtml, que ele chama e que veio junto.

   usageMatrixHtml devolve { html, caption } porque a versao antiga escrevia em DOIS
   lugares (a matriz e a legenda ao lado); um objeto pequeno e o jeito de manter os
   dois sem devolver o elemento. */

export function fmtMoney(v) { return 'US$ ' + (Number(v) || 0).toFixed(2); }

export function fmtUsageMetric(v, metric) { return metric === 'custo' ? fmtMoney(v) : fmtCompact(v); }

// cor por camada: fixa pro tipo (bate com o mock), ciclica pras outras dimensoes
// (modelo/conta), que tem quantidade variavel de nomes. _resto (a fatia
// reconciliada sem detalhamento) e SEMPRE apagado, em qualquer dimensao: e
// registro antigo, nao pode parecer uma serie de verdade.
export const USAGE_KIND_COLOR = { review: 'var(--accent)', self: 'var(--info)', chat: 'var(--ok)', tool: '#b394f0', pushback: 'var(--danger)', outro: 'var(--faint)', _resto: 'var(--faint)' };
export const USAGE_PALETTE = ['var(--accent)', 'var(--info)', 'var(--ok)', '#b394f0', 'var(--danger)', 'var(--faint)'];
export function usageColorsFor(dim, names) {
  if (dim === 'kind') return names.map(n => USAGE_KIND_COLOR[n] || 'var(--faint)');
  return names.map((n, i) => n === '_resto' ? 'var(--faint)' : USAGE_PALETTE[i % USAGE_PALETTE.length]);
}

export function usageTooltipHtml(day, vals, names, labels, colors, metric, idx, geo, W) {
  const total = vals.reduce((a, b) => a + b, 0);
  const leftPct = Math.min(82, Math.max(4, (geo.xs[idx] / W) * 100));
  const rows = names.map((n, i) => vals[i] > 0 ? `<div class="ut-row"><span class="dot" style="background:${colors[i]}"></span><span>${esc(labels[n] || n)}</span><b>${esc(fmtUsageMetric(vals[i], metric))}</b></div>` : '').join('');
  return `<div class="usage-tooltip" style="left:${leftPct}%"><div class="ut-head">${esc(day.slice(8, 10))}/${esc(day.slice(5, 7))} · ${esc(fmtUsageMetric(total, metric))}</div>${rows}</div>`;
}

export function usageKpisHtml(u, win) {
  const map = {}; for (const d of (u.series || [])) map[d.day] = d;
  const janela = usageDayKeysBack(win).map(day => map[day]);
  const anteriorKeys = usageDayKeysBack(win * 2).slice(0, win);
  const anterior = anteriorKeys.map(day => map[day]);
  const primeiroDia = (u.series && u.series[0] && u.series[0].day) || null;
  const comparavel = win * 2 <= ((u.retentionDays) || 120) && !!primeiroDia && primeiroDia <= anteriorKeys[0];
  const soma = (list, m) => list.reduce((a, d) => a + usageMetricVal(d, m), 0);
  const curCost = soma(janela, 'custo');
  const curTok = soma(janela, 'total');
  const curSess = janela.reduce((a, d) => a + ((d || {}).sessions || 0), 0);
  const curCache = soma(janela, 'cache');
  const antCost = comparavel ? soma(anterior, 'custo') : 0;
  const antTok = comparavel ? soma(anterior, 'total') : 0;
  const antSess = comparavel ? anterior.reduce((a, d) => a + ((d || {}).sessions || 0), 0) : 0;
  const hoje = map[usageDayKeysBack(1)[0]] || {};
  const ontemKey = usageDayKeysBack(2)[0];
  const ontem = map[ontemKey] || {};
  const spark14 = usageDayKeysBack(14).map(day => usageMetricVal(map[day], 'custo'));

  const card = (label, big, sub, delta, vals) => {
    const { line, area } = sparklinePath(vals, 100, 26);
    return `<div class="usage-kpi">
      <div class="usage-kpi-head"><span class="usage-kpi-label">${esc(label)}</span>${delta ? `<span class="usage-kpi-delta">${esc(delta)}</span>` : ''}</div>
      <b>${esc(big)}</b>
      <span class="usage-kpi-sub">${esc(sub)}</span>
      <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true" class="usage-kpi-spark">
        <path d="${area}" fill="var(--accent-soft)"></path>
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"></path>
      </svg>
    </div>`;
  };

  // o sub do KPI de tokens declara o cache quando houver: "Tokens" (in+out) nao
  // inclui cache em nenhum painel, mas o CUSTO inclui o custo do cache, e sem a
  // linha os dois cartoes vizinhos nao se explicavam (achado da auditoria).
  const tokSub = `${fmtCompact(soma(janela, 'input'))} in · ${fmtCompact(soma(janela, 'output'))} out`
    + (curCache > 0 ? ` · ${fmtCompact(curCache)} cache` : '');
  return [
    card(`Custo estimado · ${win} dias`, fmtMoney(curCost), `~${fmtMoney(curCost / win)} por dia`, usageDelta(curCost, antCost), janela.map(d => usageMetricVal(d, 'custo'))),
    card(`Tokens · ${win} dias`, fmtCompact(curTok), tokSub, usageDelta(curTok, antTok), janela.map(d => usageMetricVal(d, 'total'))),
    card(`Sessões · ${win} dias`, String(curSess), `média de ${(curSess / win).toFixed(1)} por dia`, usageDelta(curSess, antSess), janela.map(d => (d || {}).sessions || 0)),
    card('Hoje', fmtMoney(usageMetricVal(hoje, 'custo')), `${fmtCompact(usageMetricVal(hoje, 'total'))} tokens · ${hoje.sessions || 0} sessões`, usageDelta(usageMetricVal(hoje, 'custo'), usageMetricVal(ontem, 'custo')), spark14),
  ].join('');
}

export function usageMatrixHtml(u, metric, win) {
  const days = usageDayKeysBack(win);
  // nomes PROPRIOS da matriz (matrixKindNames/matrixModelNames): incluem _resto
  // quando algum dia tem fatia sem detalhamento, independente da linha do tempo
  const kindNames = u.matrixKindNames || u.kindNames || [];
  const modelNames = u.matrixModelNames || u.modelNames || [];
  if (!modelNames.length) return { html: '<div class="usage-empty">Sem dados ainda.</div>', caption: '' };
  const m = usageMatrixRows(u.matrixSeries || [], kindNames, modelNames, days, metric);
  if (!m.grand) return { html: '<div class="usage-empty">Sem consumo nesta janela.</div>', caption: '' };
  const caption = metric === 'custo' ? 'custo estimado no período' : 'tokens no período';
  const kindLabel = k => USAGE_KIND_LABEL[k] || k;
  const modelLabelOf = mm => mm === '_resto' ? 'Sem detalhamento' : mm;
  // valor EXATO no title da celula (fmtTok/fmtMoney): as celulas compactadas
  // (43k) nao somam o proprio total a vista, e o title e onde confere sem ruido
  const exact = v => metric === 'custo' ? fmtMoney(v) : fmtTok(v);
  // modelo aposentado nunca some de u.modelNames (byModel, no backend, não tem poda:
  // é histórico permanente), então sem esse filtro a coluna dele ficava pra sempre na
  // matriz, zerada. A linha do tempo já faz o equivalente na legenda (totalPorNome[i]
  // > 0); aqui é a mesma ideia aplicada às colunas (achado da revisão final).
  const idxAtivos = modelNames.map((_, j) => j).filter(j => m.colTotals[j] > 0);
  const modelosAtivos = idxAtivos.map(j => modelNames[j]);
  const cols = `96px repeat(${modelosAtivos.length}, minmax(0,1fr)) 64px`;
  const head = `<div class="usage-matrix-row head" style="grid-template-columns:${cols}"><span></span>${modelosAtivos.map(mm => `<span class="usage-matrix-hcell">${esc(modelLabelOf(mm))}</span>`).join('')}<span class="usage-matrix-hcell">Total</span></div>`;
  const rows = m.rows.filter(r => r.total > 0).map(r => `<div class="usage-matrix-row" style="grid-template-columns:${cols}">
      <span class="usage-matrix-label"><span class="dot" style="background:${USAGE_KIND_COLOR[r.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(kindLabel(r.kind))}</span>
      ${idxAtivos.map(j => { const c = r.cells[j]; return `<span class="usage-matrix-cell" style="background:color-mix(in srgb, var(--accent) ${((0.04 + 0.24 * c.intensity) * 100).toFixed(0)}%, transparent)" title="${esc(kindLabel(r.kind))} × ${esc(modelLabelOf(c.model))}: ${esc(exact(c.value))}">${esc(fmtUsageMetric(c.value, metric))}</span>`; }).join('')}
      <span class="usage-matrix-total" title="${esc(exact(r.total))}">${esc(fmtUsageMetric(r.total, metric))}</span>
    </div>`).join('');
  const foot = `<div class="usage-matrix-row foot" style="grid-template-columns:${cols}"><span>Total</span>${idxAtivos.map(j => `<span class="usage-matrix-total" title="${esc(exact(m.colTotals[j]))}">${esc(fmtUsageMetric(m.colTotals[j], metric))}</span>`).join('')}<span class="usage-matrix-grand" title="${esc(exact(m.grand))}">${esc(fmtUsageMetric(m.grand, metric))}</span></div>`;
  return { html: `<div class="usage-matrix">${head}${rows}${foot}</div>`, caption };
}

export function usageBudgetHtml(u) {
  const perfis = (u && u.budgets) || [];
  if (!perfis.length) return '<div class="usage-empty">Nenhum perfil de Claude configurado ainda.</div>';
  const meter = (label, spent, cap) => {
    // cap == null: teto NAO configurado (meter() nem chega a ser chamado nesse caso, ver
    // abaixo). cap === 0 e um teto valido (lib/parse.js aceita 0), e qualquer gasto acima
    // de zero ja estoura ele, por isso cap > 0 (que tratava 0 como "sem teto") virava um
    // sliver vazio e nao vermelho, contradizendo o selo "estourado" do cartao (achado de
    // review). >= no lugar de > pra bater com o mesmo criterio de profileBudgetStatus
    // (lib/engine/usage.js), que bloqueia em spent >= cap, nao só spent > cap.
    // cheio quando ha teto e ele foi batido; sem teto a barra fica em zero. Escrito
    // em passos porque os tres ternarios encadeados numa linha so contavam como
    // ternario aninhado no gate de qualidade, e a conta em si nao e obvia.
    let pct = 0;
    if (cap != null && cap > 0) pct = Math.min(100, (spent / cap) * 100);
    else if (cap != null && spent > 0) pct = 100;
    const over = cap != null && spent >= cap;
    return `<div class="usage-meter">
      <div class="usage-meter-row"><span>${esc(label)}</span><span>${esc(fmtMoney(spent))} / ${esc(fmtMoney(cap))}</span></div>
      <span class="usage-meter-track"><span class="usage-meter-fill${over ? ' over' : ''}" style="width:${Math.max(2, pct).toFixed(0)}%"></span></span>
    </div>`;
  };
  // a lacuna do terminal interativo vale pra qualquer perfil COM TETO (antes era
  // só chave de API, porque só ela tinha teto): o aviso segue o teto, não o tipo
  const temTetoAlgum = perfis.some(p => p.budgetDaily != null || p.budgetTotal != null);
  return perfis.map(p => {
    const isApiKey = p.kind === 'apikey';
    const statusCls = p.blocked ? 'bad' : 'ok';
    const temTeto = p.budgetDaily != null || p.budgetTotal != null;
    // "coberto pela assinatura" era o status FIXO de todo perfil de assinatura,
    // porque ele nunca podia ter teto. Agora pode, então o status segue o teto:
    // sem teto, a frase de sempre; com teto, a mesma régua da chave de API.
    const statusSemTeto = isApiKey ? 'no orçamento' : 'coberto pela assinatura';
    // "estourado" seria mentira quando o gasto ainda não passou do teto e o que
    // barrou foi a projeção: o chip tem que concordar com a nota logo abaixo
    const previsto = String(p.reason || '').endsWith('-previsto');
    const statusBloqueado = previsto ? 'no limite' : 'orçamento estourado';
    const statusComTeto = p.blocked ? statusBloqueado : 'no orçamento';
    const statusTxt = temTeto ? statusComTeto : statusSemTeto;
    const medidorDiario = p.budgetDaily != null ? meter('Teto diário', p.today, p.budgetDaily) : '';
    const medidorTotal = p.budgetTotal != null ? meter('Teto total', p.sinceCutoff, p.budgetTotal) : '';
    const meters = medidorDiario + medidorTotal;
    const irAoTeto = `sys:plans:.cp-budget-daily[data-id="${escAttrSelector(p.id)}"]`;
    // tres casos excludentes, um por linha: sem chave de API, com chave e sem teto,
    // e com teto batido. A cadeia de ternarios que estava aqui escondia qual deles
    // ganhava quando mais de um parecia valer.
    const NOTA_ASSINATURA = '<span class="usage-budget-note">O gasto em tokens não vira fatura neste perfil, mas o teto vale como ritmo do dia a dia.</span>';
    const NOTA_PAUSADO = '<span class="usage-budget-note">Automação de gasto pausada pra este perfil (revisão automática, retentativa e scan de pushback).</span>';
    const notaPrevisto = `<span class="usage-budget-note">A próxima revisão (${esc(fmtMoney(p.tipicoReview || 0))} em média) não caberia no teto, então a automação parou antes de gastar. O clique manual continua liberado.</span>`;
    const notaSemTeto = `<span class="usage-budget-note">Nenhum teto definido pra este perfil (<span class="is-goto" data-goto="${esc(irAoTeto)}" role="button" tabindex="0">definir em Sistema → Plano e chaves</span>).</span>`;
    let nota = '';
    if (!temTeto && !isApiKey) nota = NOTA_ASSINATURA;
    else if (!temTeto) nota = notaSemTeto;
    else if (previsto) nota = notaPrevisto;
    else if (p.blocked) nota = NOTA_PAUSADO;
    // o nome do perfil leva ao card DELE em Sistema (o input do nome carrega o
    // mesmo id; seletor montado aqui porque CSS.escape não existe no pure.js)
    const alvoPerfil = `sys:plans:.cp-label[data-id="${escAttrSelector(p.id)}"]`;
    return `<div class="usage-budget-card">
      <div class="usage-budget-head">
        <span class="usage-budget-name is-goto" data-goto="${esc(alvoPerfil)}" role="button" tabindex="0" title="Abrir este perfil em Sistema → Plano e chaves">${esc(p.label || p.id)}</span>
        <span class="usage-budget-kind">${isApiKey ? 'Chave de API' : 'Login por assinatura'}</span>
        <span class="usage-budget-status ${statusCls}">${esc(statusTxt)}</span>
      </div>
      ${meters}
      ${nota}
    </div>`;
  }).join('')
    // lacuna declarada (auditoria de 10/08): a sessao interativa de terminal usa a
    // MESMA credencial do perfil, mas o claude interativo nao emite stream-json,
    // entao esse gasto nao tem como entrar na medicao nem no teto. Sem declarar,
    // o cartao prometia um teto que um dos caminhos de gasto nunca encontra.
    + (temTetoAlgum ? '<span class="usage-budget-note">Sessões interativas no terminal usam a mesma credencial, mas não entram na medição nem no teto: o CLI não reporta o consumo delas ao Farol.</span>' : '');
}

export function usageSessionsHtml(u) {
  const lista = u.recentSessions || [];
  // mensagem curta de proposito: a explicacao completa (o que gera consumo) ja
  // aparece na linha do tempo, logo acima nesta mesma aba; repetir a frase
  // inteira aqui so duplicava as mesmas 25 palavras duas vezes na tela.
  if (!lista.length) return '<div class="usage-empty">Nenhuma sessão ainda.</div>';
  const head = `<div class="usage-sessions-row head">
      <span class="usage-sessions-hcell">Quando</span><span class="usage-sessions-hcell">Tipo</span>
      <span class="usage-sessions-hcell">PR / sessão</span><span class="usage-sessions-hcell">Modelo</span>
      <span class="usage-sessions-hcell">Farol</span>
      <span class="usage-sessions-hcell right">Tokens</span><span class="usage-sessions-hcell right">~US$</span>
      <span class="usage-sessions-hcell right">Estado</span></div>`;
  const rows = lista.map(s => {
    const r = usageSessionRow(s);
    return `<div class="usage-sessions-row">
      <span class="usage-sessions-when">${esc(r.whenLabel)}</span>
      <span class="usage-sessions-kind"><span class="dot" style="background:${USAGE_KIND_COLOR[s.kind] || 'var(--faint)'};width:8px;height:8px;border-radius:2.5px;display:inline-block"></span>${esc(r.kindLabel)}</span>
      ${sessionRefCell(r.ref, 'usage-sessions-ref')}
      <span class="usage-sessions-model">${esc(r.model)}</span>
      <span class="usage-sessions-farol"${r.farol === FAROL_PRE_STAMP_LABEL ? ` title="sessão registrada antes da ${FAROL_STAMP_SINCE}, quando o carimbo de versão passou a existir"` : ''}>${esc(r.farol)}</span>
      <span class="usage-sessions-num">${esc(r.tokLabel)}</span>
      <span class="usage-sessions-num">${esc(r.costLabel)}</span>
      <span style="text-align:right"><span class="usage-sessions-st ${r.stClass}">${esc(r.stLabel)}</span></span>
    </div>`;
  }).join('');
  // cobertura declarada: o log individual nasceu na v2.38.0 (10/08/2026); sessoes
  // anteriores existem SO nos agregados (KPI/linha do tempo/matriz, camada "Sem
  // detalhamento"). Sem a data, a tabela parecia ser o historico inteiro.
  const desde = u.sessionsSince ? new Date(u.sessionsSince) : null;
  const p2 = n => String(n).padStart(2, '0');
  const desdeTxt = desde ? `Registro individual desde ${p2(desde.getDate())}/${p2(desde.getMonth() + 1)}/${desde.getFullYear()}; sessões anteriores aparecem só nos agregados. ` : '';
  return `<div class="usage-sessions">${head}${rows}</div>
    <div class="usage-sessions-foot"><span>${esc(desdeTxt)}Registro permanente, sem botão de zerar.</span><span>Mostrando as ${lista.length} mais recentes</span></div>`;
}

/* ---------- perfil de review por pessoa: papel + matriz por domínio ----------
   Molda o TOM e a POSTURA da revisão automática, nunca a decisão.
   Saiu do app.js na onda 5; o mapa de pessoas entra por parâmetro (era lido de
   STATE.config.people, global proibida aqui). Todo o grupo desce de personOf, que
   era a única leitura de global: com `people` no argumento, os cinco viram puros
   de uma vez.

   As três tabelas abaixo DUPLICAM as chaves de lib/taxonomy.js, e a duplicação é
   estrutural, não descuido: o servidor estático só serve UI_DIR (ver o
   startsWith em lib/http-server.js), então o navegador não consegue importar
   lib/. O que impede a duplicação de virar divergência é test/taxonomy-ui.test.js,
   que compara os CONJUNTOS DE CHAVES com o engine. Os rótulos ficam livres de
   propósito: aqui eles são mais curtos pra caber no <select> ("Infra" em vez de
   "Infra/DevOps", "Interm." em vez de "Intermediário"). */
export const PAPEL_OPTS = [['', 'papel'], ['estagio', 'Estágio'], ['junior', 'Júnior'], ['pleno', 'Pleno'], ['senior', 'Sênior'], ['techlead', 'Tech Lead'], ['arquiteto', 'Arquiteto'], ['especialista', 'Especialista']];
export const DOMAIN_DEFS = [['backend', 'Backend'], ['frontend', 'Frontend'], ['dados', 'Dados'], ['infra', 'Infra']];
export const DOMLEVEL_OPTS = [['', 'sem info'], ['basico', 'Básico'], ['intermediario', 'Interm.'], ['avancado', 'Avançado'], ['autoridade', 'Autoridade']];
export function personOf(login, people) { return (people || {})[String(login || '').toLowerCase()] || {}; }
export function papelOf(login, people) { return personOf(login, people).papel || ''; }
export function domLevelOf(login, d, people) { return (personOf(login, people).dominios || {})[d] || ''; }
// papel (compacto): usado nos cards do PR e no cabeçalho do card do time
export function papelPicker(login, people) {
  return `<select class="papel-level" data-login="${esc(login)}" title="Papel de @${esc(login)}: molda o tom da revisão automática, nunca a decisão">
    ${PAPEL_OPTS.map(([v, t]) => `<option value="${v}"${papelOf(login, people) === v ? ' selected' : ''}>${t}</option>`).join('')}
  </select>`;
}
// matriz por domínio (só na aba Time): competência por área calibra a postura
export function domainMatrix(login, people) {
  return `<div class="dom-matrix">${DOMAIN_DEFS.map(([d, label]) => `
    <label class="dom-cell"><span class="dom-name">${label}</span>
      <select class="dom-level" data-login="${esc(login)}" data-domain="${d}" title="Competência de @${esc(login)} em ${label}">
        ${DOMLEVEL_OPTS.map(([v, t]) => `<option value="${v}"${domLevelOf(login, d, people) === v ? ' selected' : ''}>${t}</option>`).join('')}
      </select></label>`).join('')}</div>`;
}

/* ---------- reviewers: rótulo e chip ----------
   Saiu do app.js na onda 5. `cands` é o mapa de candidatos por org (era o global
   reviewerCands): só serve pra achar o NOME de um time a partir do id; sem ele o
   rótulo degrada pro slug do time, que é exatamente o que acontecia enquanto os
   candidatos ainda não tinham carregado. */
export function reviewerLabel(rv, cands) {
  const isTeam = rv.includes('/');
  const ent = isTeam && rv.split('/').slice(1).join('/').includes(':');
  if (ent) return { label: `${rv.split('/').pop()} (enterprise, não pedível)`, cls: 'bad', ent: true };
  if (isTeam) { const org = rv.split('/')[0]; const t = (((cands || {})[org] || {}).teams || []).find(t => t.id === rv); return { label: (t ? t.name : rv.split('/').pop()) + ' (time)', cls: 'team' }; }
  return { label: rv, cls: '' };
}
export function chipHtml(rv, xClass, dataAttrs, cands) {
  const r = reviewerLabel(rv, cands);
  // os dois ternários saem do template: juntos numa linha só eles contavam como
  // ternário aninhado no gate de qualidade, e a versão com nome é mais legível
  const cls = r.cls ? ' ' + r.cls : '';
  const title = r.ent ? 'title="Time enterprise não pode ser reviewer de PR (o GitHub recusa). Remova daqui."' : '';
  return `<span class="rev-chip${cls}" ${title}>${esc(r.label)}<button class="${xClass}" ${dataAttrs} title="remover">×</button></span>`;
}

/* ---------- chat: o contador de mensagens no card ----------
   Saiu do app.js na onda 5; o mapa de chats entra por parâmetro (era STATE.chats,
   e o `?.` de lá cobria justamente o STATE ainda null antes do primeiro SSE). */
export function chatBadge(key, chats) {
  const c = (chats || {})[key];
  return c && c.count ? ` <span class="count">${c.count}</span>` : '';
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
  // `posted` (você resolveu na mão) entrou na lista depois do #767: a linha mostrava
  // só "postado por você" e engolia o motivo de o PR ter caído na sua mesa, então uma
  // recusa por contestação ou cobertura era lida como se a chave de aprovar sozinho
  // estivesse quebrada. O motivo já estava gravado em `reasons`, faltava a superfície.
  const COM_REASONS = ['auto_approved', 'auto_rejected', 'already_reviewed', 'posted'];
  const attn = (r.attention && r.attention.length) ? r.attention
    : (COM_REASONS.includes(r.status) ? (r.reasons || []) : []);
  const plural = attn.length > 1;
  const attnLabel = r.status === 'already_reviewed'
    ? `achado${plural ? 's' : ''} que ${plural ? 'ficaram' : 'ficou'} só aqui`
    : r.status === 'auto_rejected'
      ? `motivo${plural ? 's' : ''} do pedido de mudanças`
      : r.status === 'posted'
        ? `motivo${plural ? 's' : ''} de ter vindo pra você`
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
  const stLine = stagesLine(r.stages);
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
        ${stLine ? `<div class="rr-stages">${esc(stLine)}</div>` : ''}
        ${attn.length ? `<details class="resolved-attn"><summary>⚠ ${attn.length} ${attnLabel}</summary>${reasonGroupsHtml(attn, r.postRetry)}</details>` : ''}
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

/* ---------- diagnóstico ----------
   O texto que a pessoa copia e cola quando vem pedir ajuda. É a única saída do app que
   alguém lê fora do app, então mudança aqui é mudança de contrato com quem socorre.
   Cada ternário mora no seu próprio `const` porque o ratchet conta '?' por statement e
   este arquivo não tem folga nesse eixo. */

function contaLinhaDiag(a) {
  const primaria = a.primary ? ' [primária]' : '';
  const silenciada = a.muted ? ' · silenciada' : '';
  const token = a.tokenOk ? 'ok' : 'NAO';
  const orgs = (a.owners || []).join(',') || '-';
  return `  @${a.user}${primaria} · rótulo=${a.label || '-'} · tipo=${a.kind || '-'} · orgs=${orgs} · token=${token}${silenciada}`;
}

function assinaturaLinhaDiag(p) {
  const rotulo = p.label ? ' [' + p.label + ']' : '';
  const onde = p.configDir ? 'dir próprio (' + p.configDir + ')' : 'padrão da máquina';
  const conta = p.account ? ' · conta ' + p.account : '';
  const semLogin = p.ready === false ? ' · SEM LOGIN (rode: claude login nesse dir)' : '';
  return `  assinatura Claude${rotulo}: ${onde}${conta}${semLogin}`;
}

function atualizacaoLinhaDiag(u) {
  if (!u) return '?';
  const alvo = u.available ? 'v' + u.sourceVersion + ' DISPONÍVEL' : 'na mais recente';
  const repo = u.repo ? ' ' + u.repo : '';
  const nota = u.note ? ' · ' + u.note : '';
  return `v${u.current} · ${alvo} (${u.channel}${repo})${nota}`;
}

export function diagnosticsText(ctx = {}) {
  const s = ctx.s || {};
  const log = ctx.log || [];
  const grupos = ctx.grupos || [];
  const tail = ctx.tail || 40;
  const d = s.doctor || {};
  const c = s.config || {};
  const contas = s.accounts || [];
  const accts = contas.map(contaLinhaDiag).join('\n');
  const erroSuf = s.error ? ' · último erro: ' + s.error : '';
  const ghAuth = d.ghAuth ? 'sim' : 'NAO';
  const eventos = grupos.reduce((n, g) => n + g.count, 0);
  // resumo primeiro, detalhe depois: quem lê o relatório precisa saber QUANTOS
  // episódios distintos existem antes de encarar linha crua.
  const resumo = grupos.length ? ['  Resumo:', ...logSummaryLines(grupos).map(l => '    ' + l), ''] : [];
  const cabecalhoDetalhe = `  Detalhe (as ${Math.min(log.length, tail)} linhas mais recentes):`;
  const detalhe = log.length ? [cabecalhoDetalhe, ...logTailLines(log, tail)] : ['  (sem falhas registradas)'];
  return [
    '=== Farol · diagnóstico ===',
    `gerado: ${ctx.agora || '?'}`,
    `versão: v${s.app?.version || '?'} · plataforma: ${s.app?.platform || '?'} · node: ${d.node || '?'}`,
    `status: ${s.status || '?'}${erroSuf}`,
    '',
    'Ambiente (doctor):',
    `  gh: ${d.gh || 'NAO ENCONTRADO'}`,
    `  claude: ${d.claude || 'NAO ENCONTRADO'}`,
    ...(d.claudeAuth || []).map(assinaturaLinhaDiag),
    `  git bash: ${d.gitBash || '(n/a)'}`,
    `  conta primária autenticada no gh: ${ghAuth}`,
    `  workspace: ${d.workspace || s.paths?.workspace || '?'}`,
    `  home: ${s.paths?.home || '?'}`,
    '',
    `Contas (${contas.length}):`,
    accts || '  (nenhuma)',
    '',
    'Config:',
    `  intervalo: ${c.intervalSeconds}s · autoReview: ${!!c.autoReview} · autoApproveAll: ${c.autoApproveAll !== false} · autoApproveContested: ${c.autoApproveContested === true} · skipPermissions: ${!!c.skipPermissions}`,
    `  autostart: ${!!c.autostart} · som: ${!!c.soundEnabled} · tema: ${c.theme || '-'}`,
    `  updateRepo: ${c.updateRepo || '-'} · updateSource: ${c.updateSource || '(release)'}`,
    `  mergeBlockedRepos: ${(c.mergeBlockedRepos || []).join(', ') || '-'}`,
    '',
    'Estado agora:',
    `  fila: ${(s.queue || []).length} · panorama: ${(s.panorama || []).length} · meus PRs: ${(s.myPRs || []).length} · decisões pendentes: ${(s.decisions?.pending || []).length} · sessões ativas: ${(s.activeSessions || []).length}`,
    `  atualização: ${atualizacaoLinhaDiag(s.update)}`,
    '',
    // evento = linha com timestamp; o total de LINHAS é maior porque mensagem de erro
    // multilinha (gh, cmd.exe) ocupa mais de uma. Dizer só "159 linhas" e depois "146
    // eventos" na linha de leitura confundia, então o cabeçalho traz os dois.
    `Log de falhas (${eventos} evento(s) em ${grupos.length} grupo(s), ${log.length} linha(s)):`,
    ...resumo,
    ...detalhe,
    '',
    '(este relatório não contém tokens nem senhas)'
  ].join('\n');
}

/* ---------- cartão da sessão ao vivo ----------
   O bloco que aparece enquanto o Claude está trabalhando num PR. Os `data-id`/`data-started`
   não são decoração: o app volta neles depois para atualizar tempo, modelo e progresso sem
   redesenhar o cartão. Trocar um atributo desses quebra a atualização, não o layout. */
export function sessionCardHtml(s = {}, stages = '') {
  const id = esc(s.id);
  const linkPR = s.pr?.url ? `<a href="${esc(s.pr.url)}" target="_blank" rel="noreferrer">abrir PR</a>` : '';
  const cancelar = s.cancellable ? `<button class="btn sm danger-ghost act-cancel" data-id="${id}">Cancelar</button>` : '';
  return `
      <div class="card session-card" data-id="${id}">
        <div class="session-head">
          <span class="spin accent"></span>
          <b>${esc(s.label)}</b> <span class="session-stage" data-started="${s.startedAt || ''}">${stages}</span>
          <span class="session-model" data-id="${id}" hidden></span>
          <span class="session-agents" data-id="${id}" hidden></span>
          ${linkPR}
          <span class="session-elapsed" data-started="${s.startedAt}"></span>
          ${cancelar}
        </div>
        <div class="op-progress sess-progress" data-id="${id}"><span class="sess-pct"></span><div class="op-bar"><div class="op-bar-fill"></div></div></div>
        <div class="stage-flow" data-id="${id}" hidden></div>
        <div class="activity-feed" data-id="${id}"></div>
      </div>`;
}
