// Modo da distribuição de um aparelho (7.C5, anexo S3, "Degradação e volta"). Puro.
//
// O MODO SAI DA PRONTIDÃO, NÃO DO RELÓGIO DO OUTRO. A prontidão é observada como mudança
// de sequência, carimbada com o relógio LOCAL (lib/sync/autoridade.js), e vence depois de
// três intervalos sem mudança. Nenhuma comparação entre relógios decide o modo.
//
// SEM HISTERESE NA SUBIDA. Voltar para distribuído é imediato no primeiro valor fresco:
// exigir dois valores criaria, em toda recuperação, uma janela com dois escalonadores
// ativos pagando o gate de consciência em dobro. O pior caso de voltar cedo é ninguém
// enfileirar por um ciclo, que é mais barato.
//
// JITTER POR APARELHO. Todos os seguidores vencem o mesmo valor ao mesmo tempo, e o limite
// do GitHub é por token: sem espalhar, a frota inteira dispara no mesmo segundo.
import { createHash } from 'node:crypto';
import { autoridadeFresca } from './autoridade.js';

function modoDe(estadoProntidao, { agora, intervaloMs }) {
  return autoridadeFresca(estadoProntidao, { agora, intervaloMs }) ? 'distribuido' : 'local';
}

// Sem modo anterior (boot) não há virada: nada foi desviado ainda.
function transicao(anterior, atual) {
  if (!anterior || anterior === atual) return null;
  return atual === 'local' ? 'para-local' : 'para-distribuido';
}

function jitterMs(deviceId, tetoMs) {
  const teto = Math.floor(Number(tetoMs) || 0);
  if (teto <= 0) return 0;
  const h = createHash('sha256').update(String(deviceId || '')).digest();
  return h.readUInt32BE(0) % teto;
}

// Os que esperam há mais tempo saem primeiro; o resto fica para o próximo giro.
function loteDaVolta(itens, teto) {
  const ordenados = [...(Array.isArray(itens) ? itens : [])].sort((a, b) => Number(a.desde) - Number(b.desde));
  const n = Math.max(0, Math.floor(Number(teto) || 0));
  return { agora: ordenados.slice(0, n), depois: ordenados.slice(n) };
}

export default { modoDe, transicao, jitterMs, loteDaVolta };
export { modoDe, transicao, jitterMs, loteDaVolta };
