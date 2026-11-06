// Decisão de gente no head enquanto o Farol concluía a análise (06/11/2026).
//
// Medido em biudtech/biud-frontend#1841: a pendência com `esperaProva` foi relançada no mesmo
// head (stale_head), a rodada relançada foi segurada pela aprovação de uma pessoa naquele head
// (bloqueiaAutomatico, skip-review.js) e a pendência ficou sete horas com o cartão "Recuperando a
// análise" até o merge: a recuperação não roda (o histórico segura) e nada a encerrava.
//
// Aqui, no molde da espera do CI (espera-ci.js, dispensar e consciencia): quando o lançamento
// automático de uma recuperação seria segurado por decisão de gente no MESMO head da espera, a
// pendência é resolvida sem postar e sem mesa (`approval_not_needed`, `skip`), com log INFO, um
// aviso e o recibo de coordenação publicado. Vale `hist.bloqueado`, não `hist.decidido`: com o
// meu pedido automático aberto (`pedidoMeuAberto`) a rodada roda para retirá-lo.
//
// Custo: a consulta ao histórico (as mesmas até 2 chamadas gh do bloqueadoPorHistorico) só
// acontece para PR com `esperaProva` naquele head, na boca do lançamento automático.
import { coordenacaoForaDoAr } from './postagem-arbitragem.js';
import { publicarRecibo } from './decision.js';

const curto = (sha) => String(sha || '').slice(0, 7) || '?';

function esperaDoHead(engine, pr) {
  const item = ((engine.decisions || {}).pending || []).find((d) => d && d.key === pr.key && d.esperaProva);
  if (!item) return null;
  const alvo = item.esperaProva.alvo || item.headSha || '';
  if (!alvo || (pr._headRound && pr._headRound !== alvo)) return null;
  return { item, alvo };
}

// O aviso do bloqueio por histórico (avisaBloqueioHistorico) usa a mesma chave PR@head: marcada
// aqui, um ciclo seguinte que mire o PR pelo outro gatilho não repete o aviso.
function marcarAvisado(engine, key, head) {
  if (!(engine.historicoAvisado instanceof Set)) engine.historicoAvisado = new Set();
  engine.historicoAvisado.add(`${key}@${head}`);
}

// true = a recuperação deste head foi resolvida (não enfileire); false = siga o caminho de sempre.
async function resolverSeGenteDecidiu(engine, pr) {
  const espera = esperaDoHead(engine, pr);
  if (!espera || coordenacaoForaDoAr(engine)) return false;
  const hist = await engine.bloqueadoPorHistorico(pr);
  if (!hist || !hist.bloqueado || hist.head !== espera.alvo) return false;
  const { item, alvo } = espera;
  const idx = engine.decisions.pending.findIndex((d) => d.id === item.id);
  if (idx < 0) return false;
  const nomes = (hist.quem || []).map((u) => `@${u}`).join(', ');
  const motivo = { text: `outra pessoa já decidiu este commit (${nomes}) enquanto eu concluía a análise: a revisão automática não é necessária, nada foi publicado`, kind: 'gate' };
  engine.decisions.pending.splice(idx, 1);
  const reasons = [motivo, ...(item.reasons || []).filter((r) => !(r && typeof r === 'object' && r.espera === true))];
  engine.resolveIntoHistory({ ...item, esperaProva: null, blockedKind: undefined, blockedHead: undefined, status: 'approval_not_needed', action: 'skip', reasons });
  engine.saveDecisions();
  await publicarRecibo(engine, item, alvo);
  engine.log('INFO', `${pr.key}: recuperação da análise resolvida sem postar, decisão de gente no head ${curto(alvo)} (${(hist.quem || []).join(', ')})`);
  marcarAvisado(engine, pr.key, alvo);
  engine.emit('toast', { kind: 'info', text: `${pr.key}: outra pessoa já decidiu este commit (${nomes}) enquanto eu concluía a análise; a revisão automática não é necessária.` });
  return true;
}

export default { resolverSeGenteDecidiu };
export { resolverSeGenteDecidiu };
