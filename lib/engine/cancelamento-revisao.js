// O pedido pertence à revisão inteira, não só ao processo do provedor.
import vigia from './vigia-sessao.js';

export function conferirCancelamento(engine, id) {
  if (engine.activeReviews?.get(id)?.cancelled) {
    throw Object.assign(new Error('cancelada por você'), { cancelled: true });
  }
}

// Depois de iniciar o envio, não há garantia de interromper o efeito no GitHub.
export function iniciarPublicacao(engine, id) {
  conferirCancelamento(engine, id);
  const sessao = engine.activeReviews.get(id);
  if (sessao) sessao.cancellable = false;
  engine.pushState();
}

// O terminal de revisão segura o PR neste aparelho (revisao-em-curso.js) até a janela avisar
// que fechou; se o aviso se perdeu (trap do macOS/Linux que não chegou), nada mais o soltaria
// até reiniciar. "Liberar PR" faz o que o fim da sessão faria, sem fechar a janela da pessoa.
function liberarTerminal(engine, sessao) {
  if (sessao?.mode !== 'terminal' || sessao.login === true || !(sessao.keys || []).length) return false;
  engine.handleSessionExit({ keys: sessao.keys, label: sessao.label, id: sessao.id, code: 0 });
  return true;
}

export function cancelSession(engine, id) {
  const sessao = engine.activeReviews?.get(id);
  if (liberarTerminal(engine, sessao)) return { ok: true, liberado: true };
  const run = engine.running.get(id);
  if (sessao?.cancelled) return { ok: true };
  if (sessao?.cancellable === false) return { ok: false, error: 'a revisão já está sendo concluída; não é possível cancelar agora' };
  if (!run && !(['auto', 'self'].includes(sessao?.mode) && sessao.cancellable)) return { ok: false, error: 'sessão não encontrada (já terminou?)' };
  if (sessao) sessao.cancelled = true;
  // a marca de abandono de outra sessão do mesmo PR não é o motivo deste cancelamento
  if (sessao) vigia.largarMarcaDeOutra(engine, sessao.keys, id);
  sessao?.sourceAbort?.abort();
  engine.pushState?.();
  if (!run || run.cancelled) return { ok: true };
  run.cancelled = true;
  if (!run.child) return { ok: true };
  engine.killTree(run.child.pid);
  return { ok: true };
}
