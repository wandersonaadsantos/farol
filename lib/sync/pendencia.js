// Pendência e visto (7.C3, decisão D3), a parte pura. Sem estado, sem IO, sem rede.
//
// A DECISÃO É SEMPRE DO APARELHO DONO, porque o dedup de postagem é por processo: o admin
// só manda o comando `decidir`. Por isso sobe só o que a tela precisa para dizer "precisa
// de você" e por quê: PR e conta por tag, veredito, motivos com o tipo, o bloqueio, as
// ações que têm payload (`acoes`, com `skip` sempre) e o `reviewId` do corpo no histórico,
// que é onde o review completo mora (Task 8, 28/09/2026). O review nunca viaja aqui.
//
// `espera` (01/10/2026): vocabulário fechado, hoje só `ci`. Diz que a pendência é aprovável
// e que o aparelho dono aprova sozinho quando o CI obrigatório fechar verde, então ela NÃO
// precisa de ninguém e não entra no aviso da D3. Só o fato viaja: a lista de checks não sobe
// (o texto da espera já vai como motivo `gate`, dentro do orçamento de sempre). É campo a
// mais, e não veredito ou bloqueio novo, por causa de quem lê em versão anterior: o leitor
// da 2.66.3 espalha a projeção sem allowlist e ignora o campo, mostrando a pendência comum
// de antes. Sem o campo (publicador antigo) ou com lixo nele, o leitor novo lê pendência comum.
//
// D3: todos os aparelhos avisam o que ninguém viu ainda; o primeiro visto, em qualquer um,
// cala os outros. O visto é gravado uma vez só e não precisa de chave.
import { tag, prTag, acctTag } from './tags.js';
import { reviewIdDe } from './historico.js';

const VEREDITOS = ['approve', 'request_changes', 'comment', 'skip'];
const BLOQUEIOS = ['stale_head'];
const ESPERAS = ['ci'];
const KINDS = ['gate', 'content', 'infra'];
const MAX_MOTIVO = 300;
const MAX_MOTIVOS = 10;
// Orçamento em BYTES do texto dos motivos JÁ ESCAPADO como o envelope o serializa (JSON):
// o nó tem teto de 4096 no envelope, e 10 motivos de 300 caracteres já não cabiam nem antes
// do `reviewId` (3551 bytes em claro viram 4779 em base64). Com acento, o dobro; com aspas
// ou barra, o dobro também, e caractere de controle vira seis bytes (revisão final,
// 28/09/2026: medido o cru, 1800 aspas estouravam o teto e a pendência não subia).
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

// O peso de um ponto de código dentro de uma string JSON (sem as aspas de fora), com as
// regras do JSON.stringify: aspas e barra viram dois bytes, controle com nome curto
// (\b \t \n \f \r) dois, o resto do controle e o surrogate solto seis (\uXXXX).
const ESCAPE_CURTO = new Set([0x08, 0x09, 0x0a, 0x0c, 0x0d, 0x22, 0x5c]);
function pesoEscapado(ch) {
  const c = ch.codePointAt(0);
  if (ESCAPE_CURTO.has(c)) return 2;
  if (c < 0x20 || (c >= 0xd800 && c <= 0xdfff)) return 6;
  return Buffer.byteLength(ch, 'utf8');
}

function pesoDoTexto(texto) {
  let total = 0;
  for (const ch of texto) total += pesoEscapado(ch);
  return total;
}

// Corta por ponto de código, nunca no meio de um caractere de dois bytes nem de um escape.
function cortarBytes(texto, max) {
  let saida = '';
  let usados = 0;
  for (const ch of texto) {
    const peso = pesoEscapado(ch);
    if (usados + peso > max) break;
    saida += ch;
    usados += peso;
  }
  return saida;
}

// O que não coube é CONTADO (`omitidos`): o admin aprova com base nesta lista, e uma lista
// parcial não pode parecer completa.
function motivosDe(reasons) {
  const todos = Array.isArray(reasons) ? reasons : [];
  const saida = [];
  let resta = ORCAMENTO_MOTIVOS;
  for (const r of todos.slice(0, MAX_MOTIVOS)) {
    const m = motivoDe(r);
    const text = cortarBytes(m.text, resta);
    if (!text && m.text) break;
    resta -= pesoDoTexto(text);
    saida.push({ ...m, text });
  }
  return { motivos: saida, omitidos: todos.length - saida.length };
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

// Do registro local sai só o fato: os checks e as ressalvas guardadas na marca ficam aqui.
function esperaDe(item) {
  return objeto(item.esperaCi) ? 'ci' : '';
}

function projetarPendencia(item, { kId, dev = '' }) {
  const i = objeto(item) ? item : {};
  const conta = contaDe(i);
  const { motivos, omitidos } = motivosDe(i.reasons);
  return {
    prTag: tagOuVazio(prTag, kId, i.key),
    acctTag: tagOuVazio(acctTag, kId, conta),
    veredito: daLista(VEREDITOS, i.verdict),
    motivos,
    motivosOmitidos: omitidos,
    bloqueio: daLista(BLOQUEIOS, i.blockedKind),
    espera: esperaDe(i),
    reviewId: dev && i.id ? reviewIdDe(kId, String(dev), i.id) : '',
    acoes: acoesDe(i.payloads),
  };
}

// A mesma decisão local em dois aparelhos são dois itens: o id amarra aparelho e decisão.
function itemIdDe(kId, dev, idLocal) {
  return tag(kId, 'pending', `${dev}|${idLocal}`);
}

// O que o LEITOR aceita no campo `espera`: fora da lista (ou tipo errado) é pendência comum.
function esperaLida(valor) {
  return typeof valor === 'string' ? daLista(ESPERAS, valor) : '';
}

// Quem espera o CI não precisa de ninguém, então não avisa. E também não entra em
// `notificadas` (quem chama só marca o que avisou): se a espera for largada e o item for
// para a mesa, o mesmo id avisa nessa hora.
function deveNotificar(itemId, { notificadas, vistos, espera = '' }) {
  if (esperaLida(espera)) return false;
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

export default { VEREDITOS, ESPERAS, MAX_MOTIVO, MAX_MOTIVOS, ORCAMENTO_MOTIVOS, VISTO_MAX_MS, projetarPendencia, itemIdDe, esperaLida, deveNotificar, vistoDe, vistoApagavel };
export { VEREDITOS, ESPERAS, MAX_MOTIVO, MAX_MOTIVOS, ORCAMENTO_MOTIVOS, VISTO_MAX_MS, projetarPendencia, itemIdDe, esperaLida, deveNotificar, vistoDe, vistoApagavel };
