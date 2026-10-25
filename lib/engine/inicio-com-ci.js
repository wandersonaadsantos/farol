// A preferência de CI é reconferida na boca da sessão, inclusive nas retomadas.
import { aguardaChecksParaRevisar, avisaBloqueioChecks } from './checks-exigidos.js';

function recuperacao(engine, pr) {
  return engine.decisions?.pending?.find(d => d.key === pr.key
    && engine.accountForPr({ ...d.pr, key: d.key }) === engine.accountForPr(pr))?.esperaProva;
}

async function esperaCiNoInicio(engine, pr) {
  if (pr.manual || !aguardaChecksParaRevisar(engine)) return false;
  const checks = await engine.bloqueadoPorChecks(pr);
  if (checks.bloqueado) avisaBloqueioChecks(engine, pr, checks.faltando);
  return checks.bloqueado === true;
}

function registrarEsperaCi(engine, pr) {
  engine.unsee(pr.key);
  if (!engine.queue.some(p => p.key === pr.key && engine.accountForPr(p) === engine.accountForPr(pr))) engine.queue.push(pr);
  const marca = recuperacao(engine, pr);
  if (marca && !marca.aguardandoCi) {
    marca.aguardandoCi = true;
    // O agendador contou a rodada, mas nenhum executor chegou a iniciá-la.
    marca.tentativas = Math.max(0, (Number(marca.tentativas) || 0) - 1);
    engine.saveDecisions();
  }
}

function retomarAposCi(engine, pr) {
  const marca = recuperacao(engine, pr);
  if (!marca?.aguardandoCi) return;
  delete marca.aguardandoCi;
  marca.tentativas = (Number(marca.tentativas) || 0) + 1;
  engine.saveDecisions();
}

export { esperaCiNoInicio, registrarEsperaCi, retomarAposCi };
