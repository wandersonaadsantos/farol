import { esc } from './comum.js';
const QUOTA_STATUS = { open: 'Saldo conferido', unknown: 'Cota não verificada', observing: 'Percentual atingido · observação', reserved: 'Cota reservada' };
const MODES = { off: 'Desligada', observe: 'Observação', enforce: 'Reserva ativa' };
const WINDOWS = { five_hour: 'Cinco horas', weekly: 'Semanal', daily: 'Diária' };
function percent(value) { return value === null || value === undefined ? 'indisponível' : `${value.toFixed(1)}%`; }
function memory(bytes) { return bytes === null || bytes === undefined ? 'indisponível' : `${(bytes / 1024 / 1024).toFixed(0)} MiB`; }
function quotaProfile(profile) {
  const q = profile.quota;
  const refresh = profile.kind === 'agy' ? `<button type="button" class="btn sm" data-capacity-refresh="${esc(profile.id)}">Atualizar fonte deste perfil</button>` : '<p>Fonte verificável ainda não integrada para este provedor.</p>';
  return `<article class="field"><h4>${esc(profile.label)} · ${esc(profile.provider || profile.kind)}</h4>
    <p>${esc(QUOTA_STATUS[q.status] || q.status)} · ${esc(q.reason)} Fonte: ${esc(q.source)} · Atualização: ${esc(q.observedAt ? new Date(q.observedAt).toLocaleString('pt-BR') : 'indisponível')}</p>
    ${q.windows.map(w => `<p>${esc(WINDOWS[w.window] || w.window)} · uso ${percent(w.usedPercent)} · reset ${esc(new Date(w.resetAt).toLocaleString('pt-BR'))}</p>`).join('')}
    <p>Política: ${esc(MODES[profile.policy?.mode] || 'Desligada')} · máximo ${profile.policy?.maxUsedPercent ?? 'não definido'}%</p>
    <p>Política efetiva da assinatura: ${esc(MODES[q.mode])} · máximo ${q.maxUsedPercent ?? 'não definido'}% · perfis de origem: ${esc(q.policyProfiles.join(', ') || 'nenhum')}. Perfis conhecidos da mesma assinatura compartilham a reserva.</p>
    ${refresh}</article>`;
}
function resourceReport(value) {
  const rows = [['Máquina inteira', value.machine.cpuPercent, value.machine.totalBytes - value.machine.freeBytes, null],
    ['Farol e subprocessos sem os CLIs', value.farol.cpuPercent, value.farol.rssBytes, value.farol.count],
    ['CLIs e seus filhos', value.clis.cpuPercent, value.clis.rssBytes, value.clis.count]];
  return `<p>Coleta: ${esc(new Date(value.measuredAt).toLocaleString('pt-BR'))} · ${value.machine.cores} CPUs lógicas.</p>
    <table><thead><tr><th>Escopo</th><th>CPU</th><th>Memória</th><th>Processos</th></tr></thead><tbody>${rows.map(([label, cpu, rss, count]) => `<tr><td>${label}</td><td>${percent(cpu)}</td><td>${memory(rss)}</td><td>${count ?? 'não se aplica'}</td></tr>`).join('')}</tbody></table>
    <p>RAM livre da máquina: ${memory(value.machine.freeBytes)}. Disponível ao processo/container: ${value.machine.availableToProcessMb === null ? 'indisponível' : value.machine.availableToProcessMb.toFixed(0) + ' MiB'}.</p>
    <p>Processo principal: ${memory(value.main.rssBytes)}. Sessões ativas: ${value.sessions}. Revisões na fila: ${value.queue}. Estado dos CLIs: ${esc(value.clis.status)} · não localizados: ${value.missingCliCount}.</p>
    ${value.cliSessions.map(s => `<p>Sessão ${esc(s.id)} · ${s.count} processos · ${memory(s.rssBytes)} · CPU ${percent(s.cpuPercent)}</p>`).join('')}
    ${value.alerts.map(a => `<p role="status">${esc(a)}</p>`).join('')}`;
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
