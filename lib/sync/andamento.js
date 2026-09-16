// Andamento ao vivo (7.C3), a parte pura: o que de uma sessão local pode viajar para os
// outros aparelhos. Sem estado, sem IO, sem rede.
//
// ANDAMENTO É "EM QUE ETAPA, HÁ QUANTO TEMPO, COM QUEM", e só isso. O feed da sessão tem
// texto do modelo, caminho de arquivo, comando e trecho de código de terceiros; nada disso
// sobe, nem cifrado. A projeção é uma allowlist construída campo a campo, e o PR e a conta
// viajam como tag.
//
// O vocabulário de etapa é FECHADO e é o mesmo da esteira local (lib/engine/review.js).
// Etapa que ninguém conhece vira `desconhecida`: a tela do outro aparelho não pode receber
// um rótulo que ela não sabe traduzir. A autoanálise, que não tem etapa, aparece assim.
//
// O nó tem vida curta (`x`): quem não renova some. Nó vencido é "interrompida", e nunca
// "em andamento" por inércia.
import { tag, prTag, acctTag } from './tags.js';

const ETAPAS = ['preparo', 'leitura', 'card', 'verificacao', 'raciocinio', 'fechamento'];
const DESCONHECIDA = 'desconhecida';
const TIPOS = ['review', 'self', 'pushback'];
const TTL_MS = 150 * 1000;
const MAX_SUBAGENTE = 24;

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function etapaDe(item) {
  const s = objeto(item) ? String(item.s || '') : '';
  return ETAPAS.includes(s) ? s : DESCONHECIDA;
}

function tipoDe(sessao) {
  const c = String(sessao.checkpoint || sessao.mode || '');
  return TIPOS.includes(c) ? c : 'review';
}

// rótulo de subagente: só letras, dígitos e hífen, curto. É o que a tela mostra, e nada
// que pareça caminho ou comando atravessa
function rotuloDe(a) {
  return String(a || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, MAX_SUBAGENTE);
}

function temposDe(feed, inicio, agora) {
  const ms = {};
  let antes = Number(inicio) || 0;
  let atual = DESCONHECIDA;
  const linhas = (Array.isArray(feed) ? feed : []).filter((i) => objeto(i) && Number(i.t) > 0);
  for (const item of linhas) {
    const e = etapaDe(item);
    ms[e] = (ms[e] || 0) + Math.max(0, Number(item.t) - antes);
    antes = Number(item.t);
    atual = e;
  }
  // a etapa corrente conta até agora, senão o tempo da tela do outro congela na última linha
  if (linhas.length) ms[atual] = (ms[atual] || 0) + Math.max(0, Number(agora) - antes);
  return { ms, atual };
}

function tagOuVazio(fn, kId, valor) {
  return valor ? fn(kId, String(valor)) : '';
}

function etapaVisivel(sessao, atual) {
  return tipoDe(sessao) === 'self' ? DESCONHECIDA : atual;
}

function projetar(sessao, feed, { kId, agora }) {
  const s = objeto(sessao) ? sessao : {};
  const pr = objeto(s.pr) ? s.pr : {};
  const { ms, atual } = temposDe(feed, s.startedAt, agora);
  const subagentes = [...new Set((Array.isArray(feed) ? feed : []).map((i) => rotuloDe(objeto(i) && i.a)).filter(Boolean))].sort();
  const msPorEtapa = {};
  for (const e of [...ETAPAS, DESCONHECIDA]) if (ms[e]) msPorEtapa[e] = ms[e];
  return {
    etapa: etapaVisivel(s, atual),
    msPorEtapa,
    subagentes,
    modelo: String(s.model || '').slice(0, 40),
    prTag: tagOuVazio(prTag, kId, pr.key),
    acctTag: tagOuVazio(acctTag, kId, s.account),
    tipo: tipoDe(s),
  };
}

// O id da operação amarra aparelho e sessão local: o mesmo `a-17` em dois aparelhos são
// duas operações diferentes.
function opIdDe(kId, dev, idLocal) {
  return tag(kId, 'event', `op|${dev}|${idLocal}`);
}

function vencimentoDe(agora) {
  return Number(agora) + TTL_MS;
}

function situacao(no, agora) {
  return objeto(no) && Number(no.x) > Number(agora) ? 'viva' : 'interrompida';
}

export default { ETAPAS, DESCONHECIDA, TIPOS, TTL_MS, projetar, opIdDe, vencimentoDe, situacao };
export { ETAPAS, DESCONHECIDA, TIPOS, TTL_MS, projetar, opIdDe, vencimentoDe, situacao };
