// Itens 9 a 13 do roteiro (C2a, autoridade e políticas). A parte do item 11 que exige
// senha VENCIDA mora em regras-casos-tempo.js.
//
// O banco não verifica assinatura: o que se mede aqui é dono, forma, geração e frescor
// de login, e só isso.
import { renovarSenha } from './regras-contexto.js';
import { MINUTO_MS, OK, RECUSADO, medir, enc, encInvalido, raiz, zerar, semear, semearAdmin } from './regras-comum.js';

const APARELHO = 'aparelho-a';
const OUTRO_APARELHO = 'aparelho-b';
const ENC_TETO_POLITICA = 2048;

function admin(deviceId, generation) {
  return { deviceId, generation, publicKey: 'pk-de-teste', setAt: Date.now() };
}

function caminhoAdmin(ctx) {
  return `${raiz(ctx)}/live/control/admin`;
}

async function itemNove(ctx) {
  await renovarSenha(ctx, ctx.u1);
  await zerar(ctx, 'live/control/admin');
  const primeira = await medir(ctx, 9, 'primeira geração do admin, com o nó ausente, é aceita', OK, 'PUT', caminhoAdmin(ctx), { corpo: admin(APARELHO, 1) });
  await zerar(ctx, 'live/control/admin');
  const salto = await medir(ctx, 9, 'geração 2 com o nó ausente é recusada', RECUSADO, 'PUT', caminhoAdmin(ctx), { corpo: admin(APARELHO, 2) });
  return [primeira, salto];
}

async function itemDez(ctx) {
  await semearAdmin(ctx, APARELHO, 1);
  const sobe = await medir(ctx, 10, 'geração vigente + 1 é aceita', OK, 'PUT', caminhoAdmin(ctx), { corpo: admin(APARELHO, 2) });
  await semearAdmin(ctx, APARELHO, 1);
  const repete = await medir(ctx, 10, 'regravar a geração vigente é recusado (admin deposto não reescreve)', RECUSADO, 'PUT', caminhoAdmin(ctx), { corpo: admin(APARELHO, 1) });
  await semearAdmin(ctx, APARELHO, 1);
  const pula = await medir(ctx, 10, 'pular uma geração é recusado', RECUSADO, 'PUT', caminhoAdmin(ctx), { corpo: admin(APARELHO, 3) });
  return [sobe, repete, pula];
}

async function itemOnze(ctx) {
  await renovarSenha(ctx, ctx.u1);
  await semearAdmin(ctx, APARELHO, 1);
  return [await medir(ctx, 11, 'troca de admin com senha RECENTE é aceita', OK, 'PUT', caminhoAdmin(ctx), { corpo: admin(APARELHO, 2) })];
}

function batimento(dev, generation, beatAt) {
  return { dev, generation, sequencia: 1, beatAt, sig: 'sig-de-teste' };
}

async function itemDoze(ctx) {
  await semearAdmin(ctx, APARELHO, 2);
  const base = `${raiz(ctx)}/live/control/beat`;
  const agora = Date.now();
  return [
    await medir(ctx, 12, 'batimento do admin do momento, na geração vigente, é aceito', OK, 'PUT', base, { corpo: batimento(APARELHO, 2, agora) }),
    await medir(ctx, 12, 'batimento na geração anterior é recusado', RECUSADO, 'PUT', base, { corpo: batimento(APARELHO, 1, agora) }),
    await medir(ctx, 12, 'batimento de aparelho que não é o admin é recusado', RECUSADO, 'PUT', base, { corpo: batimento(OUTRO_APARELHO, 2, agora) }),
    await medir(ctx, 12, 'batimento com beatAt no passado, fora da janela de 60 s, é recusado', RECUSADO, 'PUT', base, { corpo: batimento(APARELHO, 2, agora - 2 * MINUTO_MS) }),
    await medir(ctx, 12, 'batimento com beatAt no futuro, fora da janela de 60 s, é recusado', RECUSADO, 'PUT', base, { corpo: batimento(APARELHO, 2, agora + 2 * MINUTO_MS) }),
  ];
}

function politica(generation, envelope) {
  return { v: 1, generation, enc: envelope, sig: 'sig-de-teste' };
}

async function itemTreze(ctx) {
  await semearAdmin(ctx, APARELHO, 2);
  const base = `${raiz(ctx)}/live/devicePolicies/${APARELHO}`;
  return [
    await medir(ctx, 13, 'política na geração vigente é aceita', OK, 'PUT', base, { corpo: politica(2, enc(64)) }),
    await medir(ctx, 13, 'política em geração diferente é recusada', RECUSADO, 'PUT', base, { corpo: politica(1, enc(64)) }),
    await medir(ctx, 13, 'política com envelope fora do formato é recusada', RECUSADO, 'PUT', base, { corpo: politica(2, encInvalido()) }),
    await medir(ctx, 13, 'política com envelope acima de 2048 é recusada', RECUSADO, 'PUT', base, { corpo: politica(2, enc(ENC_TETO_POLITICA + 1)) }),
  ];
}

export async function casos(ctx) {
  const saida = [];
  saida.push(...await itemNove(ctx));
  saida.push(...await itemDez(ctx));
  saida.push(...await itemOnze(ctx));
  saida.push(...await itemDoze(ctx));
  saida.push(...await itemTreze(ctx));
  await semear(ctx, 'live/control/admin', admin(APARELHO, 2));
  return saida;
}

export default { casos };
