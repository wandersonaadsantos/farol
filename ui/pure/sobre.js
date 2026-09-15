// Sistema > Sobre: os créditos sincronizados com o GitHub. Extraído do ui/pure.js na Fase 1a
// da reorganização; o conteúdo não mudou.
//
// Idealizador é o dono do repo do update; contribuidores vêm da API de contributors do mesmo
// repo, então colaborador novo no git aparece sozinho, sem manutenção. Toda pessoa sai por
// personMention (menção navegável com foto, regra do app). Sem dado ainda (boot, gh sem
// login, rede), aviso explicativo, nunca vazio mudo.
import { esc, plural } from './comum.js';
import { personMention, repoMention } from './mencoes.js';

export function creditsHtml(credits) {
  if (!credits || !credits.owner || !credits.owner.login) {
    return `<div class="credits-wait">Buscando os contribuidores no GitHub… precisa do <code>gh</code> autenticado; a lista aparece sozinha quando a busca responder.</div>`;
  }
  const own = credits.owner;
  const ownName = own.name && own.name.toLowerCase() !== own.login.toLowerCase() ? `<span class="credits-name">${esc(own.name)}</span>` : '';
  // o idealizador tem card próprio; na lista geral ele não repete
  const rest = (credits.contributors || []).filter(c => (c.login || '').toLowerCase() !== own.login.toLowerCase());
  const linhas = rest.map(c =>
    `<div class="credits-item">${personMention(c.login, 'sm')}<span class="credits-meta">${plural(c.contributions | 0, 'contribuição', 'contribuições')}</span></div>`
  ).join('');
  return `
    <div class="credits-founder">
      ${personMention(own.login)}
      <span class="credits-role">Idealizador e mantenedor${ownName ? ' · ' : ''}${ownName}</span>
    </div>
    ${rest.length ? `<div class="credits-sub">Contribuidores</div><div class="credits-grid">${linhas}</div>` : ''}
    <div class="credits-foot">Lista sincronizada com ${repoMention(credits.repo)} no GitHub: quem contribui no repositório entra aqui automaticamente.</div>`;
}
