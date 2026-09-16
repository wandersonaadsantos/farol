// Itens 35 a 42 do roteiro (C5c, distribuição), mais o campo `espera` de
// `live/assign/{item}` (lib/engine/sync-espera.js), que entrou depois do roteiro.
import { renovarSenha } from './regras-contexto.js';
import { HORA_MS, MINUTO_MS, OK, RECUSADO, medir, enc, encInvalido, hex, raiz, semear, zerar, semearAdmin, semearLimpeza, semOperacoes } from './regras-comum.js';

const APARELHO = 'aparelho-a';
const OUTRO_APARELHO = 'aparelho-b';
const GERACAO = 2;
const REV_BASE = 5;
const ITEM = `${hex(8, 'a')}_${hex(8, 'b')}`;
const COMANDO = hex(32, 'c');
const PR_TAG = hex(32, 'd');
const CHECKPOINT = hex(32, 'e');
const TETO_FILA_MS = 30 * MINUTO_MS;
const TETO_ATRIBUICAO_MS = 10 * MINUTO_MS;
const DIA = '2026-09-16';

function candidato(agora, extra) {
  return { itemId: ITEM, prTag: PR_TAG, matTag: 'mat', acctTag: 'acct', orgTag: 'org', publishedAt: agora, ttl: agora + MINUTO_MS, enc: enc(64), ...extra };
}

async function itemTrintaECinco(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/queue/${ITEM}/${APARELHO}`;
  await zerar(ctx, 'live/queue');
  return [
    await medir(ctx, 35, 'candidato com os oito campos e ttl dentro de 30 min é aceito', OK, 'PUT', base, { corpo: candidato(agora) }),
    await medir(ctx, 35, 'id do item fora do formato prTag_matTag é recusado', RECUSADO, 'PUT', `${raiz(ctx)}/live/queue/item-invalido/${APARELHO}`, { corpo: candidato(agora) }),
    await medir(ctx, 35, 'candidato com ttl no passado é recusado', RECUSADO, 'PUT', base, { corpo: candidato(agora, { ttl: agora - MINUTO_MS }) }),
    await medir(ctx, 35, 'candidato com ttl além de 30 min é recusado', RECUSADO, 'PUT', base, { corpo: candidato(agora, { ttl: agora + TETO_FILA_MS + MINUTO_MS }) }),
  ];
}

function atribuicao(agora, rev, extra) {
  return { itemId: ITEM, dev: APARELHO, rev, generation: GERACAO, ttl: agora + MINUTO_MS, sig: 'sig-de-teste', ...extra };
}

async function itemTrintaESeis(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/assign/${ITEM}`;
  await semearAdmin(ctx, APARELHO, GERACAO);
  await zerar(ctx, 'live/assign');
  return [
    await medir(ctx, 36, 'atribuição na geração vigente é aceita', OK, 'PUT', base, { corpo: atribuicao(agora, 1) }),
    await medir(ctx, 36, 'atribuição com a MESMA revisão é recusada', RECUSADO, 'PUT', base, { corpo: atribuicao(agora, 1) }),
    await medir(ctx, 36, 'atribuição com revisão MENOR é recusada', RECUSADO, 'PUT', base, { corpo: atribuicao(agora, 0) }),
    await medir(ctx, 36, 'atribuição com ttl além de 10 min é recusada', RECUSADO, 'PUT', base, { corpo: atribuicao(agora, 2, { ttl: agora + TETO_ATRIBUICAO_MS + MINUTO_MS }) }),
  ];
}

// O veredito de espera (lib/engine/sync-espera.js) é APRESENTAÇÃO: campo do nó que já
// existe, com prazo próprio e envelope cifrado. Nenhum caminho de decisão o lê, mas a
// regra dele precisa valer, senão o nó da atribuição vira depósito de qualquer coisa.
async function espera(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/assign/${ITEM}/espera`;
  return [
    await medir(ctx, '36b', 'veredito de espera com {v, ttl, enc} dentro de 10 min é aceito', OK, 'PUT', base, { corpo: { v: 1, ttl: agora + MINUTO_MS, enc: enc(64) } }),
    await medir(ctx, '36b', 'veredito de espera com ttl além de 10 min é recusado', RECUSADO, 'PUT', base, { corpo: { v: 1, ttl: agora + TETO_ATRIBUICAO_MS + MINUTO_MS, enc: enc(64) } }),
    await medir(ctx, '36b', 'veredito de espera com envelope fora do formato é recusado', RECUSADO, 'PUT', base, { corpo: { v: 1, ttl: agora + MINUTO_MS, enc: encInvalido() } }),
    await medir(ctx, '36b', 'remover o veredito de espera é aceito', OK, 'DELETE', base),
  ];
}

async function itemTrintaESete(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/ack/${ITEM}`;
  return [
    await medir(ctx, 37, 'resposta do executor com {dev, estado, at} é aceita', OK, 'PUT', base, { corpo: { dev: APARELHO, estado: 'aceito', at: agora } }),
    await medir(ctx, 37, 'resposta com at além de agora + 60 s é recusada', RECUSADO, 'PUT', base, { corpo: { dev: APARELHO, estado: 'aceito', at: agora + 2 * MINUTO_MS } }),
  ];
}

function pronto(dev, sequencia, agora) {
  return { dev, generation: GERACAO, sequencia, beatAt: agora, sig: 'sig-de-teste' };
}

async function itemTrintaEOito(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/control/ready`;
  await semearAdmin(ctx, APARELHO, GERACAO);
  await zerar(ctx, 'live/control/ready');
  return [
    await medir(ctx, 38, 'pronto do admin do momento é aceito', OK, 'PUT', base, { corpo: pronto(APARELHO, 2, agora) }),
    await medir(ctx, 38, 'pronto na MESMA sequência é recusado', RECUSADO, 'PUT', base, { corpo: pronto(APARELHO, 2, agora) }),
    await medir(ctx, 38, 'pronto de aparelho que não é o admin é recusado', RECUSADO, 'PUT', base, { corpo: pronto(OUTRO_APARELHO, 3, agora) }),
  ];
}

const GRUPO_BOM = { c: 1, s: 2, d: 3 };
const GRUPO_RUIM = { c: 'um', s: 2, d: 3 };
const CHAVE_GRUPO = hex(32, 'f');

function rollup(agora, extra) {
  return { v: 1, u: agora, seq: 1, g: { [CHAVE_GRUPO]: GRUPO_BOM }, ...extra };
}

async function itemTrintaENove(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/usageDaily/${APARELHO}`;
  await zerar(ctx, 'usageDaily');
  await semearLimpeza(ctx, false, GERACAO, REV_BASE);
  const saida = [
    await medir(ctx, 39, 'rollup do dia com grupos de 32 hex é aceito', OK, 'PUT', `${base}/${DIA}`, { corpo: rollup(agora) }),
    await medir(ctx, 39, 'dia fora da forma AAAA-MM-DD é recusado', RECUSADO, 'PUT', `${base}/16-09-2026`, { corpo: rollup(agora) }),
    await medir(ctx, 39, 'versão diferente de 1 é recusada', RECUSADO, 'PUT', `${base}/${DIA}`, { corpo: rollup(agora, { v: 2 }) }),
    await medir(ctx, 39, 'seq não numérico é recusado', RECUSADO, 'PUT', `${base}/${DIA}`, { corpo: rollup(agora, { seq: 'um' }) }),
    await medir(ctx, 39, 'grupo com c em texto é recusado', RECUSADO, 'PUT', `${base}/${DIA}`, { corpo: rollup(agora, { g: { [CHAVE_GRUPO]: GRUPO_RUIM } }) }),
    await medir(ctx, 39, 'remoção sem a chave de limpeza é recusada', RECUSADO, 'DELETE', `${base}/${DIA}`),
  ];
  await semearAdmin(ctx, APARELHO, GERACAO);
  await semearLimpeza(ctx, true, GERACAO, REV_BASE);
  await semOperacoes(ctx);
  await renovarSenha(ctx, ctx.u1);
  saida.push(await medir(ctx, 39, 'remoção com a chave ligada e senha recente é aceita', OK, 'DELETE', `${base}/${DIA}`));
  return saida;
}

function comando(agora, extra) {
  return { v: 1, generation: GERACAO, alvo: APARELHO, ttl: agora + MINUTO_MS, enc: enc(64), sig: 'sig-de-teste', ...extra };
}

async function itemQuarenta(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/commands`;
  await semearAdmin(ctx, APARELHO, GERACAO);
  await semearLimpeza(ctx, false, GERACAO, REV_BASE);
  await zerar(ctx, 'live/commands');
  const saida = [
    await medir(ctx, 40, 'comando na geração vigente e dentro de 1 h é aceito', OK, 'PUT', `${base}/${COMANDO}`, { corpo: comando(agora) }),
    await medir(ctx, 40, 'comando com ttl além de 1 h é recusado', RECUSADO, 'PUT', `${base}/${COMANDO}`, { corpo: comando(agora, { ttl: agora + HORA_MS + MINUTO_MS }) }),
    await medir(ctx, 40, 'comando em geração antiga é recusado', RECUSADO, 'PUT', `${base}/${COMANDO}`, { corpo: comando(agora, { generation: GERACAO - 1 }) }),
    await medir(ctx, 40, 'chave de comando fora de 32 hex é recusada', RECUSADO, 'PUT', `${base}/comando-1`, { corpo: comando(agora) }),
    await medir(ctx, 40, 'remoção antes do ttl e sem a chave de limpeza é recusada', RECUSADO, 'DELETE', `${base}/${COMANDO}`),
  ];
  await semear(ctx, `live/commands/${COMANDO}`, comando(agora, { ttl: agora - MINUTO_MS }));
  saida.push(await medir(ctx, 40, 'remoção depois do ttl é aceita', OK, 'DELETE', `${base}/${COMANDO}`));
  return saida;
}

function recibo(agora, dev) {
  return { dev, estado: 'aplicado', code: 'ok', at: agora };
}

async function itemQuarentaEUm(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/commandReceipts/${COMANDO}`;
  await semear(ctx, `live/commands/${COMANDO}`, comando(agora));
  await zerar(ctx, `commandReceipts/${COMANDO}`);
  const doAlvo = await medir(ctx, 41, 'recibo do aparelho ALVO é aceito', OK, 'PUT', base, { corpo: recibo(agora, APARELHO) });
  const segundo = await medir(ctx, 41, 'segundo recibo por cima do primeiro é recusado', RECUSADO, 'PUT', base, { corpo: recibo(agora, APARELHO) });
  const comComando = await medir(ctx, 41, 'remover o recibo com o comando ainda lá é recusado', RECUSADO, 'DELETE', base);
  await zerar(ctx, `commandReceipts/${COMANDO}`);
  const deOutro = await medir(ctx, 41, 'recibo de aparelho que não é o alvo é recusado', RECUSADO, 'PUT', base, { corpo: recibo(agora, OUTRO_APARELHO) });
  // A janela de 60 s do `at` não estava no roteiro escrito, e uma mutação que apagou
  // esse teto atravessou o executor inteiro sem reprovar nada. Caso escrito por isso.
  const futuro = await medir(ctx, 41, 'recibo com at além de agora + 60 s é recusado', RECUSADO, 'PUT', base, { corpo: recibo(agora + 2 * MINUTO_MS, APARELHO) });
  const passado = await medir(ctx, 41, 'recibo com at mais de 60 s no passado é recusado', RECUSADO, 'PUT', base, { corpo: recibo(agora - 2 * MINUTO_MS, APARELHO) });
  return [doAlvo, segundo, comComando, deOutro, futuro, passado];
}

function entrada(agora) {
  return { v: 1, u: agora, dev: APARELHO, enc: enc(64) };
}

async function itemQuarentaEDois(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/checkpoints`;
  await zerar(ctx, 'checkpoints');
  await semearLimpeza(ctx, false, GERACAO, REV_BASE);
  return [
    await medir(ctx, 42, 'entrada na loja review é aceita', OK, 'PUT', `${base}/review/${PR_TAG}/${CHECKPOINT}`, { corpo: entrada(agora) }),
    await medir(ctx, 42, 'entrada na loja self é aceita', OK, 'PUT', `${base}/self/${PR_TAG}/${CHECKPOINT}`, { corpo: entrada(agora) }),
    await medir(ctx, 42, 'loja inventada é recusada', RECUSADO, 'PUT', `${base}/inventada/${PR_TAG}/${CHECKPOINT}`, { corpo: entrada(agora) }),
    await medir(ctx, 42, 'id fora de 32 hex é recusado', RECUSADO, 'PUT', `${base}/review/${PR_TAG}/id-curto`, { corpo: entrada(agora) }),
    await medir(ctx, 42, 'segunda escrita no mesmo id é recusada', RECUSADO, 'PUT', `${base}/review/${PR_TAG}/${CHECKPOINT}`, { corpo: entrada(agora) }),
    await medir(ctx, 42, 'remoção sem a chave de limpeza é recusada', RECUSADO, 'DELETE', `${base}/review/${PR_TAG}/${CHECKPOINT}`),
  ];
}

export async function casos(ctx) {
  const saida = [];
  saida.push(...await itemTrintaECinco(ctx));
  saida.push(...await itemTrintaESeis(ctx));
  saida.push(...await espera(ctx));
  saida.push(...await itemTrintaESete(ctx));
  saida.push(...await itemTrintaEOito(ctx));
  saida.push(...await itemTrintaENove(ctx));
  saida.push(...await itemQuarenta(ctx));
  saida.push(...await itemQuarentaEUm(ctx));
  saida.push(...await itemQuarentaEDois(ctx));
  return saida;
}

export default { casos };
