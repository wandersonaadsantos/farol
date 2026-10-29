// Agenda durável da recuperação: duas rodadas rápidas, depois recuo até seis horas.
// O teto limita a frequência, nunca dispensa prova nem transfere uma decisão impossível.
import { MAX_TENTATIVAS } from './busca-da-prova.js';
import { classify } from '../log-taxonomy.js';
import { profileFor } from '../technical-review/profiles.js';
import { VERSAO_DA_CONFERENCIA } from '../technical-review/declaracao.js';
import { technicalRuntime } from '../technical-review/runtime.js';

const MINUTO = 60_000;
const MAX_INTERVALO = 6 * 60 * MINUTO;
const VERSAO_DA_RECUPERACAO = 2;

function intervaloDaProva(tentativas, interrupcoes = 0) {
  const recuos = Math.max(0, tentativas - MAX_TENTATIVAS, interrupcoes);
  return recuos ? Math.min(MAX_INTERVALO, 15 * MINUTO * 2 ** Math.min(recuos - 1, 5)) : 0;
}

async function pausaDaRecuperacao(engine, item) {
  const conta = engine.accountForPr({ ...item.pr, key: item.key });
  if (!engine.autoReviewFor(conta)) return 'Revisão automática desativada nesta conta. Retomo quando ela for ativada.';
  if (engine.isMuted(conta)) return 'Conta silenciada. Retomo quando ela voltar a ser monitorada.';
  if (!engine.tokenFor(conta)) return 'Login do GitHub indisponível. Retomo após restabelecer o login.';
  if (item.technicalReview?.failure === 'profile' && !profileFor(item.pr?.repo || item.key.split('#')[0])) {
    return 'Configuração dos critérios técnicos do repositório ausente ou ilegível. Retomo após corrigir essa configuração; aprovar manualmente não resolve.';
  }
  // Declaração que cita pasta inexistente: refazer a busca daria o mesmo erro. Retoma quando a
  // declaração do repositório mudar (impressão diferente da que falhou).
  // só pausa pela falha da conferência atual; falha gravada por versão anterior volta a ser conferida
  if (item.technicalReview?.failure === 'declaration' && item.technicalReview.declarationProfile
    && item.technicalReview.declarationCheck === VERSAO_DA_CONFERENCIA
    && profileFor(item.pr?.repo || item.key.split('#')[0])?.fingerprint === item.technicalReview.declarationProfile) {
    return 'A declaração técnica do repositório cita pasta que não existe mais no código. Retomo quando ela for corrigida neste aparelho; aprovar manualmente não resolve.';
  }
  if (item.technicalReview?.failure === 'tool') {
    try { await technicalRuntime.requireTool(); }
    catch { return 'Ferramenta de verificação técnica indisponível. Retomo após restabelecer a ferramenta neste aparelho; aprovar manualmente não resolve.'; }
  }
  if (!engine.autoReviewParked?.has(item.key)) return '';
  const parada = engine.parkedMotivos?.[item.key];
  if (parada?.tipo === 'cancelado') return 'Revisão cancelada por você. A recuperação só continua se você iniciar outra revisão.';
  if (parada?.tipo === 'orcamento') {
    return engine.budgetBlockedFor(conta) ? 'Orçamento de revisões atingido. Retomo quando houver orçamento disponível.' : '';
  }
  const classe = classify(parada?.motivo || '');
  if (classe.kind === 'permanente') return `${classe.label}. ${classe.acao}`;
  return '';
}

function rodadaEmCurso(engine, key) {
  return (engine.headlessQueue || []).some(p => p.key === key)
    || [...(engine.activeReviews || new Map()).values()].some(s => (s.keys || []).includes(key))
    || engine.retryAfterNet?.has(key);
}

function registrarPausa(engine, item, impedimento) {
  if ((item.esperaProva.impedimento || '') === impedimento) return;
  item.esperaProva.impedimento = impedimento;
  engine.saveDecisions();
}

function prepararRecuperacaoDaPublicacao(result, autoDec, post) {
  result.technicalRecheck = post.needsReview === true;
  if (post.waitForCi) autoDec.motivo = 'ci_em_andamento';
  else if (post.blocked === 'technical_review') {
    autoDec.motivo = 'prova_tecnica_incompleta';
    result.approvalEvidence = [...(result.approvalEvidence || []), post.error];
  }
  return !post.waitForCi && post.blocked !== 'technical_review';
}

function reagendarInterrupcao(engine, item) {
  const marca = item.esperaProva;
  marca.interrupcoes = (Number(marca.interrupcoes) || 0) + 1;
  marca.proximaEm = Date.now() + intervaloDaProva(Number(marca.tentativas) || 0, marca.interrupcoes);
  delete item.blockedKind;
  delete item.blockedHead;
  item.reasons = [{ text: 'A execução anterior não concluiu. O Farol retomará a análise automaticamente após o intervalo de recuperação; nada foi publicado.', kind: 'gate', espera: true },
    ...(item.reasons || []).filter(r => !r?.espera)];
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: recuperação da prova reagendada após execução interrompida.`);
  return 1;
}

export { VERSAO_DA_RECUPERACAO, intervaloDaProva, pausaDaRecuperacao, rodadaEmCurso, registrarPausa, reagendarInterrupcao, prepararRecuperacaoDaPublicacao };
