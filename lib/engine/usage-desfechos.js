// Vocabulário do registro de consumo: os DESFECHOS possíveis de uma sessão, quais deles
// significam gasto que não virou resultado, quais origens de custo são desconhecidas, e
// as marcas `farol_*` que o evento carrega para a linha (A1 da operação multidispositivo).
//
// Mora fora de lib/engine/usage.js porque lá o assunto é agregação e orçamento; aqui é
// só a tabela de significados, folha e sem dependência.

/* Desfechos que significam "este gasto não virou nada":
   - `parcial`: a sessão morreu no meio e nunca entregou resultado;
   - `descartada`: rodou até o fim e o resultado foi jogado fora (commit novo durante a
     análise). Era gravada como `ok` até 31/08/2026, e foi assim que US$ 64,81 de um dia
     só apareceram como sucesso na tela;
   - `cancelada`: você mandou parar;
   - `erro`: terminou em falha;
   - `interrompida`: o processo do Farol morreu com a sessão aberta e o boot seguinte
     registrou o que o diário de tentativas tinha visto.
   `ok` é o único que produziu resultado. */
const DESFECHOS = ['ok', 'erro', 'cancelada', 'parcial', 'descartada', 'interrompida'];
const DESFECHOS_PERDIDOS = new Set(['erro', 'cancelada', 'parcial', 'descartada', 'interrompida']);
// custo cujo valor não se sabe: nunca é zero para o gate nem medido para a auditoria
// (`sem-base` é o nome antigo da mesma coisa, gravado até a v2.59.3)
const ORIGENS_DESCONHECIDAS = new Set(['desconhecido', 'sem-base']);
// desfechos de retomada que a A5 produz e que a linha do consumo guarda
const RESUME_OUTCOMES = ['retomada', 'recusada', 'nova', 'nenhuma'];

// em qual balde da auditoria o custo desta sessão entra
function origemDoCusto(r, s) {
  if (ORIGENS_DESCONHECIDAS.has(s.costSource)) return r.desconhecido;
  return s.costSource === 'estimado' ? r.estimado : r.medido;
}

// Campos da tentativa (lib/engine/usage-tentativas.js) que viajam no evento como marcas
// farol_*, para a assinatura de recordUsage (e da fachada) continuar a mesma. `attemptId`
// é o que o boot usa para não duplicar uma tentativa já registrada.
function camposDaTentativa(ev) {
  const extra = {};
  if (typeof ev.farol_attempt === 'string' && ev.farol_attempt) extra.attemptId = ev.farol_attempt;
  if (Number(ev.farol_iniciada_em) > 0) extra.iniciadaEm = Number(ev.farol_iniciada_em);
  if (ev.farol_provedor_destacado === true) extra.provedorPodeTerContinuado = true;
  if (RESUME_OUTCOMES.includes(ev.farol_resume_outcome)) extra.resumeOutcome = ev.farol_resume_outcome;
  return extra;
}

// Fecha a conta do registro nos dois eixos que a auditoria precisa: quanto virou
// resultado x quanto foi perdido, e quanto do total é medido, estimado ou desconhecido.
// PURA. Registro antigo não tem `costSource`, e conta como MEDIDO, que é o que ele era.
function auditoriaDeConsumo(sessions) {
  const zero = () => ({ sessions: 0, costUsd: 0 });
  const r = { total: zero(), util: zero(), perdido: zero(), medido: zero(), estimado: zero(), desconhecido: zero() };
  for (const s of sessions || []) {
    if (!s) continue;
    const custo = Number(s.costUsd) || 0;
    const soma = (b) => { b.sessions += 1; b.costUsd += custo; };
    soma(r.total);
    soma(DESFECHOS_PERDIDOS.has(s.status) ? r.perdido : r.util);
    soma(origemDoCusto(r, s));
  }
  return r;
}

// Quantas sessões DESTE perfil têm custo desconhecido, hoje e desde o corte. Lê o log de
// sessões porque o agregado não guarda a origem do custo. PURA.
function contarDesconhecidas(sessions, profileId, since, hoje) {
  const r = { hoje: 0, desde: 0 };
  if (!profileId) return r;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    if (!s || s.profileId !== profileId || !ORIGENS_DESCONHECIDAS.has(s.costSource)) continue;
    if (s.day === hoje) r.hoje += 1;
    if (!since || s.day >= since) r.desde += 1;
  }
  return r;
}

export default { DESFECHOS, DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS, origemDoCusto, camposDaTentativa, auditoriaDeConsumo, contarDesconhecidas };
export { DESFECHOS, DESFECHOS_PERDIDOS, ORIGENS_DESCONHECIDAS, origemDoCusto, camposDaTentativa, auditoriaDeConsumo, contarDesconhecidas };
