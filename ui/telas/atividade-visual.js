import { stageFlowFrom } from '../pure/sessao.js';
// Só a cauda da apresentação: checkpoints e evidência durável continuam no engine.
const LIMITE_ATIVIDADE_VISUAL = 300;
const prefixos = new Map();
function resumirPrefixo(id, itens, startedAt) {
  const validos = itens.filter(item => item?.t);
  if (!validos.length || !startedAt) return;
  const lastT = validos.at(-1).t;
  const anterior = prefixos.get(id);
  const flow = stageFlowFrom(validos, startedAt, lastT, anterior);
  const stage = [...validos].reverse().find(item => item.s)?.s || anterior?.stage || 'preparo';
  prefixos.set(id, { lastT, stage, ms: Object.fromEntries(flow.map(etapa => [etapa.id, etapa.ms])) });
}
function limitarAtividadeVisual(atividade, sessoes = []) {
  prefixos.clear();
  if (!atividade || typeof atividade !== 'object') return atividade;
  return Object.fromEntries(Object.entries(atividade).map(([id, itens]) => {
    const lista = Array.isArray(itens) ? itens : [];
    resumirPrefixo(id, lista.slice(0, -LIMITE_ATIVIDADE_VISUAL), sessoes.find(s => s.id === id)?.startedAt);
    return [id, lista.slice(-LIMITE_ATIVIDADE_VISUAL)];
  }));
}
function registrarAtividadeVisual(atividade, id, item, startedAt) {
  const lista = [...(atividade[id] || []), item];
  resumirPrefixo(id, lista.slice(0, -LIMITE_ATIVIDADE_VISUAL), startedAt);
  atividade[id] = lista.slice(-LIMITE_ATIVIDADE_VISUAL);
}
function fluxoDaAtividade(id, itens, startedAt, agora = Date.now()) {
  return stageFlowFrom(itens, startedAt, agora, prefixos.get(id));
}
export { LIMITE_ATIVIDADE_VISUAL, limitarAtividadeVisual, registrarAtividadeVisual, fluxoDaAtividade };
