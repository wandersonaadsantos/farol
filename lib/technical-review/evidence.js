import { coverageGap } from '../engine/file-proof.js';
import { checkpointGap } from '../engine/ressalvas.js';
import { dependenciasAbertas, motivoDeEspera } from '../engine/gate-espera.js';
import { evidenceGap } from './verdict.js';

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
  if (dependenciasAbertas(result).length) gaps.push('dependência necessária ainda aberta: ' + dependenciasAbertas(result).join('; '));
  if (result.cardMet === false || (result.card && result.cardMet !== true)) gaps.push('critérios necessários do card não comprovados');
  const protocol = result.protocolo || {};
  if (protocol.prReviewer !== 'rodou' && !(protocol.prReviewer === 'dispensado' && String(protocol.motivo || '').trim())) gaps.push('protocolo de revisão não comprovado');
  return gaps;
}

export { isCiGap } from './verdict.js';
export { approvalGaps };
