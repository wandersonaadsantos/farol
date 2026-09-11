// "Refazer neste aparelho": o botão do recibo ÓRFÃO na tela. Separado de
// lib/engine/sync.js pelo teto de linhas úteis, e porque é um fluxo fechado com regra
// própria: ele APAGA a prova de que uma análise foi feita, e por isso é o caminho mais
// perigoso do recurso inteiro. Duas travas guardam esse apagamento (ver recusaDoRefazer
// e bloqueioAlemDoRecibo); nenhuma delas pode ser contornada pela tela.
import { SYNC_CODES, motivoDe, falhaSemConexao } from '../sync/errors.js';
import { accountHash, prHash, operationFingerprint } from '../sync/keys.js';
import { readReceipt, invalidateReceipt, receiptOrphanState } from '../sync/receipts.js';
import { coordinationActive } from '../sync/config.js';

const CONECTADO = 'conectado';

function falhaSem(code, motivo) { return { ok: false, code, motivo: motivo || motivoDe(code) }; }

// "Refazer neste aparelho" (recibo órfão na tela)
const CHAVE_PR = /^([^/#\s]+\/[^/#\s]+)#(\d+)$/;
const REFAZER = Object.freeze({ ignorarRecibo: true });
const MOTIVO_SEM_HEAD = 'head do PR desconhecido; refazer exige saber de qual commit é o recibo';
const MOTIVO_CHAVE = 'chave do PR fora do formato dono/repo#número';
// Só o recibo ÓRFÃO pode ser refeito. "Refazer" existe para destravar a análise que
// ficou pela metade num aparelho que sumiu, não para apagar a prova de uma análise que
// terminou: apagada, a mesma análise é paga de novo em todo aparelho que a encontrar.
const PUBLICACAO_REFAZIVEL = new Set(['pending', 'failed']);
const MOTIVO_RECIBO_AUSENTE = 'não há recibo deste commit para refazer';
const MOTIVO_RECIBO_PUBLICADO = 'a análise deste commit terminou e foi publicada; refazer apagaria a prova dela';
const MOTIVO_RECIBO_ATIVO = 'o aparelho que fez esta análise continua ativo; espere ou use Revisar de novo este commit';

// o PR que a tela está vendo (fila ou panorama) carrega a conta dona; sem ele, a chave
// basta pra montar o PR como uma URL avulsa colada no Revisar
function prDaChave(engine, key) {
  const lista = [...(engine.queue || []), ...(engine.panorama || [])];
  const visto = lista.find((p) => p && p.key === key);
  if (visto) return visto;
  const m = CHAVE_PR.exec(key);
  return m ? engine.prFromUrl(`https://github.com/${m[1]}/pull/${m[2]}`) : null;
}

async function headDoPr(engine, pr) {
  try { return String((await engine.headSha(pr)) || ''); } catch { return ''; }
}

function resultadoDoRelancamento(r) {
  if (r && r.ok) return { ok: true };
  const code = r && r.coordenacao ? SYNC_CODES.CONFLITO : SYNC_CODES.FALHA_INTERNA;
  return falhaSem(code, String((r && r.error) || ''));
}

// O recibo só é refazível quando a análise dele ficou pela metade (publicação pendente
// ou falha) E o aparelho que a fez está parado há tempo (receiptOrphanState). Qualquer
// outro caso é recusa com motivo, nunca apagamento silencioso.
function recusaDoRefazer(rt, receipt) {
  if (!receipt) return falhaSem(SYNC_CODES.NAO_ENCONTRADO, MOTIVO_RECIBO_AUSENTE);
  if (!PUBLICACAO_REFAZIVEL.has(receipt.publicationState)) return falhaSem(SYNC_CODES.CONFLITO, MOTIVO_RECIBO_PUBLICADO);
  const device = (rt.devices && rt.devices[receipt.deviceId]) || null;
  if (receiptOrphanState(receipt, device, rt.agora()) !== 'orfao') return falhaSem(SYNC_CODES.CONFLITO, MOTIVO_RECIBO_ATIVO);
  return null;
}

// O preflight do clique responde 'recibo' porque o recibo que estamos prestes a apagar
// ainda está lá: esse é o bloqueio esperado. Qualquer OUTRO (lease de outro aparelho,
// banco fora) quer dizer que o relançamento não aconteceria, e aí nada é apagado.
async function bloqueioAlemDoRecibo(engine, pr) {
  // pela FACHADA da Engine, que é a mesma boca que o clique usa: perguntar direto ao
  // coordenador deixaria o "Refazer" respondendo a um preflight diferente do real
  const r = await engine.syncPreflightManual(pr);
  if (r.ok || r.reason === 'recibo') return null;
  return falhaSem(r.reason === 'alheio' ? SYNC_CODES.CONFLITO : SYNC_CODES.INDISPONIVEL, motivoDoBloqueio(r));
}

function motivoDoBloqueio(r) {
  const d = r.detail || {};
  if (r.reason !== 'alheio') return d.motivo || motivoDe(SYNC_CODES.INDISPONIVEL);
  return `outro aparelho (${d.deviceName || 'desconhecido'}) está analisando este PR agora`;
}

// Apaga o recibo de review do head ATUAL, condicionado ao etag lido: se outro aparelho
// regravou o recibo entre a leitura e o apagar, ele deixou de ser órfão e fica, e nada
// é relançado. Depois relança pelo clique com o override de recibo, que passa pelo
// preflight de sempre: lease de outro aparelho continua barrando (D12).
async function redoReceipt(engine, key) {
  const rt = engine.sync;
  if (!coordinationActive((engine.config && engine.config.sync) || {})) return falhaSem(SYNC_CODES.DESLIGADO, 'a coordenação entre aparelhos está desligada');
  if (rt.status !== CONECTADO || !rt.client) return falhaSemConexao(rt);
  const pr = prDaChave(engine, String(key || ''));
  if (!pr) return falhaSem(SYNC_CODES.FALHA_INTERNA, MOTIVO_CHAVE);
  const head = await headDoPr(engine, pr);
  if (!head) return falhaSem(SYNC_CODES.INDISPONIVEL, MOTIVO_SEM_HEAD);
  const ids = { uid: rt.uid, accountHash: accountHash(engine.accountForPr(pr)), prHash: prHash(pr.key) };
  const fp = operationFingerprint('review', head);
  const lido = await readReceipt(rt.client, ids, fp);
  if (!lido.ok) return falhaSem(lido.code, lido.motivo);
  const recusa = recusaDoRefazer(rt, lido.receipt);
  if (recusa) return recusa;
  // Só depois de saber que o relançamento VAI acontecer. Apagar antes deixava, quando
  // um lease alheio ou o banco fora barravam o clique, o recibo destruído e nenhuma
  // análise no lugar dele.
  const barrado = await bloqueioAlemDoRecibo(engine, pr);
  if (barrado) return barrado;
  const apagado = await invalidateReceipt(rt.client, ids, fp, { ifMatch: lido.etag });
  if (!apagado.ok) return falhaSem(apagado.code, apagado.motivo);
  delete rt.recibosVistos[pr.key];
  return resultadoDoRelancamento(await engine.launchReview([pr.url], 'auto', 'clique', REFAZER));
}

export default { redoReceipt, prDaChave };
export { redoReceipt, prDaChave };
