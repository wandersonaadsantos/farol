// A preferência de CI é reconferida na boca da sessão, inclusive nas retomadas.
import { aguardaChecksParaRevisar, avisaBloqueioChecks } from './checks-exigidos.js';

function decisaoDaRecuperacao(engine, pr) {
  return engine.decisions?.pending?.find(d => d.key === pr.key
    && engine.accountForPr({ ...d.pr, key: d.key }) === engine.accountForPr(pr));
}

async function esperaCiNoInicio(engine, pr, devolver = false) {
  if (pr.manual || !aguardaChecksParaRevisar(engine)) return false;
  const decisao = decisaoDaRecuperacao(engine, pr);
  const checks = await engine.bloqueadoPorChecks(pr);
  if (checks.bloqueado) avisaBloqueioChecks(engine, pr, checks.faltando);
  if (checks.bloqueado && devolver) registrarEsperaCi(engine, pr, decisao);
  return checks.bloqueado === true;
}

function registrarEsperaCi(engine, pr, decisao) {
  engine.unsee(pr.key);
  if (!engine.queue.some(p => p.key === pr.key && engine.accountForPr(p) === engine.accountForPr(pr))) engine.queue.push(pr);
  const marca = decisao?.esperaProva;
  const alvo = pr.knownHead || pr.headSha || pr._headRound;
  if (marca && decisao.blockedKind === 'stale_head' && !marca.aguardandoCi && alvo && alvo === (marca.alvo || decisao.headSha)
    && decisaoDaRecuperacao(engine, pr) === decisao) {
    marca.aguardandoCi = true;
    // O agendador contou a rodada, mas nenhum executor chegou a iniciá-la.
    marca.tentativas = Math.max(0, (Number(marca.tentativas) || 0) - 1);
    // A rodada não começou: o agendador durável volta a ser dono da espera.
    // stale_head com âncora antiga pareceria uma execução órfã após o intervalo.
    delete decisao.blockedKind;
    delete decisao.blockedHead;
    engine.saveDecisions();
  }
}

function retomarAposCi(engine, pr) {
  const decisao = decisaoDaRecuperacao(engine, pr);
  const marca = decisao?.esperaProva;
  const alvo = pr.knownHead || pr.headSha || pr._headRound;
  if (!marca?.aguardandoCi || !alvo || alvo !== (marca.alvo || decisao.headSha)) return;
  delete marca.aguardandoCi;
  marca.tentativas = (Number(marca.tentativas) || 0) + 1;
  engine.saveDecisions();
}

export { esperaCiNoInicio, retomarAposCi };
