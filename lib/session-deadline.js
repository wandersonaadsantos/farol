// Prazo compartilhado pelos provedores: progresso renova a janela de inatividade,
// mas nunca o teto absoluto. Ruído de stderr e tentativas de rede não são progresso.
import { TEMPOS } from './constants.js';

function sessionDeadline(onTimeout, cancelled = () => false, { recovery = false } = {}) {
  const idleMs = recovery ? TEMPOS.RECUPERACAO_SEM_PROGRESSO_MS : TEMPOS.SESSAO_SEM_PROGRESSO_MS;
  let stopped = false, idle;
  const expire = (message) => {
    if (stopped) return;
    stop();
    if (!cancelled()) onTimeout(new Error(message));
  };
  const absolute = setTimeout(() => expire('tempo esgotado (2h) na sessão autônoma'), TEMPOS.SESSAO_HEADLESS_MS);
  function progress() {
    if (stopped) return;
    clearTimeout(idle);
    idle = setTimeout(() => expire(`tempo esgotado (${idleMs / 60000}min sem progresso) na sessão autônoma`), idleMs);
  }
  function stop() {
    stopped = true;
    clearTimeout(idle);
    clearTimeout(absolute);
  }
  progress();
  return { progress, stop };
}

export { sessionDeadline };
