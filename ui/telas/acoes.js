/* Farol · UI: ações de topo (checar agora, revisar tudo, tweaks de exibição, kudos,
   diagnóstico, doctor, atualização), os cliques de Panorama/Sessões ativas/Fila/
   Decisões pendentes, e o laço que liga settingsMap aos toggles de Sistema. */

import { estado } from './estado.js';
import {
  $, api, get, toast, toastRich, confirmModal, showOp, closeOp, copyToClipboard,
} from './infra.js';
import { TWEAK, scopeVisible } from './contas.js';
import { revisarUrls } from './consumo.js';
import { kudosScopeKey, loadLog } from './ferramentas.js';

/* decisão pendente: caminho ÚNICO de POST, usado pelo card (#decisions) e pela paleta
   (ui/app.js). O achado A5: a paleta chamava um decide() que nunca existiu
   (ReferenceError engolido). */
function decide(id, action) {
  return api('/api/decide', { id, action }).then(r => {
    if (!r || !r.ok) toast('error', (r && r.error) || 'não consegui registrar a decisão');
    return r;
  });
}

/* ---------- ações ---------- */
$('#btnCheck').onclick = () => api('/api/check');
$('#btnReviewAll').onclick = () => {
  // revisa só o que está visível no escopo atual; a lista vai SEMPRE explícita
  // (mandar {} fazia o servidor revisar a fila INTEIRA, achado B22)
  const urls = (estado().queue || []).filter(scopeVisible).map(p => p.url);
  if (!urls.length) { toast('info', 'Nada visível pra revisar agora (a fila mudou embaixo do botão).'); return; }
  revisarUrls(urls);
};

/* tweaks de exibição (guardados no navegador, não vão pro engine). `rerenderScope`
   fica no bootstrap (ui/app.js): ela conhece TODAS as telas, e este módulo não pode
   sem criar ciclo de volta pro app.js. */
function initTweaks(rerenderScope) {
  const mh = $('#setMutedHandling'), is = $('#setIdentityStyle');
  if (mh) { mh.value = TWEAK.muted; mh.onchange = () => { TWEAK.muted = mh.value; localStorage.setItem('farol-muted-handling', mh.value); rerenderScope(); }; }
  if (is) { is.value = TWEAK.ident; is.onchange = () => { TWEAK.ident = is.value; localStorage.setItem('farol-identity-style', is.value); rerenderScope(); }; }
}
$('#btnKudos').onclick = async () => {
  const btn = $('#btnKudos');
  const opId = 'tool-kudos';
  showOp(opId, { type: 'tool', title: 'Gerando kudos', inline: true, container: btn.parentElement });
  const r = await api('/api/tool', { name: 'kudos', scope: kudosScopeKey() });
  if (r?.ok) closeOp(opId, 'done', 'Kudos gerado');
  else { closeOp(opId, 'error', r?.error || 'não consegui gerar'); toast('info', r?.error || 'não consegui gerar'); }
};
$('#btnHealth').onclick = async () => {
  const btn = $('#btnHealth');
  const opId = 'tool-health';
  showOp(opId, { type: 'tool', title: 'Diagnosticando', inline: true, container: btn.parentElement });
  const r = await api('/api/tool', { name: 'health' });
  if (r?.ok) closeOp(opId, 'done', 'Diagnóstico completo');
  else closeOp(opId, 'error', r?.error || 'falha no diagnóstico');
};
$('#btnDoctor').onclick = async () => { await get('/api/doctor'); };
$('#btnUpdateCheck').onclick = async () => {
  const btn = $('#btnUpdateCheck');
  const opId = 'sys-update-check';
  btn.disabled = true;
  btn.textContent = '↑ Verificando…';
  showOp(opId, { type: 'update', title: 'Verificando atualizações', inline: true, container: $('#updateBox') || document.body });
  await get('/api/doctor');
  closeOp(opId, 'done', 'Verificação concluída');
  setTimeout(() => { btn.disabled = false; btn.textContent = '↑ Verificar agora'; }, 1000);
  toast('ok', 'Verificação de atualização feita.', 2500);
};
$('#btnLogRefresh').onclick = loadLog;

$('#panorama').addEventListener('click', async (e) => {
  const btn = e.target.closest('.pano-review');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Revisando…';
    revisarUrls([btn.dataset.url]);
    return;
  }
  // .act-chat é ouvido globalmente (document); só o copiar precisa de listener aqui,
  // mesmo padrão de "cada seção escuta o seu" usado em Revisões recentes (#resolved).
  const cp = e.target.closest('.rr-copy');
  if (cp) {
    const ok = await copyToClipboard(cp.dataset.url || cp.dataset.key || '');
    toast(ok ? 'ok' : 'error', ok ? 'URL do PR copiada.' : 'Não consegui copiar (permissão do navegador).', 2500);
  }
});

$('#activeSessions').addEventListener('click', (e) => {
  const btn = e.target.closest('.act-cancel');
  if (!btn) return;
  btn.disabled = true;
  api('/api/cancel', { id: btn.dataset.id });
});

$('#queue').addEventListener('click', (e) => {
  const rev = e.target.closest('.act-review');
  if (rev) { revisarUrls([rev.dataset.url]); return; }
  const term = e.target.closest('.act-terminal');
  if (term) { revisarUrls([term.dataset.url], {}, 'terminal'); return; }
  const ign = e.target.closest('.act-ignore');
  if (ign) {
    const key = ign.dataset.key;
    api('/api/ignore', { key });
    let undo;
    const t = toastRich('info', (el) => {
      const message = document.createElement('span');
      message.textContent = `${key} ignorado.`;
      undo = document.createElement('button');
      undo.className = 'undo';
      undo.textContent = 'Desfazer';
      el.appendChild(message);
      el.appendChild(undo);
    }, 8000);
    undo.onclick = () => { api('/api/restore', { key }); t.remove(); };
  }
});

$('#decisions').addEventListener('click', async (e) => {
  // revisar de novo: mesma rota do Revisar da fila. O .act-review NÃO tem listener
  // global (cada seção escuta o seu, ver #resolved), e o card bloqueado por head
  // velho é o único caso em que ele aparece aqui: o round novo substitui este card.
  const rev = e.target.closest('.act-review');
  if (rev) { rev.disabled = true; revisarUrls([rev.dataset.url]); return; }
  const btn = e.target.closest('.dec-act');
  if (!btn) return;
  const id = btn.closest('.decision').dataset.id;
  const action = btn.dataset.action;
  if (action === 'request_changes') {
    const ref = (btn.closest('.decision').querySelector('.dec-ref')?.textContent || 'este PR').trim();
    const ok = await confirmModal({
      title: `Pedir mudanças em ${ref}?`, danger: true, confirmLabel: 'Pedir mudanças', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>posta um REQUEST CHANGES no GitHub</b>, visível pra todo mundo do PR, com os pontos que a revisão levantou.</p>
        <p>O PR fica <b>bloqueado</b> até o autor tratar e você reavaliar. Pra reverter, é só dispensar o seu review depois.</p>`
    });
    if (!ok) return;
  }
  btn.disabled = true;
  const r = await decide(id, action);
  if (!r?.ok) btn.disabled = false;
});

/* configurações: aplica na mudança */
const settingsMap = [
  ['#setUser', 'ghUser', el => el.value],
  ['#setOwners', 'owners', el => el.value],
  ['#setMergeBlocked', 'mergeBlockedRepos', el => el.value],
  ['#setInterval', 'intervalSeconds', el => parseInt(el.value, 10)],
  ['#setReviewModel', 'reviewModel', el => el.value],
  ['#setCodexReviewModel', 'codexReviewModel', el => el.value],
  ['#setParallelReviews', 'parallelReviews', el => parseInt(el.value, 10)],
  ['#setGlobalParallelReviews', 'globalParallelReviews', el => parseInt(el.value, 10)],
  // radio: o change borbulha até o container, então e.target já é o rádio marcado
  ['#setReviewEffort', 'reviewEffort', el => el.value],
  ['#setCodexReviewEffort', 'codexReviewEffort', el => el.value],
  ['#setAutoPushback', 'autoPushback', el => el.checked],
  ['#setAutoUpdate', 'autoUpdate', el => el.checked],
  ['#setDebugSpawns', 'debugSpawns', el => el.checked],
  ['#setAutoReview', 'autoReview', el => el.checked],
  ['#setAutoApproveAll', 'autoApproveAll', el => el.checked],
  ['#setAutoApproveContested', 'autoApproveContested', el => el.checked],
  ['#setReviewFast', 'reviewFast', el => el.checked],
  ['#setCoAssinarReview', 'coAssinarReview', el => el.checked],
  ['#setReReviewResume', 'reReviewResume', el => el.checked],
  ['#setSkipPerms', 'skipPermissions', el => el.checked],
  ['#setSound', 'soundEnabled', el => el.checked],
  ['#setTeamHighlights', 'teamHighlights', el => el.checked],
  ['#setDeliveriesEnabled', 'deliveriesEnabled', el => el.checked],
  ['#setAutostart', 'autostart', el => el.checked]
];
for (const [sel, key, read] of settingsMap) {
  $(sel).addEventListener('change', async (e) => {
    const r = await api('/api/settings', { [key]: read(e.target) });
    // o servidor devolve o que NÃO aceitou. Dizer "salva" sem olhar isso foi o que
    // fez preferência sumir em silêncio: a tela confirmava, o config não guardava.
    if (r && Array.isArray(r.ignoradas) && r.ignoradas.includes(key)) {
      toast('error', `"${key}" não foi salva: o servidor não reconhece essa preferência.`, 6000);
      return;
    }
    toast('ok', 'Configuração salva.', 2500);
  });
}

export { decide, initTweaks };
