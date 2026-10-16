import { esc, fmtClock } from './comum.js';
import { feedLine, stageFlowFrom, stageFlowHtml, progressoDaSessao, agentsTitle } from './sessao.js';
export function espelhoDaSessaoHtml(op, agora = Date.now()) {
  const e = op.espelho;
  if (!e || e.estado !== 'completo') return '<p role="status">Aguardando o espelho completo do executor. Se ele ainda não suporta espelhamento, permanece apenas o resumo remoto.</p>';
  const velho = op.situacao === 'interrompida' || e.venceEm <= agora;
  const flow = stageFlowFrom(e.feed, e.startedAt, e.capturadoEm);
  const progresso = progressoDaSessao(e, flow, e.capturadoEm);
  const aviso = velho ? 'Sinal vencido: esta é a última captura recebida, não o estado atual.' : `Captura do executor às ${fmtClock(e.capturadoEm)}. Atualização por sincronização; credenciais são ocultadas.`;
  const agentes = `<span title="${esc(agentsTitle(e.agents))}">👥 ${Number(e.agentsLive) || 0}/${e.agents.length}</span>`;
  return `<div class="espelho-remoto"><p class="section-sub">${esc(aviso)}</p><div>${agentes} · ${esc(e.modelo)} · ${Math.floor(progresso.pct)}% · ${esc(progresso.texto)}</div><div class="stage-flow">${stageFlowHtml(flow)}</div><div class="activity-feed" role="log" aria-label="Espelho da sessão do executor">${e.feed.map(feedLine).join('') || '<p>Preparando a sessão…</p>'}</div></div>`;
}
