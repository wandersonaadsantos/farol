// Tomada forçada do lease (7.C8). Puro: sem estado, sem IO, sem rede.
//
// O QUE A TOMADA NÃO PROMETE: exactly-once. O Farol não alcança o processo do outro
// aparelho; ele só garante que, a partir da tomada, o executor antigo NÃO PUBLICA (a
// geração do lease sobe e o funil recusa quem está atrás). O processo antigo pode seguir
// vivo até perceber que perdeu, e isso custa dinheiro: por isso a tomada exige confirmação
// e registra evidência de possível consumo duplicado.
//
// TOMADA É DELIBERADA, e a regra do banco enxerga isso: o sucessor sobe com a geração
// anterior mais um e com o nome de quem foi tomado. Escrita acidental por cima de lease
// vivo continua impossível.
//
// LEASE VENCIDO NÃO É TOMADA. Quando o lease já venceu, o caminho é o de sempre (disputa
// por CAS), e chamar isso de tomada esconderia a diferença entre "ninguém está lá" e
// "tirei de alguém que estava trabalhando".
import { SYNC } from '../constants.js';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function geracaoDe(lease) {
  return Math.max(1, Number(objeto(lease) && lease.takeoverSeq) || 1);
}

function podeTomar(atual, { nowMs, deviceId }) {
  if (!objeto(atual) || !atual.leaseId) return { pode: false, motivo: 'sem-lease' };
  if (atual.deviceId === deviceId) return { pode: false, motivo: 'ja-e-meu' };
  const exp = Number(atual.expiresAt);
  if (Number.isFinite(exp) && exp <= Number(nowMs)) return { pode: false, motivo: 'vencido' };
  return { pode: true, motivo: '' };
}

function sucessorDe(atual, { leaseId, deviceId, operationKind, headSha, nowMs, farolVersion }) {
  return {
    leaseId, deviceId, operationKind, headSha: headSha || '',
    acquiredAt: nowMs, heartbeatAt: nowMs, expiresAt: nowMs + SYNC.LEASE_TTL_MS, farolVersion,
    takeoverSeq: geracaoDe(atual) + 1,
    tomadoDe: String((objeto(atual) && atual.deviceId) || ''),
    tomadoEm: nowMs,
  };
}

// O outro processo provavelmente AINDA ESTÁ VIVO quando a última batida dele é recente.
// Com batida velha ele já deve ter morrido, e o risco é menor, mas nunca é zero: por isso
// a evidência é registrada nos dois casos, com o risco declarado.
function riscoDeDuplicidade(atual, { nowMs }) {
  const batida = Number(objeto(atual) && atual.heartbeatAt) || 0;
  return Number(nowMs) - batida <= SYNC.LEASE_TTL_MS ? 'provavel' : 'possivel';
}

// O texto que o computador mostra ANTES de confirmar. Ele não promete o que não pode.
function avisoDaTomada(atual, { nowMs, nomeDoAparelho = '' }) {
  const onde = nomeDoAparelho || String((objeto(atual) && atual.deviceId) || 'outro aparelho');
  const risco = riscoDeDuplicidade(atual, { nowMs });
  const quando = risco === 'provavel' ? 'e a sessão de lá deu sinal de vida agora há pouco' : 'e a sessão de lá está sem dar sinal há um tempo';
  return [
    `Este PR está sendo analisado em ${onde}, ${quando}.`,
    'Tomar não encerra o processo do outro aparelho: o Farol não alcança a máquina dele.',
    'A partir da tomada, o aparelho antigo não consegue mais postar review deste PR.',
    `O que pode acontecer é a análise rodar duas vezes e custar duas vezes (risco ${risco}).`,
  ].join(' ');
}

// O funil de postagem pergunta isto antes de enviar: quem está numa geração atrás do lease
// atual não publica.
function publicacaoBloqueada(minhaGeracao, atual) {
  return geracaoDe(atual) > Math.max(1, Number(minhaGeracao) || 1);
}

function evidenciaDaTomada(atual, { prKey, deviceId, nowMs }) {
  return {
    prKey: String(prKey || ''),
    de: String((objeto(atual) && atual.deviceId) || ''),
    para: String(deviceId || ''),
    geracao: geracaoDe(atual) + 1,
    risco: riscoDeDuplicidade(atual, { nowMs }),
    at: Number(nowMs) || 0,
  };
}

export default { geracaoDe, podeTomar, sucessorDe, riscoDeDuplicidade, avisoDaTomada, publicacaoBloqueada, evidenciaDaTomada };
export { geracaoDe, podeTomar, sucessorDe, riscoDeDuplicidade, avisoDaTomada, publicacaoBloqueada, evidenciaDaTomada };
