// Retenção do banco da coordenação (D17 do contrato): uma faxina por dia, no syncTick,
// que poda os dias de dailyRounds mais velhos que ROUNDS_TTL_MS e apaga o recibo cujo
// expiresAt já passou. Separada de lib/engine/sync.js pelo teto de linhas e porque é
// manutenção: nunca decide admissão nem o estado da conexão.
//
// Lease e presença não entram: o lease vence sozinho pelo TTL (o próximo admit o toma)
// e a presença é um nó por aparelho, sobrescrito a cada tick.
//
// O tick é aguardado no fim do check(), e quem usa há meses acumula centenas de PRs com
// recibo. Por isso cada faxina visita no máximo FAXINA_MAX_PRS nós de PR, numa fatia que
// gira com o dia (fatiaDoDia): em poucos dias tudo passa, sem cursor gravado em disco.
import { SYNC, TEMPOS } from '../constants.js';
import { coordinationActive } from '../sync/config.js';
import { accountHash } from '../sync/keys.js';
import { pruneRounds } from '../sync/rounds.js';
import { receiptsPath, readReceipt, invalidateReceipt } from '../sync/receipts.js';

const CONECTADO = 'conectado';
const SHALLOW = { shallow: true };

function ehObjeto(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// Lista pequena vai inteira. Na grande, o dia escolhe onde a janela começa e ela dá a
// volta no fim: dias seguidos cobrem fatias vizinhas, e ceil(n / max) dias cobrem todas.
function fatiaDoDia(lista, diaN, max) {
  if (lista.length <= max) return lista.slice();
  const inicio = (diaN * max) % lista.length;
  return Array.from({ length: max }, (_, i) => lista[(inicio + i) % lista.length]);
}

// Conta repetida (ou com caixa diferente) vira o mesmo hash: faxinar duas vezes o mesmo
// nó só gastaria requisição.
function contasDe(engine) {
  const lista = typeof engine.accountList === 'function' ? engine.accountList() : [];
  const hashes = lista.map((a) => String((a && a.user) || '').trim()).filter(Boolean).map(accountHash);
  return [...new Set(hashes)];
}

function podeFaxinar(engine, agora) {
  const rt = engine.sync;
  if (!rt || !coordinationActive((engine.config && engine.config.sync) || {})) return false;
  if (rt.status !== CONECTADO || !rt.client || !rt.uid) return false;
  return agora - (Number(rt.lastFaxinaAt) || 0) >= SYNC.FAXINA_MS;
}

async function chavesDe(client, path) {
  const r = await client.get(path, SHALLOW);
  if (!r.ok) return { erro: r };
  return { chaves: Object.keys(ehObjeto(r.data) ? r.data : {}).sort() };
}

// Os nós de PR a visitar, nas duas árvores e em todas as contas. Listagem que falha
// cancela a faxina inteira: sem saber o que existe, qualquer fatia seria arbitrária.
async function tarefas(client, uid, contas) {
  const lista = [];
  for (const acct of contas) {
    const rodadas = await chavesDe(client, `/users/${uid}/dailyRounds/${acct}`);
    if (rodadas.erro) return rodadas;
    const recibos = await chavesDe(client, `/users/${uid}/receipts/${acct}`);
    if (recibos.erro) return recibos;
    for (const ph of rodadas.chaves) lista.push({ tipo: 'rodadas', acct, ph });
    for (const ph of recibos.chaves) lista.push({ tipo: 'recibos', acct, ph });
  }
  return { lista };
}

// Sem expiresAt numérico o recibo fica: falta de dado nunca apaga a prova de que uma
// análise já foi feita, porque apagá-la faria outro aparelho pagar a mesma análise.
function vencido(recibo, nowMs) {
  return ehObjeto(recibo) && typeof recibo.expiresAt === 'number' && recibo.expiresAt <= nowMs;
}

// Relê com etag antes de apagar: o recibo pode ter sido regravado ("refazer neste
// aparelho") entre a listagem e aqui, e só o nó que o etag prova vencido sai.
async function apagarSeVencido(client, ids, fp, nowMs) {
  const r = await readReceipt(client, ids, fp);
  if (!r.ok || !vencido(r.receipt, nowMs)) return 0;
  const d = await invalidateReceipt(client, ids, fp, { ifMatch: r.etag });
  return d.ok ? 1 : 0;
}

async function faxinarRecibos(client, ids, nowMs) {
  const lido = await client.get(receiptsPath(ids.uid, ids.accountHash, ids.prHash));
  if (!lido.ok) return 0;
  const alvos = Object.entries(ehObjeto(lido.data) ? lido.data : {}).filter(([, rec]) => vencido(rec, nowMs));
  let removidos = 0;
  for (const [fp] of alvos) removidos += await apagarSeVencido(client, ids, fp, nowMs);
  return removidos;
}

async function executar(client, uid, t, nowMs, saldo) {
  if (t.tipo === 'rodadas') {
    const r = await pruneRounds(client, uid, t.acct, t.ph, { nowMs });
    saldo.rodadas += r.removidos || 0;
    return;
  }
  saldo.recibos += await faxinarRecibos(client, { uid, accountHash: t.acct, prHash: t.ph }, nowMs);
}

// A tentativa conta para a janela do dia mesmo quando falha: retenção não é urgente
// (recibo vence em 180 dias, rodada em 8) e tentar de novo a cada tick só gastaria rede
// contra um banco que acabou de recusar. Falha de nó isolado não para a faxina; o nó
// fica para o próximo dia.
async function faxinar(engine) {
  const rt = engine.sync;
  const agora = rt && typeof rt.agora === 'function' ? rt.agora() : Date.now();
  if (!podeFaxinar(engine, agora)) return { ok: true, feita: false };
  rt.lastFaxinaAt = agora;
  const { client, uid } = rt;
  const t = await tarefas(client, uid, contasDe(engine));
  if (t.erro) return { ok: false, feita: true, code: t.erro.code, motivo: t.erro.motivo };
  const fatia = fatiaDoDia(t.lista, Math.floor(agora / TEMPOS.DIA_MS), SYNC.FAXINA_MAX_PRS);
  const saldo = { ok: true, feita: true, prs: fatia.length, rodadas: 0, recibos: 0 };
  for (const tarefa of fatia) {
    // a conexão foi trocada (logout, outra conta) no meio: o resto fica para amanhã
    if (rt.client !== client) break;
    await executar(client, uid, tarefa, agora, saldo);
  }
  return saldo;
}

export default { fatiaDoDia, faxinar };
export { fatiaDoDia, faxinar };
