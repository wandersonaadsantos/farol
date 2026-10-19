// A aprovação que BUSCA a prova técnica sozinha (17/10/2026).
//
// Caso medido: biudtech/biud-frontend#1465 (head 1f18057), conta em "aprova sozinho". A
// revisão concluiu aprovar, `shouldAutoApprove` devolveu `prova_tecnica_incompleta` e o
// resultado foi para "Precisa de você", esperando um clique. Regra do dono: com a aprovação
// automática configurada, o desfecho nunca depende de ação humana.
//
// A v2.72.3 trocou o clique por esperar o PR mudar (commit novo, review novo, dependência
// resolvida), e o desfecho continuou dependendo de alguém de fora. Decisão do dono na v2.72.6:
// "o Farol não pode esperar uma ação externa; o próprio Farol precisa ir atrás das provas e
// não exigir mais provas". Então, no molde da espera do CI (espera-ci.js):
//   - o runHeadlessReview grava a pendência com a marca `esperaProva` (`{ desde, limpo,
//     lacunas, soEnvelope, tentativas, regras, leituraDesde }`, durável no decisions.json), o
//     toast diz que o app busca a prova sozinho e NÃO sai o `needs-decision`;
//   - no ciclo seguinte do check(), junto da espera do CI e sob a mesma guarda de coordenação,
//     `reverQuandoAProvaMudar` faz UMA leitura `gh` do PR (estado, head e autor) e relança NA
//     HORA uma revisão complementar do MESMO head: marca `stale_head` no head lido, libera a
//     âncora do round e o recibo da rodada (espera-prova-recibo.js), e o round sai sem o
//     relógio de PR quieto (review.js, relogioDoRound). O prompt dessa rodada lista o que
//     faltou (busca-da-prova.js, blocoDaTentativa), e o que o engine mede (diff, checks) é
//     medido de novo por ela;
//   - no máximo MAX_TENTATIVAS rodadas próprias por head (`tentativas`, herdado pela revisão
//     relançada porque o head é o mesmo). A que nasce com o contador cheio é a última: nela a
//     lacuna que não é dura vira ressalva e a política da conta decide (busca-da-prova.js).
//     Sobrou lacuna dura nela, a pendência vai para a mesa, e só então sai `needs-decision`;
//   - PR fechado ou mergeado: é do reconcilePending, que roda antes;
//   - head diferente: larga a espera e carimba `stale_head`, o caminho de sempre do commit
//     novo (reReviewTargets, gatilho B);
//   - regra nova: a marca carrega a versão das regras do gate (`regras`, VERSAO_DAS_REGRAS em
//     evidence.js). Marca sem carimbo ou anterior relança sem gastar tentativa, e sai carimbada
//     (biud-messaging-waba#52 no celular mostrava lacunas de regras que já tinham saído);
//   - PR da própria conta que revisa (biud-frontend#1479): o GitHub não aceita a revisão do
//     autor, então a espera sai e a revisão vira COMMENT, ou mesa com a conta esperando você
//     (espera-pr-proprio.js);
//   - resultado incompleto da sessão (18/10/2026, desfecho-automatico.js, lacunaDoEnvelope):
//     entra com a marca `envelope` e relança do mesmo jeito, no máximo MAX_TENTATIVAS vezes.
//
// O invariante 4 continua: com lacuna exigida nada é postado. Esgotadas as duas tentativas, a
// lacuna que não é dura vira ressalva e a política da conta decide (decisão do dono de
// 18/10/2026, que supera o PR #250 da v2.72.8).
//
// Fica de fora: violação técnica confirmada ou achado técnico não resolvido (pedem mudança no
// código: com a conta reprovando sozinha, o desfecho já pediu mudanças; sem ela, mesa),
// reconferência técnica (`technicalRecheck`, que tem caminho próprio), resultado sem head
// lido e conta cuja política não aprovaria.
import io from '../io.js';
import contasConfig from './contas-config.js';
import esperaCi from './espera-ci.js';
import { coordenacaoForaDoAr } from './postagem-arbitragem.js';
import { liberarReciboDaRodada } from './espera-prova-recibo.js';
import { TEMPOS } from '../constants.js';
import { approvalGaps, isCiGap, VERSAO_DAS_REGRAS } from '../technical-review/evidence.js';
import { largarSeForPrProprio, largarEsperasDePrProprio } from './espera-pr-proprio.js';
import { MAX_TENTATIVAS } from './busca-da-prova.js';
import { origemDoDono, lacunaDoEnvelope } from './desfecho-automatico.js';

const MOTIVO = 'prova_tecnica_incompleta';
const TETO_DE_LACUNAS = 8;
const TETO_DO_TEXTO = 300;
const IMPEDEM = ['violação técnica confirmada', 'achados técnicos não resolvidos'];
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

// A tentativa que vem a seguir (1 ou 2), para o card e o toast.
const proximaTentativa = (marca) => Math.min((Number(marca.tentativas) || 0) + 1, MAX_TENTATIVAS);

// O motivo que o card mostra enquanto busca. `espera: true` deixa a varredura trocar ou tirar
// esta linha sem farejar o texto, como na espera do CI.
function motivoDaEspera(marca) {
  const lacuna = marca.lacunas[0] || 'prova técnica';
  if (marca.envelope) {
    return { text: `a revisão voltou incompleta (${lacuna}); reviso de novo sozinho neste commit (tentativa ${proximaTentativa(marca)} de ${MAX_TENTATIVAS}), sem precisar de você`, kind: 'gate', espera: true };
  }
  return {
    text: `aprovável, mas faltou prova técnica (${lacuna}); busco a prova sozinho neste commit (tentativa ${proximaTentativa(marca)} de ${MAX_TENTATIVAS}), sem precisar de você`,
    kind: 'gate', espera: true,
  };
}

// A revisão relançada no mesmo head herda a marca da anterior: é o que conta as tentativas.
function marcaAnterior(engine, key, head) {
  const d = ((engine.decisions || {}).pending || []).find((x) => x && x.key === key && x.esperaProva && x.headSha === head);
  return d ? d.esperaProva : null;
}

// A conta sai sozinha em alguma classe (aprova limpo ou reprova)? É a régua do resultado incompleto,
// que ainda não tem classe: sem nenhuma das duas, a conta escolheu decidir, e a pendência é dela.
function saiSozinhaEmAlgumaClasse(engine, conta) {
  return engine.approvePolicyFor(conta, true) === 'approve' || engine.rejectPolicyFor(conta) === 'request_changes';
}

function avisarDaEspera(engine, pr, marca) {
  if (marca.envelope) {
    engine.emit('toast', { kind: 'info', text: `⏳ ${pr.key}: a revisão voltou incompleta (${marca.lacunas[0]}); reviso de novo sozinho (tentativa ${proximaTentativa(marca)} de ${MAX_TENTATIVAS})` });
    return;
  }
  engine.emit('toast', { kind: 'info', text: `⏳ ${pr.key}: aprovável, faltou prova (${marca.lacunas[0] || 'prova técnica'}); busco a prova sozinho (tentativa ${proximaTentativa(marca)} de ${MAX_TENTATIVAS})` });
}

// O que o runHeadlessReview grava quando o gate devolve prova_tecnica_incompleta; qualquer
// outro caso devolve null e o resultado segue o caminho de antes. Com as tentativas gastas
// neste head, a lacuna que sobrou é dura (a outra já virou ressalva), e o caminho é a mesa.
// Resultado incompleto da sessão (desfecho-automatico.js, lacunaDoEnvelope) entra pelo mesmo
// caminho desde 18/10/2026, com a marca `envelope`: relança no mesmo commit quando a conta sai
// sozinha em alguma classe e a revisão veio do dono, no máximo MAX_TENTATIVAS vezes.
function armar(engine, pr, motivo, result, pontos) {
  if (!result || result.technicalRecheck || !result.headSha) return null;
  const envelope = lacunaDoEnvelope(motivo, result);
  if (motivo !== MOTIVO && !envelope) return null;
  const lacunas = envelope ? [envelope] : lacunasDe(result);
  if (!lacunas.length || (!envelope && lacunas.some((g) => IMPEDEM.includes(g)))) return null;
  const limpo = !(Array.isArray(pontos) && pontos.length);
  const conta = engine.accountForPr(pr);
  const automatica = envelope ? origemDoDono(pr) && saiSozinhaEmAlgumaClasse(engine, conta) : engine.approvePolicyFor(conta, limpo) === 'approve';
  if (!automatica) return null;
  const ant = marcaAnterior(engine, pr.key, result.headSha) || {};
  const tentativas = Number(ant.tentativas) || 0;
  if (tentativas >= MAX_TENTATIVAS) return null;
  const marca = {
    desde: Number(ant.desde) || Date.now(),
    limpo,
    lacunas: lacunas.slice(0, TETO_DE_LACUNAS).map((g) => g.slice(0, TETO_DO_TEXTO)),
    soEnvelope: lacunas.every(doEnvelope),
    tentativas,
    regras: VERSAO_DAS_REGRAS,
    // quando a sessão começou a ler o PR (diagnóstico de quanto a busca levou)
    leituraDesde: Date.now() - (Number(result.stages && result.stages.totalMs) || 0),
  };
  if (envelope) Object.assign(marca, { envelope: true, limpo: true, soEnvelope: true });
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
async function relancar(engine, item, tentativas, causa) {
  if (!(await liberarReciboDaRodada(engine, item))) return 0;
  const idx = indiceDe(engine, item);
  if (idx < 0) return 0;
  const d = engine.decisions.pending[idx];
  // a revisão relançada aplica as regras vigentes: o carimbo novo impede relançar de novo por elas
  d.esperaProva = { ...d.esperaProva, tentativas, regras: VERSAO_DAS_REGRAS };
  d.blockedKind = 'stale_head';
  d.blockedHead = d.headSha;
  d.reasons = [{ text: `${causa}: reviso de novo sozinho neste commit para buscar a prova técnica (tentativa ${tentativas || 1} de ${MAX_TENTATIVAS})`, kind: 'gate', espera: true },
    ...semMotivoDaEspera(d.reasons)];
  liberarAncora(engine, item.key);
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: busca da prova relançada no head ${curto(d.headSha)} (${causa}, tentativa ${tentativas}).`);
  return 1;
}

// A política da conta pode ter mudado durante a busca: aí o resultado é seu, como no CI.
function politicaAindaAprova(engine, item) {
  const conta = engine.accountForPr({ ...item.pr, key: item.key });
  const limpo = item.esperaProva.limpo !== false;
  if (item.esperaProva.envelope ? saiSozinhaEmAlgumaClasse(engine, conta) : engine.approvePolicyFor(conta, limpo) === 'approve') return true;
  const idx = indiceDe(engine, item);
  if (idx < 0) return false;
  const d = engine.decisions.pending[idx];
  d.esperaProva = null;
  d.reasons = [{ text: contasConfig.motivoDaPolitica(engine, conta, limpo), kind: 'gate' }, ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  const publico = engine.decisionForUi(d);
  engine.emit('needs-decision', { pr: { ...d.pr, key: d.key }, item: publico });
  engine.emit('toast', { kind: 'info', text: `🟡 ${d.key} precisa da sua atenção: ${((publico.reasons || [])[0] || {}).text || 'ver relatório'}` });
  return false;
}

// Rodada relançada no mesmo head que estacionou (cancelada, falha permanente, autenticação)
// ou que saiu e não concluiu (âncora queimada, fora da fila e sem retry há mais que a janela
// de PR quieto): nada mais a relança sozinho, então a marca sai e o card vai para a mesa,
// como commit novo, com o motivo do round parado e o Revisar agora.
function rodadaParada(engine, item) {
  if (engine.autoReviewParked && engine.autoReviewParked.has(item.key)) return 'estacionou';
  const a = (engine.reReviewLaunched || {})[item.key];
  const ancora = a && typeof a === 'object' ? a : { head: String(a || ''), at: 0 };
  if (ancora.head !== item.headSha || Date.now() - (Number(ancora.at) || 0) < TEMPOS.HEAD_QUIETO_MS) return '';
  const naFila = (engine.headlessQueue || []).some((p) => p.key === item.key)
    || [...(engine.activeReviews || new Map()).values()].some((s) => (s.keys || []).includes(item.key));
  if (naFila || (engine.retryAfterNet && engine.retryAfterNet.has(item.key))) return '';
  return 'saiu e não concluiu';
}

function largarRodadaParada(engine, item, como) {
  const idx = indiceDe(engine, item);
  if (idx < 0) return 0;
  const d = engine.decisions.pending[idx];
  d.esperaProva = null;
  d.reasons = [{ text: `a revisão que relancei neste commit para buscar a prova técnica ${como}, então ela não sai mais sozinha: revise de novo quando quiser`, kind: 'gate' },
    ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  const publico = engine.decisionForUi(d);
  engine.emit('needs-decision', { pr: { ...d.pr, key: d.key }, item: publico });
  engine.emit('toast', { kind: 'info', text: `🟡 ${d.key} precisa da sua atenção: a revisão relançada para buscar a prova ${como}.` });
  return 1;
}

async function umaEspera(engine, item) {
  if (item.blockedKind === 'stale_head') {
    const como = item.blockedHead === item.headSha ? rodadaParada(engine, item) : '';
    return como ? largarRodadaParada(engine, item, como) : 0;
  }
  if (await largarSeForPrProprio(engine, item)) return 1;
  if (!item.headSha || !politicaAindaAprova(engine, item)) return 0;
  const lido = await lerPr(engine, item);
  if (!lido || lido.estado !== 'OPEN') return 0;
  if (lido.head !== item.headSha) return largarPorCommitNovo(engine, item, lido.head);
  if (await largarSeForPrProprio(engine, item, lido.autor)) return 1;
  const tentativas = Number(item.esperaProva.tentativas) || 0;
  if (!(Number(item.esperaProva.regras) >= VERSAO_DAS_REGRAS)) return relancar(engine, item, tentativas, 'as regras do gate mudaram desde que esta espera começou');
  return relancar(engine, item, Math.min(tentativas + 1, MAX_TENTATIVAS), 'faltou prova técnica na revisão deste commit');
}

// A varredura do ciclo. Devolve quantas buscas foram relançadas ou largadas.
async function reverQuandoAProvaMudar(engine) {
  if (coordenacaoForaDoAr(engine)) return 0;
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
  let andaram = await largarEsperasDePrProprio(engine);
  try { andaram += await esperaCi.aprovarQuandoOCiFechar(engine); }
  catch (err) { engine.log('WARN', `espera do CI: ${err.message}`); }
  try { andaram += await reverQuandoAProvaMudar(engine); }
  catch (err) { engine.log('WARN', `busca da prova: ${err.message}`); }
  return andaram;
}

export default { MAX_TENTATIVAS, armar, armarEspera, reverQuandoAProvaMudar, varrerEsperas };
export { MAX_TENTATIVAS, armar, armarEspera, reverQuandoAProvaMudar, varrerEsperas };
