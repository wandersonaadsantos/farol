import { esc } from './comum.js';
const QUOTA_STATUS = { open: 'Saldo conferido', unknown: 'Cota não verificada', observing: 'Percentual atingido · observação', reserved: 'Cota reservada' };
const MODES = { off: 'Desligada', observe: 'Observação', enforce: 'Reserva ativa' };
const WINDOWS = { five_hour: 'Cinco horas', weekly: 'Semanal', daily: 'Diária' };
function percent(value) { return value === null || value === undefined ? 'indisponível' : `${value.toFixed(1)}%`; }
function memory(bytes) { return bytes === null || bytes === undefined ? 'indisponível' : `${(bytes / 1024 / 1024).toFixed(0)} MiB`; }
function quotaProfile(profile) {
  const q = profile.quota;
  const refresh = profile.kind === 'agy' ? `<button type="button" class="btn sm ghost" data-capacity-refresh="${esc(profile.id)}">Atualizar fonte deste perfil</button>` : '';
  const sourceNote = profile.kind === 'agy' ? '' : '<p>Fonte verificável ainda não integrada para este provedor.</p>';
  const status = { open: 'ok', unknown: 'off', observing: 'warn', reserved: 'info' }[q.status] || 'off';
  return `<article class="irow"><div class="irow-main"><div class="irow-head"><h4>${esc(profile.label)}</h4><span class="chip">${esc(profile.provider || profile.kind)}</span><span class="chip ${status}">${esc(QUOTA_STATUS[q.status] || q.status)}</span></div>
    <p class="irow-sub">${esc(q.reason)}</p><p class="irow-sub">Fonte: ${esc(q.source)} · Atualização: ${esc(q.observedAt ? new Date(q.observedAt).toLocaleString('pt-BR') : 'indisponível')}</p></div><div class="irow-acts">${refresh}</div>
    <div class="windows irow-full">${q.windows.map(w => `<div><div class="window-name">${esc(WINDOWS[w.window] || w.window)}</div>${quotaMeter(w, q.status)}<p class="meter-line">Uso ${percent(w.usedPercent)} · reset ${esc(new Date(w.resetAt).toLocaleString('pt-BR'))}</p></div>`).join('')}</div>
    <p class="irow-sub irow-full">Política: ${esc(MODES[profile.policy?.mode] || 'Desligada')} · máximo ${policyPercent(profile.policy?.maxUsedPercent)}</p>
    <details class="disc"><summary>Política efetiva da assinatura</summary><div class="disc-body"><p>${esc(MODES[q.mode])} · máximo ${policyPercent(q.maxUsedPercent)} · perfis de origem: ${esc(q.policyProfiles.join(', ') || 'nenhum')}. Perfis conhecidos da mesma assinatura compartilham a reserva.</p>${sourceNote}</div></details></article>`;
}
function policyPercent(value) { return Number.isFinite(value) ? percent(value) : 'não definido'; }
function quotaMeter(window, status) {
  if (status === 'unknown' || !Number.isFinite(window.usedPercent)) return '<p class="set-desc">Cota não medida; isso não significa 0%.</p>';
  const used = Math.min(100, Math.max(0, window.usedPercent));
  return `<div class="meter" role="meter" aria-label="Uso de cota · ${esc(WINDOWS[window.window] || window.window)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${used}" aria-valuetext="${percent(window.usedPercent)}"><span style="width:${used}%"></span></div>`;
}
function resourceReport(value) {
  const rows = [['Máquina inteira', value.machine.cpuPercent, value.machine.totalBytes - value.machine.freeBytes, null],
    ['Farol e subprocessos sem os CLIs', value.farol.cpuPercent, value.farol.rssBytes, value.farol.count],
    ['CLIs e seus filhos', value.clis.cpuPercent, value.clis.rssBytes, value.clis.count]];
  return `<p class="set-msg">Coleta: ${esc(new Date(value.measuredAt).toLocaleString('pt-BR'))} · ${value.machine.cores} CPUs lógicas.</p>
    <div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Escopo</th><th scope="col">CPU</th><th scope="col">Memória</th><th scope="col">Processos</th></tr></thead><tbody>${rows.map(([label, cpu, rss, count]) => `<tr><td data-label="Escopo">${label}</td><td data-label="CPU">${percent(cpu)}</td><td data-label="Memória">${memory(rss)}</td><td data-label="Processos">${count ?? 'não se aplica'}</td></tr>`).join('')}</tbody></table></div>
    <p class="set-desc">RAM livre da máquina: ${memory(value.machine.freeBytes)}. Disponível ao processo/container: ${value.machine.availableToProcessMb === null ? 'indisponível' : value.machine.availableToProcessMb.toFixed(0) + ' MiB'}.</p>
    <details class="disc"><summary>Processos e sessões medidas</summary><div class="disc-body"><p>Processo principal: ${memory(value.main.rssBytes)}. Sessões ativas: ${value.sessions}. Revisões na fila: ${value.queue}. Estado dos CLIs: ${esc(value.clis.status)} · não localizados: ${value.missingCliCount}.</p>
    ${value.cliSessions.map(s => `<p>Sessão ${esc(s.id)} · ${s.count} processos · ${memory(s.rssBytes)} · CPU ${percent(s.cpuPercent)}</p>`).join('')}</div></details>
    ${value.alerts.map(a => `<p class="set-msg" role="status">${esc(a)}</p>`).join('')}`;
}
function quotaHistory(value) {
  if (!value.ok) return `<p>${esc(value.reason)}</p>`;
  return value.items.map(item => {
    let outcome = 'Sem observação final; em andamento ou interrompida.';
    if (item.end) outcome = 'Teto atingido após a sessão: ' + (item.end.aboveMax ? 'sim' : 'não');
    if (item.end?.aboveMax === null) outcome = 'Cota final indisponível.';
    return `<p>${esc(item.start.profileId)} · ${esc(item.start.sessionId || 'sem identificador')} · ${esc(outcome)}</p>`;
  }).join('') || '<p>Nenhuma admissão com política de cota registrada.</p>';
}
export { quotaProfile, resourceReport, quotaHistory };
