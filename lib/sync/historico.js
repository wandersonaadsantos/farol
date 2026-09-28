// História de revisões (7.C3), a parte pura: o índice que a lista lê e o corpo que se abre.
// Sem estado, sem IO, sem rede.
//
// O ÍNDICE é pequeno de propósito (até 1024 no envelope): veredito, status, ação, contagens
// e o PR por tag. Em claro ficam só `t` (instante da decisão), `d` (aparelho) e `dt`
// (aparelho + instante com 13 dígitos), que são os campos que o banco sabe ordenar: é o
// que permite pedir "as 30 mais recentes" e "as 30 deste aparelho" sem baixar tudo.
//
// O CORPO é a projeção que a tela já usa (decisionForUi), com o review humanizado, sem o
// login da conta e sem o estado de retry, que é deste aparelho. Desde a Task 8 ele leva
// também os payloads de cada ação (corpo e inlines), para o admin decidir vendo o review.
// Cada mudança de status é uma VERSÃO nova, e a versão é o instante da mudança:
// determinística entre reinícios, e crescente.
import { tag, prTag, matTag } from './tags.js';
import { safeStringify } from '../io.js';

const STATUS = ['pending', 'posted', 'auto_approved', 'auto_rejected', 'already_reviewed', 'skipped', 'superseded'];
const ACOES = ['approve', 'request_changes', 'comment', 'skip'];
const VEREDITOS = ['approve', 'request_changes', 'comment', 'skip'];
// `reportMarkdown` FICA: na projeção da tela ele já é o review humanizado
// (reviewMarkdownForUi), que é justamente o que se abre no outro aparelho.
const FORA_DO_CORPO = ['account', 'postRetry', 'payloads', 'memory'];
const ACOES_COM_PAYLOAD = ['approve', 'request_changes', 'comment'];
const MAX_CORPO_PAYLOAD = 12000;
const MAX_CORPO_CORTADO = 2000;
const MAX_INLINES = 60;
const MAX_INLINE = 1500;
const ORCAMENTO_CORPO_BYTES = 34000;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function daLista(lista, valor) {
  return lista.includes(String(valor || '')) ? String(valor) : '';
}

function contar(v) {
  return Array.isArray(v) ? v.length : 0;
}

// tag vazia quando o valor não existe: tag de string vazia seria uma tag de verdade, e
// passaria por dado conhecido
function tagSeHouver(valor, calcular) {
  return valor ? calcular(String(valor)) : '';
}

function indiceDe(d, { kId }) {
  const x = objeto(d) ? d : {};
  return {
    veredito: daLista(VEREDITOS, x.verdict),
    status: daLista(STATUS, x.status),
    acao: daLista(ACOES, x.action),
    contagens: { motivos: contar(x.reasons), atencao: contar(x.attention) },
    prTag: tagSeHouver(x.key, (v) => prTag(kId, v)),
    // o commit analisado, como TAG: é o que deixa o admin pedir "repetir" (C6) sobre o
    // mesmo head que a revisão leu, sem o SHA aparecer em lugar nenhum. Revisão sem head
    // conhecido fica com o campo vazio, e a tela diz que falta o dado
    matTag: tagSeHouver(x.headSha, (v) => matTag(kId, v)),
  };
}

function tDe(d) {
  return Number(objeto(d) && d.createdAt) || 0;
}

function dtDe(dev, t) {
  return `${dev}|${String(Math.max(0, Math.floor(Number(t) || 0))).padStart(13, '0')}`;
}

function versaoDe(d) {
  if (!objeto(d)) return 0;
  return Number(d.resolvedAt) || Number(d.createdAt) || 0;
}

function reviewIdDe(kId, dev, idLocal) {
  return tag(kId, 'review', `${dev}|${idLocal}`);
}

// Os payloads que o corpo leva são os MESMOS `item.payloads` que o aparelho dono postaria
// (quem chama passa o registro cru, nunca um texto refeito), saneados por allowlist.
function payloadDe(p) {
  const comments = (Array.isArray(p.comments) ? p.comments : []).filter(objeto).slice(0, MAX_INLINES);
  return {
    event: String(p.event || ''),
    body: String(p.body || '').slice(0, MAX_CORPO_PAYLOAD),
    comments: comments.map(({ path, line, body }) => ({ path: String(path || ''), line: Number(line) || 0, body: String(body || '').slice(0, MAX_INLINE) })),
  };
}

function payloadsDe(payloads) {
  const saida = {};
  for (const acao of ACOES_COM_PAYLOAD) if (objeto(payloads) && objeto(payloads[acao])) saida[acao] = payloadDe(payloads[acao]);
  return Object.keys(saida).length ? saida : null;
}

// O corte, em ordem, até o corpo caber: inlines de comentar, de pedir mudanças, de aprovar,
// depois os corpos encurtados, e por fim os payloads inteiros. A régua é em BYTES do JSON,
// medida contra o cifrar() real: base64 cresce 4/3, então 40000 caracteres (a conta do
// plano) viravam 53 mil no envelope, acima do teto de 48000 do nó de corpos.
const CORTES = [
  (p) => { if (p.comment) p.comment.comments = []; },
  (p) => { if (p.request_changes) p.request_changes.comments = []; },
  (p) => { if (p.approve) p.approve.comments = []; },
  (p) => { for (const a of Object.keys(p)) p[a].body = p[a].body.slice(0, MAX_CORPO_CORTADO); },
];

function cabe(corpo) {
  return Buffer.byteLength(safeStringify(corpo, ''), 'utf8') <= ORCAMENTO_CORPO_BYTES;
}

function corpoDe(ui, payloads) {
  if (!objeto(ui)) return {};
  const corpo = { ...ui };
  for (const campo of FORA_DO_CORPO) delete corpo[campo];
  const limpos = payloadsDe(payloads);
  if (!limpos) return corpo;
  corpo.payloads = limpos;
  for (const cortar of CORTES) {
    if (cabe(corpo)) return corpo;
    cortar(limpos);
    corpo.cortado = true;
  }
  if (!cabe(corpo)) delete corpo.payloads;
  return corpo;
}

// O banco devolve a consulta sem ordem, e duas leituras podem trazer o mesmo item.
function ordenar(lista) {
  const vistos = new Map();
  for (const item of Array.isArray(lista) ? lista : []) {
    if (objeto(item) && item.reviewId && !vistos.has(item.reviewId)) vistos.set(item.reviewId, item);
  }
  return [...vistos.values()].sort((a, b) => b.t - a.t);
}

export default { STATUS, ORCAMENTO_CORPO_BYTES, indiceDe, tDe, dtDe, versaoDe, reviewIdDe, corpoDe, ordenar };
export { STATUS, ORCAMENTO_CORPO_BYTES, indiceDe, tDe, dtDe, versaoDe, reviewIdDe, corpoDe, ordenar };
