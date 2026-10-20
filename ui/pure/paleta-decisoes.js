// Comandos das pendências: as ações individuais e em lote usam os gates do card.
import { staleCardMeta } from './review.js';

function podeAprovar(d) {
  const meta = staleCardMeta(d, null);
  return !meta.stale && !meta.approveDisabled;
}

export function comandosDasPendencias(pendentes, { scopeVisible, decide, decideComConfirmacao }) {
  const lista = Array.isArray(pendentes) ? pendentes.filter(Boolean) : [];
  const comandos = lista.flatMap(d => {
    if (d.prProprio) return [];
    const ref = d.key || '';
    const acao = (rotulo, action) => ({
      kind: 'decisão', label: `${rotulo} ${ref}`, hint: 'decisão',
      run: () => decideComConfirmacao(d.id, action, ref),
    });
    const itens = [acao('Pedir mudanças em', 'request_changes')];
    if (podeAprovar(d)) itens.unshift(acao('Aprovar', 'approve'));
    return itens;
  });
  const visiveis = lista.filter(podeAprovar).filter(scopeVisible);
  if (visiveis.length > 1) comandos.push({
    kind: 'lote', label: `Aprovar as ${visiveis.length} pendentes`, hint: 'lote',
    run: async () => { for (const d of visiveis) await decide(d.id, 'approve'); },
  });
  return comandos;
}
