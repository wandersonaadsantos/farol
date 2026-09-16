/* Farol · UI: Sistema > Sobre (privacidade, licença e créditos). */

import { personMention, creditsHtml } from '../pure.js';
import { estado } from './estado.js';
import { $ } from './infra.js';

/* ---------- Sistema > Sobre: privacidade, licença e créditos ---------- */
// Créditos vêm do snapshot (engine busca os contribuidores do repo do update no
// GitHub, cache de 24h): a lista se mantém sozinha quando entra colaborador novo.
// O link da licença aponta pro LICENSE do MESMO repo, então fork continua certo.
function renderAbout() {
  const box = $('#creditsBox');
  if (!box) return;
  // crédito de ORIGEM é fixo de propósito: a inspiração não está no git (o código
  // atual foi reconstruído do zero), então a lista sincronizada nunca a capturaria,
  // e história não muda, logo não há manutenção. Decisão do Wanderson, 15/08/2026.
  $('#aboutOrigem').innerHTML = `<span class="origem-label">Origem</span> O Farol nasceu de uma iniciativa do Thiago (${personMention('thiagopcdev', 'xs')}): um revisor de PRs que rodava numa janela de terminal e dependia de ação manual. O app atual foi reconstruído do zero em cima dessa essência.`;
  box.innerHTML = creditsHtml(estado().credits);
  const repo = ((estado().config && estado().config.updateRepo) || '').trim();
  const link = $('#aboutLicenseLink');
  if (link && /^[^\s/]+\/[^\s/]+$/.test(repo)) link.href = `https://github.com/${repo}/blob/main/LICENSE`;
}

export { renderAbout };
