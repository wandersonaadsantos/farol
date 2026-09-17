// História de revisões (7.C3), a parte pura: o índice que a lista lê e o corpo que se abre.
// Sem estado, sem IO, sem rede.
//
// O ÍNDICE é pequeno de propósito (até 1024 no envelope): veredito, status, ação, contagens
// e o PR por tag. Em claro ficam só `t` (instante da decisão), `d` (aparelho) e `dt`
// (aparelho + instante com 13 dígitos), que são os campos que o banco sabe ordenar: é o
// que permite pedir "as 30 mais recentes" e "as 30 deste aparelho" sem baixar tudo.
//
// O CORPO é a projeção que a tela já usa (decisionForUi), com o review humanizado, sem o
// login da conta e sem o estado de retry, que é deste aparelho. Cada mudança de status é uma VERSÃO nova, e a
// versão é o instante da mudança: determinística entre reinícios, e crescente.
import { tag, prTag, matTag } from './tags.js';

const STATUS = ['pending', 'posted', 'auto_approved', 'auto_rejected', 'already_reviewed', 'skipped', 'superseded'];
const ACOES = ['approve', 'request_changes', 'comment', 'skip'];
const VEREDITOS = ['approve', 'request_changes', 'comment', 'skip'];
// `reportMarkdown` FICA: na projeção da tela ele já é o review humanizado
// (reviewMarkdownForUi), que é justamente o que se abre no outro aparelho.
const FORA_DO_CORPO = ['account', 'postRetry', 'payloads', 'memory'];

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

function corpoDe(ui) {
  if (!objeto(ui)) return {};
  const corpo = { ...ui };
  for (const campo of FORA_DO_CORPO) delete corpo[campo];
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

export default { STATUS, indiceDe, tDe, dtDe, versaoDe, reviewIdDe, corpoDe, ordenar };
export { STATUS, indiceDe, tDe, dtDe, versaoDe, reviewIdDe, corpoDe, ordenar };
