import { esc } from './comum.js';

function opcoesDoEscopo(modo, heranca) {
  const automatico = modo === 'auto' ? ' selected' : '';
  const manual = modo === 'manual' ? ' selected' : '';
  return `<option value="inherit">${heranca}</option><option value="auto"${automatico}>Automático</option><option value="manual"${manual}>Manual</option>`;
}

function linhaDaRegra(user, org, autor, modo, contaManual) {
  const alvo = autor ? `@${autor}` : 'Todos os autores';
  const heranca = autor ? 'Seguir organização' : 'Seguir conta';
  const efeito = contaManual && modo === 'auto' ? '<span class="scope-warning">Sem efeito: conta manual</span>' : '';
  return `<div class="review-scope-row">
    <div class="review-scope-target"><strong>${esc(org)}</strong><span>${esc(alvo)}</span>${efeito}</div>
    <select class="scope-mode" data-user="${esc(user)}" data-organization="${esc(org)}" data-author="${esc(autor)}" aria-label="Modo de review: ${esc(org)}, ${esc(alvo)}">${opcoesDoEscopo(modo, heranca)}</select>
    <button type="button" class="btn sm ghost scope-remove" data-user="${esc(user)}" data-organization="${esc(org)}" data-author="${esc(autor)}" aria-label="Remover regra: ${esc(org)}, ${esc(alvo)}">Remover</button>
  </div>`;
}

export function reviewScopeHtml(conta) {
  const linhas = [];
  for (const [org, regra] of Object.entries(conta.reviewRules || {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (regra.mode) linhas.push(linhaDaRegra(conta.user, org, '', regra.mode, conta.autoReview === false));
    for (const [autor, modo] of Object.entries(regra.authors || {}).sort(([a], [b]) => a.localeCompare(b))) {
      linhas.push(linhaDaRegra(conta.user, org, autor, modo, conta.autoReview === false));
    }
  }
  const aviso = conta.autoReview === false ? '<p class="scope-warning">Esta conta está no modo manual. Regras automáticas só terão efeito quando ela puder revisar sozinha.</p>' : '';
  const lista = linhas.length ? linhas.join('') : '<p class="review-scope-note">Nenhuma exceção. Vale a configuração atual da conta.</p>';
  return `<details class="review-scope" data-user="${esc(conta.user)}">
    <summary>Review por organização e autor <span class="review-scope-count">${linhas.length} regra(s)</span></summary>
    <p class="review-scope-note">Sem regra nova, vale a configuração atual da conta. Essas regras controlam o início da revisão; a publicação segue as opções acima.</p>
    ${aviso}${lista}
    <div class="review-scope-form">
      <label>Organização<input class="scope-organization" placeholder="org-exemplo" autocomplete="off" spellcheck="false"></label>
      <label>Autor (opcional)<input class="scope-author" placeholder="Todos os autores" autocomplete="off" spellcheck="false"></label>
      <label>Modo<select class="scope-new-mode">${opcoesDoEscopo('', 'Seguir conta')}</select></label>
      <button type="button" class="btn sm scope-add" data-user="${esc(conta.user)}" disabled>Adicionar regra</button>
    </div>
    <p class="review-scope-note">O autor tem prioridade dentro da organização. Manual permite revisar por clique e impede retentativas e novas rodadas automáticas. Remover restaura a regra da organização ou da conta.</p>
    <p class="scope-status" role="status" aria-live="polite"></p>
  </details>`;
}
