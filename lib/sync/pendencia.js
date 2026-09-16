// Pendência e visto (7.C3, decisão D3), a parte pura. Sem estado, sem IO, sem rede.
//
// NESTA ENTREGA A PENDÊNCIA É SÓ VISÍVEL nos outros aparelhos: a ação continua no aparelho
// dono, porque o dedup de postagem é por processo. Por isso sobe só o que a tela precisa
// para dizer "precisa de você" e por quê: PR e conta por tag, veredito, motivos curtos com
// o tipo, e o bloqueio. Relatório interno e corpo do review ficam fora.
//
// D3: todos os aparelhos avisam o que ninguém viu ainda; o primeiro visto, em qualquer um,
// cala os outros. O visto é gravado uma vez só e não precisa de chave.
import { tag, prTag, acctTag } from './tags.js';

const VEREDITOS = ['approve', 'request_changes', 'comment', 'skip'];
const BLOQUEIOS = ['stale_head'];
const KINDS = ['gate', 'content', 'infra'];
const MAX_MOTIVO = 300;
const MAX_MOTIVOS = 10;
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

function contaDe(item) {
  return objeto(item.pr) ? String(item.pr.account || '') : '';
}

function tagOuVazio(fn, kId, valor) {
  return valor ? fn(kId, String(valor)) : '';
}

function projetarPendencia(item, { kId }) {
  const i = objeto(item) ? item : {};
  const conta = contaDe(i);
  return {
    prTag: tagOuVazio(prTag, kId, i.key),
    acctTag: tagOuVazio(acctTag, kId, conta),
    veredito: daLista(VEREDITOS, i.verdict),
    motivos: (Array.isArray(i.reasons) ? i.reasons : []).slice(0, MAX_MOTIVOS).map(motivoDe),
    bloqueio: daLista(BLOQUEIOS, i.blockedKind),
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

export default { VEREDITOS, MAX_MOTIVO, MAX_MOTIVOS, VISTO_MAX_MS, projetarPendencia, itemIdDe, deveNotificar, vistoDe, vistoApagavel };
export { VEREDITOS, MAX_MOTIVO, MAX_MOTIVOS, VISTO_MAX_MS, projetarPendencia, itemIdDe, deveNotificar, vistoDe, vistoApagavel };
