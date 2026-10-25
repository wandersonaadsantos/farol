// O pedido pertence à revisão inteira, não só ao processo do provedor.
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

export function cancelSession(engine, id) {
  const sessao = engine.activeReviews?.get(id);
  const run = engine.running.get(id);
  if (sessao?.cancelled) return { ok: true };
  if (sessao?.cancellable === false) return { ok: false, error: 'a revisão já está sendo concluída; não é possível cancelar agora' };
  if (!run && !(['auto', 'self'].includes(sessao?.mode) && sessao.cancellable)) return { ok: false, error: 'sessão não encontrada (já terminou?)' };
  if (sessao) sessao.cancelled = true;
  sessao?.sourceAbort?.abort();
  engine.pushState?.();
  if (!run || run.cancelled) return { ok: true };
  run.cancelled = true;
  if (!run.child) return { ok: true };
  engine.killTree(run.child.pid);
  return { ok: true };
}
