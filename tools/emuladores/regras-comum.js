// Vocabulário comum dos casos do roteiro: um caso é um par (o que se esperava, o que
// o servidor respondeu), e nada mais. Quem escreve caso não formata saída nem decide
// desfecho; quem imprime não sabe montar payload.
import { pedir, preparar } from './regras-contexto.js';

export const SEGUNDO_MS = 1000;
export const MINUTO_MS = 60 * SEGUNDO_MS;
export const HORA_MS = 60 * MINUTO_MS;
export const DIA_MS = 24 * HORA_MS;

export const OK = 200;
export const RECUSADO = 401;

// prefixo e sufixo do envelope cifrado, na forma que a regra exige: e1.g<N>.<iv>.<ct>.<tag>
const ENC_PREFIXO = 'e1.g1.aaaa.';
const ENC_SUFIXO = '.cccc';
const ENC_FIXO = ENC_PREFIXO.length + ENC_SUFIXO.length;

/** Envelope VÁLIDO com exatamente `tamanho` caracteres (para medir os tetos de `.length`). */
export function enc(tamanho = 40) {
  const miolo = Math.max(1, tamanho - ENC_FIXO);
  return `${ENC_PREFIXO}${'b'.repeat(miolo)}${ENC_SUFIXO}`;
}

/** Envelope fora do formato que a regra exige (serve aos casos de `matches`). */
export function encInvalido() {
  return 'e1-g1-sem-pontos';
}

export function hex(n, letra = 'a') {
  return letra.repeat(n);
}

/** Um caso medido: o que se esperava do servidor e o que ele respondeu. */
export function caso(item, prova, esperado, obtido) {
  return { item, prova, esperado, obtido, ok: esperado === obtido };
}

/** Atalho: faz a requisição como o USUÁRIO e devolve o caso já medido. */
export async function medir(ctx, item, prova, esperado, metodo, caminho, opcoes = {}) {
  const r = await pedir(ctx, metodo, caminho, { token: opcoes.token || ctx.u1.idToken, ...opcoes });
  return caso(item, prova, esperado, r.status);
}

/** Raiz da árvore do primeiro usuário. */
export function raiz(ctx) {
  return `users/${ctx.u1.uid}`;
}

// ---------------------------------------------------------------- PREPARAÇÃO

/** PREPARAÇÃO: apaga um nó com o token de dono do emulador (ignora as regras). */
export async function zerar(ctx, caminho) {
  return preparar(ctx, 'DELETE', `${raiz(ctx)}/${caminho}`);
}

/** PREPARAÇÃO: grava um nó com o token de dono do emulador (ignora as regras). */
export async function semear(ctx, caminho, valor) {
  return preparar(ctx, 'PUT', `${raiz(ctx)}/${caminho}`, valor);
}

/** PREPARAÇÃO: fixa o admin do momento (aparelho e geração) sem passar pelas regras. */
export async function semearAdmin(ctx, deviceId, generation) {
  await semear(ctx, 'live/control/admin', { deviceId, generation, publicKey: 'pk-de-teste', setAt: Date.now() });
  return { deviceId, generation };
}

/** PREPARAÇÃO: liga ou desliga a chave de limpeza, na geração informada. */
export async function semearLimpeza(ctx, ligada, generation, rev) {
  return semear(ctx, 'live/control/cleanup', { enabled: ligada, generation, rev, sig: 'sig-de-teste' });
}

/** PREPARAÇÃO: garante que não há operação viva (a limpeza exige isto). */
export async function semOperacoes(ctx) {
  return zerar(ctx, 'live/operations');
}

export default { caso, medir, enc, encInvalido, raiz, zerar, semear, semearAdmin, semearLimpeza, semOperacoes, OK, RECUSADO };
