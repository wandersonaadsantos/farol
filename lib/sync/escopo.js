// Panorama e Meus PRs (7.C3), a parte pura: uma linha por PR, por conta monitorada.
// Sem estado, sem IO, sem rede.
//
// UM PUBLICADOR POR CONTA. Dois aparelhos que monitoram a mesma conta veriam os mesmos PRs
// e escreveriam as mesmas linhas duas vezes; o meta (`dev` + vencimento de 15 min) diz de
// quem é a vez, e um publicador que some perde a vez sozinho.
//
// A linha só sobe quando o `ctag` muda. O `ctag` é tag do texto claro (HMAC com a chave do
// conjunto), e fica em claro: é ele que permite saber se mudou sem decifrar, e ele não
// revela nada porque sem a chave não se calcula.
//
// Meus PRs leva o estado de merge para MOSTRAR. O botão Merge nunca é habilitado por dado
// remoto, e a leitura marca isso na linha.
import { tag } from './tags.js';
import { resumoDoClaro } from './catalogo.js';
import { SYNC } from '../constants.js';

const META_MS = SYNC.ESCOPO_META_MS;
const TOMBSTONE_MS = SYNC.ESCOPO_TOMBSTONE_MS;
const MAX_TITULO = 200;

const BASE = ['key', 'url', 'title', 'author', 'repo', 'number', 'isDraft', 'updatedAt'];
const EXTRA_MEUS = ['mergeable', 'headRefName', 'baseRefName'];
const SELOS = ['mine', 'reviewedByMe', 'reRequested'];
const TIPOS = { panorama: { extra: [], selos: true }, myPrs: { extra: EXTRA_MEUS, selos: false } };

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function valorDe(campo, v) {
  if (campo === 'number') return Number(v) || 0;
  if (campo === 'isDraft') return v === true;
  const t = typeof v === 'string' ? v : '';
  const teto = campo === 'title' ? MAX_TITULO : 300;
  return t.slice(0, teto);
}

function selosDe(pr) {
  const s = {};
  for (const k of SELOS) s[k] = pr[k] === true;
  return s;
}

function linhaDe(tipo, pr) {
  const def = TIPOS[tipo];
  if (!def || !objeto(pr)) return null;
  const linha = {};
  for (const campo of [...BASE, ...def.extra]) linha[campo] = valorDe(campo, pr[campo]);
  if (def.selos) linha.selos = selosDe(pr);
  return linha;
}

function ctagDe(kId, linha) {
  return tag(kId, 'event', `ctag|${resumoDoClaro(linha)}`);
}

function suDe(scope, u) {
  return `${scope}|${String(Math.max(0, Math.floor(Number(u) || 0))).padStart(13, '0')}`;
}

function idDe(scope, prTag) {
  return `${scope}_${prTag}`;
}

function metaDe({ dev, agora }) {
  return { dev: String(dev || ''), x: Number(agora) + META_MS };
}

function possoPublicar(meta, dev, agora) {
  if (!objeto(meta) || Number(meta.x) <= Number(agora)) return true;
  return meta.dev === dev;
}

function tombstoneApagavel(no, agora) {
  return objeto(no) && no.del === true && Number(no.u) + TOMBSTONE_MS < Number(agora);
}

export default { META_MS, TOMBSTONE_MS, TIPOS, linhaDe, ctagDe, suDe, idDe, metaDe, possoPublicar, tombstoneApagavel };
export { META_MS, TOMBSTONE_MS, TIPOS, linhaDe, ctagDe, suDe, idDe, metaDe, possoPublicar, tombstoneApagavel };
