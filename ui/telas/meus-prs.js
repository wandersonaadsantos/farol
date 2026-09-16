/* Farol · UI: aba "Meus PRs" (autoanálise). Não é aba registrável (não passa por
   registrarTela, é sub-seção do Radar): renderMyPRs é chamada pelo connect() do
   app.js a cada snapshot do SSE, na mesma ordem de sempre.

   O botão "Reviewers" (.act-set-reviewers) é a UNICA ação deste bloco que navega
   pra fora do card: ela leva pra aba Sistema e mexe no editor de reviewers. Por
   isso initReviewersButton recebe switchTab por parâmetro (a mesma navegação que
   o bootstrap segura) e o app.js chama a função no lugar em que o listener
   morava, no MESMO elemento #myPRs (o listener declarado aqui embaixo cuida do
   resto dos cliques do card). */

import {
  esc, fmtRel, personMention, md, avatar, expiredSessionMarks, splitHiddenPRs,
  effectiveHidden, hiddenFootLabel, myPRsEmptyMsg, mergeToastKind, buildFixPrompt,
  canMergeSelfAnalysis, qualityBlockTitle, selfAnalysisBadge, selfAnalysisToggle,
  selfAnalysisStale, listViewState, prKeyFromUrl, defaultFor, overrideFor, repoShort,
  selfSessionKey, sessionProgress,
} from '../pure.js';
import { estado, escopo } from './estado.js';
import {
  $, api, confirmModal, showOp, updateOp, closeOp, toast, rotuloDoBotaoDeAnalise,
  copyToClipboard, sysFlash, ACTIVE_OPS,
} from './infra.js';
import { scopeVisible, acctMark } from './contas.js';
import { renderRadarNav } from './radar.js';
import { loadReviewerCands, renderReviewersEditor, revCtx } from './reviewers.js';
import { switchSistemaSection, sysSearchFilter } from './sistema.js';
import { renderMeusPrsRemoto } from './listas-remotas.js';

/* ---------- render: meus PRs (autoanálise) ---------- */
// PRs cujo merge normal esbarrou na proteção de branch: mostram as saídas
// auto-merge/admin até a pessoa escolher (estado só da sessão, não persiste).
const mergeBlockedByPolicy = new Set();
// PRs cujo auto-merge o repo recusou nesta sessão (repo sem "Allow auto-merge"):
// desabilita o botão Auto-merge até o próximo refresh confirmar o estado do repo.
// Map de key pro lastCheckAt do momento da recusa: a poda no renderMyPRs expira a
// marca quando um refresh mais novo chega (antes era Set e nunca expirava, B17).
const autoUnavailableKeys = new Map();
// PRs cujo Merge (admin) foi recusado por ruleset nesta sessão: esconde o botão
// admin até o próximo refresh confirmar (o --admin não fura ruleset). Mesmo Map
// com geração da recusa, mesma poda.
const adminUnavailableKeys = new Map();
// PR oculto de "Meus PRs" (experimento velho que nunca vai mergear e ocupava a aba pra
// sempre). Quem guarda a lista é o motor (estado().hiddenPRs); estas duas marcas são só a
// resposta OTIMISTA ao clique, pra o card sumir/voltar na hora em vez de esperar o
// próximo push de estado. Cada uma é limpa assim que o motor confirma.
const hideOptimistic = new Set();
const unhideOptimistic = new Set();
// mostrar os ocultos é estado local da tela (não persiste), igual ao silencedOpen
// A barra esquerda do card de "Meus PRs" fala o mesmo que o selo, e é por isso que ela
// deriva do `cls` dele em vez de reler `approvable`: eram duas leituras do mesmo estado, e
// com a análise podendo VENCER (ver selfAnalysisStale) a segunda passaria a mentir, pintando
// de verde um PR cujo veredito já não vale.
const BARRA_DO_SELO = { approve: 'ok', rc: 'warn', stale: 'stale' };

let hiddenOpen = false;
function renderMyPRs() {
  // os marcadores de sessão valem até o PRÓXIMO refresh de mergeStates (que roda
  // no fim de cada check, junto do lastCheckAt novo): refresh mais novo que a
  // marcação poda a marca e o dado fresco do repo volta a decidir os botões
  for (const k of expiredSessionMarks([...autoUnavailableKeys], estado().lastCheckAt)) autoUnavailableKeys.delete(k);
  for (const k of expiredSessionMarks([...adminUnavailableKeys], estado().lastCheckAt)) adminUnavailableKeys.delete(k);
  // o motor é a fonte de verdade dos ocultos; a marca otimista morre assim que ele
  // confirma (ocultou de fato, ou de fato reexibiu), pra não sobreviver a um estado novo
  const doMotor = new Set((estado().hiddenPRs || []).map(k => String(k).toLowerCase()));
  for (const k of [...hideOptimistic]) if (doMotor.has(String(k).toLowerCase())) hideOptimistic.delete(k);
  for (const k of [...unhideOptimistic]) if (!doMotor.has(String(k).toLowerCase())) unhideOptimistic.delete(k);

  const todos = (estado().myPRs || []).filter(scopeVisible);
  const { visiveis, ocultos } = splitHiddenPRs(todos, effectiveHidden(estado().hiddenPRs, hideOptimistic, unhideOptimistic));
  // sem nenhum oculto o rodapé não tem o que alternar: volta pro fechado, senão a tela
  // ficaria "aberta" pra sempre depois que o motor reexibisse tudo sozinho
  if (!ocultos.length) hiddenOpen = false;
  // a lista pintada: os visíveis sempre, os ocultos só quando a pessoa pede
  const list = hiddenOpen ? [...visiveis, ...ocultos] : visiveis;
  const analyses = estado().selfAnalyses || {};
  const wrap = $('#myPRsWrap');
  wrap.hidden = false;
  // o contador da sub-aba conta o que está VISÍVEL: com o total, a bolinha dizia 3 e a
  // lista mostrava 0
  // linhas de outros aparelhos: mesmo filtro de conta e mesmos ocultos; os PRs daqui (inclusive
  // os ocultos) nunca voltam como remotos
  const ocultosAgora = new Set(effectiveHidden(estado().hiddenPRs, hideOptimistic, unhideOptimistic));
  const remotasVisiveis = renderMeusPrsRemoto(todos, pr => scopeVisible(pr) && !ocultosAgora.has(String(pr.key).toLowerCase()));
  const contagem = visiveis.length + remotasVisiveis;
  $('#myPRsCount').hidden = contagem === 0;
  $('#myPRsCount').textContent = contagem;
  renderMyPRsHiddenFoot(ocultos.length);
  // o estado de carregamento é do MOTOR, então olha a lista completa: com tudo oculto o
  // ciclo terminou bem e o vazio é escolha da pessoa, não falta de resposta
  const vs = listViewState({ lastCheckAt: estado().lastCheckAt, status: estado().status, length: todos.length });
  if (vs !== 'list' || !list.length) {
    $('#myPRs').innerHTML = `<div class="empty" style="border:0">${esc(myPRsEmptyMsg(vs, { escopoTodas: escopo() === 'all', ocultos: ocultos.length }))}</div>`;
    return;
  }

  const activeSelf = new Set(
    [].concat(...(estado().activeSessions || []).filter(s => s.mode === 'self').map(s => s.keys || []))
  );
  const waiting = estado().headlessWaiting || [];
  const blockedRepos = new Set(((estado().config && estado().config.mergeBlockedRepos) || []).map(r => String(r).toLowerCase()));
  // só tem conteúdo quando os ocultos estão à mostra: é o que esmaece o card e troca
  // o botão Ocultar pelo Reexibir
  const ocultosSet = new Set(ocultos.map(p => p.key));

  $('#myPRs').innerHTML = list.map(pr => {
    const escondido = ocultosSet.has(pr.key);
    const a = analyses[pr.key];
    const m = acctMark(pr, { noBar: !!a });
    const running = activeSelf.has(pr.key);
    // fila serial (um por vez): posicao = ordem real na headlessQueue
    const qpos = running ? 0 : waiting.indexOf(pr.key) + 1;
    const queued = qpos > 0;
    const btnLabel = rotuloDoBotaoDeAnalise({ running, queued, qpos, analisado: a });
    // merge so quando a autoanalise diz aprovavel; desativado (com motivo) se o
    // repo estiver na lista bloqueada ou se ainda ha analise rodando/na fila
    // O Merge só fica disponível quando dá pra mergear DE VERDADE. A mergeabilidade
    // real vem do GitHub (estado().mergeStates): CLEAN/UNSTABLE = mergeia agora;
    // BLOCKED = proteção exige requisitos (mostra auto/admin); DIRTY/BEHIND/DRAFT =
    // não dá, botão desabilitado com o motivo.
    // a decisao mora em ui/pure.js (testada); aqui so consome. NUNCA volte a ler
    // `a.approvable`: ele e parecer, e quem autoriza e o `quality` que o engine calcula.
    const canMerge = canMergeSelfAnalysis(a);
    const repoBlocked = blockedRepos.has(String(pr.key.split('#')[0]).toLowerCase());
    const ms = (estado().mergeStates || {})[pr.key];
    const dataAttrs = `data-url="${esc(pr.url)}" data-key="${esc(pr.key)}"`;
    // auto-merge indisponível: repo sem "Allow auto-merge" (autoAllowed===false) ou
    // já recusou numa tentativa nesta sessão. Nesse caso só admin resolve.
    const autoOff = (ms && ms.autoAllowed === false) || autoUnavailableKeys.has(pr.key);
    // admin indisponível: a base usa ruleset que o --admin não fura (ms.adminBlocked)
    // ou já recusou por isso nesta sessão. Nesse caso o botão Merge (admin) some.
    const adminOff = (ms && ms.adminBlocked === true) || adminUnavailableKeys.has(pr.key);
    const btnMerge = (dis, title) => `<button class="btn ok sm act-self-merge" ${dataAttrs} ${dis ? 'disabled' : ''} title="${esc(title)}">Merge</button>`;
    const btnOptions = () => {
      if (autoOff && adminOff) return `<button class="btn sm act-self-merge" ${dataAttrs} disabled title="A proteção deste repo exige aprovação (ruleset), e nem auto-merge nem admin resolvem. Consiga uma aprovação.">Precisa de aprovação</button>`;
      const auto = `<button class="btn ok sm act-merge-auto" ${dataAttrs} ${autoOff ? 'disabled' : ''} title="${esc(autoOff ? "Este repo não tem 'Allow auto-merge' ligado (Settings do repo)." : 'Ativa o auto-merge: o GitHub mergeia sozinho quando aprovação e checks passarem (não burla a proteção)')}">⏳ Auto-merge</button>`;
      const admin = adminOff ? '' : `<button class="btn sm act-merge-admin" ${dataAttrs} title="Bypassa a proteção da branch e mergeia agora, ignorando revisões e checks obrigatórios (só funciona se você for admin e a proteção não for ruleset)">Merge (admin)</button>`;
      return auto + (admin ? '\n         ' + admin : '');
    };
    let mergeBtns = '';
    if (!canMerge && a && a.quality && a.quality.status !== 'eligible') {
      // fail-closed explicado: sem isto o botao sumia e o usuario nao sabia por que
      mergeBtns = btnMerge(true, qualityBlockTitle(a.quality));
    } else if (canMerge) {
      if (running || queued) mergeBtns = btnMerge(true, 'Aguarde a análise terminar');
      else if (repoBlocked) mergeBtns = btnMerge(true, 'Merge bloqueado para este repo (edite a lista na aba Sistema)');
      else if (mergeBlockedByPolicy.has(pr.key)) mergeBtns = btnOptions();
      else if (!ms) mergeBtns = btnMerge(true, 'Verificando se dá pra mergear…');
      else if (ms.isDraft || ms.status === 'DRAFT') mergeBtns = btnMerge(true, 'O PR está como rascunho, marque como ready antes');
      else if (ms.mergeable === 'CONFLICTING' || ms.status === 'DIRTY') mergeBtns = btnMerge(true, 'O PR tem conflito com a branch de destino, resolva antes');
      else if (ms.status === 'BEHIND') mergeBtns = btnMerge(true, 'A branch está atrás da base, atualize antes de mergear');
      else if (ms.status === 'BLOCKED') mergeBtns = btnOptions();
      else if (ms.status === 'CLEAN' || ms.status === 'UNSTABLE' || ms.status === 'HAS_HOOKS' || ms.mergeable === 'MERGEABLE')
        mergeBtns = btnMerge(false, 'Atribui você ao PR se preciso, faz o merge na branch de destino e deleta a branch de origem se for descartável');
      else mergeBtns = btnMerge(true, `Não dá pra mergear agora (${ms.status || ms.mergeable || 'estado desconhecido'})`);
    }
    const sel = selfAnalysisBadge(a);
    const badge = sel ? `<span class="verdict ${sel.cls}"${sel.title ? ` title="${esc(sel.title)}"` : ''}>${esc(sel.label)}</span>` : '';
    const vis = selfAnalysisToggle(a);
    const desatualizada = selfAnalysisStale(a);
    const hasBlockers = !!(a && (a.blockers || []).length);
    const hasWork = !!(a && ((a.blockers || []).length || (a.tips || []).length));
    // OCULTA some com o painel, nunca com o registro: o botão ao lado traz de volta.
    // Sem essa distinção o "Ocultar" antigo prometia recolher e deletava do disco.
    const analysisPanel = a && !vis.hidden ? `
      <div class="mypr-analysis${desatualizada ? ' desatualizada' : ''}">
        ${desatualizada ? '<div class="mypr-stale">Entrou commit novo depois desta análise. O que está escrito aqui continua valendo pro código que foi lido, mas o veredito não fala do código de agora: reanalise pra ter o veredito atual.</div>' : ''}
        ${a.summary ? `<div class="mypr-summary">${esc(a.summary)}</div>` : ''}
        ${(a.blockers || []).length ? `<div class="mypr-block"><b>Antes de pedir review</b><ul class="dec-reasons">${a.blockers.map(b => `<li>🔴 ${esc(b)}</li>`).join('')}</ul></div>` : ''}
        ${(a.tips || []).length ? `<div class="mypr-tips"><b>Dá pra melhorar</b><ul class="dec-reasons">${a.tips.map(t => `<li>🟡 ${esc(t)}</li>`).join('')}</ul></div>` : ''}
        ${hasWork ? `<div class="mypr-fixrow"><button class="btn sm act-fix-copy" data-key="${esc(pr.key)}" title="Monta um prompt com os pontos da revisão pra você colar no chat que está resolvendo este PR">📋 ${hasBlockers ? 'Copiar prompt de correção' : 'Copiar prompt de melhoria'}</button></div>` : ''}
        ${a.reportMarkdown ? `<details class="dec-report"><summary>Ver relatório completo</summary><div class="report">${md(a.reportMarkdown)}</div></details>` : ''}
        <div class="mypr-when">analisado ${fmtRel(new Date(a.at).toISOString())}${a.card ? ` · ${esc(a.card)}` : ''}</div>
      </div>` : '';
    return `
    <div class="card mypr-card ${sel ? BARRA_DO_SELO[sel.cls] : ''}${escondido ? ' oculto' : ''}" data-key="${esc(pr.key)}" style="${m.style}">
      <div class="mypr-top">
        ${m.dot}${avatar(pr.author)}
        <div class="info">
          <div class="pr-ref"><a href="${esc(pr.url)}" target="_blank" rel="noreferrer">${esc(pr.key)}</a>
            ${pr.isDraft ? '<span class="badge">rascunho</span>' : ''}${badge}${m.chip}</div>
          <div class="pr-title" title="${esc(pr.title)}">${esc(pr.title)}</div>
          ${pr.head && pr.base ? `<div class="pr-branches"><code>${esc(pr.head)}</code> <span class="arrow">→</span> <code>${esc(pr.base)}</code></div>` : ''}
          <div class="pr-sub">${m.acct ? `por você · ${personMention(m.acct.user, 'xs', true)} · ` : ''}atualizado ${fmtRel(pr.updatedAt)}</div>
        </div>
        <div class="pr-actions">
          <button class="btn primary sm act-self" data-url="${esc(pr.url)}" ${running || queued ? 'disabled' : ''}>${btnLabel}</button>
          <button class="btn sm ghost act-set-reviewers" data-url="${esc(pr.url)}" title="Atribui você e pede review dos reviewers configurados deste repo (aba Sistema). Aplica na hora, sem confirmação.">👥 Reviewers</button>
          ${mergeBtns}
          ${a ? `<button class="btn sm ghost act-self-visibility" data-key="${esc(pr.key)}" data-hidden="${vis.alvo ? '1' : '0'}" title="${esc(vis.title)}">${esc(vis.label)}</button>` : ''}
          ${escondido
        ? `<button class="btn sm ghost act-pr-unhide" data-key="${esc(pr.key)}" title="Traz este PR de volta pra lista de Meus PRs">Reexibir</button>`
        : `<button class="btn sm ghost act-pr-hide" data-key="${esc(pr.key)}" title="Some com este PR de Meus PRs. Ele volta sozinho se receber commit novo">Ocultar</button>`}
        </div>
      </div>
      ${analysisPanel}
    </div>`;
  }).join('');
}
// rodapé discreto da seção: "3 PRs ocultos · mostrar". A linha inteira é o controle
// (um botão só), pra ser alcançável por teclado e leitor de tela sem inventar widget.
function renderMyPRsHiddenFoot(n) {
  const foot = $('#myPRsHiddenFoot');
  if (!foot) return;
  const label = hiddenFootLabel(n, hiddenOpen);
  foot.hidden = !label;
  foot.innerHTML = label
    ? `<button class="mypr-hidden-toggle" aria-expanded="${hiddenOpen ? 'true' : 'false'}" title="PR oculto some de Meus PRs mas volta sozinho se receber commit novo">${esc(label)}</button>`
    : '';
}

// Wrapper fino: coleta do estado os dados do prompt (achados da autoanálise +
// metadados do PR) e delega o miolo puro pra buildFixPrompt de ui/pure.js
// (carregado antes deste arquivo via <script src>, migrado na Task 12).
function montaFixPrompt(key) {
  const a = (estado().selfAnalyses || {})[key];
  const pr = (estado().myPRs || []).find(p => p.key === key) || {};
  if (!a) return '';
  return buildFixPrompt({
    key, url: pr.url, title: pr.title, card: a.card, summary: a.summary,
    blockers: a.blockers, tips: a.tips
  });
}

$('#myPRs').addEventListener('click', (e) => {
  const fix = e.target.closest('.act-fix-copy');
  if (fix) {
    const prompt = montaFixPrompt(fix.dataset.key);
    if (!prompt) { toast('error', 'não achei a análise pra montar o prompt'); return; }
    copyToClipboard(prompt).then(ok => ok
      ? toast('ok', 'Prompt copiado. É só colar no chat que está resolvendo o PR.', 3500)
      : toast('error', 'Não consegui copiar (permissão do navegador).'));
    return;
  }
  const run = e.target.closest('.act-self');
  if (run) {
    run.disabled = true; run.textContent = 'Analisando…';
    // o card já carrega o key canônico; a URL é só fallback (pura, testada)
    const card = run.closest('.mypr-card');
    const prKey = (card && card.dataset.key) || prKeyFromUrl(run.dataset.url);
    const opId = `analysis-${prKey}`;
    showOp(opId, {
      type: 'analysis',
      title: `Analisando ${prKey}`,
      key: prKey,
      cancellable: true,
      cancel: { path: '/api/self-review/cancel', body: { key: prKey } },
      container: run.closest('.mypr-card') || run.parentElement
    });
    updateOp(opId, { step: 'Iniciando…', progress: 5 });
    api('/api/self-review', { url: run.dataset.url }).then(r => {
      if (!r?.ok) {
        closeOp(opId, 'error', r?.error || 'falha ao iniciar');
        toast('error', r?.error || 'não consegui iniciar a autoanálise');
        run.disabled = false; run.textContent = 'Analisar';
      } else {
        // daqui em diante quem move a barra é o feed real da sessão (evento
        // 'activity'); prometer "Lendo arquivos… 25%" aqui era chute
        updateOp(opId, { step: 'Preparando a sessão…', progress: 8 });
      }
    });
    return;
  }
  const mrg = e.target.closest('.act-self-merge');
  if (mrg) {
    const key = mrg.dataset.key;
    confirmModal({
      title: `Mergear ${key}?`, danger: true, confirmLabel: 'Mergear', cancelLabel: 'Cancelar',
      body: `<p>O Farol vai:</p>
        <ul>
          <li>te <b>atribuir ao PR</b> se você ainda não estiver;</li>
          <li>fazer o <b>merge commit</b> na branch de destino;</li>
          <li><b>deletar a branch de origem</b> se for descartável (feature/fix/task…), preservando develop/release/main.</li>
        </ul>
        <p>Isso <b>escreve no GitHub</b> e não dá pra desfazer com um clique.</p>`
    }).then(ok => {
      if (!ok) return;
      mrg.disabled = true; mrg.textContent = 'Mergeando…';
      api('/api/self-review/merge', { url: mrg.dataset.url }).then(r => {
        if (r?.ok) { toast('ok', '✓ Merge realizado com sucesso', 3000); return; } // sucesso: o state push atualiza a tela
        if (r?.blocked === 'policy') {
          mergeBlockedByPolicy.add(key); renderMyPRs();
          toast('info', 'A branch de destino tem proteção. Escolha: Auto-merge (espera os requisitos) ou Merge (admin).', 6000);
          return;
        }
        toast(mergeToastKind(r?.error), r?.error || 'não consegui mergear');
        mrg.disabled = false; mrg.textContent = 'Merge';
      });
    });
    return;
  }
  const mAuto = e.target.closest('.act-merge-auto');
  if (mAuto) {
    const key = mAuto.dataset.key;
    mAuto.disabled = true; mAuto.textContent = 'Ativando…';
    api('/api/self-review/merge', { url: mAuto.dataset.url, mode: 'auto' }).then(r => {
      if (r?.ok) { mergeBlockedByPolicy.delete(key); autoUnavailableKeys.delete(key); renderMyPRs(); return; }
      if (r?.blocked === 'autoUnavailable') {
        // repo sem "Allow auto-merge": some com o botão auto, sobra o admin (o
        // servidor já mostrou o toast acionável). Mantém as opções visíveis.
        autoUnavailableKeys.set(key, estado().lastCheckAt || 0); mergeBlockedByPolicy.add(key); renderMyPRs(); return;
      }
      toast(mergeToastKind(r?.error), r?.error || 'não consegui ativar o auto-merge');
      renderMyPRs();
    });
    return;
  }
  const mAdmin = e.target.closest('.act-merge-admin');
  if (mAdmin) {
    const key = mAdmin.dataset.key;
    confirmModal({
      title: `Merge como ADMIN de ${key}`, danger: true, confirmLabel: 'Merge como admin', cancelLabel: 'Cancelar',
      body: `<p>Isso <b>bypassa a proteção da branch</b> e mergeia <b>agora</b>, ignorando revisões e checks obrigatórios. Só funciona se você for admin do repo.</p>
        <p><b>Você está passando por cima do gate de review do time.</b> Use com consciência. Quando der, prefira o <b>Auto-merge</b>: ele espera os requisitos passarem, sem furar nada.</p>`
    }).then(ok => {
      if (!ok) return;
      mAdmin.disabled = true; mAdmin.textContent = 'Mergeando…';
      api('/api/self-review/merge', { url: mAdmin.dataset.url, mode: 'admin' }).then(r => {
        if (r?.ok) { mergeBlockedByPolicy.delete(key); return; } // state push atualiza
        if (r?.blocked === 'rule') { adminUnavailableKeys.set(key, estado().lastCheckAt || 0); renderMyPRs(); return; }
        toast(mergeToastKind(r?.error), r?.error || 'não consegui mergear como admin');
        mAdmin.disabled = false; mAdmin.textContent = 'Merge (admin)';
      });
    });
    return;
  }
  // recolher/mostrar o PARECER (o registro fica no disco nos dois casos). Otimista como
  // o ocultar de PR ao lado: o clique responde na hora e o estado do motor confirma no
  // push seguinte; falhou, desfaz e avisa, senão a tela mentiria sobre o que gravou.
  const visBtn = e.target.closest('.act-self-visibility');
  if (visBtn) {
    const key = visBtn.dataset.key;
    const hidden = visBtn.dataset.hidden === '1';
    const a = (estado().selfAnalyses || {})[key];
    if (a) { a.hidden = hidden; renderMyPRs(); }
    api('/api/self-review/visibility', { key, hidden }).then(r => {
      if (r?.ok) return;
      if (a) { a.hidden = !hidden; renderMyPRs(); }
      toast('error', r?.error || 'não consegui mudar a visibilidade dessa análise');
    });
    return;
  }
  // ocultar/reexibir o PR inteiro: some (ou volta) na hora, otimista, e o estado que o
  // motor devolve confirma. Falhou, desfaz a marca e avisa, senão a tela mentiria.
  const hide = e.target.closest('.act-pr-hide');
  if (hide) {
    const key = hide.dataset.key;
    hideOptimistic.add(key); unhideOptimistic.delete(key);
    renderMyPRs(); renderRadarNav();
    api('/api/pr/hide', { key }).then(r => {
      if (r?.ok) return;
      hideOptimistic.delete(key); renderMyPRs(); renderRadarNav();
      toast('error', r?.error || 'não consegui ocultar este PR');
    });
    return;
  }
  const unhide = e.target.closest('.act-pr-unhide');
  if (unhide) {
    const key = unhide.dataset.key;
    unhideOptimistic.add(key); hideOptimistic.delete(key);
    renderMyPRs(); renderRadarNav();
    api('/api/pr/unhide', { key }).then(r => {
      if (r?.ok) return;
      unhideOptimistic.delete(key); renderMyPRs(); renderRadarNav();
      toast('error', r?.error || 'não consegui reexibir este PR');
    });
  }
});

/* alterna a exibição dos ocultos (estado só da tela, não persiste) */
$('#myPRsHiddenFoot').addEventListener('click', (e) => {
  if (!e.target.closest('.mypr-hidden-toggle')) return;
  hiddenOpen = !hiddenOpen;
  renderMyPRs(); renderRadarNav();
});

/* ---------- Meus PRs: botão Reviewers ----------
   Segundo listener delegado no MESMO #myPRs (o de cima cuida do resto dos cliques
   do card): navega pra aba Sistema (switchTab) e usa o editor de reviewers
   (loadReviewerCands, renderReviewersEditor e revCtx). O handler mora no TOPO
   do módulo, na mesma profundidade que tinha quando vivia no ui/app.js;
   switchTab é a única dependência de fora, guardada em _switchTabReviewers
   (dono único de escrita: initReviewersButton), o mesmo desenho de estado.js.
   initReviewersButton é chamada pelo bootstrap (ui/app.js) no mesmo ponto
   relativo em que este listener morava, e só guarda a dependência e registra
   o handler nomeado abaixo. */
let _switchTabReviewers = null;

// rola até o editor de reviewers e o pisca, depois que a seção do Sistema
// desenhou (setTimeout). Função nomeada em vez de closure inline: mantém a
// profundidade de chaves na mesma faixa que tinha em ui/app.js.
function focarReviewersEditor() {
  const el = $('#reviewersEditor');
  if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); sysFlash(el); }
}

function onMyPRsReviewersClick(e) {
  const rev = e.target.closest('.act-set-reviewers');
  if (!rev) return;
  const card = rev.closest('.mypr-card');
  const repo = String(card?.dataset.key || '').split('#')[0];
  const org = repo.split('/')[0];
  // efetivo = exceção do repo, senão o padrão da org
  const eff = overrideFor(repo, revCtx()) || defaultFor(org, revCtx());
  // sem reviewers (nem exceção nem padrão): leva pra tela de config
  if (!eff || !eff.length) {
    _switchTabReviewers('sistema');
    // sem isso a seção fica display:none e o scroll abaixo não mostra nada: o usuário
    // caía na Visão geral com um toast falando de uma tela que ele não estava vendo
    switchSistemaSection('reviewers');
    const busca = $('#sysSearch');
    if (busca.value) { busca.value = ''; sysSearchFilter(''); }
    loadReviewerCands();
    renderReviewersEditor();
    setTimeout(focarReviewersEditor, 60);
    toast('info', `Defina os reviewers padrão de ${org} (ou uma exceção pra ${repoShort(repo)}) aqui, depois é só clicar em Reviewers no PR.`, 7000);
    return;
  }
  // tem config: aplica na hora, sem confirmação
  rev.disabled = true; rev.textContent = 'Setando…';
  api('/api/self-review/reviewers', { url: rev.dataset.url }).then(r => {
    if (!r?.ok) toast('error', r?.error || 'não consegui setar os reviewers');
    rev.disabled = false; rev.textContent = '👥 Reviewers';
  });
}

function initReviewersButton(switchTab) {
  _switchTabReviewers = switchTab;
  $('#myPRs').addEventListener('click', onMyPRsReviewersClick);
}

/* ---------- progresso da autoanálise, a partir do evento 'activity' do SSE ----------
   Chamado pelo connect() do ui/app.js pra cada evento de atividade de sessão: só
   AGE se a sessão for uma autoanálise (selfSessionKey resolve pra uma chave de PR,
   ver ui/pure.js), atualizando a MESMA régua sessionProgress que o card de sessão
   usa. O op `analysis-<key>` é criado aqui no módulo (showOp, no fluxo de análise),
   então é este módulo que sabe atualizar o progresso dele. */
function updateAnalysisProgress(id, item) {
  const selfKey = selfSessionKey(estado()?.activeSessions, id);
  if (!selfKey) return;
  const op = ACTIVE_OPS.get(`analysis-${selfKey}`);
  if (op && op.status === 'running') {
    const n = (estado()?.activity?.[id] || []).length;
    updateOp(op.id, {
      step: (item && item.text) || op.step,
      progress: Math.max(op.progress || 0, sessionProgress(n))
    });
  }
}

export { renderMyPRs, renderMyPRsHiddenFoot, montaFixPrompt, initReviewersButton, updateAnalysisProgress };
