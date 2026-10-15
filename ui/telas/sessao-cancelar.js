import { api, confirmModal, toast } from './infra.js';

const pedidos = new Set();

// O cartão permanece no DOM entre snapshots: atualiza o controle já existente.
export function atualizarCancelamento(sessao, box) {
  const btn = box.querySelector(`.act-cancel[data-id="${CSS.escape(sessao.id)}"]`);
  if (!btn) return;
  btn.hidden = !sessao.cancellable;
  btn.disabled = !!sessao.cancelled || pedidos.has(sessao.id);
  btn.textContent = sessao.cancelled ? 'Cancelando…' : 'Cancelar';
}

export async function cancelarSessao(btn) {
  const id = btn.dataset.id;
  if (!id || btn.disabled || pedidos.has(id)) return;
  pedidos.add(id);
  btn.disabled = true;
  let aceito = false;
  try {
    const confirmou = await confirmModal({
      title: 'Cancelar esta sessão?', danger: true,
      confirmLabel: 'Cancelar sessão', cancelLabel: 'Continuar sessão',
      body: '<p>A análise em andamento será interrompida. O que já foi enviado ao GitHub não será desfeito.</p><p>Se o envio do review já tiver começado, o cancelamento será recusado.</p>',
    });
    if (!confirmou) return;
    const r = await api('/api/cancel', { id });
    aceito = r?.ok === true;
    if (aceito) {
      btn.textContent = 'Cancelando…';
      toast('info', 'Cancelamento solicitado. A sessão está sendo encerrada.');
    } else toast('error', r?.error || 'Não consegui cancelar a sessão. Tente novamente.');
  } finally {
    pedidos.delete(id);
    if (!aceito) btn.disabled = false;
  }
}
