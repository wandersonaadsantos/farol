// Folhas da UI: formatação e transformação de valor solto (texto, número, data, duração),
// sem saber de que tela o valor veio. É a camada de baixo de ui/pure/: nada aqui importa
// outro módulo do diretório, e todos os outros importam daqui.
//
// Extraído do ui/pure.js na Fase 1a da reorganização; o conteúdo não mudou.
//
// `safeJsonParse` é o JSON.parse único da UI, e por isso este caminho é santuário em
// tools/quality/rules.js, do mesmo jeito que lib/io.js é o do engine.

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

// "5h57" / "48min": duração pra leitura humana, sem biblioteca.
export function fmtSpan(minutos) {
  const m = Math.max(0, Math.round(Number(minutos) || 0));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60), resto = m % 60;
  return resto ? `${h}h${String(resto).padStart(2, '0')}` : `${h}h`;
}

export function plural(n, um, muitos) { return `${n} ${n === 1 ? um : muitos}`; }

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

// Quantos PRs o app aprovou SOZINHO hoje (dia local): alimenta a frase do "vazio bom"
// do Radar. resolvedAt é epoch em ms (Date.now() do engine); a versão antiga fatiava
// String(epoch) contra data ISO e nunca batia (ramo morto da v2.30.0).
//
// Duas correções de 30/08/2026, feitas porque a tela dizia 5 e a verdade era 2:
// - `status === 'auto_approved'` é o ÚNICO desfecho em que o APPROVE saiu sem você.
//   Só `action === 'approve'` também somava `posted` (o APPROVE que você mandou postar
//   pelo chat) e `already_reviewed` (em que nada foi postado), então a frase creditava
//   ao app trabalho que era seu, justo na tela onde você confere se a automação age.
// - a contagem é de PRs DISTINTOS, porque é isso que a frase promete: um PR que tem
//   commit novo e é reaprovado três vezes no mesmo dia é um PR, não três.
export function aprovadosHoje(resolved, agora = Date.now()) {
  const hoje = localDayKey(agora);
  const prs = new Set();
  for (const r of resolved || []) {
    if (!r || r.status !== 'auto_approved' || r.action !== 'approve') continue;
    if (localDayKey(r.resolvedAt) !== hoje) continue;
    prs.add(r.key || r.id || r);   // sem key (registro antigo) cada item conta por si
  }
  return prs.size;
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

/* Valor de string dentro de seletor de atributo CSS: [data-id="AQUI"].
   Escapa a barra invertida ANTES da aspa, e a ordem e o ponto: fazendo so a aspa
   (como era ate a onda 5), um id terminado em barra produz [data-id="a\\"], onde a
   barra escapa a aspa de fechamento e o seletor inteiro fica invalido. O clique
   entao nao navega pra lugar nenhum, sem erro visivel. O CSS.escape do navegador
   resolveria, mas nao existe aqui: o pure.js roda tambem no node --test. */
export function escAttrSelector(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function fmtMoney(v) { return 'US$ ' + (Number(v) || 0).toFixed(2); }

// Id genérico pra registro novo que a tela cria (perfil de assinatura Claude, site do
// Jira): nasce aqui, nunca digitado, e mantém o formato que a allowlist do servidor
// espera. Não lê DOM nem STATE (só Date.now/Math.random, fontes externas mas não
// globais mutáveis da tela), por isso mora nesta camada em vez de em cada tela que
// precisa de um id: telas/sistema-contas.js e telas/sistema-jira.js usam a MESMA
// função, e duplicá-la por assunto criaria dois formatos de id por acidente.
export function genProfileId() {
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
