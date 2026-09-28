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
import io from '../io.js';

const ETAPAS = ['preparo', 'leitura', 'card', 'verificacao', 'raciocinio', 'fechamento'];
const DESCONHECIDA = 'desconhecida';
const TIPOS = ['review', 'self', 'pushback'];
const TTL_MS = 150 * 1000;
const MAX_SUBAGENTE = 24;
const HERANCAS = ['integral', 'parcial', 'reinicio'];
const MAX_LINHA_FEED = 140;
const ORCAMENTO_FEED = 900;
// Teto de LINHAS, separado do orçamento de conteúdo: o orçamento em bytes só limita o
// TEXTO das linhas, e uma enxurrada de linhas curtas (o feed real emite muitas por giro)
// passa pelo orçamento de conteúdo folgada e ainda assim multiplica aspas, vírgulas e
// colchetes do JSON por linha. Medido em 28/09/2026 (fix round 1): 120 linhas de ~20
// caracteres, com 8 subagentes e tags reais, estouravam o teto do envelope mesmo com o
// orçamento de conteúdo em bytes já valendo.
const MAX_LINHAS_FEED = 12;
// Teto do CLARO inteiro (`{ p: projecao }`, antes do envelope somar `s`/`v`/`r`), medido
// contra o `cifrar()` real de lib/sync/envelope.js pro nó 'live/operations' (teto de 2048
// caracteres cifrados). O claro é preenchido até múltiplo de 256 bytes
// (SYNC.ENVELOPE_BLOCO_BYTES) antes de cifrar; o maior múltiplo de 256 cujo cifrado
// (prefixo + kid + iv base64 + ct base64 + tag base64) ainda cabe em 2048 caracteres é
// 1280 bytes. Medindo com o `cifrar()` de verdade (scratch/medir5.mjs, apagado depois de
// medir), no PIOR caso de campos que não são feed — 8 subagentes no teto de 24
// caracteres, modelo no teto de 40, `msPorEtapa` com as 6 etapas em números de 7 dígitos,
// as três tags de 32 hex e o rótulo mais longo de herança/tipo — o maior
// `Buffer.byteLength(JSON.stringify({ p: projecao }))` que ainda cifra sem `teto` foi
// 1258; 1259 já falha. Ficamos com folga (kid cresce com a geração do admin, e texto com
// aspas ou barra invertida escapa maior no JSON do que no feed cru).
const PROJECAO_MAX_BYTES = 1100;

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
    if (saida.length >= MAX_LINHAS_FEED) break;
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

// Defesa final, redundante de propósito: o orçamento por linha (`feedDe`) e o teto de
// linhas (`MAX_LINHAS_FEED`) já deveriam bastar, mas o que decide se cabe no nó é o
// `cifrar()` de verdade, e ele mede a projeção INTEIRA (tags, subagentes, ms por etapa),
// não só o feed. Cada rodada tira a linha mais ANTIGA (a mais nova é a que importa pra
// quem está assistindo agora) até o claro caber no teto medido acima.
function comFeedNoTeto(projecao) {
  const p = { ...projecao, feed: [...projecao.feed] };
  while (p.feed.length && Buffer.byteLength(io.safeStringify({ p }), 'utf8') > PROJECAO_MAX_BYTES) {
    p.feed.shift();
  }
  return p;
}

function projetar(sessao, feed, { kId, agora }) {
  const s = objeto(sessao) ? sessao : {};
  const pr = objeto(s.pr) ? s.pr : {};
  const { ms, atual } = temposDe(feed, s.startedAt, agora);
  const subagentes = [...new Set((Array.isArray(feed) ? feed : []).map((i) => rotuloDe(objeto(i) && i.a)).filter(Boolean))].sort().slice(0, 8);
  const msPorEtapa = {};
  for (const e of [...ETAPAS, DESCONHECIDA]) if (ms[e]) msPorEtapa[e] = ms[e];
  const projecao = {
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
  return comFeedNoTeto(projecao);
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

export default {
  ETAPAS, DESCONHECIDA, TIPOS, HERANCAS, TTL_MS, MAX_LINHA_FEED, ORCAMENTO_FEED, MAX_LINHAS_FEED, PROJECAO_MAX_BYTES,
  projetar, opIdDe, vencimentoDe, situacao,
};
export {
  ETAPAS, DESCONHECIDA, TIPOS, HERANCAS, TTL_MS, MAX_LINHA_FEED, ORCAMENTO_FEED, MAX_LINHAS_FEED, PROJECAO_MAX_BYTES,
  projetar, opIdDe, vencimentoDe, situacao,
};
