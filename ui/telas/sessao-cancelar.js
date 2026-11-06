import { api, confirmModal, toast } from './infra.js';
import { liberaTerminal, temCancelamento, textoDoCancelamento } from '../pure.js';
import { estado } from './estado.js';

const pedidos = new Set();

// O cartão permanece no DOM entre snapshots: atualiza o controle já existente.
export function atualizarCancelamento(sessao, box) {
  const btn = box.querySelector(`.act-cancel[data-id="${CSS.escape(sessao.id)}"]`);
  if (!btn) return;
  btn.hidden = !temCancelamento(sessao);
  btn.disabled = !!sessao.cancelled || pedidos.has(sessao.id);
  btn.textContent = textoDoCancelamento(sessao);
}

const PERGUNTA_DO_TERMINAL = {
  title: 'Liberar este PR?', danger: true,
  confirmLabel: 'Liberar PR', cancelLabel: 'Manter',
  body: '<p>O Farol deixa de contar esta janela de terminal como revisão em curso, e o PR volta a poder ser revisado neste aparelho.</p><p>A janela não é fechada: feche-a você, se ainda estiver aberta.</p>',
};

const PERGUNTA_DA_SESSAO = {
  title: 'Cancelar esta sessão?', danger: true,
  confirmLabel: 'Cancelar sessão', cancelLabel: 'Continuar sessão',
  body: '<p>A análise em andamento será interrompida. O que já foi enviado ao GitHub não será desfeito.</p><p>Se o envio do review já tiver começado, o cancelamento será recusado.</p>',
};

export async function cancelarSessao(btn) {
  const id = btn.dataset.id;
  if (!id || btn.disabled || pedidos.has(id)) return;
  pedidos.add(id);
  btn.disabled = true;
  let aceito = false;
  try {
    const terminal = liberaTerminal((estado()?.activeSessions || []).find(s => s.id === id));
    const confirmou = await confirmModal(terminal ? PERGUNTA_DO_TERMINAL : PERGUNTA_DA_SESSAO);
    if (!confirmou) return;
    const r = await api('/api/cancel', { id });
    aceito = r?.ok === true;
    if (aceito && terminal) toast('info', 'PR liberado neste aparelho.');
    else if (aceito) {
      btn.textContent = 'Cancelando…';
      toast('info', 'Cancelamento solicitado. A sessão está sendo encerrada.');
    } else toast('error', r?.error || 'Não consegui cancelar a sessão. Tente novamente.');
  } finally {
    pedidos.delete(id);
    if (!aceito) btn.disabled = false;
  }
}
