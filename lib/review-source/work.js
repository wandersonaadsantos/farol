// Fila pequena própria de IO/índice; não altera vagas de reviews em execução.
import { aborted, check } from './contract.js';

const queue = [];
let active = 0;
function pump() {
  const next = queue[0];
  if (!next || active >= next.limits.concurrency) return;
  queue.shift();
  next.signal?.removeEventListener('abort', next.cancel);
  active++;
  Promise.resolve().then(() => { aborted(next.signal); return next.work(); })
    .then(next.resolve, next.reject).finally(() => { active--; pump(); });
  pump();
}
function sourceWork(limits, signal, work) {
  aborted(signal);
  check(queue.length < limits.maxQueued, 'Fila de fontes cheia; nova aquisição adiada.');
  return new Promise((resolve, reject) => {
    const job = { limits, signal, work, resolve, reject };
    job.cancel = () => {
      const index = queue.indexOf(job);
      if (index < 0) return;
      queue.splice(index, 1);
      reject(new Error('Preparação de fontes cancelada antes da execução.'));
      pump();
    };
    signal?.addEventListener('abort', job.cancel, { once: true });
    queue.push(job);
    pump();
  });
}
function sourceWorkStatus() { return { active, queued: queue.length }; }
export { sourceWork, sourceWorkStatus };
