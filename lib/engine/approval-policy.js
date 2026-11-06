// Decide admissibilidade antes da preferência de publicação.
import { roundGap } from './review-findings.js';
import { inventoryGap, inventarioNoLimite, LIMITE_DE_ARQUIVOS_DO_GITHUB } from './pr-inventory.js';
import { isCiGap } from '../technical-review/evidence.js';
import { lacunasExigidas } from './busca-da-prova.js';
import { motivoDeEspera } from './gate-espera.js';
import { ehMeu, textoDoPrProprio } from './pr-proprio.js';
import { origemDoDono, analiseSustentaReprovacao, reprovacaoSoDeEstado } from './desfecho-automatico.js';
import { reviewCoherenceGap } from './review-consistency.js';
import { KIND as ENV_KIND } from '../review-source/env-changes.js';
import { caminhoProtegido } from '../review-source/contract.js';

const VEREDITOS_POSTAVEIS = ['approve', 'request_changes'];

function temTextoPublico(payload) {
  if (!payload) return false;
  return !!(String(payload.body || '').trim() || (Array.isArray(payload.comments) && payload.comments.length));
}

// Valor de arquivo de ambiente que a revisão não pôde ler. Decisão do dono (03/11/2026): sai sozinho
// quando o autor é Tech Lead; de quem não é, a mudança vai para a pessoa. O papel é o do cadastro local.
function arquivosDoDiff(result) {
  return Array.isArray(result?.inventarioDiff?.files) ? result.inventarioDiff.files : [];
}
function valoresOcultosDeAmbiente(result) {
  return arquivosDoDiff(result).filter(f => f?.representation?.kind === ENV_KIND && (f.representation.hiddenValues > 0 || f.representation.partial));
}
// Sem a projeção, a revisão não viu o arquivo protegido: isso segura para qualquer autor.
function arquivosProtegidosSemProjecao(result) {
  return arquivosDoDiff(result).filter(f => (caminhoProtegido(f?.path) || caminhoProtegido(f?.previousPath)) && f?.representation?.kind !== ENV_KIND);
}
function ambienteSegura(engine, pr, result) {
  const presos = valoresOcultosDeAmbiente(result);
  return presos.some(f => f.representation.partial) || (presos.length > 0 && !autorEhTechLead(engine, pr));
}
function autorEhTechLead(engine, pr) {
  const pessoa = engine.config?.people?.[String(pr?.author || '').toLowerCase()];
  return pessoa?.papel === 'techlead';
}

function shouldAutoApprove(engine, pr, result) {
  // PR da própria conta que revisa: o GitHub recusa a postagem do autor, nenhuma espera adianta
  if (VEREDITOS_POSTAVEIS.includes(result.verdict) && ehMeu(engine, pr)) return { ok: false, motivo: 'pr_proprio' };
  // Antes de tudo o que recupera: outra tentativa continuaria sem poder ler o arquivo.
  if (arquivosProtegidosSemProjecao(result).length) return { ok: false, motivo: 'protegido_sem_leitura' };
  // diff acima do limite do GitHub: outra tentativa nunca mede o diff inteiro (pr-inventory.js)
  if (inventarioNoLimite(result.inventarioDiff)) return { ok: false, motivo: 'inventario_no_limite' };
  if (result.analysisStatus !== 'complete') return { ok: false, motivo: 'analise_incompleta' };
  if (inventoryGap(result)) return { ok: false, motivo: 'inventario_incompleto' };
  if (roundGap(result, engine.config?.reviewRoundsMode, result.verdict)) return { ok: false, motivo: 'round_incompleto' };
  if (reviewCoherenceGap(result)) return { ok: false, motivo: 'review_inconsistent' };
  const approvable = result.verdict === 'approve' &&
    result.payloads && result.payloads.approve && result.payloads.approve.event === 'APPROVE';
  if (!approvable) return { ok: false, motivo: 'nao_aprovavel' };
  if (!temTextoPublico(result.payloads.approve)) return { ok: false, motivo: 'sem_texto' };
  // fila, clique, Panorama, admin, comando e distribuição são o dono agindo (18/10/2026);
  // só a origem sem marca nenhuma segue sem postar sozinha
  if (!origemDoDono(pr)) return { ok: false, motivo: 'origem_desconhecida' };
  const required = lacunasExigidas(result).filter(g => !isCiGap(g));
  if (required.length) return { ok: false, motivo: 'prova_tecnica_incompleta' };
  if (ambienteSegura(engine, pr, result)) return { ok: false, motivo: 'valor_oculto_de_ambiente' };
  const clean = engine.attentionPoints(result).length === 0;
  if (engine.approvePolicyFor(engine.accountForPr(pr), clean) !== 'approve') {
    return { ok: false, motivo: 'politica' };
  }
  const espera = motivoDeEspera(result) || (result.checksVerifiedHead !== result.headSha && 'ci_em_andamento');
  return espera ? { ok: false, motivo: espera } : { ok: true, motivo: null };
}

function shouldAutoReject(engine, pr, result) {
  if (reviewCoherenceGap(result)) return false;
  // declaração técnica desatualizada é configuração do aparelho: nunca sai reprovação automática
  // enquanto ela durar (a sessão pode ter lido as pastas ausentes como testes apagados)
  if (result.technicalReview?.failure === 'declaration') return false;
  if (!analiseSustentaReprovacao(result)) return false;
  // bloqueio só de estado do PR (CI, conflito, dependência, fora do diff) espera ou vai à mesa
  // (desfecho-da-revisao.js); o defeito que a avaliação técnica provou segue reprovando
  if (reprovacaoSoDeEstado(result)) return false;
  if (inventoryGap(result) || roundGap(result, engine.config?.reviewRoundsMode, 'request_changes')) return false;
  const rc = result.payloads && result.payloads.request_changes;
  const rejectable = result.verdict === 'request_changes' &&
    rc && rc.event === 'REQUEST_CHANGES' && temTextoPublico(rc);
  if (!rejectable || !origemDoDono(pr)) return false;   // a mesma régua de origem do approve
  if (ehMeu(engine, pr)) return false;   // o GitHub recusa REQUEST_CHANGES do autor
  return engine.rejectPolicyFor(engine.accountForPr(pr)) === 'request_changes';
}

// O texto do card para as recusas do gate que a sessão não explica sozinha. '' = nada a dizer
// (nao_aprovavel só é notícia quando a revisão concluiu aprovar).
const TEXTOS_DA_RECUSA = {
  review_inconsistent: () => 'o veredito, os achados e o texto público discordam; a análise será recuperada antes de publicar',
  round_incompleto: (e, _pr, r) => roundGap(r, e.config?.reviewRoundsMode),
  inventario_incompleto: (_e, _pr, r) => inventoryGap(r),
  analise_incompleta: () => 'a revisão não terminou a análise (o envelope voltou com status incompleto), então não posto sozinho',
  sem_texto: () => 'a revisão aprovou sem escrever nada (nem corpo, nem comentário de linha), e aprovação em branco não sai sozinha',
  nao_aprovavel: (_e, _pr, r) => (r.verdict === 'approve' ? 'a revisão concluiu aprovar, mas não devolveu o APPROVE pronto pra postar (envelope incompleto), então não posto sozinho' : ''),
  pr_proprio: (e, pr, r) => textoDoPrProprio(e.accountForPr(pr), r.verdict),
  inventario_no_limite: (_e, _pr, r) => `o PR tem ${Number(r.inventarioDiff.changedFiles)} arquivos alterados, acima dos ${LIMITE_DE_ARQUIVOS_DO_GITHUB} que o GitHub lista, então o diff não pode ser medido inteiro. Tentar de novo não muda isso: a decisão é sua.`,
  protegido_sem_leitura: (_e, _pr, r) => `arquivo protegido que a revisão não pôde ler (${arquivosProtegidosSemProjecao(r).map(f => f.path).join(', ')}). Tentar de novo não muda isso: a decisão é sua.`,
  bloqueio_de_estado: () => 'a reprovação se apoia só no estado do PR (CI, conflito, dependência ou arquivo fora do diff), não em defeito do código: espera, sem reprovar',
  valor_oculto_de_ambiente: (_e, _pr, r) => `arquivo de ambiente com valor que pode ser credencial e que a revisão não leu (${valoresOcultosDeAmbiente(r).map(f => f.path).join(', ')}); confira o valor e decida`,
};

function textoDaRecusa(engine, pr, motivo, result) {
  const texto = TEXTOS_DA_RECUSA[motivo];
  return texto ? texto(engine, pr, result) : '';
}

export { shouldAutoApprove, shouldAutoReject, textoDaRecusa, arquivosProtegidosSemProjecao };
