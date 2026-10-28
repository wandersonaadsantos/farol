// Dono de trava, lease ou reserva: este processo e o fim de outro, pela data de criação do SO.
// Saiu do lock-file.js (v2.78.8) quando leases e reservas passaram a gravar o mesmo dono.
import { processProbe } from '../technical-review/material-process.js';

// Início do processo pelo próprio Node, sem consultar o SO a cada registro.
const STARTED_AT = Math.round(performance.timeOrigin);
// A data de criação do SO vem antes do início do runtime (medido: 20 a 25 ms); um processo que
// nasceu mais que isto depois do início gravado não é o dono.
const NASCEU_DEPOIS_MS = 5000;

// O dono acabou? 'ended', 'alive' ou 'unknown'. Reaproveitado é o PID cujo processo atual
// nasceu depois do início gravado do dono. As duas datas são medidas na partida, então um
// salto do relógio depois dela não as afasta, e a demora do Electron para iniciar o Node
// só deixa a diferença negativa (lado de "vivo"). O mesmo PID deste processo com outro
// início é o Farol reaberto em segundos. Sem início gravado, só o PID ausente prova.
async function ownerState(owner) {
  if (owner.pid === process.pid) return owner.startedAt === STARTED_AT ? 'alive' : 'ended';
  const current = await processProbe.read(owner.pid).catch(() => ({ status: 'unknown' }));
  if (current.status === 'absent') return 'ended';
  if (current.status !== 'found' || !Number.isSafeInteger(owner.startedAt)) return 'unknown';
  const born = Date.parse(current.birth);
  if (!Number.isFinite(born)) return 'unknown';
  return born - owner.startedAt > NASCEU_DEPOIS_MS ? 'ended' : 'alive';
}

export { STARTED_AT, ownerState };
