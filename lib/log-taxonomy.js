// Taxonomia de FALHA do Farol: a fonte ÚNICA de "que erro é esse e o que fazer".
// Puro (sem estado, sem IO, sem rede), como lib/format.js e lib/taxonomy.js.
//
// Por que existe: a classificação estava duplicada em dois lugares que nem se
// falavam. Em lib/engine/review.js quatro regexes inline (limitErr, netErr,
// toolErr, authErr) decidiam se a revisão volta pra fila ou estaciona; o painel
// de Diagnóstico, do outro lado, só despejava a linha crua do farol.log, sem
// entender nada. Mesmo texto, duas leituras, uma delas nenhuma. Aqui os dois
// consumidores passam a ler a mesma tabela.
//
// A tabela é ORDENADA: a primeira classe que casar vence. A ordem não é enfeite,
// ela resolve sobreposição real (ver 'console-fechado' contra 'ferramenta'
// abaixo), então mexer na ordem muda comportamento. Classe nova entra no lugar
// que respeite as sobreposições, nunca simplesmente no fim.
//
// Os padrões saíram do farol.log real de produção, não de suposição.

// kind = o que FAZER com a falha, o eixo que interessa pro engine:
//   operacional  : nem é falha de verdade, é o app/você agindo (reinício, janela fechada)
//   espera-reset : passa sozinho, mas na hora dele (limite de plano espera o reset)
//   transitorio  : passa sozinho e rápido (rede, binário sumido, token piscando)
//   permanente   : não passa sem alguém agir (credencial, crédito, assinatura)
// grupo = ONDE dói, o eixo que interessa pro painel de Diagnóstico agrupar.
const CLASSES = [
  {
    id: 'restart-fila',
    label: 'App reiniciado com revisão em andamento',
    grupo: 'operacional',
    kind: 'operacional',
    re: /app reiniciado com revis/i,
  },
  {
    // vem ANTES de 'ferramenta' de propósito: 3221225786 é STATUS_CONTROL_C_EXIT
    // do Windows, ou seja, você fechou a janela do console. O texto também casa
    // com 'saiu com codigo \d' lá embaixo, e sem esta precedência fechar a janela
    // do login viraria "binário indisponível" no Diagnóstico.
    id: 'console-fechado',
    label: 'Sessão fechada no console',
    grupo: 'operacional',
    kind: 'operacional',
    re: /sessao ".*" saiu com codigo 3221225786/i,
  },
  {
    id: 'limite-plano',
    label: 'Limite do plano Claude',
    grupo: 'ambiente',
    kind: 'espera-reset',
    re: /hit your (session|usage|weekly) limit|session limit|usage limit/i,
  },
  {
    id: 'assinatura-bloqueada',
    label: 'Org desligou o acesso por assinatura',
    grupo: 'credencial',
    kind: 'permanente',
    re: /disabled Claude subscription|ask your admin to enable access/i,
  },
  {
    id: 'credencial-invalida',
    label: 'Credencial recusada pelo provedor',
    grupo: 'credencial',
    kind: 'permanente',
    re: /Invalid API key|Fix external API key|authentication_error/i,
  },
  {
    id: 'credito-insuficiente',
    label: 'Crédito insuficiente no provedor',
    grupo: 'credencial',
    kind: 'permanente',
    re: /requires more credits|OpenRouter returned 402|\b402\b/i,
  },
  {
    id: 'rede',
    label: 'Rede indisponível',
    grupo: 'rede',
    kind: 'transitorio',
    re: /ECONNRESET|ENOTFOUND|ETIMEDOUT|Connection closed|Unable to connect|fetch failed|network|error connecting to api\.github\.com|buscas gh falharam/i,
  },
  {
    // API do GitHub fora do ar (gateway 502/503/504, ou o boilerplate do gh pra
    // isso: "No server is currently available..."). Achado no biud-frontend#774
    // (17/08/2026): um APPROVE aprovável pelo gate falhou por 503 durante um
    // major_outage do GitHub, e como nenhuma classe daqui casava, a falha virava
    // 'desconhecido' -> permanente, sem chance de tentar de novo sozinho.
    id: 'github-indisponivel',
    label: 'API do GitHub indisponível',
    grupo: 'rede',
    kind: 'transitorio',
    re: /No server is currently available|HTTP 50[234]\b|\b50[234] Server Error/i,
  },
  {
    // flake do keyring do gh: o token da conta some no meio e volta sozinho
    id: 'token-gh',
    label: 'Token da conta sumiu no gh',
    grupo: 'credencial',
    kind: 'transitorio',
    re: /sem token no gh/i,
  },
  {
    id: 'ferramenta',
    label: 'Ferramenta ou binário indisponível',
    grupo: 'app',
    kind: 'transitorio',
    re: /não é reconhecido|nao e reconhecido|not recognized|No such file|ENOENT|command not found|saiu com c[óo]digo \d/i,
  },
];

// Fallback. NUNCA transitório de propósito: sem saber o que houve, relançar a
// revisão sozinho vira loop queimando token. Falha que ninguém previu estaciona
// e espera olho humano, que é o comportamento de hoje em review.js.
const DESCONHECIDO = {
  id: 'desconhecido',
  label: 'Falha não classificada',
  grupo: 'app',
  kind: 'permanente',
  re: null,
};

// Classifica um texto de falha (mensagem de erro ou linha de log). Nunca lança e
// nunca devolve null: entrada estranha cai no fallback.
function classify(texto) {
  let s = '';
  try { s = typeof texto === 'string' ? texto : ''; } catch { return DESCONHECIDO; }
  if (!s) return DESCONHECIDO;
  for (const c of CLASSES) {
    if (c.re.test(s)) return c;
  }
  return DESCONHECIDO;
}

// Hora do reset citada nas mensagens de limite de plano ("resets 9pm",
// "resets 21:00", "resets 9:30pm"). Devolve Date ou null.
//
// FUSO: a hora é interpretada no fuso LOCAL da máquina. A mensagem do Claude
// carrega o fuso dela (ex.: "resets 9pm (America/Sao_Paulo)") e a máquina do
// usuário já roda nesse fuso, então local acerta. Converter fuso de verdade
// exigiria tabela de zona ou biblioteca, e o invariante 1 do projeto proíbe
// dependência npm. Se um dia isso doer, o caminho é Intl.DateTimeFormat com
// timeZone, que é nativo, não a inclusão de um pacote.
function resetAtFrom(msg, now) {
  const s = typeof msg === 'string' ? msg : '';
  if (!s) return null;
  const base = (now instanceof Date && !isNaN(now.getTime())) ? now : new Date();
  const m = s.match(/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] === undefined ? 0 : Number(m[2]);
  const mer = (m[3] || '').toLowerCase();
  if (min > 59) return null;
  if (mer) {
    if (h < 1 || h > 12) return null; // "13pm" não existe
    if (mer === 'pm' && h !== 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
  } else if (h > 23) {
    return null;
  }
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, min, 0, 0);
  // o reset citado é sempre o PRÓXIMO: se o instante de hoje já passou (ou é
  // exatamente agora), o que a mensagem quer dizer é amanhã
  if (d.getTime() <= base.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

// Uma linha do farol.log: "[2026-08-07 17:32:15] [WARN] mensagem".
// Devolve null quando a linha NÃO abre com timestamp, o que no farol.log quer
// dizer continuação de uma mensagem multilinha (o stderr do gh e do claude vem
// com quebra dentro), e não linha inválida pra descartar.
// O carimbo aceita offset opcional ("[2026-08-16 22:04:36 -03:00]"): linhas novas
// saem em Brasília com fuso explícito (logStamp), as antigas eram UTC sem marcador
// e continuam parseáveis. O ts devolvido é só data+hora, sem o offset.
const LINHA_RE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?: [+-]\d{2}:\d{2})?\]\s*(?:\[([A-Z]+)\]\s*)?([\s\S]*)$/;

function parseLine(linha) {
  const s = typeof linha === 'string' ? linha.replace(/\r$/, '') : '';
  if (!s) return null;
  const m = s.match(LINHA_RE);
  if (!m) return null;
  return { ts: m[1], level: m[2] || '', msg: m[3] };
}

const REF_RE = /[\w.-]+\/[\w.-]+#\d+/g;
const MAX_REFS = 12;
const MAX_SAMPLE = 160;

// Resumo agrupado das linhas cruas do log (saída de tailLog), do grupo mais
// frequente pro menos. É o que o painel de Diagnóstico mostra no lugar do
// despejo de linha crua.
function triage(linhas) {
  if (!Array.isArray(linhas)) return [];

  // 1) linhas viram EVENTOS. Continuação (linha sem timestamp) é anexada à
  // mensagem do evento anterior antes de classificar: o "não é reconhecido" do
  // binário quebrado cai na linha de baixo, então classificar linha a linha
  // erraria a classe. Continuação nunca abre evento e nunca conta.
  const eventos = [];
  for (const bruta of linhas) {
    const ev = parseLine(bruta);
    if (ev) { eventos.push(ev); continue; }
    const anterior = eventos[eventos.length - 1];
    if (!anterior) continue; // continuação órfã no topo do tail: sem dono, ignora
    const cauda = typeof bruta === 'string' ? bruta.replace(/\r$/, '') : '';
    if (cauda.trim()) anterior.msg += '\n' + cauda;
  }

  // 2) agrupa por classe
  const grupos = new Map();
  for (const ev of eventos) {
    const c = classify(ev.msg);
    let g = grupos.get(c.id);
    if (!g) {
      g = {
        id: c.id, label: c.label, grupo: c.grupo, kind: c.kind,
        count: 0, first: ev.ts, last: ev.ts,
        refs: [], sample: ev.msg.slice(0, MAX_SAMPLE),
        _refs: new Set(),
      };
      grupos.set(c.id, g);
    }
    g.count++;
    g.last = ev.ts;
    for (const ref of ev.msg.match(REF_RE) || []) g._refs.add(ref);
  }

  // 3) refs únicas e ordenadas, com teto; e ordena os grupos por volume.
  // O sort do Node é estável, então empate de count mantém a ordem de primeira
  // aparição no log, que é a leitura natural pra quem olha o painel.
  const out = [];
  for (const g of grupos.values()) {
    g.refs = [...g._refs].sort().slice(0, MAX_REFS);
    delete g._refs;
    out.push(g);
  }
  out.sort((a, b) => b.count - a.count);
  return out;
}

export default { CLASSES, DESCONHECIDO, classify, resetAtFrom, parseLine, triage };
export { CLASSES, DESCONHECIDO, classify, resetAtFrom, parseLine, triage };
