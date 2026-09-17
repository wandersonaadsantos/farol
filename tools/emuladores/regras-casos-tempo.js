// Os casos que dependem de o `auth_time` VENCER de verdade: item 1 (keyring), a metade
// vencida do item 11 (autoridade), o item 14 (a chave de limpeza é o único nó de
// controle que NÃO exige senha recente) e a metade vencida do item 17.
//
// A espera é REAL, de seis minutos contados do login antigo, e não um relógio
// empurrado: a regra compara `auth.token.auth_time` com o `now` do servidor, e
// adiantar o relógio do cliente não muda nenhum dos dois. Quando o resto do roteiro já
// consumiu esses seis minutos, não sobra espera nenhuma.
//
// LIMITE QUE CONTINUA FORA DAQUI: o emulador não prova o comportamento do `auth_time`
// no projeto REAL (o próprio README diz isso). O que estes casos provam é que a regra
// está escrita e avaliada; a confirmação no projeto do dono segue pendente.
import { renovarSenha, renovarSemSenha } from './regras-contexto.js';
import { MINUTO_MS, OK, RECUSADO, medir, raiz, zerar, semearAdmin, semearLimpeza } from './regras-comum.js';
import { chaveiro } from './regras-casos-c1.js';

const APARELHO = 'aparelho-a';
const GERACAO = 2;
const REV_BASE = 5;
const JANELA_SENHA_MS = 5 * MINUTO_MS;
const FOLGA_MS = 30 * 1000;

function admin(generation) {
  return { deviceId: APARELHO, generation, publicKey: 'pk-de-teste', setAt: Date.now() };
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * O token do login ANTIGO, renovado pelo refresh: o acesso é novo, o `auth_time` é o
 * de seis minutos atrás. É exatamente o estado que o roteiro descreve.
 */
export async function tokenVencido(ctx, aviso) {
  const alvo = ctx.antiga.authTime * 1000 + JANELA_SENHA_MS + FOLGA_MS;
  const falta = alvo - Date.now();
  if (falta > 0) {
    aviso(`aguardando ${Math.ceil(falta / 1000)} s para o auth_time do login antigo vencer`);
    await esperar(falta);
  }
  const renovado = await renovarSemSenha(ctx, ctx.antiga);
  return renovado.idToken;
}

async function itemUm(ctx, vencido) {
  await zerar(ctx, 'keyring');
  await renovarSenha(ctx, ctx.u1);
  const base = `${raiz(ctx)}/keyring`;
  const comSenha = await medir(ctx, 1, 'keyring com senha RECENTE é aceito', OK, 'PUT', base, { corpo: chaveiro(1) });
  const semSenha = await medir(ctx, 1, 'keyring com o token renovado e o auth_time VENCIDO é recusado', RECUSADO, 'PUT', base, { token: vencido, corpo: chaveiro(2) });
  await renovarSenha(ctx, ctx.u1);
  const depoisDoLogin = await medir(ctx, 1, 'keyring volta a ser aceito depois de refazer o login', OK, 'PUT', base, { corpo: chaveiro(2) });
  return [comSenha, semSenha, depoisDoLogin];
}

async function itemOnze(ctx, vencido) {
  await semearAdmin(ctx, APARELHO, 1);
  const base = `${raiz(ctx)}/live/control/admin`;
  return [await medir(ctx, 11, 'troca de admin com o auth_time VENCIDO é recusada', RECUSADO, 'PUT', base, { token: vencido, corpo: admin(2) })];
}

async function itemQuatorze(ctx, vencido) {
  await semearAdmin(ctx, APARELHO, GERACAO);
  await semearLimpeza(ctx, true, GERACAO, REV_BASE);
  const base = `${raiz(ctx)}/live/control/cleanup`;
  const corpo = { enabled: true, generation: GERACAO, rev: REV_BASE + 1, sig: 'sig-de-teste' };
  return [await medir(ctx, 14, 'a chave de limpeza é aceita SEM senha recente (decisão D-b)', OK, 'PUT', base, { token: vencido, corpo })];
}

async function itemDezessete(ctx, vencido) {
  const base = `${raiz(ctx)}/live/control/lastCleanup`;
  const corpo = { at: Date.now(), dev: APARELHO, categorias: 'grupos' };
  return [await medir(ctx, 17, 'último registro de limpeza com o auth_time VENCIDO é recusado', RECUSADO, 'PUT', base, { token: vencido, corpo })];
}

// 7.C2, "encerrar as sessões dos outros aparelhos": `live/control/revokedBefore` é o corte
// que faz um token com `auth_time` anterior parar de LER e de ESCREVER. Medido na bancada
// com engines reais (17/09/2026): o nó era gravado e nenhuma regra o consultava, então a
// revogação não cortava nada. O corte fica no U, e por isso vale em toda leitura e escrita.
async function revogacao(ctx, vencido) {
  await renovarSenha(ctx, ctx.u1);
  const corte = ctx.antiga.authTime + 1;
  const base = `${raiz(ctx)}/live/control/revokedBefore`;
  const gravado = await medir(ctx, 'REV', 'corte de sessões com senha recente é aceito', OK, 'PUT', base, { corpo: corte });
  const leituraVelha = await medir(ctx, 'REV', 'token anterior ao corte NÃO lê mais nada', RECUSADO, 'GET', `${raiz(ctx)}/devices`, { token: vencido });
  const escritaVelha = await medir(ctx, 'REV', 'token anterior ao corte NÃO escreve mais nada', RECUSADO, 'PUT', `${raiz(ctx)}/devices/depois-do-corte`, { token: vencido, corpo: { name: 'teste' } });
  const leituraNova = await medir(ctx, 'REV', 'o token do login novo continua lendo', OK, 'GET', `${raiz(ctx)}/devices`);
  const escritaNova = await medir(ctx, 'REV', 'o token do login novo continua escrevendo', OK, 'PUT', `${raiz(ctx)}/devices/depois-do-corte`, { corpo: { name: 'teste' } });
  const paraTras = await medir(ctx, 'REV', 'o corte não anda para trás', RECUSADO, 'PUT', base, { corpo: corte - 10 });
  return [gravado, leituraVelha, escritaVelha, leituraNova, escritaNova, paraTras];
}

export async function casos(ctx, aviso) {
  const vencido = await tokenVencido(ctx, aviso);
  const saida = [];
  saida.push(...await itemUm(ctx, vencido));
  saida.push(...await itemOnze(ctx, vencido));
  saida.push(...await itemQuatorze(ctx, vencido));
  saida.push(...await itemDezessete(ctx, vencido));
  // por último: o corte vale para todo token anterior a ele, e os casos acima usam o antigo
  saida.push(...await revogacao(ctx, vencido));
  return saida;
}

export default { casos };
