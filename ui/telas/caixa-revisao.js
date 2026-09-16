/* Farol · UI: abre a caixa de revisão de uma decisão por chave (atalho da tabela de
   Consumo). Não é aba (não passa por registrarTela): é um handler delegado no
   document, chamado pelo bootstrap (ui/app.js) no mesmo ponto em que morava. */

import { esc, reviewBoxHtml } from '../pure.js';
import { estado } from './estado.js';
import { get, toast } from './infra.js';

/* ---------- caixa de revisão por chave (atalho da tabela de Consumo) ----------
   O snapshot manda só as 30 revisões mais recentes (com relatório, cada decisão
   pesa ~5 KB; 3000 seriam 15 MB a CADA push de SSE). Então procura primeiro no
   que já está em mãos e, só se não achar, pergunta ao engine, que varre o
   histórico completo (3000 em disco). Handler delegado no document, igual ao
   data-goto: nenhuma tela registra listener próprio. */
function decisaoLocal(key) {
  const d = estado()?.decisions || {};
  return (d.pending || []).find(x => x.key === key) || (d.resolved || []).find(x => x.key === key) || null;
}

async function abrirCaixaRevisao(key) {
  // o get() devolve null em QUALQUER falha, por isso a rota responde envelope:
  // sem ele, "não há revisão desse PR" e "a busca falhou" seriam a mesma coisa
  // na tela, e o clique ficaria indistinguível de bug.
  let d = decisaoLocal(key);
  if (!d) {
    const env = await get('/api/decision?key=' + encodeURIComponent(key));
    if (!env) { toast('error', 'Não consegui buscar a revisão agora. Tente de novo.'); return; }
    d = env.decision;
  }
  overlayModal(`Revisão de ${esc(key)}`, reviewBoxHtml(d));
}

// overlay de leitura (sem confirmar/cancelar), no mesmo esqueleto do confirmModal
function overlayModal(titulo, corpo) {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal-card wide" role="dialog" aria-modal="true" aria-labelledby="revBoxTitle">
    <div class="modal-title" id="revBoxTitle">${titulo}</div>
    <div class="modal-body scroll">${corpo}</div>
    <div class="modal-actions"><button class="btn sm primary modal-ok">Fechar</button></div>
  </div>`;
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  ov.querySelector('.modal-ok').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  document.addEventListener('keydown', onKey);
  setTimeout(() => ov.querySelector('.modal-ok').focus(), 30);
}

// registrada pelo bootstrap (ui/app.js) no mesmo ponto relativo em que o listener
// morava, pra não mudar a ordem dos handlers de click do document.
function initCaixaRevisao() {
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('[data-review-key]');
    if (!b) return;
    e.preventDefault();
    abrirCaixaRevisao(b.dataset.reviewKey);
  });
}

export { initCaixaRevisao };
