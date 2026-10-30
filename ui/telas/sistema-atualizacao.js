/* Farol · UI: versão e atualização (Sistema > Visão geral). */

import { esc, fmtClock, updateAdiadoHtml, pontePainelHtml } from '../pure.js';
import { estado, ehMac, ehWin } from './estado.js';
import { $, api, toast, confirmModal, origemLocal } from './infra.js';

let updateEmAndamento = false;

async function aplicarAtualizacao() {
  if (updateEmAndamento) return;
  updateEmAndamento = true;
  renderUpdate();
  let aplicado = false;
  try {
    const r = await api('/api/update', {});
    aplicado = !!r?.ok;
    if (r?.queued) toast('info', 'Tem análise, chat ou sessão de terminal em andamento. O update ficou agendado: assim que terminar, o Farol aplica sozinho, fecha e reabre.');
    else if (!r?.ok) toast('error', r?.error || 'não consegui iniciar a atualização');
  } catch { toast('error', 'Não consegui iniciar a atualização. Tente novamente.'); }
  finally {
    updateEmAndamento = aplicado;
    renderUpdate();
  }
}

/* ---------- render: versão e atualização ---------- */
// o aviso da ponte muda por sistema: macOS e Windows têm instalador nativo, o Linux não
function plataformaDaPonte() {
  if (ehMac()) return 'darwin';
  return ehWin() ? 'win32' : 'linux';
}

function renderUpdate() {
  const u = estado().update;
  const box = $('#updateBox');
  if (!u) { box.textContent = 'Verificando…'; return; }
  const remote = u.channel === 'remote';
  // o repo das releases é menção a coisa navegável: abre a página de releases
  const origin = remote
    ? `GitHub Releases (<a href="https://github.com/${esc(u.repo || '')}/releases" target="_blank" rel="noreferrer" title="Abrir as releases no GitHub"><code>${esc(u.repo || '')}</code></a>)`
    : origemLocal(u);
  const hasChannel = remote || !!u.source;
  // não deu pra ler a release (repo privado/sem acesso, sem release ainda, ou rede):
  // sourceVersion nulo + note. Não é "está na mais recente", é falta de acesso.
  const noAccess = hasChannel && !u.available && !u.sourceVersion && !!u.note;
  box.classList.toggle('avail', !!u.available || !!u.ponte);
  box.classList.toggle('ok-state', !u.available && hasChannel && !noAccess && !u.ponte);
  box.classList.toggle('ponte', !!u.ponte);
  if (u.ponte) {
    // a 3.x é o Farol nativo: nada a aplicar aqui, só o instalador a baixar
    box.innerHTML = pontePainelHtml(u, plataformaDaPonte());
  } else if (u.available) {
    const autoOn = remote && estado().config?.autoUpdate !== false;
    const noteAuto = autoOn
      ? `Atualização disponível ${'nas ' + origin}. Com "Atualizar sozinho" ligado (Sistema > Automação), o Farol aplica sozinho assim que ficar ocioso (sem análise, chat ou terminal em andamento), fecha e reabre preservando estado e configurações. O botão abaixo aplica agora, sem esperar.`
      : `Atualização disponível ${remote ? 'nas ' + origin : 'na ' + origin}. O Farol ${remote ? 'baixa e instala, ' : ''}fecha e reabre sozinho, preservando estado e configurações.`;
    const queuedLine = u.queued ? ' <b>Agendado:</b> aplica sozinho assim que as sessões em andamento terminarem.' : '';
    const disabled = updateEmAndamento ? 'disabled aria-busy="true"' : '';
    const label = updateEmAndamento ? 'Preparando atualização…' : 'Atualizar agora';
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)} → v${esc(u.sourceVersion)}</span>
      <span class="up-note">${noteAuto}${queuedLine}${updateAdiadoHtml(u)}</span>
      <button id="btnUpdateNow" class="btn primary sm" ${disabled}>${label}</button>`;
    $('#btnUpdateNow').onclick = async () => {
      if (updateEmAndamento) return;
      // confirm() nativo era o último popup fora da identidade do app neste fluxo
      // (pedido do Wanderson, 15/08/2026): o modal do próprio Farol explica o que
      // vai acontecer, e nada roda sem o clique em Atualizar.
      const ok = await confirmModal({
        title: `Atualizar pra v${u.sourceVersion}?`,
        body: `<p>O Farol sai da <b>v${esc(u.current)}</b> pra <b>v${esc(u.sourceVersion)}</b>.</p>
          <ul>
            <li>${remote ? 'baixa e instala sozinho, incluindo o instalador completo se precisar atualizar o Electron' : 'copia os arquivos da pasta-fonte'};</li>
            <li>o app <b>fecha e reabre</b> no fim; o download pode levar alguns minutos;</li>
            <li>estado, memória do time e configurações ficam intactos;</li>
            <li>se houver revisão ou sessão em andamento, nada é morto no meio: o update fica agendado e aplica sozinho assim que terminar.</li>
          </ul>`,
        confirmLabel: 'Atualizar'
      });
      if (!ok) return;
      await aplicarAtualizacao();
    };
  } else if (noAccess) {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Não consegui ler as releases em ${origin} (${esc(u.note || 'sem acesso')}). Se o repo for privado, a conta primária do gh precisa ter acesso a ele (ou torne o repo público). Última verificação ${fmtClock(u.checkedAt)}.</span>`;
  } else if (hasChannel) {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Você está na versão mais recente (${origin}${u.sourceVersion ? ` também na v${esc(u.sourceVersion)}` : ''}). Última verificação ${fmtClock(u.checkedAt)}.</span>`;
  } else {
    box.innerHTML = `
      <span class="up-ver">v${esc(u.current)}</span>
      <span class="up-note">Nenhuma fonte de atualização nesta máquina. Configure <code>updateRepo</code> (releases do GitHub) ou <code>updateSource</code> (pasta) no config.json.</span>`;
  }
}

export { renderUpdate };
