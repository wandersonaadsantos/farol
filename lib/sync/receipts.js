// Recibo de coordenação: a prova, no banco compartilhado, de que uma análise de um
// head (ou de um marcador de pushback) já terminou em algum aparelho. Folha de IO
// simples: recebe o cliente do banco pronto e não conhece o engine.
//
// A escrita é sempre condicionada ao ETag (`if-match`): recibo escrito às cegas
// apagaria o de um aparelho que terminou a mesma análise um instante antes, e o
// recibo é justamente o que impede a segunda análise paga.
//
// Nada aqui lança: todo desfecho volta como { ok, ... } para quem chama decidir.
import { SYNC } from '../constants.js';
import { SYNC_CODES, motivoDe } from './errors.js';

// só estes desfechos dizem "já foi analisado"; qualquer outro valor não bloqueia
const OUTCOMES_QUE_BLOQUEIAM = new Set(['completed', 'external_review']);
// só recibo cuja publicação não aconteceu pode ficar órfão: publicado ou sem
// publicação (autoanálise, pushback) já é desfecho final, não há o que refazer
const PUBLICACAO_PENDENTE = new Set(['pending', 'failed']);
const COM_ETAG = { etag: true };

function receiptsPath(uid, accountHash, prHash) {
  return `/users/${uid}/receipts/${accountHash}/${prHash}`;
}

function receiptPath(uid, accountHash, prHash, fingerprint) {
  return `${receiptsPath(uid, accountHash, prHash)}/${fingerprint}`;
}

function caminhoDe(ids, fingerprint) {
  return receiptPath(ids.uid, ids.accountHash, ids.prHash, fingerprint);
}

function ehObjeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function ehNumero(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function buildReceipt({ operationKind, materialVersion, deviceId, leaseId, nowMs, outcome, publicationState, reviewId, farolVersion }) {
  return {
    operationKind, materialVersion, deviceId, leaseId: leaseId || '',
    completedAt: nowMs, lastVerifiedAt: nowMs, expiresAt: nowMs + SYNC.RECEIPT_TTL_MS,
    outcome, publicationState, reviewId: reviewId || '', farolVersion,
  };
}

function receiptBlocks(receipt, nowMs) {
  if (!ehObjeto(receipt) || !OUTCOMES_QUE_BLOQUEIAM.has(receipt.outcome)) return false;
  return ehNumero(receipt.expiresAt) && receipt.expiresAt > nowMs;
}

// Órfão exige as DUAS idades: aparelho parado há uma semana E recibo com uma semana.
// Recibo recente de aparelho antigo é o aparelho que acabou de voltar e ainda não
// carimbou presença, e chamá-lo de órfão ofereceria refazer o que está em curso.
// Falta de dado (aparelho sumido do banco, relógio no futuro) é 'desconhecido', nunca
// órfão: a tela não pode convidar a refazer com base em ausência de informação.
function receiptOrphanState(receipt, device, nowMs) {
  const r = ehObjeto(receipt) ? receipt : {};
  if (!PUBLICACAO_PENDENTE.has(r.publicationState)) return 'ativo';
  if (!ehObjeto(device) || !ehNumero(device.lastSeenAt) || device.lastSeenAt > nowMs) return 'desconhecido';
  if (!ehNumero(r.completedAt)) return 'desconhecido';
  const parado = nowMs - device.lastSeenAt >= SYNC.ORPHAN_AFTER_MS;
  const antigo = nowMs - r.completedAt >= SYNC.ORPHAN_AFTER_MS;
  return parado && antigo ? 'orfao' : 'ativo';
}

function falha(r) {
  const code = (r && r.code) || SYNC_CODES.INDISPONIVEL;
  return { ok: false, code, motivo: (r && r.motivo) || motivoDe(code) };
}

async function readReceipt(client, ids, fingerprint) {
  const lido = await client.get(caminhoDe(ids, fingerprint), COM_ETAG);
  if (!lido.ok) return falha(lido);
  return { ok: true, receipt: ehObjeto(lido.data) ? lido.data : null, etag: lido.etag };
}

// Sem ifMatch vale 'null_etag' (só grava em nó vazio), nunca escrita incondicional.
async function writeReceipt(client, ids, fingerprint, receipt, { ifMatch } = {}) {
  const w = await client.put(caminhoDe(ids, fingerprint), receipt, { ifMatch: ifMatch || 'null_etag' });
  if (w.ok) return { ok: true };
  if (w.code === SYNC_CODES.CONFLITO) return { ok: false, code: SYNC_CODES.CONFLITO, atual: w.data };
  return falha(w);
}

// Invalidar sem o etag lido apagaria o recibo que outro aparelho regravou entre a
// leitura e o clique; por isso o etag é obrigatório e a falta dele nem toca a rede.
async function invalidateReceipt(client, ids, fingerprint, { ifMatch } = {}) {
  if (!ifMatch) return { ok: false, code: SYNC_CODES.FALHA_INTERNA, motivo: 'invalidar recibo exige o etag lido antes' };
  const d = await client.del(caminhoDe(ids, fingerprint), { ifMatch });
  if (d.ok) return { ok: true };
  return falha(d);
}

export default { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt };
export { receiptPath, receiptsPath, buildReceipt, receiptBlocks, receiptOrphanState, readReceipt, writeReceipt, invalidateReceipt };
