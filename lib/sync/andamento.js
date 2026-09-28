// Andamento ao vivo (7.C3), a parte pura: o que de uma sessão local pode viajar para os
// outros aparelhos. Sem estado, sem IO, sem rede.
//
// ANDAMENTO É "EM QUE ETAPA, HÁ QUANTO TEMPO, COM QUEM", e só isso, MENOS o `feed` (Fase
// 3.1, 28/09/2026): o admin assiste as mesmas linhas que o aparelho dono mostra na tela
// dele, das mais recentes para trás, dentro do orçamento. É a única exceção de proposito;
// todo o resto da projeção continua sendo allowlist campo a campo, e o PR e a conta
// continuam viajando como tag, nunca em claro.
//
// O vocabulário de etapa é FECHADO e é o mesmo da esteira local (lib/engine/review.js).
// Etapa que ninguém conhece vira `desconhecida`: a tela do outro aparelho não pode receber
// um rótulo que ela não sabe traduzir. A autoanálise, que não tem etapa, aparece assim.
//
// O nó tem vida curta (`x`): quem não renova some. Nó vencido é "interrompida", e nunca
// "em andamento" por inércia.
//
// O COMMIT E A HERANÇA viajam para a tela poder AGIR (7.C7b e 7.C8): transferir e tomar
// exigem a versão material, e ela sobe como tag, nunca como SHA. A herança da memória
// (integral, parcial, reinício) é decidida pelo executor ao começar, num vocabulário
// fechado, e sai vazia enquanto ele não decidiu.
import { tag, prTag, acctTag, matTag } from './tags.js';

const ETAPAS = ['preparo', 'leitura', 'card', 'verificacao', 'raciocinio', 'fechamento'];
const DESCONHECIDA = 'desconhecida';
const TIPOS = ['review', 'self', 'pushback'];
const TTL_MS = 150 * 1000;
const MAX_SUBAGENTE = 24;
const HERANCAS = ['integral', 'parcial', 'reinicio'];
const MAX_LINHA_FEED = 140;
const ORCAMENTO_FEED = 900;

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

// o head mora na SESSÃO (runHeadlessReview grava `headSha` nela); o do PR é só reserva
function materialDe(kId, s, pr) {
  return tagOuVazio(matTag, kId, s.headSha || pr.headSha);
}

function herancaDe(s) {
  return HERANCAS.includes(s.heranca) ? s.heranca : '';
}

// O feed ao vivo que o admin assiste (28/09/2026): as mesmas linhas que o aparelho dono
// mostra na tela dele, das mais recentes para trás, até o orçamento. O nó de operações
// cabe em 2048 caracteres cifrados, e o resto da projeção já ocupa parte disso.
function feedDe(feed) {
  const linhas = (Array.isArray(feed) ? feed : []).filter((i) => objeto(i) && i.text);
  const saida = [];
  let total = 0;
  for (let i = linhas.length - 1; i >= 0; i--) {
    const l = String(linhas[i].text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINHA_FEED);
    if (!l) continue;
    // o orçamento é em BYTES (o que o cifrado paga), não em caracteres: texto com acento
    // ou emoji pesa até o dobro em UTF-8, e contar por caractere deixaria o nó estourar
    const peso = Buffer.byteLength(l, 'utf8');
    if (total + peso > ORCAMENTO_FEED) break;
    saida.unshift(l);
    total += peso;
  }
  return saida;
}

function projetar(sessao, feed, { kId, agora }) {
  const s = objeto(sessao) ? sessao : {};
  const pr = objeto(s.pr) ? s.pr : {};
  const { ms, atual } = temposDe(feed, s.startedAt, agora);
  const subagentes = [...new Set((Array.isArray(feed) ? feed : []).map((i) => rotuloDe(objeto(i) && i.a)).filter(Boolean))].sort().slice(0, 8);
  const msPorEtapa = {};
  for (const e of [...ETAPAS, DESCONHECIDA]) if (ms[e]) msPorEtapa[e] = ms[e];
  return {
    etapa: etapaVisivel(s, atual),
    msPorEtapa,
    subagentes,
    feed: feedDe(feed),
    modelo: String(s.model || '').slice(0, 40),
    prTag: tagOuVazio(prTag, kId, pr.key),
    acctTag: tagOuVazio(acctTag, kId, s.account),
    matTag: materialDe(kId, s, pr),
    heranca: herancaDe(s),
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

export default { ETAPAS, DESCONHECIDA, TIPOS, HERANCAS, TTL_MS, MAX_LINHA_FEED, ORCAMENTO_FEED, projetar, opIdDe, vencimentoDe, situacao };
export { ETAPAS, DESCONHECIDA, TIPOS, HERANCAS, TTL_MS, MAX_LINHA_FEED, ORCAMENTO_FEED, projetar, opIdDe, vencimentoDe, situacao };
