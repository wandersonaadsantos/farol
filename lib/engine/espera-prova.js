// A aprovação que espera a PROVA técnica e se reavalia sozinha (17/10/2026).
//
// Caso medido: biudtech/biud-frontend#1465 (head 1f18057), conta em "aprova sozinho". A
// revisão concluiu aprovar, `shouldAutoApprove` devolveu `prova_tecnica_incompleta` (lacuna
// de alcance, critérios do card, dependência em aberto) e o resultado foi para "Precisa de
// você", esperando um clique. Regra do dono: com a aprovação automática configurada, o
// desfecho nunca depende de ação humana.
//
// O invariante 4 NÃO afrouxa (PR #244, v2.72.2): com lacuna de prova nada é postado, e a
// lacuna não vira ressalva. Desde 17/10/2026 (v2.72.4) o card inteiro e a dependência em
// aberto deixaram de ser lacuna (são ressalva, a política decide); a lacuna de ESTADO que
// sobra é a sessão dizendo que a parte do card deste PR não foi entregue, e as dependências
// citadas continuam lidas aqui, porque uma delas fechar é estado novo para revisar de novo. O que muda é QUEM AGE DEPOIS, no molde da espera do CI
// (espera-ci.js):
//   - o runHeadlessReview grava a pendência com a marca `esperaProva` (`{ desde, lacunas,
//     soEnvelope, tentativas, assinatura, dependencias }`, durável no decisions.json), o
//     toast diz que o app revisa de novo sozinho e NÃO sai o `needs-decision`;
//   - a cada ciclo do check(), junto da espera do CI e sob a mesma guarda de coordenação,
//     `reverQuandoAProvaMudar` faz UMA leitura `gh` por PR em espera (estado, head, decisão
//     de review e reviews) e, se a lacuna for dependência, uma por PR citado (até três);
//   - PR fechado ou mergeado: é do reconcilePending, que roda antes;
//   - head diferente: larga a espera e carimba `stale_head`, o caminho de sempre do commit
//     novo (reReviewTargets, gatilho B);
//   - estado novo (review de alguém, decisão do PR, dependência que fechou) ou lacuna só de
//     ENVELOPE (o que a própria sessão preenche ao revisar de novo: cobertura, alcance,
//     protocolo, checkpoint, verificação, avaliação técnica ausente ou inconclusiva) com
//     menos de MAX_TENTATIVAS: marca a pendência `stale_head` no MESMO head e libera a âncora
//     do round, e o launchReReviews do próximo ciclo relança pela fila de sempre, com todos
//     os gates. A revisão relançada herda a marca (mesmo head), então o contador sobrevive;
//   - nada mudou: espera calado, sem regravar o decisions.json. Depois de MAX_TENTATIVAS de
//     envelope sem estado novo, segue esperando o PR mudar, e o card diz isso;
//   - regra nova (v2.72.6): a marca carrega a versão das regras do gate (`regras`,
//     VERSAO_DAS_REGRAS em evidence.js). Marca sem carimbo ou com versão anterior relança UMA
//     revisão pelo mesmo caminho, fora do contador do envelope, e sai carimbada: sem isso a
//     espera armada antes de uma regra sair mostrava para sempre a lacuna que não existe mais
//     (biud-messaging-waba#52 no celular);
//   - PR da própria conta que revisa (v2.72.6, biud-frontend#1479): o GitHub não aceita a
//     revisão do autor, então a espera sai e o card vai para a mesa (espera-pr-proprio.js).
//
// O `updatedAt` do PR é lido mas NÃO entra na assinatura: a própria revisão põe e tira a
// label de "revisando", o que mexe nele, e cada relançamento dispararia o próximo.
//
// Fica de fora (vai para a mesa, como antes): violação técnica confirmada ou achado técnico
// não resolvido (pedem mudança, não espera), reconferência técnica (`technicalRecheck`, que
// tem caminho próprio), resultado sem head lido e conta cuja política não aprovaria.
import crypto from 'node:crypto';
import io from '../io.js';
import contasConfig from './contas-config.js';
import esperaCi from './espera-ci.js';
import { dependenciasAbertas } from './gate-espera.js';
import { coordenacaoForaDoAr } from './postagem-arbitragem.js';
import { liberarReciboDaRodada } from './espera-prova-recibo.js';
import { TEMPOS } from '../constants.js';
import { approvalGaps, isCiGap, VERSAO_DAS_REGRAS } from '../technical-review/evidence.js';
import { largarSeForPrProprio, largarEsperasDePrProprio } from './espera-pr-proprio.js';

const MOTIVO = 'prova_tecnica_incompleta';
const MAX_TENTATIVAS = 2;
const TETO_DE_LACUNAS = 8;
const TETO_DO_TEXTO = 300;
const TETO_DE_DEPENDENCIAS = 3;
const IMPEDEM = ['violação técnica confirmada', 'achados técnicos não resolvidos'];
const DO_ENVELOPE = [
  /^a cobertura da leitura/, /^protocolo de revisão/, /^checkpoint de verificação/, /^divergência de veredito/,
  /^verificação de afirmações/, /^diff não medido/, /^commit revisado não confirmado/, /^análise incompleta/,
  /avaliação técnica/, /^aplicabilidade técnica/, /^regras técnicas/, /^histórico de objeções/,
  /^declaração técnica/, /^prova necessária à aprovação/,
];
const REF = /(?:github\.com\/)?([\w.-]+\/[\w.-]+)(?:#|\/pull\/)(\d+)/g;

const curto = (sha) => String(sha || '').slice(0, 7) || '?';
const doEnvelope = (g) => DO_ENVELOPE.some((re) => re.test(g));

function lacunasDe(result) {
  const lista = Array.isArray(result.approvalEvidence) ? result.approvalEvidence : approvalGaps(result);
  return lista.filter((g) => typeof g === 'string' && g.trim() && !isCiGap(g));
}

// `owner/repo#N` citados nas dependências em aberto, sem o próprio PR, até o teto
function refsDeDependencia(result, key) {
  const vistos = new Set();
  for (const texto of dependenciasAbertas(result)) {
    for (const m of texto.matchAll(REF)) {
      const ref = `${m[1]}#${m[2]}`;
      if (ref !== key) vistos.add(ref);
    }
  }
  return [...vistos].slice(0, TETO_DE_DEPENDENCIAS);
}

function semMotivoDaEspera(reasons) {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => !(r && typeof r === 'object' && r.espera === true));
}

// O motivo que o card mostra enquanto espera. `espera: true` deixa a varredura trocar ou tirar
// esta linha sem farejar o texto, como na espera do CI.
function motivoDaEspera(marca) {
  const lacuna = marca.lacunas[0] || 'prova técnica';
  let text = `aprovável, mas falta prova técnica (${lacuna}); reviso de novo sozinho quando o PR mudar (commit novo, review novo ou dependência resolvida), sem precisar de você`;
  if (marca.soEnvelope && marca.tentativas < MAX_TENTATIVAS) {
    text = `aprovável, mas falta prova técnica (${lacuna}); reviso de novo sozinho para completar a prova, sem precisar de você`;
  } else if (marca.soEnvelope) {
    text = `aprovável, mas falta prova técnica (${lacuna}); já revisei de novo ${marca.tentativas} vezes sem fechar a prova, então espero o PR mudar (commit novo, review novo ou dependência resolvida) para revisar sozinho de novo`;
  }
  return { text, kind: 'gate', espera: true };
}

// A revisão relançada no mesmo head herda a marca da anterior: é o que conta as tentativas.
function marcaAnterior(engine, key, head) {
  const d = ((engine.decisions || {}).pending || []).find((x) => x && x.key === key && x.esperaProva && x.headSha === head);
  return d ? d.esperaProva : null;
}

function avisarDaEspera(engine, pr, marca) {
  engine.emit('toast', { kind: 'info', text: `⏳ ${pr.key}: aprovável, falta prova (${marca.lacunas[0] || 'prova técnica'}); reviso de novo sozinho quando o PR mudar` });
}

// O que o runHeadlessReview grava quando o gate devolve prova_tecnica_incompleta; qualquer
// outro caso devolve null e o resultado segue o caminho de antes.
function armar(engine, pr, motivo, result, pontos) {
  if (motivo !== MOTIVO || !result || result.technicalRecheck || !result.headSha) return null;
  const lacunas = lacunasDe(result);
  if (!lacunas.length || lacunas.some((g) => IMPEDEM.includes(g))) return null;
  const limpo = !(Array.isArray(pontos) && pontos.length);
  if (engine.approvePolicyFor(engine.accountForPr(pr), limpo) !== 'approve') return null;
  const ant = marcaAnterior(engine, pr.key, result.headSha) || {};
  const marca = {
    desde: Number(ant.desde) || Date.now(),
    limpo,
    lacunas: lacunas.slice(0, TETO_DE_LACUNAS).map((g) => g.slice(0, TETO_DO_TEXTO)),
    soEnvelope: lacunas.every(doEnvelope),
    tentativas: Number(ant.tentativas) || 0,
    assinatura: String(ant.assinatura || ''),
    regras: VERSAO_DAS_REGRAS,
    dependencias: refsDeDependencia(result, pr.key),
    // quando a sessão começou a ler o PR: review de alguém posterior a isto ela não viu
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
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'state,headRefOid,updatedAt,reviewDecision,reviews,author'], { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  const j = io.parseJson(r.stdout, null);
  if (!j || !j.state || !j.headRefOid) return null;
  const lista = (Array.isArray(j.reviews) ? j.reviews : []).filter((v) => v && typeof v === 'object');
  const reviews = lista.map((v) => `${(v.author && v.author.login) || '?'}:${v.state || '?'}:${v.submittedAt || ''}`).sort();
  const ultimoReview = Math.max(0, ...lista.map((v) => Date.parse(String(v.submittedAt || '')) || 0));
  const autor = String((j.author && j.author.login) || '');
  return { estado: String(j.state), head: String(j.headRefOid), decisao: String(j.reviewDecision || ''), reviews, ultimoReview, autor };
}

// O estado de cada dependência citada. null = alguma leitura falhou, e o ciclo não compara.
async function lerDependencias(engine, item) {
  const conta = engine.accountForPr({ ...item.pr, key: item.key });
  const estados = [];
  for (const ref of item.esperaProva.dependencias || []) {
    const [repo, numero] = ref.split('#');
    const r = await io.run('gh', ['pr', 'view', numero, '--repo', repo, '--json', 'state'], { env: engine.ghEnv(conta) });
    const j = r && r.ok ? io.parseJson(r.stdout, null) : null;
    if (!j || !j.state) return null;
    estados.push(`${ref}:${j.state}`);
  }
  return estados;
}

function assinaturaDe(lido, deps) {
  const fonte = [lido.decisao, ...lido.reviews, ...deps].join('\n');
  return crypto.createHash('sha256').update(fonte).digest('hex').slice(0, 16);
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
  d.reasons = [{ text: `chegou commit novo enquanto a aprovação esperava a prova técnica (${curto(item.headSha)} -> ${curto(head)}): reviso de novo sozinho, este texto fala do código anterior`, kind: 'gate' },
    ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: head andou de ${curto(item.headSha)} pra ${curto(head)} na espera da prova; marcada stale_head.`);
  engine.emit('toast', { kind: 'info', text: `↻ ${item.key}: chegou commit novo enquanto eu esperava a prova, então reviso de novo sozinho; o card mostra quando.` });
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
async function relancar(engine, item, assinatura, tentativas, causa) {
  if (!(await liberarReciboDaRodada(engine, item))) return 0;
  const idx = indiceDe(engine, item);
  if (idx < 0) return 0;
  const d = engine.decisions.pending[idx];
  // a revisão relançada aplica as regras vigentes: o carimbo novo impede relançar de novo por elas
  d.esperaProva = { ...d.esperaProva, assinatura, tentativas, regras: VERSAO_DAS_REGRAS };
  d.blockedKind = 'stale_head';
  d.blockedHead = d.headSha;
  d.reasons = [{ text: `${causa}: reviso de novo sozinho neste commit para fechar a prova técnica`, kind: 'gate', espera: true },
    ...semMotivoDaEspera(d.reasons)];
  liberarAncora(engine, item.key);
  engine.saveDecisions();
  engine.log('INFO', `${item.key}: espera da prova relançada no head ${curto(d.headSha)} (${causa}, tentativa ${tentativas}).`);
  return 1;
}

// A política da conta pode ter mudado durante a espera: aí o resultado é seu, como no CI.
function politicaAindaAprova(engine, item) {
  const conta = engine.accountForPr({ ...item.pr, key: item.key });
  const limpo = item.esperaProva.limpo !== false;
  if (engine.approvePolicyFor(conta, limpo) === 'approve') return true;
  const idx = indiceDe(engine, item);
  if (idx < 0) return false;
  const d = engine.decisions.pending[idx];
  d.esperaProva = null;
  d.reasons = [{ text: contasConfig.motivoDaPolitica(engine, conta, limpo), kind: 'gate' }, ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  const publico = engine.decisionForUi(d);
  engine.emit('needs-decision', { pr: d.pr, item: publico });
  engine.emit('toast', { kind: 'info', text: `🟡 ${d.key} precisa da sua atenção: ${((publico.reasons || [])[0] || {}).text || 'ver relatório'}` });
  return false;
}

function registrarEstado(engine, item, assinatura) {
  const idx = indiceDe(engine, item);
  if (idx < 0) return;
  const d = engine.decisions.pending[idx];
  d.esperaProva = { ...d.esperaProva, assinatura };
  engine.saveDecisions();
}

// O primeiro ciclo não tem estado anterior gravado: compara com o que a REVISÃO conhecia.
// Ela leu as dependências em aberto e os reviews até o começo da leitura; dependência que
// fechou ou review que chegou depois disso é estado novo, e não a linha de base.
function mudouDesdeALeitura(lido, deps, marca) {
  if (deps.some((s) => !s.endsWith(':OPEN'))) return true;
  return lido.ultimoReview > (Number(marca.leituraDesde) || Number(marca.desde) || 0);
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
  d.reasons = [{ text: `a revisão que relancei neste commit para fechar a prova técnica ${como}, então ela não sai mais sozinha: revise de novo quando quiser`, kind: 'gate' },
    ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
  const publico = engine.decisionForUi(d);
  engine.emit('needs-decision', { pr: d.pr, item: publico });
  engine.emit('toast', { kind: 'info', text: `🟡 ${d.key} precisa da sua atenção: a revisão relançada para fechar a prova ${como}.` });
  return 1;
}

async function umaEspera(engine, item) {
  if (item.blockedKind === 'stale_head') {
    const como = item.blockedHead === item.headSha ? rodadaParada(engine, item) : '';
    return como ? largarRodadaParada(engine, item, como) : 0;
  }
  if (largarSeForPrProprio(engine, item)) return 1;
  if (!item.headSha || !politicaAindaAprova(engine, item)) return 0;
  const lido = await lerPr(engine, item);
  if (!lido || lido.estado !== 'OPEN') return 0;
  if (lido.head !== item.headSha) return largarPorCommitNovo(engine, item, lido.head);
  if (largarSeForPrProprio(engine, item, lido.autor)) return 1;
  const deps = await lerDependencias(engine, item);
  if (!deps) return 0;
  const assinatura = assinaturaDe(lido, deps);
  const marca = item.esperaProva;
  const tentativas = Number(marca.tentativas) || 0;
  if (!(Number(marca.regras) >= VERSAO_DAS_REGRAS)) return relancar(engine, item, assinatura, tentativas, 'as regras do gate mudaram desde que esta espera começou');
  if (marca.assinatura && assinatura !== marca.assinatura) return relancar(engine, item, assinatura, 0, 'o PR mudou enquanto eu esperava a prova');
  if (!marca.assinatura && mudouDesdeALeitura(lido, deps, marca)) return relancar(engine, item, assinatura, 0, 'o PR mudou depois da leitura da revisão');
  if (marca.soEnvelope && tentativas < MAX_TENTATIVAS) return relancar(engine, item, assinatura, tentativas + 1, 'a prova que faltou é da própria revisão');
  if (!marca.assinatura) registrarEstado(engine, item, assinatura);
  return 0;
}

// A varredura do ciclo. Devolve quantas esperas foram relançadas ou largadas.
async function reverQuandoAProvaMudar(engine) {
  if (coordenacaoForaDoAr(engine)) return 0;
  const esperando = engine.decisions.pending.filter((d) => d && d.esperaProva);
  let andaram = 0;
  for (const item of esperando) {
    try { andaram += await umaEspera(engine, item); }
    catch (err) { engine.log('WARN', `espera da prova ${item.key}: ${err.message}`); }
  }
  return andaram;
}

// As duas esperas automáticas do ciclo, sob a mesma guarda de coordenação. Devolve quantas
// andaram (CI resolvido somado a prova relançada ou largada).
async function varrerEsperas(engine) {
  if (coordenacaoForaDoAr(engine)) return 0;
  let andaram = largarEsperasDePrProprio(engine);
  try { andaram += await esperaCi.aprovarQuandoOCiFechar(engine); }
  catch (err) { engine.log('WARN', `espera do CI: ${err.message}`); }
  try { andaram += await reverQuandoAProvaMudar(engine); }
  catch (err) { engine.log('WARN', `espera da prova: ${err.message}`); }
  return andaram;
}

export default { MAX_TENTATIVAS, armar, armarEspera, reverQuandoAProvaMudar, varrerEsperas };
export { MAX_TENTATIVAS, armar, armarEspera, reverQuandoAProvaMudar, varrerEsperas };
