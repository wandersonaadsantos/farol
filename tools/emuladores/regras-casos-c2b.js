// Itens 15 a 21 do roteiro (C2b, limpeza, revogação e grupo). O item 14 e a metade do
// item 17 que exige senha VENCIDA moram em regras-casos-tempo.js.
import { renovarSenha } from './regras-contexto.js';
import { MINUTO_MS, OK, RECUSADO, medir, enc, encInvalido, raiz, zerar, semear, semearAdmin, semearLimpeza, semOperacoes } from './regras-comum.js';

const APARELHO = 'aparelho-a';
const GERACAO = 2;
const TETO_TRAVA_MS = 10 * MINUTO_MS;
const ENC_TETO_GRUPO = 2048;
const REV_BASE = 5;

function chave(rev, ligada = true) {
  return { enabled: ligada, generation: GERACAO, rev, sig: 'sig-de-teste' };
}

function controle(ctx, no) {
  return `${raiz(ctx)}/live/control/${no}`;
}

async function itemQuinze(ctx) {
  await semearAdmin(ctx, APARELHO, GERACAO);
  await semearLimpeza(ctx, true, GERACAO, REV_BASE);
  const base = controle(ctx, 'cleanup');
  return [
    await medir(ctx, 15, 'chave de limpeza com a MESMA revisão é recusada', RECUSADO, 'PUT', base, { corpo: chave(REV_BASE) }),
    await medir(ctx, 15, 'chave de limpeza com revisão MENOR é recusada', RECUSADO, 'PUT', base, { corpo: chave(REV_BASE - 1) }),
    await medir(ctx, 15, 'chave de limpeza com revisão + 1 é aceita', OK, 'PUT', base, { corpo: chave(REV_BASE + 1) }),
  ];
}

async function itemDezesseis(ctx) {
  const base = controle(ctx, 'cleanupLock');
  const agora = Date.now();
  await renovarSenha(ctx, ctx.u1);
  await semearLimpeza(ctx, false, GERACAO, REV_BASE);
  const desligada = await medir(ctx, 16, 'trava de limpeza com a chave DESLIGADA é recusada', RECUSADO, 'PUT', base, { corpo: { dev: APARELHO, x: agora + MINUTO_MS } });
  await semearLimpeza(ctx, true, GERACAO, REV_BASE);
  const ligada = await medir(ctx, 16, 'trava de limpeza com a chave ligada e senha recente é aceita', OK, 'PUT', base, { corpo: { dev: APARELHO, x: agora + MINUTO_MS } });
  const longa = await medir(ctx, 16, 'trava com x acima de agora + 10 min é recusada', RECUSADO, 'PUT', base, { corpo: { dev: APARELHO, x: agora + TETO_TRAVA_MS + MINUTO_MS } });
  await semearLimpeza(ctx, false, GERACAO, REV_BASE);
  const apagada = await medir(ctx, 16, 'apagar a trava é aceito SEMPRE, inclusive com a chave desligada', OK, 'DELETE', base);
  return [desligada, ligada, longa, apagada];
}

async function itemDezessete(ctx) {
  await renovarSenha(ctx, ctx.u1);
  const corpo = { at: Date.now(), dev: APARELHO, categorias: 'grupos' };
  return [await medir(ctx, 17, 'último registro de limpeza com senha recente é aceito', OK, 'PUT', controle(ctx, 'lastCleanup'), { corpo })];
}

async function itemDezoito(ctx) {
  await zerar(ctx, 'live/control/revokedBefore');
  await renovarSenha(ctx, ctx.u1);
  const base = controle(ctx, 'revokedBefore');
  const marca = ctx.u1.authTime;
  return [
    await medir(ctx, 18, 'revogar a partir do próprio auth_time é recusado (quem revoga não se corta fora)', RECUSADO, 'PUT', base, { corpo: marca }),
    await medir(ctx, 18, 'revogar um instante anterior ao auth_time é aceito', OK, 'PUT', base, { corpo: marca - 10 }),
    await medir(ctx, 18, 'recuar a marca de revogação é recusado', RECUSADO, 'PUT', base, { corpo: marca - 20 }),
  ];
}

const GRUPO_SEMENTE = { v: 1, generation: GERACAO, enc: 'e1.g1.aaaa.bbbb.cccc', sig: 'sig-de-teste' };

async function prepararLimpeza(ctx, ligada) {
  await semearAdmin(ctx, APARELHO, GERACAO);
  await semearLimpeza(ctx, ligada, GERACAO, REV_BASE);
  await semOperacoes(ctx);
  await semear(ctx, 'live/groups/g1', GRUPO_SEMENTE);
  await semear(ctx, 'live/devicePolicies/p1', GRUPO_SEMENTE);
  await renovarSenha(ctx, ctx.u1);
}

async function itemDezenove(ctx) {
  await prepararLimpeza(ctx, true);
  const grupos = await medir(ctx, 19, 'remoção de live/groups com a chave ligada é aceita', OK, 'DELETE', `${raiz(ctx)}/live/groups`);
  const politicas = await medir(ctx, 19, 'remoção de live/devicePolicies com a chave ligada é aceita', OK, 'DELETE', `${raiz(ctx)}/live/devicePolicies`);
  await prepararLimpeza(ctx, false);
  const desligada = await medir(ctx, 19, 'remoção com a chave DESLIGADA é recusada', RECUSADO, 'DELETE', `${raiz(ctx)}/live/groups`);
  await prepararLimpeza(ctx, true);
  await semear(ctx, 'live/operations/aa', { v: 1, dev: APARELHO, t0: Date.now(), x: Date.now() + MINUTO_MS, enc: enc(40) });
  const comOperacao = await medir(ctx, 19, 'remoção com operação VIVA é recusada', RECUSADO, 'DELETE', `${raiz(ctx)}/live/groups`);
  await semOperacoes(ctx);
  return [grupos, politicas, desligada, comOperacao];
}

const FORA_DO_ALCANCE = [
  ['keyring', 'keyring'],
  ['live/control/cleanup', 'a própria chave de limpeza'],
  ['live/control/admin', 'a autoridade do momento'],
];

// A lista do item 20 separa o que a chave de limpeza REALMENTE não alcança do que é
// concessão de dono herdada do v1. Ver a nota do item 20 em firebase/README.md.
const CONCESSAO_DE_DONO = [
  ['leases', 'leases'],
  ['receipts', 'receipts'],
  ['dailyRounds', 'dailyRounds'],
];

async function itemVinte(ctx) {
  await prepararLimpeza(ctx, true);
  const saida = [];
  for (const [caminho, nome] of FORA_DO_ALCANCE) {
    saida.push(await medir(ctx, 20, `remoção de ${nome} é recusada mesmo com a chave ligada`, RECUSADO, 'DELETE', `${raiz(ctx)}/${caminho}`));
  }
  for (const [caminho, nome] of CONCESSAO_DE_DONO) {
    saida.push(await medir(ctx, 20, `LIMITE: ${nome} tem concessão de dono do v1, então a remoção passa sem a chave`, OK, 'DELETE', `${raiz(ctx)}/${caminho}`));
  }
  return saida;
}

function grupo(generation, envelope) {
  return { v: 1, generation, enc: envelope, sig: 'sig-de-teste' };
}

async function itemVinteEUm(ctx) {
  await semearAdmin(ctx, APARELHO, GERACAO);
  const base = `${raiz(ctx)}/live/groups/g2`;
  return [
    await medir(ctx, 21, 'grupo na geração vigente é aceito', OK, 'PUT', base, { corpo: grupo(GERACAO, enc(64)) }),
    await medir(ctx, 21, 'grupo em geração diferente é recusado', RECUSADO, 'PUT', base, { corpo: grupo(GERACAO - 1, enc(64)) }),
    await medir(ctx, 21, 'grupo com envelope acima de 2048 é recusado', RECUSADO, 'PUT', base, { corpo: grupo(GERACAO, enc(ENC_TETO_GRUPO + 1)) }),
    await medir(ctx, 21, 'grupo com envelope fora do formato é recusado', RECUSADO, 'PUT', base, { corpo: grupo(GERACAO, encInvalido()) }),
  ];
}

export async function casos(ctx) {
  const saida = [];
  saida.push(...await itemQuinze(ctx));
  saida.push(...await itemDezesseis(ctx));
  saida.push(...await itemDezessete(ctx));
  saida.push(...await itemDezoito(ctx));
  saida.push(...await itemDezenove(ctx));
  saida.push(...await itemVinte(ctx));
  saida.push(...await itemVinteEUm(ctx));
  return saida;
}

export default { casos };
