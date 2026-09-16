/* Farol · UI: abas Destaques e Time (memória de review por pessoa, separada por conta). */

import { esc, personMention, avatar, papelPicker, domainMatrix } from '../pure.js';
import { estado, escopo, peopleOf } from './estado.js';
import { $, get, showOp, closeOp, confirmModal, api, toast, doUsuario } from './infra.js';
import {
  TWEAK, ACCT, OWNER2USER, multiAccount, acctUserFromUrl, scopeMemVisible, acctStyleFor, memGroupHead,
} from './contas.js';
// 'destaques' e 'time' ainda se registram no app.js nesta etapa: o 'destaques'
// precisa de renderTools(), que só sai do app.js na Task 9, passo 2
// (ui/telas/ferramentas.js). Autoregistrar aqui exigiria importar de volta o
// app.js pra pegar renderTools, que é o ciclo que a Fase 1b existe pra evitar.

/* ---------- render: destaques (separado por conta) ---------- */
async function loadHighlights() {
  const box = $('#highlights');
  const opId = 'load-highlights';
  showOp(opId, { type: 'data', title: 'Carregando destaques', inline: true, container: box });
  const items = (await get('/api/highlights')) || [];
  closeOp(opId, 'done');
  const tagged = items.map(h => ({ ...h, _user: acctUserFromUrl(h.url) }));
  const visible = tagged.filter(h => scopeMemVisible(h._user));
  if (!visible.length) {
    box.innerHTML = `<div class="empty"><span class="big">🌱</span>${escopo() === 'all' ? 'Nenhum destaque registrado ainda.' : 'Nenhum destaque nesta conta ainda.'}<br><small>Quando um review encontrar algo exemplar, ele entra aqui.</small></div>`;
    return;
  }
  const multi = multiAccount();
  const card = h => `
    <div class="card hl-card" style="${multi ? acctStyleFor(h._user) : ''}">
      ${h.author ? avatar(h.author, 'sm') : ''}
      <div class="body">
        <div class="hl-head">
          ${h.author ? `<span class="author">${personMention(h.author, 'xs', true)}</span>` : ''}
          ${h.ref ? `<a href="${esc(h.url)}" target="_blank" rel="noreferrer">${esc(h.ref)}</a>` : ''}
          <span>${esc(h.date || '')}</span>
          ${escopo() === 'all' && multi && h._user ? `<span class="acct-chip">${esc((ACCT[h._user.toLowerCase()] || {}).label || h._user)}</span>` : ''}
        </div>
        <div class="hl-text">${esc(h.text)}</div>
      </div>
    </div>`;
  if (escopo() === 'all' && multi) {
    const parts = [];
    for (const a of (estado().accounts || [])) {
      const list = visible.filter(h => h._user && h._user.toLowerCase() === a.user.toLowerCase());
      if (list.length) { parts.push(memGroupHead(a.user)); parts.push(list.map(card).join('')); }
    }
    const geral = visible.filter(h => !h._user);
    if (geral.length) { parts.push(memGroupHead('')); parts.push(geral.map(card).join('')); }
    box.innerHTML = parts.join('');
  } else {
    box.innerHTML = visible.map(card).join('');
  }
}

/* ---------- perfil de review por pessoa ----------
   As puras (personOf, papelOf, domLevelOf, papelPicker, domainMatrix e as três
   tabelas de opções) foram pra pure.js na onda 5. peopleOf (o atalho que resolve
   o mapa de pessoas do estado) foi para telas/estado.js na Task 8: o Radar
   também precisa dele, e nenhum dos dois pode importar o outro. */

/* ---------- render: time (separado por conta) ---------- */
async function loadTeam() {
  const box = $('#team');
  const opId = 'load-team';
  showOp(opId, { type: 'data', title: 'Carregando time', inline: true, container: box });
  const team = (await get('/api/team')) || [];
  closeOp(opId, 'done');
  const multi = multiAccount();
  const people = peopleOf();   // idem renderDecisions: um mapa só pra toda a passada
  // conta de uma entrada: pelo owner do ref (owner/repo#num); antigo (só nome) = sem conta
  const entryUser = e => { const ref = e.ref || ''; const owner = ref.includes('/') ? ref.split('/')[0] : ''; return owner ? (OWNER2USER[owner.toLowerCase()] || '') : ''; };
  const refShort = ref => (ref.includes('/') ? ref.split('/').slice(1).join('/') : ref);
  const memberCard = (m, entries, user) => {
    const last = entries[0];
    const verdictChip = last && last.verdict ? `<span class="verdict ${/approve/i.test(last.verdict) ? 'approve' : 'rc'}">${esc(last.verdict)}</span>` : '';
    const es = entries.slice(0, 3).map(e => `
      <div class="entry">
        <div class="entry-head">${esc(e.date)} · ${esc(refShort(e.ref))} · ${esc(e.verdict)}</div>
        ${e.bullets.length ? `<ul>${e.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>`).join('');
    return `
    <div class="card ${multi ? 'member-card' : ''}" style="${multi ? acctStyleFor(user) : ''}">
      <div class="member-head">
        ${avatar(m.login)}
        <div class="names">
          <div class="name">${esc(m.name)}</div>
          <div class="login">${personMention(m.login, 'xs', true)} · ${entries.length} review(s) registrados</div>
        </div>
        ${verdictChip}
        ${papelPicker(m.login, people)}
        <button class="btn sm ghost member-remove" data-login="${esc(m.login)}" title="Remover @${esc(m.login)} do Time (apaga a memória local sobre a pessoa; pede confirmação)">Remover</button>
      </div>
      <div class="member-profile">
        <span class="mp-label">Competência por domínio</span>
        ${domainMatrix(m.login, people)}
      </div>
      <div class="member-entries">${es}</div>
    </div>`;
  };
  // membros com entradas visíveis pro grupo pedido ('__all__' = todas; '' = sem conta)
  const groupCards = (user) => {
    const out = [];
    for (const m of team) {
      const es = (m.entries || []).filter(e => doUsuario(entryUser(e), user));
      if (es.length) out.push(memberCard(m, es, user === '__all__' ? entryUser(es[0]) : user));
    }
    return out;
  };
  const emptyMsg = `<div class="empty"><span class="big">👋</span>${escopo() === 'all' ? 'Ainda não há memória de reviews.' : 'Nenhuma memória nesta conta ainda.'}<br><small>A cada PR revisado, o Farol registra recorrências e ganhos por pessoa.</small></div>`;
  if (escopo() === 'all' && multi) {
    const parts = [];
    for (const a of (estado().accounts || [])) {
      if (a.muted && TWEAK.muted !== 'Esmaecer') continue;
      const c = groupCards(a.user);
      if (c.length) { parts.push(memGroupHead(a.user)); parts.push(c.join('')); }
    }
    const geral = groupCards('');
    if (geral.length) { parts.push(memGroupHead('')); parts.push(geral.join('')); }
    box.innerHTML = parts.join('') || emptyMsg;
  } else if (escopo() !== 'all') {
    const c = groupCards(escopo());
    box.innerHTML = c.length ? c.join('') : emptyMsg;
  } else {
    const c = groupCards('__all__');
    box.innerHTML = c.length ? c.join('') : emptyMsg;
  }
}

// Remover do Time: ação destrutiva, então o botão SÓ abre o modal de confirmação
// (padrão do app pra tudo que apaga, ver confirmModal) explicando o efeito; nada
// acontece sem o clique em Remover. A remoção vale pra pessoa INTEIRA (o dossiê é
// um só), então os cards dela em todos os grupos (conta e "Geral") saem juntos.
$('#team').addEventListener('click', async (e) => {
  const btn = e.target.closest('.member-remove');
  if (!btn) return;
  const login = btn.dataset.login || '';
  const ok = await confirmModal({
    danger: true,
    title: `Remover @${login} do Time?`,
    body: `<p>Apaga <b>desta máquina</b> tudo o que o Farol guarda sobre ${personMention(login, 'xs')}:</p>
      <ul>
        <li>o dossiê com o histórico de reviews (todos os grupos, inclusive "Geral");</li>
        <li>os destaques registrados nos reviews dessa pessoa;</li>
        <li>o papel e a matriz de competência configurados;</li>
        <li>os registros de contestação (pushback).</li>
      </ul>
      <p>Nada é alterado no GitHub, e a remoção não desfaz. Se um PR dessa pessoa for revisado de novo, um dossiê novo começa do zero.</p>`,
    confirmLabel: 'Remover'
  });
  if (!ok) return;
  const r = await api('/api/team/remove', { login });
  if (r && r.ok) { toast('ok', `@${login} removido do Time.`); loadTeam(); }
  else toast('error', `Não deu pra remover: ${(r && r.error) || 'falha na chamada'}.`);
});

export { loadHighlights, loadTeam };
