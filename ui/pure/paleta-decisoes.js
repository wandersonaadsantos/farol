// Comandos das pendências: as ações individuais e em lote usam os gates do card.
import { staleCardMeta } from './review.js';

function podeAprovarCom(d, ciObrigatorio) {
  const meta = staleCardMeta(d, null, {}, ciObrigatorio);
  return !meta.stale && !meta.approveDisabled;
}

// `ciObrigatorio`: a chave "CI obrigatório antes da aprovação" (06/11/2026), a mesma do card.
export function comandosDasPendencias(pendentes, { scopeVisible, decide, decideComConfirmacao, ciObrigatorio = true }) {
  const podeAprovar = (d) => podeAprovarCom(d, ciObrigatorio);
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
