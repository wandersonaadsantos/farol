// Parte 1 do roteiro (firebase/README.md, "Validação manual com o emulador (Fase 5)"):
// o dono da árvore, os tetos do lease e os dois furos DECLARADOS entre aparelhos da
// mesma pessoa. Os furos entram como caso medido de propósito: limite que ninguém
// mede volta a ser surpresa na primeira vez que o comportamento mudar.
import { MINUTO_MS, OK, RECUSADO, medir, raiz, zerar, semear } from './regras-comum.js';

const APARELHO = 'aparelho-a';
const OUTRO_APARELHO = 'aparelho-b';
const CONTA = 'conta-parte1';
const PR = 'pr-parte1';
const TETO_LEASE_MS = 5 * MINUTO_MS;

function caminhoLease(ctx) {
  return `${raiz(ctx)}/leases/${CONTA}/${PR}`;
}

function lease(agora, extra) {
  return { leaseId: 'lease-1', deviceId: APARELHO, operationKind: 'review', expiresAt: agora + 2 * MINUTO_MS, ...extra };
}

async function dono(ctx) {
  const meu = `${raiz(ctx)}/devices/parte1`;
  const alheio = `users/${ctx.u2.uid}/devices/parte1`;
  return [
    await medir(ctx, 'P1', 'escrita na própria árvore é aceita', OK, 'PUT', meu, { corpo: { name: 'teste' } }),
    await medir(ctx, 'P1', 'escrita na árvore de outro uid é recusada', RECUSADO, 'PUT', alheio, { corpo: { name: 'teste' } }),
  ];
}

async function tetos(ctx, agora) {
  await zerar(ctx, `leases/${CONTA}`);
  const longo = lease(agora, { expiresAt: agora + TETO_LEASE_MS + MINUTO_MS });
  const rodada = `${raiz(ctx)}/dailyRounds/${CONTA}/${PR}/2026-09-16`;
  return [
    await medir(ctx, 'P1', 'lease com expiresAt acima de agora + 5 min é recusado', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: longo }),
    await medir(ctx, 'P1', 'rodada com dayPolicy fora de America/Sao_Paulo é recusada', RECUSADO, 'PUT', rodada, { corpo: { dayPolicy: 'UTC' } }),
  ];
}

async function leaseVivo(ctx, agora) {
  await semear(ctx, `leases/${CONTA}/${PR}`, lease(agora));
  const outroDono = lease(agora, { leaseId: 'lease-2', deviceId: OUTRO_APARELHO });
  const mesmoIdOutroAparelho = lease(agora, { deviceId: OUTRO_APARELHO });
  return [
    await medir(ctx, 'P1', 'lease VIVO de outro dono é recusado (um Farol por PR, no servidor)', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: outroDono }),
    await medir(ctx, 'P1', 'renovação com o mesmo leaseId e outro deviceId é recusada', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: mesmoIdOutroAparelho }),
  ];
}

async function leaseVencido(ctx, agora) {
  await semear(ctx, `leases/${CONTA}/${PR}`, lease(agora, { expiresAt: agora - MINUTO_MS }));
  const novo = lease(agora, { leaseId: 'lease-3', deviceId: OUTRO_APARELHO });
  return [await medir(ctx, 'P1', 'o MESMO PUT passa depois que o lease vence', OK, 'PUT', caminhoLease(ctx), { corpo: novo })];
}

// Os dois furos que o README declara, e a defesa que ele nomeia. Medi-los é a única
// forma de saber que a descrição continua verdadeira.
//
// A escrita direta no campo NÃO roda a `.validate` do nó pai, e é por isso que a
// validação está REPLICADA em `expiresAt`: é essa cópia que barra o lease esticado
// além do teto de 5 min. Renovar dentro do teto, com o MESMO leaseId e deviceId, é
// justamente o que a regra deixa passar, e o caso abaixo prova os dois lados.
async function furosDeclarados(ctx, agora) {
  await semear(ctx, `leases/${CONTA}/${PR}`, lease(agora));
  const campo = `${caminhoLease(ctx)}/expiresAt`;
  const esticado = await medir(ctx, 'P1', 'escrita direta em leases/.../expiresAt além do teto é barrada pela validação REPLICADA', RECUSADO, 'PUT', campo, { corpo: agora + TETO_LEASE_MS + MINUTO_MS });
  const renovado = await medir(ctx, 'P1', 'escrita direta em expiresAt dentro do teto, com o mesmo lease, é renovação e passa', OK, 'PUT', campo, { corpo: agora + 3 * MINUTO_MS });
  const remocao = await medir(ctx, 'P1', 'LIMITE: .validate não roda em DELETE, então o lease VIVO some sem if-match', OK, 'DELETE', caminhoLease(ctx));
  return [esticado, renovado, remocao];
}

// 7.C8, a TOMADA de lease: o sucessor carrega `takeoverSeq`, `tomadoDe` e outro aparelho,
// e é a única forma de um lease VIVO trocar de dono. Medido na bancada com engines reais
// (17/09/2026): a regra do nó permitia, a do CAMPO `deviceId` não, e a tomada era
// impossível. Escrita direta no campo não roda a validação do pai; por isso ela é
// replicada, e a réplica precisa carregar o mesmo ramo.
function sucessor(agora, extra) {
  return {
    leaseId: 'lease-tomado', deviceId: OUTRO_APARELHO, operationKind: 'review',
    expiresAt: agora + 2 * MINUTO_MS, acquiredAt: agora, heartbeatAt: agora,
    takeoverSeq: 2, tomadoDe: APARELHO, tomadoEm: agora, ...extra,
  };
}

async function tomadaDeLease(ctx, agora) {
  await semear(ctx, `leases/${CONTA}/${PR}`, lease(agora));
  const semSequencia = sucessor(agora, { takeoverSeq: null });
  const sequenciaErrada = sucessor(agora, { takeoverSeq: 5 });
  const semOrigem = sucessor(agora, { tomadoDe: null });
  const origemErrada = sucessor(agora, { tomadoDe: 'aparelho-c' });
  const eu = sucessor(agora, { deviceId: APARELHO });
  return [
    await medir(ctx, 'P1', 'tomada sem takeoverSeq é recusada', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: semSequencia }),
    await medir(ctx, 'P1', 'tomada com takeoverSeq fora da sequência é recusada', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: sequenciaErrada }),
    await medir(ctx, 'P1', 'tomada sem dizer de quem tomou é recusada', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: semOrigem }),
    await medir(ctx, 'P1', 'tomada apontando outro dono que não o atual é recusada', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: origemErrada }),
    await medir(ctx, 'P1', 'tomada de si mesmo é recusada', RECUSADO, 'PUT', caminhoLease(ctx), { corpo: eu }),
    await medir(ctx, 'P1', 'TOMADA de lease vivo por outro aparelho, com a sequência e a origem certas, é aceita', OK, 'PUT', caminhoLease(ctx), { corpo: sucessor(agora) }),
    await medir(ctx, 'P1', 'a tomada seguinte anda a sequência', OK, 'PUT', caminhoLease(ctx), { corpo: sucessor(agora, { deviceId: 'aparelho-c', tomadoDe: OUTRO_APARELHO, takeoverSeq: 3 }) }),
  ];
}

export async function casos(ctx) {
  const agora = Date.now();
  const saida = [];
  saida.push(...await dono(ctx));
  saida.push(...await tetos(ctx, agora));
  saida.push(...await leaseVivo(ctx, agora));
  saida.push(...await leaseVencido(ctx, agora));
  saida.push(...await tomadaDeLease(ctx, agora));
  saida.push(...await furosDeclarados(ctx, agora));
  return saida;
}

export default { casos };
