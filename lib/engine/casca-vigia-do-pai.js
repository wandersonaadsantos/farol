// A vigia do pai do motor reexecutado (28/10/2026). Node não tem execve: o pai fica vivo para
// repassar sinal, e o filho confere o pid dele (FAROL_PAI_PID) para não ficar órfão segurando
// a porta quando o pai morre sem repassar nada (SIGKILL, ou o TerminateProcess da casca no
// Windows).
import { TEMPOS } from '../constants.js';

// O pai existe? `kill(pid, 0)` não manda sinal, só pergunta. ESRCH é "não existe"; EPERM é
// "existe, mas não é meu", que conta como vivo.
function paiVivo(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== 'ESRCH'; }
}

// Vigia do pai do motor reexecutado: a cada `intervaloMs` confere se `pid` existe e, quando
// some, chama `aoMorrer` uma vez só e para. O timer é unref: a vigia nunca segura o processo.
// Devolve a função que para a vigia.
function vigiarPai({ pid, intervaloMs = TEMPOS.VIGIA_DO_PAI_MS, aoMorrer }) {
  let timer = null;
  const parar = () => { if (timer) clearInterval(timer); timer = null; };
  const conferir = () => { if (!paiVivo(pid)) { parar(); aoMorrer(); } };
  timer = setInterval(conferir, intervaloMs);
  timer.unref();
  return parar;
}

// Pai morto: o mesmo caminho de saída do SIGTERM (registrarSaidaOrdenada no server.js, que
// apaga o casca.json). Emitir o evento, e não mandar o sinal, porque no Windows o kill em si
// mesmo encerra sem rodar os ouvintes. Antes do listen não há ouvinte, e sair basta.
function sairComoNoSigterm() {
  if (process.listenerCount('SIGTERM')) process.emit('SIGTERM', 'SIGTERM');
  else process.exit(0);
}

export default { vigiarPai, sairComoNoSigterm };
export { vigiarPai, sairComoNoSigterm };
