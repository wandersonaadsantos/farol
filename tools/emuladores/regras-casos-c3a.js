// Itens 22 a 25 do roteiro (C3a, presença v2, capacidade e catálogo).
import { renovarSenha } from './regras-contexto.js';
import { OK, RECUSADO, medir, enc, hex, raiz, semear, semearAdmin, semearLimpeza, semOperacoes } from './regras-comum.js';

const APARELHO = 'aparelho-a';
const GERACAO = 2;
const REV_BASE = 5;
const PR_TAG = hex(32, 'a');
const TETO_ENVELOPE = 2048;

async function itemVinteEDois(ctx) {
  const base = `${raiz(ctx)}/devices/${APARELHO}`;
  return [
    await medir(ctx, 22, 'contract em texto é recusado', RECUSADO, 'PUT', base, { corpo: { contract: 'dois', keyReady: true } }),
    await medir(ctx, 22, 'keyReady em número é recusado', RECUSADO, 'PUT', base, { corpo: { contract: 2, keyReady: 1 } }),
    await medir(ctx, 22, 'contract numérico e keyReady booleano são aceitos', OK, 'PUT', base, { corpo: { contract: 2, keyReady: true } }),
    await medir(ctx, 22, 'presença de aparelho ANTIGO, sem os dois campos, continua aceita', OK, 'PUT', `${raiz(ctx)}/devices/antigo`, { corpo: { name: 'aparelho velho' } }),
  ];
}

function envelope(tamanho) {
  return { v: 1, u: Date.now(), enc: enc(tamanho) };
}

async function itemVinteETres(ctx) {
  const status = `${raiz(ctx)}/live/deviceStatus/${APARELHO}`;
  const catalogo = `${raiz(ctx)}/catalog/${PR_TAG}`;
  const semCampo = { v: 1, enc: enc(64) };
  return [
    await medir(ctx, 23, 'estado do aparelho com {v, u, enc} dentro de 2048 é aceito', OK, 'PUT', status, { corpo: envelope(TETO_ENVELOPE) }),
    await medir(ctx, 23, 'estado do aparelho sem o campo u é recusado', RECUSADO, 'PUT', status, { corpo: semCampo }),
    await medir(ctx, 23, 'catálogo com {v, u, enc} dentro de 2048 é aceito', OK, 'PUT', catalogo, { corpo: envelope(TETO_ENVELOPE) }),
    await medir(ctx, 23, 'catálogo com envelope acima de 2048 é recusado', RECUSADO, 'PUT', catalogo, { corpo: envelope(TETO_ENVELOPE + 1) }),
    await medir(ctx, 23, 'chave do catálogo fora do formato de tag é recusada', RECUSADO, 'PUT', `${raiz(ctx)}/catalog/dono-repo-12`, { corpo: envelope(64) }),
  ];
}

async function prepararLimpeza(ctx, ligada) {
  await semearAdmin(ctx, APARELHO, GERACAO);
  await semearLimpeza(ctx, ligada, GERACAO, REV_BASE);
  await semOperacoes(ctx);
  await semear(ctx, `live/deviceStatus/${APARELHO}`, envelope(64));
  await semear(ctx, `catalog/${PR_TAG}`, envelope(64));
  await renovarSenha(ctx, ctx.u1);
}

async function itemVinteEQuatro(ctx) {
  await prepararLimpeza(ctx, true);
  const status = await medir(ctx, 24, 'remoção do estado do aparelho com a chave ligada é aceita', OK, 'DELETE', `${raiz(ctx)}/live/deviceStatus/${APARELHO}`);
  const catalogo = await medir(ctx, 24, 'remoção do catálogo com a chave ligada é aceita', OK, 'DELETE', `${raiz(ctx)}/catalog/${PR_TAG}`);
  await prepararLimpeza(ctx, false);
  const statusOff = await medir(ctx, 24, 'remoção do estado do aparelho com a chave DESLIGADA é recusada', RECUSADO, 'DELETE', `${raiz(ctx)}/live/deviceStatus/${APARELHO}`);
  const catalogoOff = await medir(ctx, 24, 'remoção do catálogo com a chave DESLIGADA é recusada', RECUSADO, 'DELETE', `${raiz(ctx)}/catalog/${PR_TAG}`);
  return [status, catalogo, statusOff, catalogoOff];
}

// O segundo usuário existe por causa de um defeito real da C3a: a concessão de remoção
// se apoiava só na senha recente, que não prova quem é o dono.
async function itemVinteECinco(ctx) {
  await prepararLimpeza(ctx, true);
  await renovarSenha(ctx, ctx.u2);
  const alheio = ctx.u2.idToken;
  const base = raiz(ctx);
  return [
    await medir(ctx, 25, 'o SEGUNDO usuário não escreve na árvore do primeiro', RECUSADO, 'PUT', `${base}/devices/invasor`, { token: alheio, corpo: { name: 'x' } }),
    await medir(ctx, 25, 'o SEGUNDO usuário não lê a árvore do primeiro', RECUSADO, 'GET', base, { token: alheio }),
    await medir(ctx, 25, 'o SEGUNDO usuário não remove pelo caminho da limpeza', RECUSADO, 'DELETE', `${base}/live/groups`, { token: alheio }),
    await medir(ctx, 25, 'o SEGUNDO usuário não remove o catálogo do primeiro', RECUSADO, 'DELETE', `${base}/catalog/${PR_TAG}`, { token: alheio }),
  ];
}

export async function casos(ctx) {
  const saida = [];
  saida.push(...await itemVinteEDois(ctx));
  saida.push(...await itemVinteETres(ctx));
  saida.push(...await itemVinteEQuatro(ctx));
  saida.push(...await itemVinteECinco(ctx));
  return saida;
}

export default { casos };
