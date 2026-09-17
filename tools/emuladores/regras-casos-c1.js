// Itens 2 a 8 do roteiro (firebase/README.md, "Validação manual das regras v2 (C1)").
// O item 1 depende de o `auth_time` VENCER, então mora em regras-casos-tempo.js.
import { pedir } from './regras-contexto.js';
import { renovarSenha } from './regras-contexto.js';
import { MINUTO_MS, OK, RECUSADO, caso, medir, enc, encInvalido, raiz, zerar, semear, semearAdmin } from './regras-comum.js';

const APARELHO = 'aparelho-a';
const OUTRO_APARELHO = 'aparelho-b';
const CONTA = 'conta-de-teste';
const PR = 'pr-1';
const DIA = '2026-09-16';
const ENC_TETO_STATUS = 2048;

function leaseValido(agora) {
  return { leaseId: 'lease-1', deviceId: APARELHO, operationKind: 'review', expiresAt: agora + 2 * MINUTO_MS };
}

const RECIBO = { operationKind: 'review', materialVersion: 1, deviceId: APARELHO, completedAt: 0, outcome: 'ok', publicationState: 'publicado' };

async function itemDois(ctx) {
  const base = `${raiz(ctx)}/live/deviceStatus/${APARELHO}`;
  const dentro = { v: 1, u: Date.now(), enc: enc(ENC_TETO_STATUS) };
  const fora = { v: 1, u: Date.now(), enc: enc(ENC_TETO_STATUS + 1) };
  return [
    await medir(ctx, 2, 'envelope no teto de 2048 do nó é aceito', OK, 'PUT', base, { corpo: dentro }),
    await medir(ctx, 2, 'envelope um caractere acima do teto é recusado', RECUSADO, 'PUT', base, { corpo: fora }),
  ];
}

async function itemTres(ctx) {
  const base = `${raiz(ctx)}/live/deviceStatus/${APARELHO}`;
  const corpo = { v: 1, u: Date.now(), enc: encInvalido() };
  return [await medir(ctx, 3, 'envelope fora do formato e1.gN.<iv>.<ct>.<tag> é recusado', RECUSADO, 'PUT', base, { corpo })];
}

// root.child(...) é o que liga o batimento à geração gravada em live/control/admin:
// se a regra não avaliasse o nó de fora, os dois casos abaixo dariam o mesmo status.
async function itemQuatro(ctx) {
  await semearAdmin(ctx, APARELHO, 2);
  const base = `${raiz(ctx)}/live/control/beat`;
  const agora = Date.now();
  const certo = { dev: APARELHO, generation: 2, sequencia: 1, beatAt: agora, sig: 'sig' };
  const errado = { dev: APARELHO, generation: 1, sequencia: 1, beatAt: agora, sig: 'sig' };
  return [
    await medir(ctx, 4, 'batimento na geração que root.child(admin) informa é aceito', OK, 'PUT', base, { corpo: certo }),
    await medir(ctx, 4, 'batimento na geração anterior é recusado (a regra leu o nó de fora)', RECUSADO, 'PUT', base, { corpo: errado }),
  ];
}

async function itemCinco(ctx) {
  return [await medir(ctx, 5, 'DELETE na raiz da árvore do usuário é recusado', RECUSADO, 'DELETE', raiz(ctx))];
}

async function leaseComEtag(ctx, agora) {
  const caminho = `${raiz(ctx)}/leases/${CONTA}/${PR}`;
  const posto = await pedir(ctx, 'PUT', caminho, { token: ctx.u1.idToken, corpo: leaseValido(agora) });
  const lido = await pedir(ctx, 'GET', caminho, { token: ctx.u1.idToken, cabecalhos: { 'X-Firebase-ETag': 'true' } });
  const apagado = await pedir(ctx, 'DELETE', caminho, { token: ctx.u1.idToken, cabecalhos: { 'if-match': lido.etag } });
  return [
    caso(6, 'PUT de lease com if-match (escrita v1 literal)', OK, posto.status),
    caso(6, 'DELETE de lease com if-match (escrita v1 literal)', OK, apagado.status),
  ];
}

async function itemSeisPresenca(ctx) {
  const base = `${raiz(ctx)}/devices/${APARELHO}`;
  return [
    await medir(ctx, 6, 'PATCH de presença', OK, 'PATCH', base, { corpo: { contract: 2, keyReady: true } }),
    await medir(ctx, 6, 'PUT de presença', OK, 'PUT', base, { corpo: { contract: 2, keyReady: false } }),
    await medir(ctx, 6, 'GET de devices', OK, 'GET', `${raiz(ctx)}/devices`),
  ];
}

async function itemSeisRegistros(ctx, agora) {
  const recibo = `${raiz(ctx)}/receipts/${CONTA}/${PR}/impressao-1`;
  const rodada = `${raiz(ctx)}/dailyRounds/${CONTA}/${PR}`;
  const consumo = `${raiz(ctx)}/usageEvents/${APARELHO}`;
  return [
    await medir(ctx, 6, 'PUT de recibo', OK, 'PUT', recibo, { corpo: { ...RECIBO, completedAt: agora } }),
    await medir(ctx, 6, 'DELETE de recibo (faxina e Refazer)', OK, 'DELETE', recibo),
    await medir(ctx, 6, 'PUT de rodada do dia', OK, 'PUT', `${rodada}/${DIA}`, { corpo: { dayPolicy: 'America/Sao_Paulo' } }),
    await medir(ctx, 6, 'PATCH de poda da rodada', OK, 'PATCH', rodada, { corpo: { [DIA]: null } }),
    await medir(ctx, 6, 'PATCH de consumo', OK, 'PATCH', consumo, { corpo: { ev1: { at: agora, kind: 'review', costUsd: 0 } } }),
  ];
}

async function itemSeisFluxo(ctx) {
  const r = await pedir(ctx, 'GET', `${raiz(ctx)}/leases`, { token: ctx.u1.idToken, fluxo: true, cabecalhos: { Accept: 'text/event-stream' } });
  return [caso(6, 'stream de leases (SSE) abre', OK, r.status)];
}

async function itemSete(ctx) {
  await zerar(ctx, 'keyring');
  await renovarSenha(ctx, ctx.u1);
  const base = `${raiz(ctx)}/keyring`;
  return [
    await medir(ctx, 7, 'keyring na primeira revisão é aceito', OK, 'PUT', base, { corpo: chaveiro(1) }),
    await medir(ctx, 7, 'keyring com a MESMA revisão é recusado', RECUSADO, 'PUT', base, { corpo: chaveiro(1) }),
    await medir(ctx, 7, 'keyring com revisão + 1 é aceito', OK, 'PUT', base, { corpo: chaveiro(2) }),
  ];
}

const SLOTS_DO_CHAVEIRO = { pw: { blob: 'blob-de-teste' } };
const KIDS_DO_CHAVEIRO = { g1: 'chave-de-teste' };

/** Chaveiro mínimo que satisfaz hasChildren e as validações de forma. */
export function chaveiro(rev) {
  const agora = Date.now();
  return { v: 1, rev, updatedAt: agora, epochSince: agora, cur: 'g1', kids: KIDS_DO_CHAVEIRO, kcv: 'kcv', slots: SLOTS_DO_CHAVEIRO };
}

async function itemOito(ctx) {
  return [
    await medir(ctx, 8, 'sonda v1 (caminho sem concessão) é recusada', RECUSADO, 'PUT', `${raiz(ctx)}/rulesProbe/v1/${OUTRO_APARELHO}`, { corpo: { at: Date.now(), v: 1 } }),
    await medir(ctx, 8, 'sonda v2 é aceita', OK, 'PUT', `${raiz(ctx)}/rulesProbe/v2/${OUTRO_APARELHO}`, { corpo: { at: Date.now(), v: 2 } }),
  ];
}

export async function casos(ctx) {
  const agora = Date.now();
  const saida = [];
  saida.push(...await itemDois(ctx));
  saida.push(...await itemTres(ctx));
  saida.push(...await itemQuatro(ctx));
  saida.push(...await itemCinco(ctx));
  saida.push(...await itemSeisPresenca(ctx));
  saida.push(...await leaseComEtag(ctx, agora));
  saida.push(...await itemSeisRegistros(ctx, agora));
  saida.push(...await itemSeisFluxo(ctx));
  saida.push(...await itemSete(ctx));
  saida.push(...await itemOito(ctx));
  await semear(ctx, 'rulesProbe/v2/semente', { at: agora, v: 2 });
  return saida;
}

export default { casos, chaveiro };
