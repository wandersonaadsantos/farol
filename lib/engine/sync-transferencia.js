// Transferência voluntária de uma revisão em andamento (7.C7b): o aparelho que está
// rodando entrega o trabalho a outro aparelho apto.
//
// A ORDEM IMPORTA, e é esta: conferir o destino, mandar a MEMÓRIA (checkpoint da C7a),
// encerrar a sessão daqui e só então publicar o item com preferência pelo destino. Publicar
// antes de encerrar deixaria duas sessões possíveis sobre o mesmo head; encerrar antes de
// mandar a memória jogaria fora tudo o que já tinha sido verificado.
//
// O QUE NÃO ACONTECE AQUI: nenhuma sessão é migrada, nenhum `sid` viaja e nenhum PR fica
// reservado para sempre. A preferência tem prazo, e vencido ele a colocação volta a ser a
// de sempre.
import { SYNC } from '../constants.js';
import { sharedActive } from '../sync/config.js';
import { SYNC_CODES, motivoDe } from '../sync/errors.js';
import transferencia from '../sync/transferencia.js';
import capacidade from '../sync/capacidade.js';
import kek from '../sync/kek.js';
import { prTag, acctTag, matTag } from '../sync/tags.js';
import checkpointSync from './sync-checkpoint.js';
import distribuicao from './sync-distribuicao.js';
import publicar from './sync-publicar.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function recusa(code, motivo) {
  return { ok: false, code, motivo: motivo || motivoDe(code) };
}

function sessaoDoPr(engine, kId, tagDoPr) {
  const vivas = engine.activeReviews instanceof Map ? engine.activeReviews : new Map();
  for (const [id, sessao] of vivas) {
    const chaves = (sessao && sessao.keys) || [];
    if (chaves.some((k) => prTag(kId, k) === tagDoPr)) return { id, sessao };
  }
  return null;
}

async function resumoDoDestino(rt, destino) {
  const lido = await publicar.lerNo(rt.client, `/users/${rt.uid}/live/deviceStatus/${destino}`);
  if (!lido || !objeto(lido.valor)) return null;
  const aberta = capacidade.abrirCapacidade({ uid: rt.uid, material: rt.material, dev: destino, no: lido.valor });
  if (!aberta) return null;
  const c = aberta.c;
  const adm = objeto(c.admissao) ? c.admissao : { porEstado: {} };
  return {
    frescoAte: aberta.u + SYNC.FROTA_JANELA_MS,
    pausado: c.pausado === true,
    iaPronta: c.iaPronta !== false,
    token: c.token === true,
    contas: Array.isArray(c.contas) ? c.contas : [],
    teto: Math.max(1, Number(c.paralelismo) || 1),
    ocupadas: Number(adm.porEstado && adm.porEstado.reserva) + Number(adm.porEstado && adm.porEstado.execucao) || 0,
  };
}

// Devolve o desfecho para virar recibo do comando (C6): quem pediu só sabe que deu certo
// quando este aparelho responde.
async function transferir(engine, cfg, { prTag: tagDoPr, matTag: material, destino, agora = Date.now() } = {}) {
  const rt = engine.sync;
  if (!sharedActive(cfg)) return recusa('compartilhamento-desligado', 'o compartilhamento cifrado está desligado');
  if (!rt || !rt.client || !rt.uid || !rt.material) return recusa(SYNC_CODES.SEM_CREDENCIAL, 'este aparelho não está conectado');
  const alvo = String(destino || '').trim();
  if (!alvo || alvo === rt.deviceId) return recusa('forma', 'transferir exige outro aparelho de destino');
  const kId = kek.bufferDe(rt.material.id);
  const viva = sessaoDoPr(engine, kId, tagDoPr);
  if (!viva) return recusa('nada_rodando', 'nenhuma sessão deste PR está rodando aqui');
  const pr = viva.sessao.pr || {};
  if (!pr.headSha || matTag(kId, pr.headSha) !== material) return recusa('head_mudou', 'o head mudou desde o pedido');
  const conta = typeof engine.accountForPr === 'function' ? engine.accountForPr(pr) : '';
  const apto = transferencia.destinoApto(await resumoDoDestino(rt, alvo), { acctTag: conta ? acctTag(kId, conta) : '', agora });
  if (!apto.apto) return recusa('destino_inapto', `o destino não está apto (${apto.motivo})`);

  // 1. a memória vai primeiro: encerrar antes disso perderia o que já foi verificado
  await checkpointSync.publicarCheckpoint(engine, cfg, { prKey: pr.key, loja: viva.sessao.checkpoint || 'review', agora });
  // 2. a sessão daqui termina, e o lease sai junto com ela
  engine.cancelSession(viva.id);
  // 3. o item volta para a fila do conjunto, preferindo o destino enquanto a preferência vale
  const publicado = await distribuicao.publicarCandidato(engine, cfg, pr, {
    agora, preferencia: { dev: alvo, ate: agora + SYNC.PREFERENCIA_TTL_MS },
  });
  if (!publicado.ok) return recusa(publicado.code || SYNC_CODES.INDISPONIVEL, 'a sessão foi encerrada, mas o item não subiu para o conjunto');
  return { ok: true, itemId: publicado.itemId, destino: alvo };
}

export default { transferir, resumoDoDestino };
export { transferir, resumoDoDestino };
