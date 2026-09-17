// Itens 26 a 34 do roteiro (C3b a C3f: andamento ao vivo, pendências, história de
// revisões, Panorama, Meus PRs e memória de pushback).
import { DIA_MS, MINUTO_MS, OK, RECUSADO, medir, enc, hex, raiz, semear, zerar, semearAdmin, semearLimpeza } from './regras-comum.js';

const APARELHO = 'aparelho-a';
const OUTRO_APARELHO = 'aparelho-b';
const OP = hex(16, 'a');
const PENDENCIA = hex(16, 'b');
const REVISAO = hex(32, 'c');
const ITEM_PANORAMA = hex(32, 'd');
const TETO_OPERACAO = 5 * MINUTO_MS;
const TETO_PENDENCIA = 4096;
const TETO_CORPO = 48000;
const TETO_META_MS = 20 * MINUTO_MS;
const TETO_PUSHBACK = 1024;
const TETO_PANORAMA = 2048;
const TETO_MEUS_PRS = 8192;

const GERACAO = 2;
const REV_LIMPEZA = 5;

/** PREPARAÇÃO: chave de limpeza desligada, que é o estado dos casos "fora da limpeza". */
async function desligarLimpeza(ctx) {
  await semearAdmin(ctx, APARELHO, GERACAO);
  await semearLimpeza(ctx, false, GERACAO, REV_LIMPEZA);
}

function operacao(agora, extra) {
  return { v: 1, dev: APARELHO, t0: agora, x: agora + MINUTO_MS, enc: enc(64), ...extra };
}

async function itemVinteESeis(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/operations/${OP}`;
  await zerar(ctx, `live/operations/${OP}`);
  return [
    await medir(ctx, 26, 'operação com x dentro de 5 min é aceita', OK, 'PUT', base, { corpo: operacao(agora) }),
    await medir(ctx, 26, 'operação com x no passado é recusada', RECUSADO, 'PUT', base, { corpo: operacao(agora, { x: agora - MINUTO_MS }) }),
    await medir(ctx, 26, 'operação com x além de 5 min é recusada', RECUSADO, 'PUT', base, { corpo: operacao(agora, { x: agora + TETO_OPERACAO + MINUTO_MS }) }),
    await medir(ctx, 26, 'regravar a operação com outro aparelho é recusado', RECUSADO, 'PUT', base, { corpo: operacao(agora, { dev: OUTRO_APARELHO }) }),
    await medir(ctx, 26, 'regravar a operação com outro t0 é recusado', RECUSADO, 'PUT', base, { corpo: operacao(agora, { t0: agora - MINUTO_MS }) }),
    await medir(ctx, 26, 'remover a operação é aceito (remoção cooperativa)', OK, 'DELETE', base),
  ];
}

function pendencia(agora, extra) {
  return { v: 1, at: agora, dev: APARELHO, enc: enc(TETO_PENDENCIA), ...extra };
}

async function itemVinteESete(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/live/pending/${PENDENCIA}`;
  await zerar(ctx, `live/pending/${PENDENCIA}`);
  return [
    await medir(ctx, 27, 'pendência com envelope no teto de 4096 é aceita', OK, 'PUT', base, { corpo: pendencia(agora) }),
    await medir(ctx, 27, 'regravar a pendência com outro at é recusado', RECUSADO, 'PUT', base, { corpo: pendencia(agora - MINUTO_MS) }),
    await medir(ctx, 27, 'regravar a pendência com outro aparelho é recusado', RECUSADO, 'PUT', base, { corpo: pendencia(agora, { dev: OUTRO_APARELHO }) }),
    await medir(ctx, 27, 'remover a pendência é aceito', OK, 'DELETE', base),
  ];
}

async function itemVinteEOito(ctx) {
  const agora = Date.now();
  const visto = `${raiz(ctx)}/live/seen/${PENDENCIA}`;
  await zerar(ctx, `live/seen/${PENDENCIA}`);
  await semear(ctx, `live/pending/${PENDENCIA}`, pendencia(agora));
  // O teto de 60 s do `at` não estava no roteiro escrito: uma mutação que o apagasse
  // atravessaria o executor sem reprovar nada. Vale para os três nós que o repetem
  // (live/seen, live/ack e commandReceipts), e os três têm caso agora.
  const futuro = await medir(ctx, 28, 'visto com at além de agora + 60 s é recusado', RECUSADO, 'PUT', visto, { corpo: { at: agora + 2 * MINUTO_MS, dev: APARELHO } });
  const primeira = await medir(ctx, 28, 'primeiro visto é aceito', OK, 'PUT', visto, { corpo: { at: agora, dev: APARELHO } });
  const segunda = await medir(ctx, 28, 'segundo visto por cima do primeiro é recusado', RECUSADO, 'PUT', visto, { corpo: { at: agora, dev: APARELHO } });
  const comPendencia = await medir(ctx, 28, 'remover o visto com a pendência ainda lá é recusado', RECUSADO, 'DELETE', visto);
  await zerar(ctx, `live/pending/${PENDENCIA}`);
  const semPendencia = await medir(ctx, 28, 'remover o visto depois de a pendência sumir é aceito', OK, 'DELETE', visto);
  return [futuro, primeira, segunda, comPendencia, semPendencia];
}

function revisao(agora, extra) {
  return { v: 1, t: agora, d: 'decisao-1', dt: `decisao-1|${agora}`, enc: enc(512), ...extra };
}

async function itemVinteENove(ctx) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/recentReviews/${REVISAO}`;
  await zerar(ctx, 'recentReviews');
  const gravada = await medir(ctx, 29, 'revisão recente com {v, t, d, dt, enc} é aceita', OK, 'PUT', base, { corpo: revisao(agora) });
  const porT = await medir(ctx, 29, 'consulta orderBy="t" com limitToLast responde 200', OK, 'GET', `${raiz(ctx)}/recentReviews`, { query: { orderBy: '"t"', limitToLast: 30 } });
  const porDt = await medir(ctx, 29, 'consulta orderBy="dt" com limitToLast responde 200', OK, 'GET', `${raiz(ctx)}/recentReviews`, { query: { orderBy: '"dt"', limitToLast: 30 } });
  const regravada = await medir(ctx, 29, 'regravar a revisão com outro t é recusado', RECUSADO, 'PUT', base, { corpo: revisao(agora + MINUTO_MS) });
  return [gravada, porT, porDt, regravada];
}

async function itemTrinta(ctx) {
  const base = `${raiz(ctx)}/reviewBodies/${REVISAO}`;
  await zerar(ctx, `reviewBodies/${REVISAO}`);
  return [
    await medir(ctx, 30, 'primeiro corpo da revisão é aceito', OK, 'PUT', `${base}/1`, { corpo: { v: 1, enc: enc(512) } }),
    await medir(ctx, 30, 'segundo corpo na MESMA versão é recusado', RECUSADO, 'PUT', `${base}/1`, { corpo: { v: 1, enc: enc(512) } }),
    await medir(ctx, 30, 'versão não numérica é recusada', RECUSADO, 'PUT', `${base}/v2`, { corpo: { v: 1, enc: enc(512) } }),
    await medir(ctx, 30, 'corpo acima de 48000 é recusado', RECUSADO, 'PUT', `${base}/2`, { corpo: { v: 1, enc: enc(TETO_CORPO + 1) } }),
  ];
}

async function itemTrintaEUm(ctx) {
  const base = `${raiz(ctx)}/live/rev`;
  return [
    await medir(ctx, 31, 'revisão numérica em recentReviews é aceita', OK, 'PUT', `${base}/recentReviews/${REVISAO}`, { corpo: 1 }),
    await medir(ctx, 31, 'tipo fora da lista é recusado', RECUSADO, 'PUT', `${base}/inventado/${REVISAO}`, { corpo: 1 }),
    await medir(ctx, 31, 'remover a revisão é recusado', RECUSADO, 'DELETE', `${base}/recentReviews/${REVISAO}`),
  ];
}

function linha(agora, tamanho, extra) {
  return { v: 1, su: `su|${agora}`, u: agora, ctag: 'ctag-1', enc: enc(tamanho), ...extra };
}

function lapide(agora) {
  return { v: 1, su: `su|${agora}`, u: agora, ctag: 'ctag-1', del: true };
}

// "Fora da limpeza" quer dizer com a chave DESLIGADA: com ela ligada, a concessão
// @LIMPA@ do nó pai deixa a remoção passar, e o caso mediria outra coisa.
async function umaColecao(ctx, colecao, teto) {
  const agora = Date.now();
  const base = `${raiz(ctx)}/${colecao}/${ITEM_PANORAMA}`;
  await zerar(ctx, colecao);
  await desligarLimpeza(ctx);
  const viva = await medir(ctx, 32, `${colecao}: linha dentro do teto é aceita`, OK, 'PUT', base, { corpo: linha(agora, teto) });
  const morta = await medir(ctx, 32, `${colecao}: lápide sem envelope é aceita`, OK, 'PUT', base, { corpo: lapide(agora) });
  const cedo = await medir(ctx, 32, `${colecao}: remover lápide com menos de 24 h é recusado`, RECUSADO, 'DELETE', base);
  await semear(ctx, `${colecao}/${ITEM_PANORAMA}`, { ...lapide(agora), u: agora - DIA_MS - MINUTO_MS });
  const tarde = await medir(ctx, 32, `${colecao}: remover lápide com mais de 24 h é aceito`, OK, 'DELETE', base);
  await semear(ctx, `${colecao}/${ITEM_PANORAMA}`, linha(agora, 64));
  const fora = await medir(ctx, 32, `${colecao}: remover linha VIVA fora da limpeza é recusado`, RECUSADO, 'DELETE', base);
  const consulta = await medir(ctx, 32, `${colecao}: consulta orderBy="su" responde 200`, OK, 'GET', `${raiz(ctx)}/${colecao}`, { query: { orderBy: '"su"', limitToLast: 30 } });
  return [viva, morta, cedo, tarde, fora, consulta];
}

async function itemTrintaEDois(ctx) {
  const panorama = await umaColecao(ctx, 'panorama', TETO_PANORAMA);
  const meus = await umaColecao(ctx, 'myPrs', TETO_MEUS_PRS);
  return [...panorama, ...meus];
}

async function itemTrintaETres(ctx) {
  const agora = Date.now();
  const saida = [];
  for (const colecao of ['panoramaMeta', 'myPrsMeta']) {
    const base = `${raiz(ctx)}/${colecao}/escopo-1`;
    saida.push(await medir(ctx, 33, `${colecao}: x até agora + 20 min é aceito`, OK, 'PUT', base, { corpo: { dev: APARELHO, x: agora + MINUTO_MS } }));
    saida.push(await medir(ctx, 33, `${colecao}: x além de agora + 20 min é recusado`, RECUSADO, 'PUT', base, { corpo: { dev: APARELHO, x: agora + TETO_META_MS + MINUTO_MS } }));
  }
  return saida;
}

async function itemTrintaEQuatro(ctx) {
  const agora = Date.now();
  const tag = hex(32, 'e');
  const base = `${raiz(ctx)}/pushbacks/${tag}`;
  await zerar(ctx, 'pushbacks');
  await desligarLimpeza(ctx);
  return [
    await medir(ctx, 34, 'registro de contestação dentro de 1024 é aceito', OK, 'PUT', base, { corpo: { v: 1, u: agora, dev: APARELHO, enc: enc(TETO_PUSHBACK) } }),
    await medir(ctx, 34, 'lápide sem envelope é aceita', OK, 'PUT', base, { corpo: { v: 1, u: agora, dev: APARELHO, del: true } }),
    await medir(ctx, 34, 'id fora do formato de tag é recusado', RECUSADO, 'PUT', `${raiz(ctx)}/pushbacks/dono-repo-12`, { corpo: { v: 1, u: agora, dev: APARELHO, enc: enc(64) } }),
    await medir(ctx, 34, 'remover fora da limpeza é recusado', RECUSADO, 'DELETE', base),
  ];
}

export async function casos(ctx) {
  const saida = [];
  saida.push(...await itemVinteESeis(ctx));
  saida.push(...await itemVinteESete(ctx));
  saida.push(...await itemVinteEOito(ctx));
  saida.push(...await itemVinteENove(ctx));
  saida.push(...await itemTrinta(ctx));
  saida.push(...await itemTrintaEUm(ctx));
  saida.push(...await itemTrintaEDois(ctx));
  saida.push(...await itemTrintaETres(ctx));
  saida.push(...await itemTrintaEQuatro(ctx));
  return saida;
}

export default { casos };
