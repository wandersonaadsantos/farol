// Pendência e visto (7.C3, decisão D3), a parte pura. Sem estado, sem IO, sem rede.
//
// A DECISÃO É SEMPRE DO APARELHO DONO, porque o dedup de postagem é por processo: o admin
// só manda o comando `decidir`. Por isso sobe só o que a tela precisa para dizer "precisa
// de você" e por quê: PR e conta por tag, veredito, motivos com o tipo, o bloqueio, as
// ações que têm payload (`acoes`, com `skip` sempre) e o `reviewId` do corpo no histórico,
// que é onde o review completo mora (Task 8, 28/09/2026). O review nunca viaja aqui.
//
// D3: todos os aparelhos avisam o que ninguém viu ainda; o primeiro visto, em qualquer um,
// cala os outros. O visto é gravado uma vez só e não precisa de chave.
import { tag, prTag, acctTag } from './tags.js';
import { reviewIdDe } from './historico.js';

const VEREDITOS = ['approve', 'request_changes', 'comment', 'skip'];
const BLOQUEIOS = ['stale_head'];
const KINDS = ['gate', 'content', 'infra'];
const MAX_MOTIVO = 300;
const MAX_MOTIVOS = 10;
// Orçamento em BYTES do texto dos motivos, medido contra o cifrar() real: o nó tem teto de
// 4096 no envelope, e 10 motivos de 300 caracteres já não cabiam nem antes do `reviewId`
// (3551 bytes em claro viram 4779 em base64). Com acento, o dobro.
const ORCAMENTO_MOTIVOS = 1800;
const ACOES_COM_PAYLOAD = ['approve', 'request_changes', 'comment'];
const VISTO_MAX_MS = 30 * 24 * 3600 * 1000;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function daLista(lista, valor) {
  return lista.includes(String(valor || '')) ? String(valor) : '';
}

function motivoDe(r) {
  const m = objeto(r) ? r : { text: r };
  return { text: String(m.text || '').slice(0, MAX_MOTIVO), kind: KINDS.includes(m.kind) ? m.kind : 'content' };
}

// Corta por ponto de código, nunca no meio de um caractere de dois bytes.
function cortarBytes(texto, max) {
  let saida = '';
  let usados = 0;
  for (const ch of texto) {
    const peso = Buffer.byteLength(ch, 'utf8');
    if (usados + peso > max) break;
    saida += ch;
    usados += peso;
  }
  return saida;
}

function motivosDe(reasons) {
  const saida = [];
  let resta = ORCAMENTO_MOTIVOS;
  for (const r of (Array.isArray(reasons) ? reasons : []).slice(0, MAX_MOTIVOS)) {
    const m = motivoDe(r);
    const text = cortarBytes(m.text, resta);
    if (!text && m.text) break;
    resta -= Buffer.byteLength(text, 'utf8');
    saida.push({ ...m, text });
  }
  return saida;
}

function acoesDe(payloads) {
  const presentes = objeto(payloads) ? Object.keys(payloads) : [];
  return [...ACOES_COM_PAYLOAD.filter((a) => presentes.includes(a)), 'skip'];
}

function contaDe(item) {
  return objeto(item.pr) ? String(item.pr.account || '') : '';
}

function tagOuVazio(fn, kId, valor) {
  return valor ? fn(kId, String(valor)) : '';
}

function projetarPendencia(item, { kId, dev = '' }) {
  const i = objeto(item) ? item : {};
  const conta = contaDe(i);
  return {
    prTag: tagOuVazio(prTag, kId, i.key),
    acctTag: tagOuVazio(acctTag, kId, conta),
    veredito: daLista(VEREDITOS, i.verdict),
    motivos: motivosDe(i.reasons),
    bloqueio: daLista(BLOQUEIOS, i.blockedKind),
    reviewId: dev && i.id ? reviewIdDe(kId, String(dev), i.id) : '',
    acoes: acoesDe(i.payloads),
  };
}

// A mesma decisão local em dois aparelhos são dois itens: o id amarra aparelho e decisão.
function itemIdDe(kId, dev, idLocal) {
  return tag(kId, 'pending', `${dev}|${idLocal}`);
}

function deveNotificar(itemId, { notificadas, vistos }) {
  if (notificadas instanceof Set && notificadas.has(itemId)) return false;
  return !(objeto(vistos) && objeto(vistos[itemId]));
}

function vistoDe({ dev, agora }) {
  return { at: Number(agora) || 0, dev: String(dev || '') };
}

function vistoApagavel(visto, { pendenciaExiste, agora }) {
  if (!pendenciaExiste) return true;
  return objeto(visto) && Number(visto.at) + VISTO_MAX_MS < Number(agora);
}

export default { VEREDITOS, MAX_MOTIVO, MAX_MOTIVOS, ORCAMENTO_MOTIVOS, VISTO_MAX_MS, projetarPendencia, itemIdDe, deveNotificar, vistoDe, vistoApagavel };
export { VEREDITOS, MAX_MOTIVO, MAX_MOTIVOS, ORCAMENTO_MOTIVOS, VISTO_MAX_MS, projetarPendencia, itemIdDe, deveNotificar, vistoDe, vistoApagavel };
