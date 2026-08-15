'use strict';

// Fronteira entre o diagnóstico interno e qualquer texto apresentado como review.
// O prompt previne a geração ruim; este módulo verifica o último metro de forma
// determinística, tanto antes do GitHub quanto antes de expor uma decisão na UI.

// Todo caractere de formato (Cf) e invisível para quem lê, mas poderia separar
// uma palavra aos olhos do detector: soft hyphen, bidi marks/isolates, zero-width etc.
const INVISIBLE = /\p{Cf}/gu;

function normalizeUnicode(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(/[‘’]/g, "'")
    .replace(/[‐‑‒–—―]/g, '-');
}

function fold(value) {
  return normalizeUnicode(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-_]+/g, ' ')
    .toLowerCase();
}

// Código e URLs podem falar legitimamente de autoApproveAll, prompts, agentes,
// modelos e memória. Eles são evidência técnica, não proveniência do revisor.
function maskTechnicalLiterals(value) {
  return normalizeUnicode(value)
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\r\n]*`/g, ' ')
    .replace(/\]\(\s*(?:https?:\/\/|mailto:)[^)]+\)/gi, ']( )')
    .replace(/\bhttps?:\/\/\S+/gi, ' ');
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '',
    lrm: '', rlm: '', zwnj: '', zwj: '', lre: '', rle: '', lro: '', rlo: '',
    pdf: '', lri: '', rli: '', fsi: '', pdi: '',
  };
  let text = String(value || '');
  // Duas passadas também cobrem entity escapada uma vez, sem virar um decoder
  // permissivo ou depender do DOM no engine Node.
  for (let pass = 0; pass < 2; pass++) {
    text = text
      .replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6}));?/gi,
        (all, dec, hex) => {
          const cp = parseInt(dec || hex, dec ? 10 : 16);
          return Number.isSafeInteger(cp) && cp >= 0 && cp <= 0x10FFFF
            ? String.fromCodePoint(cp) : all;
        })
      .replace(/&([a-z][a-z0-9]+);/gi,
      (all, dec, hex, name) => {
        const entity = String(dec || '').toLowerCase();
        return Object.prototype.hasOwnProperty.call(named, entity) ? named[entity] : all;
      });
  }
  return text;
}

function publicProse(value) {
  // Apresentação não muda a frase visível. Código e URLs já foram mascarados;
  // então podemos reduzir links, ênfase, tags e entities ao texto que o autor vê.
  return normalizeUnicode(decodeHtmlEntities(maskTechnicalLiterals(value)))
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\[([^\]\r\n]+)\]\(\s*\)/g, '$1')
    .replace(/\[([^\]\r\n]+)\]\[[^\]\r\n]*\]/g, '$1')
    .replace(/\[\^[^\]\r\n]+\]/g, '')
    .replace(/_/g, ' ')
    .replace(/[\*~]/g, '');
}

// Regras de alta confiança. Termos genéricos como IA, automação, Farol, agente,
// prompt ou memória NÃO são proibidos sozinhos: podem ser o assunto técnico do PR.
// O que se bloqueia é a proveniência/decisão da própria revisão e o template robótico.
const TEXT_RULES = [
  ['auto_decision', /\b(?:eu\s+)?(?:nao\s+)?auto\s*aprov(?:ei|ou|amos|aram|o|a|ado|ada|ados|adas|ar|aria|avel|aveis)\b/],
  ['auto_decision', /\b(?:nao\s+)?auto\s*reprov(?:ei|ou|amos|aram|o|a|ado|ada|ados|adas|ar)\b/],
  ['auto_decision', /\bautomaticamente\s+aprovad[oa]s?\s+(?:pelo|pela|por)\s+(?:o\s+|a\s+)?(?:farol|claude|chatgpt|llm|ia|modelo|bot|agente)\b/],
  ['auto_decision', /\b(?:este|esse|o)\s+pr\s+(?:foi\s+)?aprovad[oa]\s+(?:automaticamente|de\s+forma\s+automatica)\b/],
  ['auto_decision', /\b(?:este|esse|o)\s+pr\s+(?:recebeu\s+aprovacao\s+automatica|(?:was\s+)?auto\s*approved)\b/],
  ['auto_decision', /\bthis\s+(?:pr|pull\s+request)\s+(?:was\s+)?auto\s*approved\b/],
  ['auto_decision', /\b(?:o\s+)?(?:approve|request\s+changes)\s+(?:foi\s+)?(?:enviado|postado|sent|posted)\s+(?:automaticamente|automatically)\b/],
  ['auto_decision', /\baprovacao\s+automatica\b.{0,55}\b(?:politica|gate|revisao|confirmacao)\s+intern[oa]\b/],
  ['auto_decision', /\baprovad[oa]s?\s+automaticamente\s+(?:pelo|pela|por)\s+(?:o\s+|a\s+)?(?:farol|claude|chatgpt|llm|ia|modelo|bot|agente)\b/],
  ['auto_decision', /\b(?:esta|essa)\s+(?:e|foi)\s+uma?\s+(?:revisao|analise)\s+automatica\b/],
  ['auto_decision', /(?:^|[.!?]\s+)(?:(?:este|esse|o|a|uma?)\s+)?(?:revisao|review|analise)\s+(?:foi\s+)?automatizad[oa]\b(?![^.!?\r\n]{0,80}\b(?:pelo|pela|por)\s+(?:o\s+|a\s+)?(?:worker|workflow|job)\b)/m],
  ['generated_review', /(?:^|[.!?]\s+)(?:(?:esta|essa|este|esse|a|o|uma?)\s+)?(?:revisao|review|analise)\s+(?:foi\s+)?gerad[oa]\s+automaticamente\b/m],
  ['generated_review', /(?:^|[.!?]\s+)(?:(?:este|esse|o|a|uma?)\s+)?(?:revisao|review|analise)\s+automatic[oa]\b(?![^.!?\r\n]{0,80}\b(?:pelo|pela|por)\s+(?:o\s+|a\s+)?(?:worker|workflow|job)\b).{0,45}\b(?:concluid[oa]|finalizad[oa]|sem\s+achados?)\b/m],
  ['generated_review', /(?:^|[.!?]\s+)(?:automated\s+(?:review|analysis)|(?:review|analysis)\s+was\s+automated)\b.{0,45}\b(?:completed|finished|no\s+findings?)\b/im],
  ['auto_decision', /\bautomatically\s+approved\s+by\s+(?:farol|claude|chatgpt|an?\s+(?:ai|llm|model|bot|agent))\b/],
  ['auto_decision', /\b(?:nao|nunca)\s+(?:vou\s+)?post(?:o|ei|ar)\s+(?:sozinho|automaticamente)\b/],
  ['auto_decision', /\b(?:i|we)\s+(?:(?:did\s+not|didn't|could\s+not|won't)\s+)?auto\s+(?:approve|approved|post|posted)\b/],

  ['ai_identity', /\b(?:como|sou)\s+(?:um|uma)?\s*(?:modelo\s+de\s+(?:ia|linguagem)|ia|inteligencia\s+artificial|bot|assistente\s+de\s+ia)\b/],
  ['ai_identity', /\b(?:as\s+an?\s+(?:ai|language\s+model|bot|ai\s+assistant)|i\s+am\s+an?\s+(?:ai|language\s+model|bot))\b/],

  ['generated_review', /\b(?:(?:esta|essa|este|esse|minha|meu|a|o|uma?)\s+)?(?:revisao|review|analise|comentario|texto|relatorio|parecer)\b.{0,55}\b(?:feit[oa]|realizad[oa]|gerad[oa]|escrit[oa]|produzid[oa]|postad[oa]|revisad[oa]|automatizad[oa]|criad[oa]|redigid[oa]|elaborad[oa]|preparad[oa])\s+(?:(?:automaticamente|de\s+forma\s+automatica)\s+)?(?:(?:pelo|pela|por)\s+(?:o\s+|a\s+|um\s+|uma\s+)?|com\s+(?:(?:a|o)\s+)?(?:(?:ajuda|auxilio|apoio|suporte)\s+(?:de|do|da)\s+)?)(?:farol|claude|chatgpt|llm|ia|inteligencia\s+artificial|modelo\s+de\s+(?:ia|linguagem)|bot|agente|sub\s*agente|ferramenta)\b/],
  ['generated_review', /\b(?:este|esse|o)\s+(?:pr|pull\s+request|codigo|diff)\s+(?:foi\s+)?(?:revisad[oa]|analisad[oa]|validado|aprovado)\s+(?:pelo|pela|por)\s+(?:o\s+|a\s+|um\s+|uma\s+)?(?:farol|claude|chatgpt|llm|ia|inteligencia\s+artificial|modelo\s+de\s+(?:ia|linguagem)|bot|agente|sub\s*agente|ferramenta)\b/],
  ['generated_review', /\b(?:(?:o|a|um|uma|os|as)\s+)?(?:farol|claude|chatgpt|llm|ia|inteligencia\s+artificial|modelo\s+de\s+(?:ia|linguagem)|bot|agentes?|sub\s*agentes?)\s+(?:gerou|escreveu|produziu|postou|revisou|revisaram|analisou|analisaram|validou|validaram|leu|leram|criou|redigiu|elaborou|preparou|aprovou|aprovaram|decidiu\s+(?:aprovar|reprovar|pedir\s+mudancas))\s+(?:este|esta|esse|essa|o|a)?\s*(?:pr|pull\s+request|codigo|diff|revisao|review|analise|comentario|texto|relatorio|parecer)\b/],
  ['generated_review', /(?:^|[.!?]\s+)(?:revisad[oa]|analisad[oa]|gerad[oa]|produzid[oa]|feit[oa]|realizad[oa]|criad[oa]|escrit[oa]|elaborad[oa])\s+(?:(?:pelo|pela|por)\s+(?:o\s+|a\s+|um\s+|uma\s+)?|com\s+(?:(?:a|o)\s+)?(?:(?:ajuda|auxilio|apoio|suporte)\s+(?:de|do|da)\s+)?)(?:farol|claude|chatgpt|llm|ia|inteligencia\s+artificial|modelo\s+de\s+(?:ia|linguagem)|bot|agente|sub\s*agente|ferramenta)\b/m],
  ['generated_review', /\b(?:review|analysis|comment|text|report|feedback)\b.{0,45}\b(?:made|performed|generated|written|produced|posted|reviewed|created|authored|prepared)\s+(?:automatically\s+)?(?:by|with)\s+(?:the\s+|an?\s+)?(?:farol|claude|chatgpt|llm|ai|artificial\s+intelligence|language\s+model|bot|agent|subagent|tool)\b/],
  ['generated_review', /\bthis\s+(?:(?:review|analysis|comment|text|report|feedback)\s+)?(?:was\s+)?(?:made|performed|generated|written|produced|posted|reviewed|created|authored|prepared)\s+(?:automatically\s+)?(?:by|with)\s+(?:the\s+|an?\s+)?(?:farol|claude|chatgpt|llm|ai|artificial\s+intelligence|language\s+model|bot|agent|subagent|tool)\b/],
  ['generated_review', /\b(?:(?:the|an?)\s+)?(?:farol|claude|chatgpt|llm|ai|artificial\s+intelligence|language\s+model|bot|agents?|subagents?)\s+(?:generated|wrote|produced|posted|reviewed|analyzed|validated|read|created|authored|prepared|approved|decided\s+to\s+(?:approve|reject|request\s+changes))\s+(?:this|the)?\s*(?:pr|pull\s+request|code|diff|review|analysis|comment|text|report|feedback)\b/],
  ['generated_review', /(?:^|[.!?]\s+)(?:reviewed|analyzed|generated|written|made|produced)\s+(?:by|with)\s+(?:the\s+|an?\s+)?(?:farol|claude|chatgpt|llm|ai|artificial\s+intelligence|language\s+model|bot|agent|subagent|tool)\b/im],

  ['internal_prompt', /\b(?:segui|obedeci|recebi|usei|apliquei)\s+(?:o|os|ao|a|as|meu|minha|meus|minhas)?\s*(?:prompts?\s*(?:do\s+sistema|internos?)?|instrucoes?\s+(?:do\s+sistema|de\s+sistema|internas?))\b/],
  ['internal_prompt', /\bconforme\s+(?:o|as)?\s*(?:prompt\s+do\s+sistema|instrucoes?\s+(?:do\s+sistema|internas?))\b/],
  ['internal_prompt', /\b(?:i|we)\s+(?:followed|used|received|obeyed)\s+(?:the|my|our)?\s*(?:system\s+prompt|prompt|system\s+instructions)\b/],

  ['internal_memory', /\b(?:consultei|li|usei|registrei|atualizei|gravei)\s+(?:a|na|o|no|minha|meu)?\s*(?:memoria\s+(?:do\s+autor|interna)|historico\s+(?:do\s+autor|interno))\b/],
  ['internal_memory', /\b(?:i|we)\s+(?:consulted|read|used|updated|recorded)\s+(?:the|my|our)?\s*(?:author\s+memory|internal\s+memory|reviewer\s+memory)\b/],

  ['internal_gate', /\b(?:decisao\s+interna|fluxo\s+interno|gate\s+(?:de|do)\s+(?:auto\s+)?aprovacao)\b/],
  ['internal_gate', /\bpolitica\s+da\s+conta\b.{0,60}\b(?:review|revisao|aprov|confirm|aguard|post|decis)\w*\b/],
  ['internal_gate', /\b(?:review|revisao|aprov|confirm|aguard|post|decis)\w*\b.{0,60}\bpolitica\s+da\s+conta\b/],
  ['internal_gate', /\b(?:fica|ficou|guardei|registrei)\b.{0,35}\b(?:so|apenas)\s+(?:no|dentro\s+do)\s+(?:app|farol)\b/],
  ['internal_schema', /\b(?:decision|verdict|cardmet|contested|coverage)\s*[:=]\s*(?:auto\s+approve|needs\s+decision|request\s+changes|approve|\[|\{)/],
];

const STRONG_REVIEW_ACTOR = /\b(?:farol|claude|chatgpt|llm|ia|ai|inteligencia\s+artificial|artificial\s+intelligence|modelo\s+de\s+(?:ia|linguagem)|language\s+model|bot|agentes?|sub\s*agentes?|agents?|subagents?|ferramenta|tool|assistente\s+(?:virtual|de\s+ia)|ai\s+assistant)\b/;
const REVIEW_ACTION = /\b(?:feit[oa]s?|realiz\w*|made|performed|revis\w*|analis\w*|ger(?:ou|ad[oa]s?|ar|ando)|escrev\w*|escrit[oa]s?|redig\w*|elabor\w*|prepar\w*|produz\w*|post\w*|aprov\w*|reprov\w*|decid\w*|valid\w*|review\w*|analy[sz]\w*|generat\w*|wrote|written|creat\w*|author\w*|approv\w*|decid\w*|prepar\w*|produc\w*|sent|send)\b/;
const REVIEW_OBJECT = /\b(?:pr|pull\s+request|review|revisao|analise|analysis|codigo|code|diff|comentario|comment|feedback|parecer|relatorio|report|approve|request\s+changes)\b/;
const SELF_REVIEW_REFERENCE = /\b(?:este|esta|esse|essa|neste|nesta|nesse|nessa|deste|desta|desse|dessa|this|the\s+current)\s+(?:review|revisao|analise|analysis|comentario|comment|feedback|parecer|relatorio|report)\b/;

function contextualLanguageIssues(text, field) {
  const issues = [];
  const sentences = String(text || '').split(/[\r\n]+|(?<=[.!?])\s+/).filter(Boolean);
  for (const sentence of sentences) {
    const actor = STRONG_REVIEW_ACTOR.test(sentence);
    const action = REVIEW_ACTION.test(sentence);
    const object = REVIEW_OBJECT.test(sentence);
    // Ator + verbo + objeto, sozinho, tambem descreve bugs reais (por exemplo,
    // "o bot revisa o PR errado"). So e proveniencia quando aponta para ESTE review.
    const selfReference = SELF_REVIEW_REFERENCE.test(sentence);
    if (actor && action && object && selfReference) issues.push({ field, code: 'generated_review' });
    if (/\b(?:como|as\s+an?)\s+(?:um\s+|uma\s+|an?\s+)?(?:llm|ia|ai|bot|modelo\s+de\s+(?:ia|linguagem)|language\s+model|assistente\s+(?:virtual|de\s+ia)|ai\s+assistant)\b/.test(sentence)) {
      issues.push({ field, code: 'ai_identity' });
    }
    if (actor && object && /\b(?:usei|utilizei|recorri|used|with|com)\b.{0,35}\b(?:ajuda|help|revis\w*|review\w*|analis\w*|analy[sz]\w*)\b/.test(sentence)) {
      issues.push({ field, code: 'generated_review' });
    }

    const technicalRunner = /\b(?:worker|workflow|job|pipeline)\b/.test(sentence);
    const automatic = /\b(?:automatic\w*|automat\w*|auto\s+(?:approved|reviewed|generated|posted|sent))\b/.test(sentence);
    const firstPersonAuto = /\b(?:eu\s+)?nao\s+(?:aprovei|aprovo|aprovarei|postei|posto|enviei)\s+automaticamente\b|\bi\s+(?:did\s+not|didn't)\s+(?:approve|post|send)\s+automatically\b/.test(sentence);
    if (firstPersonAuto || (!technicalRunner && selfReference && automatic && action)) {
      issues.push({ field, code: 'auto_decision' });
    }
  }
  return issues;
}

const STRUCTURAL_RULES = [
  ['robotic_alert', /^\s*>\s*\[!(?:note|tip|important|warning|caution)\]/m],
  ['robotic_scoreboard', /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:placar|scorecard)\s*:?(?:\*\*)?(?:\s|$)/m],
  ['robotic_label', /^\s*(?:[-*]\s*)?(?:(?:🔴|🟡|❓|🔵|🟢)\s*)?(?:\*\*)?\s*(?:issue\s*\(blocking\)|suggestion\s*\(non[-\s]*blocking\)|question\s*\(non[-\s]*blocking\)|nitpick|praise)\s*:(?:\*\*)?/mu],
  ['robotic_checklist', /^\s*[-*]\s*\[[xX ]\]\s+/m],
  ['robotic_verdict', /^\s*(?:#{1,6}\s*)?>?\s*(?:\*\*)?\s*(?:✅|🟢|🔴)?\s*(?:approve|aprovavel|request\s+changes|com\s+blocker)\b/m],
];

function publicTextLanguageIssues(value, field = 'body') {
  const masked = publicProse(value);
  const text = fold(masked);
  const structural = normalizeUnicode(masked).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const issues = [];
  for (const [code, pattern] of TEXT_RULES) if (pattern.test(text)) issues.push({ field, code });
  issues.push(...contextualLanguageIssues(text, field));
  for (const [code, pattern] of STRUCTURAL_RULES) if (pattern.test(structural)) issues.push({ field, code });
  return issues.filter((issue, index, all) => all.findIndex(x => x.field === issue.field && x.code === issue.code) === index);
}

function publicReviewLanguageIssues(payload) {
  const issues = publicTextLanguageIssues(payload && payload.body, 'body');
  const comments = Array.isArray(payload && payload.comments) ? payload.comments : [];
  comments.forEach((comment, index) => {
    issues.push(...publicTextLanguageIssues(comment && comment.body, `comments[${index}].body`));
  });
  return issues;
}

const EVENTS = new Set(['APPROVE', 'REQUEST_CHANGES', 'COMMENT']);
const MAX_REVIEW_BODY = 60000;
const MAX_INLINE_BODY = 20000;
const MAX_COMMENTS = 100;
const MAX_PUBLIC_TEXT_TOTAL = 200000;

// Normaliza por allowlist antes de gravar ou postar. Campos desconhecidos nunca
// atravessam o writer e uma âncora inválida falha antes de chamar o GitHub.
function normalizeReviewPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'payload de review inválido' };
  }
  const event = String(payload.event || '').toUpperCase();
  if (!EVENTS.has(event)) return { ok: false, error: 'evento de review inválido' };
  if (typeof payload.body !== 'string') return { ok: false, error: 'corpo do review precisa ser texto' };
  if (payload.body.length > MAX_REVIEW_BODY) return { ok: false, error: 'corpo do review grande demais' };
  const rawComments = payload.comments == null ? [] : payload.comments;
  if (!Array.isArray(rawComments) || rawComments.length > MAX_COMMENTS) {
    return { ok: false, error: 'comentários inline inválidos' };
  }
  const comments = [];
  let totalText = payload.body.length;
  for (let i = 0; i < rawComments.length; i++) {
    const c = rawComments[i];
    if (!c || typeof c !== 'object' || Array.isArray(c)) return { ok: false, error: `comentário inline ${i + 1} inválido` };
    const path = typeof c.path === 'string' ? c.path.trim() : '';
    const body = typeof c.body === 'string' ? c.body.trim() : '';
    const line = Number(c.line);
    const side = String(c.side || '').toUpperCase();
    if (!path || path.length > 1024 || /[\r\n\0]/.test(path)) return { ok: false, error: `path do comentário inline ${i + 1} inválido` };
    if (!body || body.length > MAX_INLINE_BODY) return { ok: false, error: `corpo do comentário inline ${i + 1} inválido` };
    if (!Number.isSafeInteger(line) || line < 1) return { ok: false, error: `linha do comentário inline ${i + 1} inválida` };
    if (side !== 'LEFT' && side !== 'RIGHT') return { ok: false, error: `lado do comentário inline ${i + 1} inválido` };
    totalText += path.length + body.length;
    if (totalText > MAX_PUBLIC_TEXT_TOTAL) return { ok: false, error: 'conteúdo total do review grande demais' };
    comments.push({ path, line, side, body });
  }
  if (event !== 'APPROVE' && !payload.body.trim() && !comments.length) {
    return { ok: false, error: 'review sem texto nem comentário inline' };
  }
  // G1: sha do head que a sessão LEU. Sem ele o GitHub ancora o review no head
  // do momento do POST, que pode ser um commit empurrado durante a sessão.
  // Sha torto é descartado (volta ao comportamento antigo), nunca bloqueia.
  const commitId = /^[0-9a-f]{7,40}$/i.test(String(payload.commit_id || '')) ? String(payload.commit_id) : '';
  const value = { event, body: payload.body.trim(), comments };
  if (commitId) value.commit_id = commitId;
  return { ok: true, value };
}

const INTERNAL_SECTION = /^(?:acao|decisao|por\s+que\s+(?:nao\s+)?auto|reviews?\s+de\s+terceiros|evolucao\b|memoria\b|cobertura\b|checkpoint\b|diagnostico\s+interno|metadados\b|processo\s+interno|placar\b|scorecard\b)/;

function headingInfo(line) {
  const hash = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (hash) return { kind: 'hash', level: hash[1].length, title: hash[2] };
  const bold = /^\s*\*\*\s*([^*]{1,100}?)\s*:?\s*\*\*(?:\s*:?.*)?$/.exec(line);
  if (bold) return { kind: 'bold', level: 7, title: bold[1] };
  return null;
}

function sentenceCase(value) {
  const s = String(value || '').trim().replace(/^[,;:\s-]+/, '');
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

// Remove apenas a autorrevelação conhecida, preservando a afirmação técnica ao redor.
function stripDisclosureClause(value) {
  let text = String(value || '').trim();
  text = text
    .replace(/\s*(?:[,;:]|[-–—])?\s*(?:ent[aã]o|por isso)\s+n[aã]o\s+(?:posto\s+sozinho|auto\s*[- ]?aprov\w+)(?:\s+(?:este|esse|o)\s+(?:pr|review))?\s*[.!]?\s*$/i, '')
    .replace(/\s*(?:[,;:]|[-–—])?\s*(?:ent[aã]o|por isso)\s+n[aã]o\s+posto\s+automaticamente\s*[.!]?\s*$/i, '');
  const because = /^\s*n[aã]o\s+auto\s*[- ]?aprov\w+\s+porque\s+(.+)$/i.exec(text);
  if (because) text = sentenceCase(because[1]);
  const whileMatch = /^\s*n[aã]o\s+auto\s*[- ]?aprov\w+\s+(?:enquanto|at[eé]\s+que)\s+(.+)$/i.exec(text);
  if (whileMatch) text = sentenceCase(whileMatch[1]);
  return text.trim();
}

function humanizeLegacyLine(value) {
  let line = String(value || '');
  const checklist = /^([ \t]*)[-*]\s*\[[xX ]\]\s+(.+)$/.exec(line);
  if (checklist) line = `${checklist[1]}- ${checklist[2]}`;
  const labeled = /^([ \t]*)(?:[-*]\s*)?(?:🔴|🟡|❓|🔵|🟢)\s*(?:\*\*)?\s*(?:issue\s*\(blocking\)|suggestion\s*\(non[-\s]*blocking\)|question\s*\(non[-\s]*blocking\)|nitpick|praise)\s*:(?:\*\*)?\s*(.+)$/iu.exec(line);
  if (labeled) line = `${labeled[1]}- ${labeled[2]}`;
  if (/^\s*>\s*(?!\[!)/.test(line)) line = line.replace(/^\s*>\s*/, '');
  line = line.replace(/^(\s*#{1,6}\s+)[✅🟢🟡🔴🔵❓⚠️\s]+/u, '$1');
  return line;
}

// Decisões antigas não tinham reviewMarkdown e misturavam relatório técnico com
// operação. O extrator só existe para migração em leitura; o dado bruto não é mutado.
function sanitizeInternalReviewMarkdown(value) {
  const lines = String(value || '').split(/\r?\n/);
  const kept = [];
  let skipped = null;
  for (const original of lines) {
    if (publicTextLanguageIssues(original).some(x => x.code === 'robotic_alert')) continue;
    let candidate = humanizeLegacyLine(original);
    const heading = headingInfo(candidate);
    if (skipped) {
      const closesHash = skipped.kind === 'hash' && heading && (heading.kind === 'bold' || heading.level <= skipped.level);
      const closesBold = skipped.kind === 'bold' && !!heading;
      if (!closesHash && !closesBold) continue;
      skipped = null;
    }
    if (heading && INTERNAL_SECTION.test(fold(heading.title).trim())) {
      // Placar em negrito costuma ser uma linha isolada seguida de checklist; não
      // engole o restante do relatório, apenas a assinatura robótica abaixo.
      if (!/^placar\b|^scorecard\b/.test(fold(heading.title).trim())) skipped = heading;
      continue;
    }
    const structuralIssues = publicTextLanguageIssues(candidate).map(x => x.code);
    if (structuralIssues.some(code => code.startsWith('robotic_'))) continue;
    if (/^\s*(?:[-*]\s*)?(?:contested|coverage|cardmet|decision|verdict)\s*[:=]/i.test(normalizeUnicode(candidate))) continue;
    if (/\b(?:APPROVE|REQUEST CHANGES)\s+no\s+head\b/i.test(candidate)) continue;

    const cleaned = stripDisclosureClause(candidate);
    if (!cleaned) continue;
    if (publicTextLanguageIssues(cleaned).length) continue;
    kept.push(cleaned);
  }

  const paragraphs = kept.join('\n').split(/\n{2,}/)
    .map(p => stripDisclosureClause(p))
    .filter(Boolean)
    .filter(p => !publicTextLanguageIssues(p).length);
  return paragraphs.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

function reviewMarkdownForUi(item) {
  if (!item) return '';
  const explicit = String(item.reviewMarkdown || '').trim();
  if (explicit && !publicTextLanguageIssues(explicit).length) return explicit;

  const payloads = item.payloads || {};
  const order = item.action
    ? [item.action, 'comment', item.action === 'approve' ? 'request_changes' : 'approve']
    : item.verdict === 'request_changes'
      ? ['request_changes', 'comment', 'approve']
      : ['approve', 'comment', 'request_changes'];
  for (const key of [...new Set(order)]) {
    const body = String(payloads[key] && payloads[key].body || '').trim();
    if (body && !publicTextLanguageIssues(body).length) return body;
  }
  return sanitizeInternalReviewMarkdown(item.reportMarkdown);
}

function diagnosticTextForUi(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let text = stripDisclosureClause(raw)
    .replace(/\s*na\s+revis[aã]o\s+autom[aá]tica\b/gi, '')
    .replace(/\bmanda aguardar sua aprova[cç][aã]o\b/gi, 'exige sua confirmação')
    .replace(/\bse quiser que aprove sozinho\b/gi, 'se quiser mudar esse comportamento')
    .replace(/\brevis[aã]o iniciada por voc[eê]\s*\([^)]*\)\s*:\s*nada [eé] postado sem sua decis[aã]o\b/gi,
      'Você iniciou esta revisão, então ela precisa da sua confirmação.');
  if (/\bpolitica\s+da\s+conta\b/i.test(fold(text))) text = 'Esta revisão precisa da sua confirmação.';
  if (publicTextLanguageIssues(text).length) return 'Esta revisão precisa da sua confirmação.';
  return text.trim();
}

function uniqueHumanTexts(values) {
  const out = [], seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const text = diagnosticTextForUi(value);
    const key = fold(text).trim();
    if (text && !seen.has(key)) { seen.add(key); out.push(text); }
  }
  return out;
}

// Allowlist deliberada: payloads, memória, relatório bruto, razões brutas e campos
// futuros não chegam à UI por acidente. reportMarkdown aqui é sempre o review humano.
function decisionForUi(item) {
  if (!item) return null;
  const projected = {};
  for (const key of [
    'id', 'createdAt', 'resolvedAt', 'key', 'card', 'cardMet', 'verdict',
    'status', 'action', 'author', 'account',
  ]) if (item[key] !== undefined) projected[key] = item[key];
  if (item.pr && typeof item.pr === 'object') {
    projected.pr = {};
    for (const key of ['repo', 'number', 'url', 'title', 'author']) {
      if (item.pr[key] !== undefined) projected.pr[key] = item.pr[key];
    }
  }
  if (item.verificationCheckpoint && typeof item.verificationCheckpoint === 'object') {
    const vc = item.verificationCheckpoint;
    projected.verificationCheckpoint = {
      total: Number.isFinite(Number(vc.total)) ? Number(vc.total) : 0,
      confirmedCount: Number.isFinite(Number(vc.confirmedCount)) ? Number(vc.confirmedCount) : 0,
      conflictCount: Array.isArray(vc.conflicts) ? vc.conflicts.length : 0,
    };
  }
  projected.reportMarkdown = reviewMarkdownForUi(item);
  projected.reasons = uniqueHumanTexts(item.reasons);
  projected.attention = uniqueHumanTexts(item.attention);
  return projected;
}

module.exports = {
  normalizeUnicode, fold, maskTechnicalLiterals,
  publicTextLanguageIssues, publicReviewLanguageIssues, normalizeReviewPayload,
  sanitizeInternalReviewMarkdown, reviewMarkdownForUi, decisionForUi,
  diagnosticTextForUi, stripDisclosureClause,
};
