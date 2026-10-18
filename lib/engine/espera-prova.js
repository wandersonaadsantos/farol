// Recuperação durável da análise técnica. A marca esperaProva permanece no decisions.json
// até uma nova rodada produzir evidência suficiente e um desfecho permitido pela política.
// Duas tentativas são rápidas; as seguintes têm recuo crescente. Uma execução interrompida
// é reagendada, sem needs-decision. Cancelamento e impedimentos do ambiente são preservados.
// Commit novo continua no caminho stale_head; CI tem sua própria espera. O recibo remoto
// só é liberado sob as mesmas condições de posse e publicação de espera-prova-recibo.js.
import io from '../io.js';
import esperaCi from './espera-ci.js';
import { coordenacaoForaDoAr } from './postagem-arbitragem.js';
import { liberarReciboDaRodada } from './espera-prova-recibo.js';
import { TEMPOS } from '../constants.js';
import { approvalGaps, isCiGap, VERSAO_DAS_REGRAS } from '../technical-review/evidence.js';
import { largarSeForPrProprio, largarEsperasDePrProprio } from './espera-pr-proprio.js';
import { MAX_TENTATIVAS } from './busca-da-prova.js';
import { ehMeu } from './pr-proprio.js';
import { intervaloDaProva, pausaDaRecuperacao, rodadaEmCurso, registrarPausa, reagendarInterrupcao } from './recuperacao-prova.js';

const MOTIVO = 'prova_tecnica_incompleta';
const TETO_DE_LACUNAS = 8;
const TETO_DO_TEXTO = 300;
const DO_ENVELOPE = [
  /^a cobertura da leitura/, /^protocolo de revisão/, /^checkpoint de verificação/, /^divergência de veredito/,
  /^verificação de afirmações/, /^diff não medido/, /^commit revisado não confirmado/, /^análise incompleta/,
  /avaliação técnica/, /^aplicabilidade técnica/, /^regras técnicas/, /^histórico de objeções/,
  /^declaração técnica/, /^prova necessária à aprovação/,
];

const curto = (sha) => String(sha || '').slice(0, 7) || '?';
const doEnvelope = (g) => DO_ENVELOPE.some((re) => re.test(g));

function lacunasDe(result) {
  const lista = Array.isArray(result.approvalEvidence) ? result.approvalEvidence : approvalGaps(result);
  return lista.filter((g) => typeof g === 'string' && g.trim() && !isCiGap(g));
}

function semMotivoDaEspera(reasons) {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => !(r && typeof r === 'object' && r.espera === true));
}

// Contagem cumulativa por commit, para o card e o diagnóstico.
const proximaTentativa = marca => (Number(marca.tentativas) || 0) + 1;

// O motivo que o card mostra enquanto busca. `espera: true` deixa a varredura trocar ou tirar
// esta linha sem farejar o texto, como na espera do CI.
function motivoDaEspera(marca) {
  return {
    text: `análise técnica pendente; concluo a revisão sozinho neste commit (tentativa ${proximaTentativa(marca)}), sem precisar de uma decisão sua`,
    kind: 'gate', espera: true,
  };
}

// A revisão relançada no mesmo head herda a marca da anterior: é o que conta as tentativas.
function marcaAnterior(engine, key, head) {
  const d = ((engine.decisions || {}).pending || []).find((x) => x && x.key === key && x.esperaProva
    && (x.esperaProva.alvo || x.headSha || '') === (head || ''));
  return d ? d.esperaProva : null;
}

function avisarDaEspera(engine, pr, marca) {
  engine.emit('toast', { kind: 'info', text: `⏳ ${pr.key}: análise técnica pendente; a recuperação continua automaticamente (tentativa ${proximaTentativa(marca)}).` });
}

// O que o runHeadlessReview grava quando o gate devolve prova_tecnica_incompleta; qualquer
// outro caso devolve null e o resultado segue o caminho de antes. Tentativas não dispensam prova.
function armar(engine, pr, motivo, result, pontos) {
  const falhaTecnica = result?.technicalReview?.verdict === 'not-run';
  const recuperavel = [MOTIVO, 'analise_incompleta', 'sem_texto'].includes(motivo) || result?.technicalRecheck
    || (motivo === 'nao_aprovavel' && (falhaTecnica || result?.verdict === 'approve'));
  if (!recuperavel || (!result?.headSha && !pr.url) || pr.requested !== true || ehMeu(engine, pr)) return null;
  const lacunas = lacunasDe(result);
  if (!lacunas.length && result.technicalRecheck) lacunas.push('avaliação técnica requer reconferência');
  if (!lacunas.length && ['sem_texto', 'nao_aprovavel'].includes(motivo)) lacunas.push('envelope de publicação incompleto');
  if (!lacunas.length) return null;
  const limpo = !(Array.isArray(pontos) && pontos.length);
  const ant = marcaAnterior(engine, pr.key, result.headSha) || {};
  const tentativas = Number(ant.tentativas) || 0;
  const marca = {
    desde: Number(ant.desde) || Date.now(),
    limpo,
    lacunas: lacunas.slice(0, TETO_DE_LACUNAS).map((g) => g.slice(0, TETO_DO_TEXTO)),
    soEnvelope: lacunas.every(doEnvelope),
    tentativas,
    interrupcoes: Number(ant.interrupcoes) || 0,
    proximaEm: Date.now() + intervaloDaProva(tentativas + 1, Number(ant.interrupcoes) || 0),
    regras: VERSAO_DAS_REGRAS,
    // quando a sessão começou a ler o PR (diagnóstico de quanto a busca levou)
    leituraDesde: Date.now() - (Number(result.stages && result.stages.totalMs) || 0),
  };
  return {
    extra: { esperaProva: marca },
    reasons: [motivoDaEspera(marca), ...semMotivoDaEspera(result.reasons)],
    avisar: (eng, p) => avisarDaEspera(eng, p, marca),
  };
}

// O funil único das esperas para o runHeadlessReview: CI primeiro, depois a prova.
function armarEspera(engine, pr, motivo, result, pontos) {
  const ci = esperaCi.armar(motivo, result, pontos);
  if (ci) return { ...ci, avisar: esperaCi.avisarDaEspera };
  return armar(engine, pr, motivo, result, pontos);
}

// A leitura única do PR no ciclo. null = não deu para provar nada, e quem chama espera.
async function lerPr(engine, item) {
  const pr = { ...item.pr, key: item.key };
  const conta = engine.accountForPr(pr);
  if (!pr.url || !engine.tokenFor(conta)) return null;
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'state,headRefOid,author'], { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  const j = io.parseJson(r.stdout, null);
  if (!j || !j.state || !j.headRefOid) return null;
  return { estado: String(j.state), head: String(j.headRefOid), autor: String((j.author && j.author.login) || '') };
}

function indiceDe(engine, item) {
  return engine.decisions.pending.findIndex((d) => d.id === item.id);
}

// Commit novo: o mesmo desfecho da espera do CI, a re-revisão do head novo é do round de sempre.
function largarPorCommitNovo(engine, item, head) {
  const idx = indiceDe(engine, item);
  if (idx < 0) return 0;
  const d = engine.decisions.pending[idx];
  d.esperaProva = null;
  d.blockedKind = 'stale_head';
  d.blockedHead = head;
  d.headQuietoDesde = Date.now();
  d.reasons = [{ text: `chegou commit novo enquanto eu buscava a prova técnica (${curto(item.headSha)} -> ${curto(head)}): reviso de novo sozinho, este texto fala do código anterior`, kind: 'gate' },
    ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: head andou de ${curto(item.headSha)} pra ${curto(head)} na busca da prova; marcada stale_head.`);
  engine.emit('toast', { kind: 'info', text: `↻ ${item.key}: chegou commit novo enquanto eu buscava a prova, então reviso de novo sozinho; o card mostra quando.` });
  return 1;
}

// A âncora do round guarda o head já relançado; no MESMO head ela seguraria o gatilho B. Só o
// head é liberado, no molde do destrave (destrava.js, soltaPresa).
function liberarAncora(engine, key) {
  const ancora = (engine.reReviewLaunched || {})[key];
  if (ancora === undefined) return;
  if (ancora && typeof ancora === 'object') engine.reReviewLaunched[key] = { ...ancora, head: '' };
  else delete engine.reReviewLaunched[key];
  engine.saveReReviewLaunched();
}

// O recibo de coordenação da primeira revisão barraria a rodada no mesmo head
// (espera-prova-recibo.js); sem conseguir liberá-lo, a espera continua e nada é gravado.
async function relancar(engine, item, tentativas, causa, alvo = item.headSha) {
  if (!(await liberarReciboDaRodada(engine, { ...item, headSha: alvo }))) return 0;
  const idx = indiceDe(engine, item);
  if (idx < 0) return 0;
  const d = engine.decisions.pending[idx];
  if (engine.autoReviewParked?.has(item.key)) {
    engine.autoReviewParked.delete(item.key);
    if (engine.parkedMotivos) delete engine.parkedMotivos[item.key];
    engine.saveAutoReviewParked();
  }
  // a revisão relançada aplica as regras vigentes: o carimbo novo impede relançar de novo por elas
  d.esperaProva = { ...d.esperaProva, tentativas, regras: VERSAO_DAS_REGRAS, alvo };
  d.blockedKind = 'stale_head';
  d.blockedHead = alvo;
  d.technicalRecheck = false;
  d.reasons = [{ text: `${causa}: reviso de novo sozinho neste commit para concluir a análise técnica (tentativa ${tentativas || 1})`, kind: 'gate', espera: true },
    ...semMotivoDaEspera(d.reasons)];
  liberarAncora(engine, item.key);
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: busca da prova relançada no head ${curto(alvo)} (${causa}, tentativa ${tentativas}).`);
  return 1;
}

// Detecta rodada órfã sem concorrer com fila, sessão ou retry já existentes.
function rodadaParada(engine, item) {
  if (engine.autoReviewParked && engine.autoReviewParked.has(item.key)) return 'estacionou';
  const a = (engine.reReviewLaunched || {})[item.key];
  const ancora = a && typeof a === 'object' ? a : { head: String(a || ''), at: 0 };
  if (ancora.head !== (item.esperaProva.alvo || item.headSha) || Date.now() - (Number(ancora.at) || 0) < TEMPOS.HEAD_QUIETO_MS) return '';
  const naFila = (engine.headlessQueue || []).some((p) => p.key === item.key)
    || [...(engine.activeReviews || new Map()).values()].some((s) => (s.keys || []).includes(item.key));
  if (naFila || (engine.retryAfterNet && engine.retryAfterNet.has(item.key))) return '';
  return 'saiu e não concluiu';
}

async function umaEspera(engine, item) {
  if (largarSeForPrProprio(engine, item)) return 1;
  const pausa = await pausaDaRecuperacao(engine, item);
  registrarPausa(engine, item, pausa);
  if (pausa || rodadaEmCurso(engine, item.key)) return 0;
  if (item.blockedKind === 'stale_head') {
    const como = item.blockedHead === (item.esperaProva.alvo || item.headSha) ? rodadaParada(engine, item) : '';
    return como ? reagendarInterrupcao(engine, item) : 0;
  }
  const lido = await lerPr(engine, item);
  if (!lido || lido.estado !== 'OPEN') return 0;
  if (largarSeForPrProprio(engine, item, lido.autor)) return 1;
  if (item.headSha && lido.head !== item.headSha) return largarPorCommitNovo(engine, item, lido.head);
  const tentativas = Number(item.esperaProva.tentativas) || 0;
  if (!(Number(item.esperaProva.regras) >= VERSAO_DAS_REGRAS)) return relancar(engine, item, tentativas, 'as regras do gate mudaram desde que esta espera começou', lido.head);
  if (Date.now() < (Number(item.esperaProva.proximaEm) || 0)) return 0;
  return relancar(engine, item, tentativas + 1, 'faltou concluir a análise técnica deste commit', lido.head);
}

// Decisões gravadas antes da recuperação durável voltam ao mesmo funil, sem postar.
function recuperarPendenciasAntigas(engine) {
  let mudou = false;
  for (const item of engine.decisions.pending) {
    if (item.esperaProva || item.esperaCi || item.postRetry || item.prProprio) continue;
    const gaps = lacunasDe(item);
    if (!item.technicalRecheck && item.analysisStatus !== 'incomplete' && !(item.verdict === 'approve' && gaps.length)
      && item.technicalReview?.verdict !== 'not-run') continue;
    const pr = { ...item.pr, key: item.key };
    const motivo = item.analysisStatus === 'incomplete' ? 'analise_incompleta' : MOTIVO;
    const espera = armar(engine, pr, motivo, item, engine.attentionPoints(item));
    if (!espera) continue;
    Object.assign(item, espera.extra);
    item.reasons = espera.reasons;
    // O agendador único passa a cuidar também da reconferência na publicação.
    item.technicalRecheck = false;
    if (item.blockedKind === 'technical_recheck') delete item.blockedKind;
    mudou = true;
  }
  if (mudou) engine.saveDecisions();
}

// A varredura do ciclo. Devolve quantas buscas foram relançadas ou largadas.
async function reverQuandoAProvaMudar(engine) {
  if (coordenacaoForaDoAr(engine)) return 0;
  recuperarPendenciasAntigas(engine);
  const esperando = engine.decisions.pending.filter((d) => d && d.esperaProva);
  let andaram = 0;
  for (const item of esperando) {
    try { andaram += await umaEspera(engine, item); }
    catch (err) { engine.log('WARN', `busca da prova ${item.key}: ${err.message}`); }
  }
  return andaram;
}

// As duas esperas automáticas do ciclo, sob a mesma guarda de coordenação. Devolve quantas
// andaram (PR próprio largado, CI resolvido e prova relançada ou largada).
async function varrerEsperas(engine) {
  if (coordenacaoForaDoAr(engine)) return 0;
  let andaram = largarEsperasDePrProprio(engine);
  try { andaram += await esperaCi.aprovarQuandoOCiFechar(engine); }
  catch (err) { engine.log('WARN', `espera do CI: ${err.message}`); }
  try { andaram += await reverQuandoAProvaMudar(engine); }
  catch (err) { engine.log('WARN', `busca da prova: ${err.message}`); }
  return andaram;
}

export default { MAX_TENTATIVAS, armar, armarEspera, reverQuandoAProvaMudar, varrerEsperas };
export { MAX_TENTATIVAS, armar, armarEspera, reverQuandoAProvaMudar, varrerEsperas };
