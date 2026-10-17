import { coverageGap } from '../engine/file-proof.js';
import { checkpointGap } from '../engine/ressalvas.js';
import { motivoDeEspera } from '../engine/gate-espera.js';
import { evidenceGap } from './verdict.js';

const GAP_DA_PARTE_DO_CARD = 'a parte do card que cabe a este PR não foi comprovada';

function approvalGaps(result) {
  const missing = coverageGap(result);
  const gaps = [...checkpointGap(result)];
  if (result.analysisStatus !== 'complete') gaps.push('análise incompleta');
  if (missing.length) gaps.push(`a cobertura da leitura tem ${missing.length} pendência(s): ${missing.slice(0, 5).join(', ')}`);
  const technical = evidenceGap(result);
  if (technical) gaps.push(technical);
  if (!result.headSha) gaps.push('commit revisado não confirmado');
  if (!result.verificationCheckpoint) gaps.push('verificação de afirmações ausente');
  if (!result.diffMedido) gaps.push('diff não medido independentemente');
  if (result.checksVerifiedHead !== result.headSha) gaps.push('checks não conferidos no commit revisado');
  const ci = motivoDeEspera(result);
  if (ci) gaps.push(ci);
  // Card e dependência (17/10/2026, decisão do dono): o card inteiro não provado e a
  // dependência em aberto são RESSALVA (lib/engine/ressalvas.js), e a política da conta decide.
  // Card BIUD é multi-repo, e a dependência aberta costuma ser o PR irmão do mesmo card, também
  // esperando aprovação: como lacuna obrigatória (PR #244) um esperava o outro para sempre. Só
  // bloqueia a sessão dizendo que a parte do card que cabe a ESTE PR não foi entregue.
  if (result.cardParteDestePr === false) gaps.push(GAP_DA_PARTE_DO_CARD);
  const protocol = result.protocolo || {};
  if (protocol.prReviewer !== 'rodou' && !(protocol.prReviewer === 'dispensado' && String(protocol.motivo || '').trim())) gaps.push('protocolo de revisão não comprovado');
  return gaps;
}

export { isCiGap } from './verdict.js';
export { approvalGaps };
