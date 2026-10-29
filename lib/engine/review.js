import { retryTargets } from './review-retry.js';
import { esperaCiNoInicio } from './inicio-com-ci.js';
import { aguardaCliquePorRegra } from './review-scope-queue.js';
import { politicaDeInicio, bloqueioDeInicio } from './review-scope.js';
// Concern do pipeline de revisão headless (Onda 2, colaborador): lançar review (terminal
// ou headless), a fila com 1 revisão por conta em paralelo (escalonador), o worker que roda
// cada uma com retry de erro transitório, a montagem do prompt (perfil do autor + formato
// humano) e a revisão em si com o gate de auto-aprovar/reprovar. Funções recebem o engine
// como ctx; a Engine mantém fachadas finas. Gate intacto (docs/REVIEW-GATES.md, invariante 4). Ver docs/QUALITY.md.
import fs from 'node:fs';
import { conferirCancelamento } from './cancelamento-revisao.js';
import path from 'node:path';
import { WORKSPACE, TEMPLATE_DIR, STATE_DIR } from '../paths.js';
import io, { writeJsonAtomic } from '../io.js';
import fanoutMod from './fanout.js';
import roundsMod from './review-rounds.js';
import { prepare as prepareSpecialist } from '../specialists/context.js';
import { attachSpecialistEvidence } from '../specialists/evidence.js';
import { prepareReviewReading, preparedPatchBlock, releaseAnalysisSource } from './analysis-source.js';
import { lerResultadoDaRevisao, resultadoComReparo } from './reparo-envelope.js';
import { recuperarResultado } from './recuperacao-resultado.js';
import vigiaMod from './vigia-sessao.js';
import { jaResolvido } from './vistos-reconciliacao.js';
import promptMod, { fastModeBlock } from './review-prompt.js';
import * as jiraMod from './jira.js';
import { JIRA_CODES, motivoDe } from '../jira/errors.js';
import { classify } from '../log-taxonomy.js';
import retomadaMod, { RESUME_SID_RE, AVISO_DESCARTE } from './retomada-duravel.js';
import { stageOfLine, stageSummaryFrom } from './etapas-revisao.js';
// reasons/attention viajam como { text, kind } desde a v2.48.0: o unwrap tem UM
// endereço (lib/format.js), senão cada consumidor reinventa e um deles esquece
import { textoBloqueio } from '../format.js';
import { TEMPOS, UPDATE_INSTALLING_ERROR } from '../constants.js';
import { runUpdateProtectedSession } from './session-update.js';
import { checkpointPath, readCheckpoint, relevantEntries, summarizeCheckpoint, resumeBlock } from './verification-checkpoint.js';
import {
  prepararCoberturaParaOGate,
  fileProofBlock, saveFileProof,
} from './file-proof.js';
import { escolheModelo, rotuloOrigem } from './model-router.js';
// repoDoPr mora em review-signal.js desde a v2.53.9 (a label o usava antes, a
// leitura de transição das refs o usa ainda): importa de lá em vez de duplicar
import { repoDoPr } from './review-signal.js';
import { novoIdDeSessao } from './sessao-id.js';
import { prDaSessao, esperaParaTela } from './conta-na-tela.js';
import { parallelLimit, globalParallelLimit, headlessOrg, processHeadless } from './headless-fila.js';
import { limiteAte } from './limite-plano.js';
import { aposLimite } from './limite-na-cadeia.js';
import { aguardarConfirmacaoDeHead, tentarFallbackLogin } from './retry-da-revisao.js';
import admissao from './admissao.js';
import distribuicao from './sync-distribuicao.js';
import fechamento from './sync-fechamento.js';
import checkpointSync from './sync-checkpoint.js';
import { registrarFalha, detalheDaFalha, anotarFalhaDaSessao } from './falhas.js';
import { outrosQueSeguram } from './skip-review.js';
import esperaProva from './espera-prova.js';
import { anexarChecksObrigatorios } from './checks-exigidos.js';
import { verificarAlcance } from './alcance.js';
import { technicalRuntime, technicalPrompt } from '../technical-review/runtime.js';
import { rememberReview } from '../technical-review/registry.js';
import { launchTechnicalRechecks } from '../technical-review/recheck.js';
import { isCiGap } from '../technical-review/evidence.js';
import { criteriaContext } from './review-criteria-context.js';
import { applyCriteriaEvidence, confirmCriteriaPersistence } from './review-criteria.js';
import desfechoMod from './desfecho-da-revisao.js';
import buscaDaProva from './busca-da-prova.js';
import { anotarEstimativa, etapasComTamanho } from './estimativa-sessao.js';
import porta from './porta-de-execucao.js';
import { iniciarTrabalho, encerrarTrabalho } from './continuidade-revisao.js';
import labelsATirar from './labels-a-tirar.js';
import { mesmoPr } from './review-label-target.js';
import { naOrdem } from './review-label-operation.js';
import { hasPolicies } from '../capacity/quota.js';
import { prepareAccount, deferBlockedReview } from '../capacity/admission.js';
import {
  PAPEL_LEVELS, PAPEL_LABEL, PAPEL_TONE,
  DOMAINS, DOMAIN_LEVELS, DOMAIN_LABEL, DOMAIN_LEVEL_LABEL, DOMAIN_POSTURE,
  PUSHBACK_LABEL,
} from '../taxonomy.js';

// Motivo cru do envelope da sessão vira { text, kind }, e o kind é SEMPRE 'content': quem
// escreveu foi a revisão, apontando algo sobre o código. Objeto que a sessão devolveu já
// etiquetado perde a etiqueta (01/10/2026): 'gate' e 'infra' são texto do app, que a tela
// mostra sem o filtro de linguagem (public-review.js), e a sessão não pode se dar esse selo.
function asReason(r) {
  if (r && typeof r === 'object' && typeof r.text === 'string') return { text: r.text, kind: 'content' };
  return { text: String(r), kind: 'content' };
}

// Motivo de GATE: o app segurou por regra (cobertura, contestação, política,
// clique), não porque a revisão achou algo. Construtor curto porque os pontos que
// prependam vivem dentro de if aninhado, e o literal ali dentro empurrava a
// profundidade acima do teto do gate de qualidade.
const gateReason = (text) => ({ text, kind: 'gate' });
// Classe da taxonomia (lib/log-taxonomy.js) que o runOneHeadless NUNCA trata como
// transitória comum: coordenação entre dispositivos fora do ar volta pra fila sem
// retry e sem estacionar (D11 do contrato da sincronização).
const CLASSE_COORDENACAO = 'coordenacao-indisponivel';

// A fachada falta em engine de teste montado à mão; ausência vale como coordenação
// desligada, que é o que um engine sem sincronização é.
// Teto do grupo não verificável (C4b): espera sem estacionar. Engine de teste sem o gate
// vale como "não segura", que é o comportamento de antes.
function grupoSegura(engine, acct) {
  return typeof engine.grupoSegura === 'function' ? engine.grupoSegura(acct) : null;
}
function grupoDaConta(engine, acct) {
  return typeof engine.grupoDaConta === 'function' ? engine.grupoDaConta(acct) : '';
}
function seguraPelaCoordenacao(engine, key) {
  return typeof engine.syncSeguraAutomacao === 'function' && engine.syncSeguraAutomacao(key) === true;
}
function coordenacaoLigada(engine) {
  return typeof engine.syncCoordenacaoAtiva === 'function' && engine.syncCoordenacaoAtiva() === true;
}

// Contexto que o gate de runClaudeStream entrega ao coordenador ("Contratos dos
// chamadores" do contrato da sincronização). A versão material é o head que ESTA
// sessão leu: recibo e lease falam do mesmo commit em que o review vai ancorar.
//
// Os overrides do clique são CONSUMIDOS aqui: valem pra esta admissão e saem do objeto
// do PR, que é o mesmo que o retry guarda e que a fila recebe de volta. Sem isso, a
// retentativa automática de uma revisão confirmada "sem coordenação" também pularia a
// coordenação, horas depois e sem ninguém ter confirmado de novo.
//
// A marca do round automático (D13) é consumida pelo mesmo motivo: a reserva compartilhada
// registra o round UMA vez, na admissão desta sessão (sem teto diário desde 17/10/2026). O retry transitório (prComRetomada
// copia o objeto), a fila de volta (tratarBloqueioDeCoordenacao e o catch do
// runOneHeadless empurram este objeto) e o clique que copia da fila herdariam a marca, e
// cada um reservaria outra rodada do dia pro mesmo round lógico. Admissão recusada antes
// da reserva (lease alheio, recibo, coordenação fora) deixa o round sem contar: é o lado
// seguro, porque a reserva registra gasto, e aqui nenhuma sessão rodou.
function contextoCoordenacao(engine, pr, headSha) {
  const semCoordenacao = !!pr.semCoordenacao;
  const ignorarRecibo = !!pr.ignorarRecibo;
  const contaRodada = !!pr.rodadaAutomatica;
  // 7.C8: tomada forçada é pedido de UMA vez, e ele é consumido aqui como os outros. O
  // `confirmado` viaja junto porque o coordenador não toma nada sem os dois.
  const tomar = !!pr.tomarLease;
  pr.semCoordenacao = false;
  pr.ignorarRecibo = false;
  pr.rodadaAutomatica = false;
  pr.tomarLease = false;
  return {
    prKey: pr.key, account: engine.accountForPr(pr), materialVersion: headSha, headSha,
    contaRodada, manual: !!pr.manual, semCoordenacao, ignorarRecibo, tomar, confirmado: tomar,
    pr: { key: pr.key, url: pr.url, repo: pr.repo, number: pr.number, author: pr.author, account: pr.account },
  };
}

// D11: bloqueio da coordenação entre aparelhos é ESPERA, nunca falha. O PR volta pra
// fila visível com a espera anotada (o toReview pula a key enquanto ela vale), sem
// estacionar e sem entrar no retry. Recibo é a exceção: o coordenador já marcou o PR
// como visto, porque a análise deste commit terminou em outro lugar, e devolvê-lo à
// fila só faria o próximo ciclo ouvir a mesma recusa.
// O toast sai só quando a FRASE muda. A espera do lease alheio (120 s) é menor que o
// ciclo de polling (180 s), então o PR volta a ser tentado a cada ciclo enquanto o outro
// aparelho revisa, e sem esta memória o mesmo aviso repetiria indefinidamente. Repetir
// não informa nada: quem leu uma vez já sabe. A memória é do PROCESSO (some no
// reinício), como o budgetWarned, e o registro no log continua saindo sempre.
function avisarBloqueioUmaVez(engine, key, texto) {
  const vistos = engine.syncBloqueioAvisado || (engine.syncBloqueioAvisado = new Map());
  if (vistos.get(key) === texto) return;
  vistos.set(key, texto);
  engine.emit('toast', { kind: 'info', text: texto });
}

function tratarBloqueioDeCoordenacao(engine, pr, admissao) {
  const adm = admissao || {};
  if (adm.reason !== 'recibo') {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    engine.syncRegistrarEspera(pr.key, adm);
  }
  // recibo é desfecho (este commit terminou em outro aparelho): a referência de
  // retomada sai. Lease alheio e coordenação fora são espera, e ela fica (CT-RET).
  if (adm.reason === 'recibo') retomadaMod.consumirRetomada(engine, pr.key);
  avisarBloqueioUmaVez(engine, pr.key, textoBloqueio(pr.key, adm));
}

// Recibo DEPOIS do estado local (D14). Falha ao gravar não desfaz o desfecho: o review
// já saiu ou a pendência já está na mesa, e o pior caso é outro aparelho refazer este
// commit (o preflight dele acha o review meu no GitHub). Nunca lança pelo mesmo motivo:
// exceção aqui estacionaria um PR que foi revisado.
async function concluirCoordenacao(engine, pr, coord, opcoes) {
  if (!coord) return;
  try {
    const r = await coord.complete({ ...opcoes });
    if (r && r.ok === false) engine.log('WARN', `${pr.key}: recibo de coordenação entre dispositivos não gravado: ${r.motivo || r.code}`);
  } catch (err) {
    engine.log('WARN', `${pr.key}: recibo de coordenação entre dispositivos não gravado: ${err.message}`);
  }
}

// Com a coordenação ligada a label entra só depois da admissão (opts.onAdmitted), então
// uma recusa só encontra label nossa no PR quando a retomada recusada abriu uma SEGUNDA
// admissão. Se ela ouviu "alheio", a label no PR é do outro aparelho só quando ele está
// numa revisão (mesma conta, mesmo nome); lease de pushback ou de autoanálise não põe
// label, e preservar a nossa a deixaria presa. Tipo desconhecido fica do lado de
// preservar: quem lê label alheia já a caduca (labelVistaDesde), e apagar o sinal de uma
// revisão viva faria os colegas revisarem por cima.
function labelEhDeOutraRevisao(admissao) {
  const a = admissao || {};
  if (a.reason !== 'alheio') return false;
  const kind = String((a.detail && a.detail.operationKind) || '');
  return kind === '' || kind === 'review';
}

// Sem desfecho, o lease volta pro banco (sem recibo). Best-effort pelo mesmo motivo do
// concluirCoordenacao: roda num finally, e exceção ali trocaria o desfecho real.
async function devolverLease(coord) {
  if (!coord || coord.done) return;
  try { await coord.abort(); } catch { /* lease que não sai agora expira sozinho pelo TTL */ }
}

// A tentativa com --resume já reservou (e iniciou) a rodada do dia no teto
// compartilhado; a sessão nova que a substitui é a MESMA rodada, e contar de novo
// gastaria o teto em dobro por causa de uma retomada recusada.
function semNovaRodada(streamOpts) {
  if (!streamOpts.coordination) return streamOpts;
  return { ...streamOpts, coordination: { ...streamOpts.coordination, contaRodada: false } };
}

function prFromUrl(engine, url) {
  const m = String(url).match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { key: `${m[1]}#${m[2]}`, url, title: '', author: '', repo: m[1], number: parseInt(m[2], 10) };
}

// Overrides do clique manual (D12): cada um contorna UM motivo de bloqueio da
// coordenação entre aparelhos, e só ele. Lease de outro aparelho não aparece aqui de
// propósito: refazer ou forçar nunca toma uma execução que está rodando.
const OVERRIDE_DO_MOTIVO = Object.freeze({ indisponivel: 'semCoordenacao', recibo: 'ignorarRecibo' });

// Os dois overrides só nascem do clique confirmado. No caminho automático eles caem
// sempre, mesmo que tenham vazado pro objeto do PR (a fila recebe de volta o objeto que
// uma sessão manual segurou): automação com contorno pularia a coordenação em silêncio.
// Clique nunca é o round automático pós-push (D13): o objeto que ele copia da fila pode
// ter vindo de uma sessão que caiu antes da admissão, ainda com a marca, e reservaria
// uma rodada automática do dia para o que foi um clique.
function marcarOrigem(it, porClique, extras) {
  it.semCoordenacao = porClique && extras.semCoordenacao === true;
  it.ignorarRecibo = porClique && extras.ignorarRecibo === true;
  if (porClique) {
    it.manual = true;
    it.automaticRetry = false;
    it.rodadaAutomatica = false;
  } else it.manual = false;
}

// Preflight do clique (só leitura, nunca reserva nem escreve): quem a coordenação
// seguraria volta pra tela decidir. O preflight roda de novo MESMO com o override,
// porque a situação pode ter mudado entre o aviso e a confirmação: sem bloqueio o
// override cai (a coordenação normal volta a valer), e bloqueio de outro motivo segue
// bloqueando. O gate no spawn roda depois e honra o que sobrou.
async function preflightDoClique(engine, itens) {
  const liberados = [];
  const coordenacao = [];
  for (const it of itens) {
    const r = (await engine.syncPreflightManual(it)) || {};
    const flag = r.ok ? '' : OVERRIDE_DO_MOTIVO[r.reason];
    const contorna = !!flag && it[flag] === true;
    it.semCoordenacao = contorna && flag === 'semCoordenacao';
    it.ignorarRecibo = contorna && flag === 'ignorarRecibo';
    if (r.ok || contorna) liberados.push(it);
    else coordenacao.push({ key: it.key, reason: r.reason, detail: r.detail });
  }
  return { liberados, coordenacao };
}

function launchReview(engine, urls, mode = 'auto', origem = 'auto', extras = {}) {
  if (engine.updateInstalling) return Promise.resolve({ ok: false, error: UPDATE_INSTALLING_ERROR });
  return runUpdateProtectedSession(engine, () => launchReviewInner(engine, urls, mode, origem, extras));
}

async function launchReviewInner(engine, urls, mode, origem, extras) {
  if (!urls || !urls.length) return { ok: false, error: 'sem PRs para revisar' };
  if (!engine.token) await engine.refreshTokens();
  // requested = o PR pediu a MINHA revisão (fila). Desde 18/10/2026 a revisão iniciada por
  // clique no panorama (ou por URL avulsa) também sai pela política da conta: quem mandou
  // revisar foi o dono (marca `manual`, desfecho-automatico.js). Cada item carrega a conta
  // dona (accountForPr deduz pela org quando veio de URL avulsa) pro token certo em todo o fluxo.
  const items = urls.map(u => {
    const q = engine.queue.find(p => p.url === u);
    if (q) return { ...q, account: engine.accountForPr(q), requested: true };
    const pano = engine.panorama.find(p => p.url === u);
    if (pano) return { ...pano, account: engine.accountForPr(pano), requested: !!pano.mine };
    const pr = engine.prFromUrl(u);
    return pr ? { ...pr, account: engine.accountForPr(pr), requested: false } : null;
  }).filter(Boolean);
  // gate por conta (A1 nos consumidores): item de conta SEM token não abre sessão
  // nenhuma (a sessão rodaria gh e Claude com identidade errada). Ele NÃO é marcado
  // como visto: fica na fila esperando o token voltar. Os demais seguem normalmente.
  const semToken = items.filter(it => !engine.tokenFor(it.account));
  if (semToken.length) {
    const contas = [...new Set(semToken.map(it => it.account || '(nenhuma)'))].join(', ');
    engine.emit('toast', { kind: 'error', text: `Conta ${contas} não autenticada no gh. Rode: gh auth login (${semToken.length} PR(s) fora desta revisão).` });
  }
  // o que não pode executar neste aparelho (PR próprio, aparelho admin) sai aqui, antes do
  // markSeen, com aviso: vale também para o clique (ver lib/engine/porta-de-execucao.js)
  const prontos = porta.executaveis(engine, items.filter(it => engine.tokenFor(it.account)));
  if (!prontos.length) return { ok: false, error: semToken.length === items.length ? 'gh sem token' : 'nada deste lote pode executar neste aparelho' };
  // o clique é marcado ANTES do gate de consciência logo abaixo: pr.manual é o
  // que faz o gate deixar passar sem consultar nada (quem mandou revisar foi você)
  const porClique = origem === 'clique';
  for (const it of prontos) marcarOrigem(it, porClique, extras || {});
  /* Gate de consciência do review automático (decisão do Wanderson, 28/08/2026 à
     tarde; desde 18/10/2026 só duas aprovações de gente no head seguram, e a revisão
     automática deixa de ser necessária): ver bloqueadoPorHistorico em
     lib/engine/skip-review.js. Roda AQUI, antes do markSeen e da saída da fila,
     de propósito: o PR bloqueado fica exatamente onde estava, com o card visível
     e o botão Revisar valendo. Clique manual atravessa dentro do próprio
     bloqueiaAutomatico (pr.manual acima). */
  const conscientes = [];
  for (const it of prontos) {
    if (bloqueioDeInicio(engine, it)) continue;
    if (await engine.bloqueiaAutomatico(it)) continue;
    conscientes.push(it);
  }
  if (!conscientes.length) return { ok: false, error: 'A revisão automática aguarda ação manual pela política ou pelo histórico de reviews do head.' };
  // coordenação entre aparelhos no clique (D12): o bloqueado fica na fila, com o card
  // visível, e volta na resposta pra tela confirmar o override. Desligada, nada disto roda.
  const coordenaClique = porClique && coordenacaoLigada(engine);
  const { liberados: coordenados, coordenacao } = coordenaClique ? await preflightDoClique(engine, conscientes) : { liberados: conscientes, coordenacao: [] };
  const liberados = coordenados.filter(it => !bloqueioDeInicio(engine, it));
  const seguradosPelaCoordenacao = coordenacao.length ? { coordenacao } : {};
  if (!liberados.length) return { ok: false, error: 'A revisão aguarda ação manual ou liberação da coordenação.', ...seguradosPelaCoordenacao };
  // lançar (manual ou auto) tira o PR do "estacionamento": ele volta a ser elegível.
  // A gravação fica FORA do laço (M2): dentro dele um lote de N PRs reescrevia o
  // arquivo inteiro N vezes, e as N-1 primeiras gravações são estado intermediário
  // que ninguém lê. Uma gravação só, e só se algo saiu mesmo do estacionamento.
  let saiuDoEstacionamento = false;
  // clique explícito também DESFAZ a saída de cena: você decidiu revisar sabendo
  // que outra pessoa está lá, e a partir daí o app volta a agir neste PR.
  let voltouDeCena = false;
  for (const it of liberados) {
    engine.markSeen(it.key);
    if (desestacionar(engine, it.key)) saiuDoEstacionamento = true;
    if (porClique && engine.skipComentado && engine.skipComentado[it.key]) {
      delete engine.skipComentado[it.key];
      voltouDeCena = true;
    }
  }
  if (saiuDoEstacionamento) engine.saveAutoReviewParked();
  if (voltouDeCena) engine.saveSkipComentado();
  engine.queue = engine.queue.filter(p => !liberados.some(it => it.url === p.url));
  engine.pushState();

  // A sessão de terminal NÃO pega lease nem grava recibo, e isso é deliberado: quem
  // conduz é a pessoa, na frente da janela, e coordenar aqui significaria recusar a
  // abertura de um terminal porque outro aparelho está com o PR. Coordenação existe
  // para não pagar a MESMA análise automática duas vezes; sessão humana não é isso.
  // O gate de postagem continua valendo igual: o terminal posta por /api/review/post.
  if (mode === 'terminal') {
    const keys = liberados.map(p => p.key);
    const label = keys.length === 1 ? `Revisão de ${keys[0]}` : `Revisão de ${keys.length} PRs`;
    // a sessao no terminal usa 1 token; pega a conta do 1o PR (lotes costumam
    // ser da mesma conta). Mistura de contas num mesmo terminal recai na 1a.
    engine.spawnConsole(`/pr-review ${liberados.map(p => p.url).join(' ')}`, label, keys, engine.accountForPr(liberados[0]));
    engine.emit('toast', { kind: 'ok', text: `${label} aberta no terminal do Claude.` });
    return { ok: true, mode, ...seguradosPelaCoordenacao };
  }

  for (const pr of liberados) engine.enqueueHeadless(pr);
  engine.emit('toast', {
    kind: 'info',
    text: liberados.length === 1
      ? `Revisando ${liberados[0].key} internamente. Te aviso do resultado.`
      : `Revisando ${liberados.length} PRs internamente (em paralelo por conta, serial dentro da conta).`
  });
  return { ok: true, mode, ...seguradosPelaCoordenacao };
}

// --- revisao autonoma (headless): contas em paralelo; dentro da mesma conta,
// até config.parallelReviews simultâneas (default 1 = serial, ver parallelLimit) ---
// PR que vai pra entrada do retryAfterNet, carregando o sid da sessão que acabou de
// cair (session.js estampa err.sessionId). Sem sid novo (a queda foi antes de a sessão
// nascer), mantém o da tentativa anterior: a leitura já feita não se joga fora.
// O `knownHead` da entrada é o head que a sessão morta DE FATO leu (pr.headLido,
// estampado pelo runHeadlessReview). Com sid novo, a referência durável é gravada
// junto, com o head e o contexto local (pr.contextoLido) daquela sessão: o
// retryAfterNet é memória e um reinício durante a espera a perderia (CT-RET).
function prComRetomada(engine, pr, err, guardado) {
  const anterior = (guardado && guardado.pr && guardado.pr.retomarSid) || '';
  if (err.sessionId) {
    const ctx = pr.contextoLido || {};
    retomadaMod.guardarRetomada(engine, pr, {
      retomarSid: err.sessionId, knownHead: pr.headLido || '', provedor: ctx.provedor, perfilId: ctx.perfilId,
      sessionId: err.sessionId, headSha: pr.headLido || '',
    });
  }
  return { ...pr, retomarSid: err.sessionId || anterior, knownHead: pr.headLido || pr.knownHead || '' };
}

function enqueueHeadless(engine, pr) {
  const politica = bloqueioDeInicio(engine, pr);
  if (politica) return { ok: false, code: politica };
  /* A promessa "não vou duplicar a revisão" é honrada AQUI, e não em quem chama.
     Foi o tropeço do #68 (20/08/2026): a trava nasceu só no `toReview`, e os
     outros dois caminhos automáticos entravam por baixo dela. Medido: o Farol
     comentou às 19:55:52 e a label dele subiu às 19:57:45, com a label do colega
     AINDA no ar, ou seja, por um caminho que nem olhava a label.

     Este é o ponto por onde TODA revisão headless passa (launchReview e
     launchReReviews), então é aqui que a garantia tem que morar. Gate em chamador
     é gate que o próximo caminho esquece, e o docs/REVIEW-GATES.md já avisava isso sobre o
     reReviewTargets ("as MESMAS travas do toReview: quem mexer lá, mexe aqui").

     Clique explícito (`pr.manual`) NUNCA é barrado: quem mandou revisar foi você,
     sabendo que outra pessoa está lá. Ele inclusive DESFAZ a saída de cena, no
     mesmo espírito do estacionamento (lançar tira de lá).

     O gate de CONSCIÊNCIA do review automático (head ativo com review decisivo
     de outra pessoa, 28/08/2026 à tarde) NÃO mora aqui de propósito: ele
     consulta o gh (é assíncrono) e esta função é síncrona por contrato. A boca
     única dele é bloqueiaAutomatico (lib/engine/skip-review.js), aguardada nos
     três caminhos automáticos ANTES de chegar aqui (launchReview,
     launchReReviews e o retry pós-transitório do check()). */
  // Correção obrigatória do anexo S3: esta função DEVOLVE desfecho. O `return` mudo de
  // antes descartava em silêncio um fato local (a saída de cena registrada), e com
  // distribuição isso viraria laço de recolocação a cada TTL, sem nada na tela.
  if (engine.skipComentado && engine.skipComentado[pr.key] && !pr.manual) return { ok: false, code: 'saida-de-cena' };
  // PR da própria conta não entra por caminho nenhum, clique inclusive
  // (lib/engine/porta-de-execucao.js)
  const fora = porta.motivoParaNaoExecutar(engine, pr); if (fora) return { ok: false, code: fora };
  // não duplica: se já há uma revisão headless deste PR na fila ou rodando, ignora
  // (ex.: clicar Revisar no panorama num PR que o check() já pôs em auto-revisão,
  // ou dois cliques rápidos). O caminho de autoanálise tem o seu próprio dedup.
  const busy = engine.headlessQueue.some(p => p.kind !== 'self' && p.key === pr.key) ||
    [...engine.activeReviews.values()].some(s => s.mode === 'auto' && (s.keys || []).includes(pr.key));
  if (busy) return { ok: false, code: 'duplicado' };
  // referência de retomada durável (CT-RET): o PR carrega o sid e o head que a
  // sessão interrompida leu. Só LÊ: enfileirar não é desfecho, e crash com o PR na
  // fila não pode perder a referência. A validação (runHeadlessReview) decide se retoma.
  const guardada = retomadaMod.lerRetomada(engine, pr.key);
  if (guardada) {
    pr = { ...pr, retomarSid: guardada.retomarSid };
    // knownHead que já veio no objeto (relançamento de re-revisão, G8) manda:
    // ele é do caminho vivo; o da referência é só pra quem não tinha nenhum.
    if (!pr.knownHead && guardada.knownHead) pr.knownHead = guardada.knownHead;
  }
  // DESVIO PARA A DISTRIBUIÇÃO, e ele acontece DEPOIS de saber que existe retomada e
  // ANTES de consumi-la (CT-RET): item com retomada fica no aparelho que consegue
  // executá-la, e por isso não vira candidato. Clique manual também não distribui: quem
  // mandou revisar foi quem está na frente deste aparelho. O pedido do admin (`viaAdmin`,
  // comando `revisar`) também não: ele escolheu ESTE aparelho, e devolver o PR ao conjunto
  // faria o agendador escolher outro. Não é clique: os demais gates continuam valendo.
  if (!pr.manual && !pr.viaDistribuicao && !pr.viaAdmin && !guardada && distribuicao.distribuindo(engine, cfgDaSync(engine))) {
    engine.headlessDistribuindo = engine.headlessDistribuindo || new Map();
    engine.headlessDistribuindo.set(pr.key, { pr, desde: Date.now() });
    engine.pushState();
    publicarComHead(engine, pr).then((r) => {
      if (!r.ok) devolverAoLocal(engine, pr);
    }).catch(() => devolverAoLocal(engine, pr));
    return { ok: true, via: 'distribuicao' };
  }
  engine.headlessQueue.push(pr);
  engine.writeInflight();
  engine.processHeadless();
  engine.pushState();
  return { ok: true, via: 'local' };
}

// Passo 8 do anexo S3: a atribuição aceita volta pelo RAMO LOCAL, e daí em diante o
// caminho é o de sempre, lease incluído. A vaga já está reservada pela admissão, então o
// item carrega o id da reserva em vez de tomar outra.
// A vaga foi reservada no ACEITE e quem a devolve é quem executa (freeHeadlessSlot, pelo
// admissaoId que viaja no PR). Enfileirar que NÃO leva o item (saída de cena registrada
// depois da publicação, ou o mesmo PR já na fila local) não tem executor nenhum: sem
// devolver aqui, a reserva ficaria presa e o aparelho recusaria toda atribuição seguinte
// por sem_vaga, com nada rodando.
function enfileirarDaDistribuicao(engine, pr, admissaoId) {
  if (engine.headlessDistribuindo) engine.headlessDistribuindo.delete(pr.key);
  const item = { ...pr, viaDistribuicao: true, admissaoId };
  const r = enqueueHeadless(engine, item);
  if (!r.ok && admissaoId) admissao.liberar(engine, admissaoId);
  return r;
}

// A herança nunca derruba a revisão: banco fora, chave fechada ou entrada ilegível apenas
// deixam o aparelho começar do que ele mesmo sabe.
async function herdarDoConjunto(engine, pr, headSha, blobs) {
  try {
    const r = await checkpointSync.herdarCheckpoint(engine, cfgDaSync(engine), { prKey: pr.key, loja: 'review', headSha, blobs });
    return r && r.ok ? r : { herdadas: 0, desfecho: 'reinicio' };
  } catch {
    return { herdadas: 0, desfecho: 'reinicio' };
  }
}

function cfgDaSync(engine) {
  return (engine.config && engine.config.sync) || {};
}

// Publicação que não sai não pode sumir com o PR: ele volta ao caminho local, que é o
// comportamento de sempre.
// O head do PR só é lido dentro do runHeadlessReview, e o candidato PRECISA dele: o head
// viaja como tag material e é o que o executor confere antes de aceitar. Na primeira
// revisão o PR chega ao enqueueHeadless sem head nenhum, então quem distribui lê o head
// ANTES de publicar. Sem isso a publicação recusava por forma e todo PR novo caía no ramo
// local, com a distribuição ligada (medido na bancada com engines reais, 16/09/2026).
//
// Head que não se lê NÃO vira candidato: sem material o executor não teria contra o que
// conferir o head atual. Quem recusa é a forma do candidato, e o desfecho é o mesmo de
// qualquer publicação que falha, a volta ao ramo local.
//
// Head que o relançamento já decidiu (knownHead, G8) manda: reler agora publicaria um head
// mais novo que o da re-revisão que pediu esta rodada.
async function publicarComHead(engine, pr) {
  const conhecido = String(pr.headSha || pr.knownHead || '');
  const head = conhecido || String((await engine.headSha(pr)) || '');
  return distribuicao.publicarCandidato(engine, cfgDaSync(engine), { ...pr, headSha: head });
}

function devolverAoLocal(engine, pr) {
  if (engine.headlessDistribuindo) engine.headlessDistribuindo.delete(pr.key);
  engine.headlessQueue.push(pr);
  engine.writeInflight();
  engine.processHeadless();
  engine.pushState();
}

// conta que "ocupa" o slot da revisão (uma por conta de cada vez)
function headlessAcct(engine, pr) { return String(engine.accountForPr(pr) || '').toLowerCase() || '(sem conta)'; }

// devolve o slot da conta ao escalonador. Zera LIMPO (delete, não set 0): o
// isBusy do update.js pergunta headlessBusyAccounts.size, e uma conta ociosa
// registrada com contagem 0 seguraria o auto-update pra sempre.
function freeHeadlessSlot(engine, acct, pr) {
  if (pr && pr.admissaoId) { admissao.liberar(engine, pr.admissaoId); delete pr.admissaoId; }
  const n = (engine.headlessBusyAccounts.get(acct) || 0) - 1;
  if (n > 0) engine.headlessBusyAccounts.set(acct, n);
  else engine.headlessBusyAccounts.delete(acct);
}

// Registro durável da falha de uma sessão headless (A1, item 6). Fica fora do catch do
// runOneHeadless para não somar profundidade lá dentro.
function registrarFalhaHeadless(engine, pr, err, kind) {
  return registrarFalha(engine, {
    sessionId: err.sessaoFarol || '', attemptId: err.attemptId || '', cliSessionId: err.sessionId || '',
    kind, account: engine.accountForPr(pr) || '', ref: pr.key,
    motivo: detalheDaFalha(err), classe: classify(err.message || '').id,
    etapas: err.etapas || null, resumeOutcome: err.resumeOutcome,
  });
}

// Erro da autoanálise só vira toast: o autor reroda quando quiser, nada volta pra fila
// de revisor e nada estaciona. Fora do runOneHeadless porque três desfechos aninhados
// dentro do catch passavam do teto de profundidade do gate.
function falhaDaAutoanalise(engine, pr, err) {
  // o coordenador cancelou a sessão porque outro aparelho tomou o lease. A sessão chega
  // aqui com cancelled também, então este caso vem ANTES: sem ele a pessoa lia
  // "Autoanálise cancelada", como se tivesse cancelado, e sem saber que a análise não
  // ficou registrada em lugar nenhum.
  if (err.coordenacao === 'perdido') {
    engine.log('WARN', `autoanalise ${pr.key}: lease de coordenação perdido durante a sessão`);
    engine.emit('toast', { kind: 'info', text: `${pr.key}: outro aparelho assumiu a coordenação; a autoanálise foi encerrada sem registrar.` });
    return;
  }
  // cancelamento AUTOMÁTICO (commit novo durante a sessão) deixa o motivo aqui; sem ele
  // o texto seria o mesmo do botão Cancelar, e a pessoa leria "cancelada" sem ter
  // cancelado nada. Consumido uma vez, pra não repetir na sessão seguinte.
  if (err.cancelled) {
    const motivo = engine.selfCancelMotivo && engine.selfCancelMotivo.get(pr.key);
    if (motivo) engine.selfCancelMotivo.delete(pr.key);
    engine.emit('toast', { kind: 'info', text: motivo || `Autoanálise de ${pr.key} cancelada.` });
    return;
  }
  registrarFalhaHeadless(engine, pr, err, 'self');
  engine.log('ERROR', `autoanalise ${pr.key}: ${err.message}`);
  engine.emit('toast', { kind: 'error', text: `Autoanálise de ${pr.key} falhou: ${err.message}` });
}

const encerrarSemSessao = porta.encerrarSemSessao;

async function runOneHeadless(engine, pr, acct) {
  if (aguardaCliquePorRegra(engine, pr)) { encerrarSemSessao(engine, pr, acct); return; }
  // a sessão vai rodar: o bloqueio anterior deste PR deixou de valer, e o próximo
  // bloqueio (se houver) volta a merecer um aviso
  if (engine.syncBloqueioAvisado) engine.syncBloqueioAvisado.delete(pr.key);
  // autoanalise: caminho separado, NUNCA posta nem gerencia a fila de revisor.
  // Erro so vira toast (o autor reroda quando quiser); nada volta pra fila.
  if (pr.kind === 'self') {
    try {
      await engine.runSelfAnalysis(pr);
    } catch (err) {
      falhaDaAutoanalise(engine, pr, err);
    } finally {
      encerrarSemSessao(engine, pr, acct);
    }
    return;
  }

  // PR pode ter sido mergeado enquanto esperava a vez na fila (conta ocupada com
  // outra revisão, fan-out grande, etc.): revisar e postar review num PR já
  // mergeado é ruído puro. null (sem prova, rede/token) NUNCA cancela, só MERGED
  // de verdade pula a revisão (mesma regra do reconcilePending em decision.js).
  let jaMergeado = false;
  try { jaMergeado = (await engine.prState(pr)) === 'MERGED'; }
  catch (err) { engine.log('WARN', `estado de ${pr.key} antes da revisão: ${err.message}`); }
  if (jaMergeado) {
    engine.emit('toast', { kind: 'info', text: `${pr.key} já foi mergeado; cancelei a revisão antes de começar.` });
    // PR mergeado não volta: a referência de retomada dele é desfecho, não espera
    retomadaMod.consumirRetomada(engine, pr.key);
    encerrarSemSessao(engine, pr, acct);
    return;
  }

  // G16: o gate de orçamento rodou no ENFILEIRAMENTO; num lote grande o teto
  // pode estourar entre a fila e a vez deste PR. Re-checa na boca da sessão:
  // estaciona (não descarta) e o relançamento manual continua valendo. Espelha
  // os outros 3 pontos de estacionamento deste arquivo (revisão da Task 3.3):
  // unsee + queue.push ANTES de estacionar (o card não pode sumir da fila
  // visível pra sempre, `seen` continuaria marcado) e retryAfterNet.delete
  // ANTES do autoReviewParked.add (entrada órfã de retry desfaz o
  // estacionamento no ciclo seguinte quando o orçamento libera, exatamente o
  // incidente de 04/08/2026 descrito mais abaixo).
  // C4b: teto do grupo que não dá para verificar volta à fila SEM estacionar, na boca da
  // sessão também (o orçamento pode ter ficado inverificável entre a fila e a vez)
  const grupoNaoVerificavel = grupoSegura(engine, engine.accountForPr(pr));
  if (grupoNaoVerificavel) {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    engine.log('WARN', `revisao ${pr.key}: teto do grupo sem verificação (${grupoNaoVerificavel}); volta pra fila sem estacionar`);
    engine.freeHeadlessSlot(acct, pr);
    engine.writeInflight();
    engine.pushState();
    return;
  }
  // Assinatura do Claude no limite do plano (21/09/2026): o PR que chega na vez nem abre
  // sessão. Abrir era o que punha a label <conta>:revisando no PR, para tirá-la segundos
  // depois quando o Claude recusava. Volta à fila esperando o reset, sem gastar tentativa
  // (nada falhou NESTE PR) e sem estacionar. Clique manual passa (invariante 4): a cota
  // pode ter voltado antes, ou você comprou uso extra.
  const limite = pr.manual ? 0 : limiteAte(engine, engine.accountForPr(pr));
  if (limite) {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    const guardado = engine.retryAfterNet.get(pr.key);
    engine.retryAfterNet.set(pr.key, { tries: (guardado && guardado.tries) || 0, pr: (guardado && guardado.pr) || pr, notBefore: limite });
    encerrarSemSessao(engine, pr, acct);
    return;
  }
  // Orçamento é ritmo da automação; o clique manual atravessa (invariante 4), igual ao
  // limite do plano acima. Antes, o botão Revisar de um PR estacionado por orçamento
  // estacionava de novo enquanto o teto seguisse estourado.
  const perfilEstourado = pr.manual ? null : engine.budgetBlockedFor(engine.accountForPr(pr));
  if (perfilEstourado) {
    engine.unsee(pr.key);
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    estacionar(engine, pr.key, `perfil "${perfilEstourado.label}"`, 'orcamento', pr.headLido);
    // M3: aviso ÚNICO por janela de bloqueio, no mesmo Set que o gate de
    // enfileiramento usa (server.js, toReview) e que o topo do check() reconcilia
    // quando o perfil destrava. Sem isso, um lote de N PRs barrados pelo MESMO
    // estouro empilhava N toasts idênticos no mesmo segundo; o que a pessoa precisa
    // saber (o perfil travou, os PRs esperam) cabe numa frase só, e os cards
    // voltando pra fila contam o resto.
    if (!engine.budgetWarned.has(perfilEstourado.id)) {
      engine.budgetWarned.add(perfilEstourado.id);
      engine.emit('toast', { kind: 'info', text: `O orçamento do perfil "${perfilEstourado.label}" estourou; as revisões desta leva aguardam você.` });
    }
    encerrarSemSessao(engine, pr, acct);
    return;
  }

  // Re-pedido de revisao no MESMO head (24/09/2026). O `requested` volta a true, o PR
  // reentra na fila automatica, e ate aqui a pergunta "eu ja revisei este head?" so era
  // feita duas vezes: pelo vigia, com a sessao rodando, e pelo decide(), com a sessao ja
  // paga (concluia `already_reviewed` e nao postava nada). O re-pedido caia entre as duas.
  // Medido em biudtech/engine-ai#273: aprovado as 12:32, re-pedido as 12:59 sem commit
  // novo, duas sessoes abertas (12 minutos a primeira), nada postado.
  // Clique manual passa (invariante 4), e falta de dado nunca cala um round.
  // já resolvido neste head (inclusive revisado FORA do Farol): sai sem sessão, e a marca
  // impede o reconciliarVistos de devolvê-lo a cada ciclo (vistos-reconciliacao.js, 05/10/2026)
  if (!pr.manual && await jaResolvido(engine, pr)) { encerrarSemSessao(engine, pr, acct); return; }

  if (porta.devolverSeSilenciada(engine, pr)) { encerrarSemSessao(engine, pr, acct); return; }
  try {
    if (hasPolicies(engine)) await prepareAccount(engine, engine.accountForPr(pr));
    if (aguardaCliquePorRegra(engine, pr)) return;
    if (await esperaCiNoInicio(engine, pr, true)) return;
    await engine.runHeadlessReview(pr);
    engine.retryAfterNet.delete(pr.key); // o limite do perfil usado sai na própria sessão (comPerfilDaSessao)
  } catch (err) {
    engine.unsee(pr.key);
    // volta VISÍVEL pra fila na hora (não só no próximo ciclo)
    if (!engine.queue.some(p => p.key === pr.key)) engine.queue.push(pr);
    const msg = err.message || '';
    // TRANSITÓRIO (se resolve sozinho, não estaciona): queda de rede, limite do
    // plano Claude (espera o reset), o binário do claude quebrado/indisponível, ou
    // o token da conta sumindo no meio (flake do keyring do gh).
    // A classificação NÃO mora mais aqui: quatro regexes inline decidiam isto de um
    // lado enquanto o painel de Diagnóstico lia o mesmo texto do outro sem entender
    // nada. Hoje os dois leem a mesma tabela (lib/log-taxonomy.js) e aqui só se
    // pergunta o que FAZER com a falha. Falha desconhecida cai em 'permanente' de
    // propósito: sem saber o que houve, relançar sozinho vira loop queimando token.
    const classe = classify(msg);
    const limitErr = classe.kind === 'espera-reset';
    const transient = limitErr || classe.kind === 'transitorio';
    if (err.quotaReservation) {
      deferBlockedReview(engine, pr, err.quotaReservation);
    } else if (err.aguardaRetomada) {
      aguardarConfirmacaoDeHead(engine, pr, msg);
    } else if (err.coordenacao) {
      // D14: o heartbeat perdeu o lease e o coordenador cancelou a sessão. Vem ANTES do
      // ramo de cancelamento de propósito (a sessão chega aqui com cancelled também):
      // quem cancelou foi a coordenação, não você, então nada estaciona, nada entra no
      // retry e nada foi postado. O PR já voltou pra fila no topo deste catch.
      // a entrada de retry que já existia sai junto, pelo mesmo motivo do ramo de
      // cancelamento: deixá-la viva faria o próprio check() relançar no ciclo seguinte
      // um PR que a coordenação acabou de tirar deste aparelho
      engine.retryAfterNet.delete(pr.key);
      engine.log('WARN', `revisao ${pr.key}: lease de coordenação perdido durante a sessão; nada foi postado`);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: outro aparelho assumiu a coordenação; esta sessão foi encerrada sem postar.` });
    } else if (classe.id === CLASSE_COORDENACAO) {
      // D11 da sincronização: a classe é 'transitorio' para o Diagnóstico ler certo,
      // mas aqui ela NÃO segue o ramo transitório. Retry com teto terminaria em
      // estacionamento, e coordenação fora do ar não é defeito do PR: o PR já voltou
      // pra fila (unsee + queue.push acima) e quem segura o relançamento é o gate de
      // coordenação, que pula a automação enquanto a conexão não volta.
      engine.log('WARN', `revisao ${pr.key} (coordenação indisponível, volta pra fila sem estacionar): ${msg}`);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: coordenação entre aparelhos indisponível; o PR voltou pra sua fila.` });
    } else if (err.cancelled && vigiaMod.abandonoDe(engine, pr.key)) {
      // o VIGIA encerrou: durante a sessão chegou commit novo, ou a revisão deste head
      // passou a existir. Nos dois casos não houve falha e não há o que estacionar; o que
      // muda é se o PR volta ou não. Head novo volta (é outro trabalho, e o topo deste
      // catch já devolveu à fila); já revisado sai de cena, porque refazer o que está
      // feito é justamente o desperdício que o vigia existe pra cortar.
      tratarAbandonoDoVigia(engine, pr);
    } else if (err.cancelled && fechamento.foiTransferida(engine, pr.key)) {
      // encerrada pela TRANSFERÊNCIA: o PR foi entregue a outro aparelho. Não é
      // cancelamento seu, então nada estaciona e nada entra no retry; o PR já voltou pra
      // fila visível no topo deste catch, e a referência de retomada não serve lá.
      engine.retryAfterNet.delete(pr.key);
      retomadaMod.consumirRetomada(engine, pr.key);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: revisão entregue a outro aparelho; nada foi postado daqui.` });
    } else if (err.cancelled) {
      // cancelado por você: estaciona pra não relançar sozinho (você reabre quando quiser).
      // O delete do retry é pelo mesmo motivo do ramo não-transitório lá embaixo (leia o
      // comentário do incidente de 04/08/2026): cancelar um PR que estava em retry e
      // deixar a entrada viva faz o próprio check() desfazer o cancelamento no ciclo seguinte.
      estacionar(engine, pr.key, 'cancelada por você', 'cancelado', pr.headLido);
      // cancelar é desfecho: um clique posterior começa sessão nova, nunca retoma a cancelada
      retomadaMod.consumirRetomada(engine, pr.key);
      engine.emit('toast', { kind: 'info', text: `Revisão de ${pr.key} cancelada. O PR voltou pra sua fila.` });
    } else if (tentarFallbackLogin(engine, pr, acct, err)) {
      registrarFalhaHeadless(engine, pr, err, 'review');
    } else if (transient) {
      // limite do plano se resolve no reset; rede/binário costumam voltar rápido.
      // Retoma sozinho no próximo ciclo bem-sucedido, até um teto (aí estaciona).
      registrarFalhaHeadless(engine, pr, err, 'review');
      const cap = limitErr ? 12 : 3;
      const guardado = engine.retryAfterNet.get(pr.key);
      const tries = (guardado && guardado.tries) || 0;
      engine.log('WARN', `revisao ${pr.key} (transitório, tenta de novo): ${msg}`);
      // o limite é da ASSINATURA que a sessão usou; com outro perfil livre na cadeia o PR segue
      // nele sem gastar tentativa nem estacionar (lib/engine/limite-na-cadeia.js)
      const limite = limitErr ? aposLimite(engine, pr, err, msg) : null;
      const trocou = limite?.notBefore === null;
      if (tries < cap || trocou) {
        // Limite de plano tem HORA pra voltar, e ela vem escrita na própria mensagem
        // ("resets 9pm"). Antes disso o PR era tratado como flake qualquer e tentava
        // de novo a cada ciclo: em 07/08/2026 foram 70 linhas de log em 8 PRs pra UMA
        // condição de hora conhecida. Agora a entrada carrega o instante do reset e o
        // retryTargets pula quem ainda não chegou lá. Com a cadeia de perfis (20/10/2026),
        // notBefore null num limite quer dizer que há outro perfil livre.
        // guarda o PR junto das tentativas: o relançamento não pode depender de o
        // PR seguir na fila mine (clique no panorama sai da queue no rebuild do check).
        // Junto vai o sid da sessão que caiu (session.js estampa err.sessionId), pra o
        // relançamento CONTINUAR aquela sessão em vez de reler o PR inteiro. Queda antes
        // de a sessão nascer não traz sid novo: nesse caso mantém o anterior, senão uma
        // cascata de quedas de rede jogaria fora a leitura já feita.
        const prRetomada = prComRetomada(engine, pr, err, guardado);
        engine.retryAfterNet.set(pr.key, { tries: trocou ? tries : tries + 1, pr: prRetomada, notBefore: limite?.notBefore ?? null });
        engine.emit('toast', { kind: 'error', text: limite
          ? limite.aviso
          : `Revisão de ${pr.key} caiu por algo transitório; tento de novo no próximo ciclo. Está na sua fila.` });
      } else {
        estacionar(engine, pr.key, msg, 'esgotado', pr.headLido, err.sessaoFarol);
        engine.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
        engine.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou várias vezes; parei de tentar sozinho. O PR está na sua fila.` });
      }
    } else {
      // Falha não-transitória de verdade: estaciona pra não relançar em loop.
      // O delete do retry é OBRIGATÓRIO, não zelo: sem ele o estacionamento é
      // mentira. O check() só olha retryAfterNet.size pra decidir se repesca, e o
      // launchReview faz autoReviewParked.delete em tudo que lança, ou seja, a
      // entrada órfã de retry desfaz o estacionamento no ciclo seguinte. Foi
      // exatamente o incidente de 04/08/2026 com biudtech/biud-frontend#702: caiu
      // por algo transitório às 16:07 (entrou no retry), a falha virou permanente
      // (a org desligou o acesso por assinatura) e o PR ficou em loop SEM TETO,
      // 25 linhas ERROR idênticas entre 15:52 e 19:28, até alguém mexer no app.
      registrarFalhaHeadless(engine, pr, err, 'review');
      estacionar(engine, pr.key, msg, 'falha', pr.headLido, err.sessaoFarol);
      // falha permanente é desfecho: retomar a sessão que falhou repetiria a falha
      retomadaMod.consumirRetomada(engine, pr.key);
      engine.log('ERROR', `revisao autonoma ${pr.key}: ${msg}`);
      engine.emit('toast', { kind: 'error', text: `Revisão de ${pr.key} falhou: ${msg}` });
    }
  } finally {
    engine.freeHeadlessSlot(acct, pr);
    fecharSeDistribuido(engine, pr);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
  }
}

// Passo 9 do anexo S3: quem executou um item do conjunto fecha o item ao terminar. Só o
// item que veio do conjunto carrega a identidade dele; o resto é recusado por forma lá
// dentro. Não espera o banco: falha aqui cai na faxina do agendador. Sessão encerrada por
// transferência não fecha: o item acabou de subir de novo, preferindo o destino.
function fecharSeDistribuido(engine, pr) {
  if (fechamento.soltarTransferida(engine, pr.key)) return;
  fechamento.fecharItem(engine, pr.itemIdDistribuido).catch(() => undefined);
}

// Marca o desfecho da tentativa no registro ativo (CT-RET): é o que o diagnóstico lê,
// e é o mesmo valor que viaja no opts até o registro de consumo. Motor sem
// activeReviews (teste mínimo) só não marca.
function marcarDesfecho(engine, id, desfecho) {
  const s = engine.activeReviews instanceof Map ? engine.activeReviews.get(id) : null;
  if (s) s.resumeOutcome = desfecho;
}

// Uma tentativa de sessão com o desfecho carimbado antes (pra quem registra consumo
// durante a sessão) e confirmado depois: admissão recusada não abriu nada, então o
// desfecho efetivo é nenhuma, mesmo que a tentativa fosse de retomada.
async function sessaoComDesfecho(engine, prompt, opts, desfecho) {
  marcarDesfecho(engine, opts.id, desfecho);
  const res = (await engine.runClaudeStream(prompt, { ...opts, resumeOutcome: desfecho })) || {};
  const efetivo = res.blocked ? 'nenhuma' : desfecho;
  marcarDesfecho(engine, opts.id, efetivo);
  return Object.assign(res, { resumeOutcome: efetivo });
}

// roda a sessão de revisão, retomando quando o chamador passou um sid válido (a
// retomada por queda validada, ou o round incremental opt-in): a mesma heurística de
// degradação do chat.js decide se o erro é do resume em si (sessão expirada/limpa
// recomeça do zero) ou falha real (sobe pro retry de sempre). Cancelamento sempre sobe.
// `semRetomada` é o desfecho da sessão sem sid: 'nova' quando uma referência foi
// descartada antes, 'nenhuma' quando não havia referência.
async function rodarSessao(engine, promptFinal, streamOpts, sid, jaAnunciada = false, blocoRetomada = '', semRetomada = 'nenhuma') {
  if (!sid) return sessaoComDesfecho(engine, promptFinal, streamOpts, semRetomada);
  // uma linha por evento: quando a retomada é por queda, quem já anunciou (com o
  // motivo) foi o anunciaRetomada, e repetir aqui duplicaria a mesma notícia na
  // esteira. Texto neutro porque este ponto não sabe qual é a origem do sid.
  if (!jaAnunciada) engine.pushActivity(streamOpts.id, 'info', 'Retomando a sessão anterior (continua a mesma conversa).');
  try {
    // SOMA, nunca substitui: o spread copia extraArgs e a atribuição jogaria fora
    // os argumentos do MCP montados pelo chamador, deixando a sessão retomada sem
    // ferramenta de Jira e sem erro nenhum aparecer.
    const argsRetomada = [...(streamOpts.extraArgs || []), '--resume', sid];
    return await sessaoComDesfecho(engine, promptFinal + blocoRetomada, { ...streamOpts, extraArgs: argsRetomada }, 'retomada');
  } catch (err) {
    if (err.cancelled || !/resume|no conversation|session id|session_id/i.test(err.message || '')) throw err;
    engine.pushActivity(streamOpts.id, 'info', 'Sessão anterior indisponível pra retomada; recomeçando do zero.');
    // a referência recusada sai ANTES da sessão nova: se esta cair antes de nascer, a
    // próxima tentativa não insiste num sid que o CLI já recusou
    if (typeof streamOpts.onRetomadaRecusada === 'function') streamOpts.onRetomadaRecusada();
    // sessão NOVA: o bloco de retomada fica de fora. Ele manda não reler o que já
    // foi lido, e numa sessão que nasce agora isso seria instrução pra pular
    // leitura que ninguém fez.
    return sessaoComDesfecho(engine, promptFinal, semNovaRodada(streamOpts), 'recusada');
  }
}

// O VIGIA encerrou a sessao: durante ela chegou commit novo, ou a revisao deste head
// passou a existir. Nos dois casos nao houve falha e nao ha o que estacionar; o que muda
// e se o PR volta ou nao. Head novo volta (e outro trabalho, e o catch ja devolveu a
// fila); ja revisado sai de cena, porque refazer o que esta feito e justamente o
// desperdicio que o vigia existe pra cortar.
function tratarAbandonoDoVigia(engine, pr) {
  const motivo = vigiaMod.abandonoDe(engine, pr.key);
  vigiaMod.consumirAbandono(engine, pr.key);
  engine.retryAfterNet.delete(pr.key);
  retomadaMod.consumirRetomada(engine, pr.key);
  if (motivo === vigiaMod.MOTIVOS.REVISADO) {
    vigiaMod.sairDeCena(engine, pr, `${pr.key}: a revisão deste head já existia; a sessão foi encerrada sem gastar o resto.`);
    return;
  }
  engine.emit('toast', { kind: 'info', text: `${pr.key}: chegou commit novo durante a revisão; a sessão foi encerrada e o head novo entra na fila.` });
}

// A sessao roda VIGIADA: de tempos em tempos o vigia confere se o mundo andou (commit
// novo, revisao deste head ja existente) e encerra em vez de pagar ate o fim por um
// resultado que ja nasceu velho. O vigia para SEMPRE junto com a sessao.
async function sessaoVigiada(engine, pr, id, headShaAtual, args) {
  const olho = vigiaMod.iniciar(engine, pr, id, headShaAtual);
  try {
    return await rodarSessao(engine, ...args);
  } finally {
    olho.parar();
  }
}

// prova por arquivo desta sessão: o retrato do diff (blobs) + o que ficou COBERTO
// neste head (lido agora ou herdado, já reconciliado pelo chamador). É o que
// permite o próximo round herdar leitura e o launchReReviews pular push trivial.
// Envelope sem coverage não prova leitura nenhuma (mesma régua do coverageGap):
// a prova sai com reviewed vazio e só serve pro pulo de push trivial.
// Best-effort: falha aqui nunca derruba a revisão.
function salvarProvaDaSessao(pr, headSha, arquivos, result) {
  if (!headSha || !Array.isArray(arquivos) || !arquivos.length) return;
  const cov = result.coverage;
  const cobertos = (cov && Array.isArray(cov.reviewed)) ? [...new Set(cov.reviewed.map(String))] : [];
  try {
    saveFileProof(pr.key, { head: headSha, at: Date.now(), sessionId: result.sessionId || null, files: arquivos, reviewed: cobertos });
  } catch { /* melhor perder a prova que a revisão */ }
}

/* ---------- label de revisão em andamento (pedido do Thiago, 18/08/2026; de volta em 28/08/2026 à tarde) ----------
   Quando a revisão headless começa, o PR ganha a label "<conta>:revisando" (ex.:
   thiagocarvalho-dev:revisando) pro time ver no GitHub que o review está acontecendo,
   e a perde quando a sessão termina (sucesso, falha ou cancelamento, via finally).
   Em 28/08/2026 de manhã a label foi tratada como vazamento de automação e a
   v2.53.9 a trocou por refs git invisíveis; à tarde o Wanderson corrigiu o rumo
   e ela VOLTOU por decisão dele: a visibilidade pro time É desejada ("deixa os
   demais membros cientes da revisão"). O que continua proibido é TEXTO público
   não-humanizado (o comentário-template de pulo segue morto, e o firewall de
   linguagem dos reviews fica como está); a label é um marcador, não um texto.
   Se a label não existe no repo, o Farol CRIA (pedido do Thiago, 19/08/2026; até
   então a falha do `--add-label` era o próprio "se existir" e a label nunca nascia
   sozinha): a adição que falha dispara um `gh label create` e UMA nova tentativa de
   adição. A criação usa cor fixa e descrição neutra, sem citar o Farol (o autor do
   PR não pode saber que é automação, mesma regra do corpo do review). Best-effort
   dos dois lados: nada aqui toca a revisão em si. Remoção sem confirmação vira
   pendência, inclusive quando a resposta da tentativa de inclusão se perde.
   O repoDoPr vem de review-signal.js (a leitura de transição das refs ainda o usa). */
function inProgressLabelFor(user) {
  const u = String(user || '').trim();
  return u ? `${u}:revisando` : '';
}

const IN_PROGRESS_LABEL_COLOR = 'FBCA04';
const IN_PROGRESS_LABEL_DESC = 'revisão em andamento';

// Devolve a label tentada: erro de resposta não prova que o GitHub deixou de aplicá-la.
// A intenção durável precede o envio; sem ela a revisão segue sem adicionar o marcador.
// `run` é injetável só pra teste (o default é o io.run de sempre).
async function addInProgressLabel(engine, pr, run = io.run) {
  const acc = engine.accountForPr(pr);
  const label = inProgressLabelFor(acc);
  if (!label || !pr.url || !engine.tokenFor(acc)) return '';
  return naOrdem(engine, pr.key, label, () => adicionarMarcador(engine, pr, acc, label, run));
}
async function adicionarMarcador(engine, pr, acc, label, run) {
  if ([...(engine.activeReviews?.values() || [])].some(s => s.keys?.some(key => mesmoPr(key, pr.key)) && s.labelsRemovidas?.includes(label.toLowerCase()))) return '';
  if (!labelsATirar.anotar(engine, pr, label)) return '';
  try {
    const env = engine.ghEnv(acc);
    const adiciona = () => run('gh', ['pr', 'edit', pr.url, '--add-label', label], { env });
    let r = await adiciona();
    if (r.ok) return label;
    // a causa mais comum da falha é a label não existir no repo: cria e tenta
    // de novo UMA vez. Falha por outra causa (rede, permissão) derruba também
    // a criação ou a retentativa; a limpeza continua responsável pela tentativa.
    const repo = repoDoPr(pr);
    if (!repo) return label;
    const c = await run('gh', ['label', 'create', label, '--repo', repo,
      '--color', IN_PROGRESS_LABEL_COLOR, '--description', IN_PROGRESS_LABEL_DESC], { env });
    if (!c.ok) return label;
    r = await adiciona();
    return label;
  } catch { return label; }
}

// a remoção que falha fica anotada e o check() tenta de novo (lib/engine/labels-a-tirar.js)
async function removeInProgressLabel(engine, pr, label, run = io.run) {
  if (!label) return true;
  return naOrdem(engine, pr.key, label, () => labelsATirar.remover(engine, pr, label, run, label.split(':')[0]));
}

/* Limpeza das labels que ESTA cópia deixou presas (29/08/2026). O
   `removeInProgressLabel` mora num `finally`, e finally não roda quando o
   processo morre: queda de renderer, kill, reinício do auto-update. A label
   presa não caducava em lugar nenhum, então um Farol morto calava a frota
   inteira naquele PR ("o Farol tem pulado review sem ninguém estar analisando").
   O `labelVistaDesde` cobre o lado de QUEM LÊ a label alheia; isto aqui cobre o
   lado de QUEM ESCREVE, que é onde o lixo nasce.

   Roda uma vez no boot, sobre a lista que o recoverInflight recuperou, e é
   Falha de rede ou token fica durável para o próximo ciclo. Nada aqui pode
   derrubar a subida do app. */
async function limparLabelsOrfas(engine, prs, run = io.run) {
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!pr || !pr.url) continue;
    const label = inProgressLabelFor(engine.accountForPr(pr));
    if (label) labelsATirar.anotar(engine, pr, label);
  }
  try { await labelsATirar.tirarPendentes(engine, run); } catch { /* A pendência sobrevive ao boot. */ }
}

/* Tempo por etapa da revisão: a heurística e a soma moram em
   lib/engine/etapas-revisao.js (saíram daqui em 30/09/2026, quando o ratchet de
   tamanho passou a medir o excesso de linhas e este arquivo não podia mais crescer). */

// Modo rápido (config.reviewFast, opt-in): corta o tempo da revisão SEM afrouxar
// gate nenhum. A troca honesta: menos experimento empírico = mais needs_decision
// quando a prova exigiria tempo; o que o modo nunca faz é afirmar sem prova.
// Retomada depois de queda (rede ou tempo esgotado): a sessão anterior é a MESMA
// revisão, no mesmo head, então continuar de onde parou é o comportamento certo, não
// um atalho. O bloco só orienta a continuidade; contrato de saída e gates não mudam.
function retomadaAposFalhaBlock() {
  return `\n\n## RETOMADA DESTA MESMA REVISÃO\n` +
    `A sessão anterior desta revisão caiu por instabilidade de conexão ou por tempo esgotado, não por decisão sua.\n` +
    `1. Continue de onde parou.\n` +
    `2. Não releia arquivo que você já leu nesta sessão, nem repita verificação já registrada no checkpoint.\n` +
    `3. Entregue o envelope final no mesmo contrato, com a cobertura completa e honesta.\n`;
}

// Escolha do sid de retomada, um lugar só. Duas origens, políticas diferentes:
// `retomarSid` (queda transitória ou recuperação do boot) NÃO é opt-in e mora na
// referência durável; ele só vale quando validarRetomada (lib/engine/retomada-duravel.js)
// comprovou PR, head confirmado e contexto local. `resumeSid` (round incremental da
// re-revisão) segue atrás de config.reReviewResume, sem mudança. Referência descartada
// não cai no resumeSid: a revisão lê do zero, como antes quando o head mudava.
// Formato sempre pela allowlist: sid fora dela nunca entra numa linha de shell.
function sidDeRetomada(engine, pr, validacao, entrada) {
  if (validacao.acao === 'retomar') {
    return { sid: String(entrada.retomarSid), aposFalha: true, motivo: validacao.motivo, semRetomada: 'nenhuma' };
  }
  if (validacao.acao === 'descartar') return { sid: '', aposFalha: false, motivo: validacao.motivo, semRetomada: 'nova' };
  const optIn = (engine.config || {}).reReviewResume && !!pr.resumeSid && RESUME_SID_RE.test(String(pr.resumeSid));
  return { sid: optIn ? String(pr.resumeSid) : '', aposFalha: false, motivo: validacao.motivo, semRetomada: 'nenhuma' };
}

// bloco de prompt + linha de atividade da retomada, num par só: quem retoma (ou
// deixa de retomar) sem dizer por quê deixa a esteira parecendo revisão pela metade.
// Devolve '' quando não é retomada por falha (descarte, round incremental ou sessão nova).
function anunciaRetomada(engine, id, retomada) {
  const aviso = AVISO_DESCARTE[retomada.motivo];
  if (retomada.semRetomada === 'nova' && aviso) {
    engine.pushActivity(id, 'info', aviso);
    return '';
  }
  if (!retomada.aposFalha) return '';
  engine.pushActivity(id, 'info', 'Retomando a sessão interrompida por instabilidade (sem reler o que já foi lido).');
  return retomadaAposFalhaBlock();
}

// espera de confirmação do head, levantada de dentro do try do runHeadlessReview
// pra o finally limpar o registro ativo; o runOneHeadless a trata como espera
function erroAguardaRetomada(key) {
  return Object.assign(new Error(`${key}: head do PR não confirmado no GitHub; a retomada da sessão interrompida aguarda a próxima checagem`), { aguardaRetomada: true });
}

// sid persiste assim que nasce (não só no fim da revisão): o onSession dispara
// uma vez, no primeiro evento que traz session_id. A referência durável nasce aqui
// com o head e o contexto local desta sessão (CT-RET), e o inflight.json é regravado
// na hora, pra sobreviver a queda do app no meio.
function registrarSessionId(engine, id, sid) {
  const s = engine.activeReviews.get(id);
  if (!s) return;
  s.sessionId = sid;
  if (s.pr) {
    retomadaMod.guardarRetomada(engine, s.pr, {
      retomarSid: sid, knownHead: s.headSha || '', provedor: s.provedor || '', perfilId: s.perfilId || '',
      sessionId: sid, headSha: s.headSha || '',
    });
  }
  engine.writeInflight();
}

// A fase diz em que PARTE da revisão a sessão está: 'modelo' enquanto o Claude fala,
// 'fechando' depois que ele devolveu e o Farol decide e posta. Só isto, e não uma
// estimativa de quanto falta, que o app não tem como saber.
function marcarFase(engine, id, fase) {
  const rec = engine.activeReviews && engine.activeReviews.get(id);
  if (!rec || rec.fase === fase) return;
  rec.fase = fase;
  engine.pushState();
}

async function runHeadlessReview(engine, pr) {
  const continuidade = iniciarTrabalho(engine, pr);
  if (!continuidade) return { ok: false, code: 'conta_silenciada' };
  const { id, rotulo } = novoIdDeSessao(engine, 'a');
  engine.activeReviews.set(id, {
    id, rotulo, keys: [pr.key], label: `Revisão automática de ${pr.key}`, mode: 'auto', checkpoint: 'review',
    startedAt: Date.now(), cancellable: true, resumeOutcome: 'nenhuma', fase: 'modelo',
    pr: prDaSessao(engine, pr)
  });
  // contexto local de provedor e perfil desta sessão (CT-RET): gravado com a referência
  // de retomada (registrarSessionId, prComRetomada) e comparado antes de reutilizá-la
  const contextoLocal = retomadaMod.contextoDaConta(engine, pr);
  Object.assign(engine.activeReviews.get(id), contextoLocal);
  pr.contextoLido = contextoLocal;
  engine.activity.set(id, []);
  // SHA do head no INÍCIO da sessão: carimbado em cada entrada de checkpoint gravada
  // por esta revisão (session.js), pra a Task 13 poder invalidar entradas de um head
  // antigo quando o PR ganha commit novo, e usado pelo dedup de postagem lá embaixo pra
  // saber se o review que eu já tenho no PR é desta rodada ou da anterior (#742).
  // Falha aqui (exceção ou string vazia, que é o que o `run` devolve quando o gh não
  // responde) cai no `knownHead` que veio com o relançamento automático (G8), logo abaixo.
  // Sem nenhum dos dois, degrada pra headSha vazio (nunca filtra, nunca bloqueia por causa
  // de uma falha de rede), mesmo padrão do fan-out.
  // headConfirmado é SÓ o que o GitHub respondeu agora; o knownHead do enfileiramento
  // (G8) continua servindo de âncora da rodada, mas nunca de confirmação pra retomada
  let headConfirmado = '';
  try {
    headConfirmado = String((await engine.headSha(pr)) || '');
    engine.activeReviews.get(id).headSha = headConfirmado;
  } catch { /* sem SHA do fetch: tenta o knownHead do enfileiramento abaixo */ }
  if (!(engine.activeReviews.get(id) || {}).headSha && pr.knownHead) {
    engine.activeReviews.get(id).headSha = pr.knownHead; // G8: fallback do relançamento
  }
  const headShaAtual = (engine.activeReviews.get(id) || {}).headSha || '';
  // carimba no MESMO objeto de PR que o runOneHeadless segura: se esta sessão cair,
  // o prComRetomada copia isto pro knownHead da entrada do retryAfterNet e a guarda
  // de head do sidDeRetomada tem com o que comparar no relançamento. Sem isso a
  // guarda era inerte em todo caminho que não fosse o relançamento da re-revisão.
  // Campo próprio (e não knownHead direto) de propósito: o objeto do PR sobrevive a
  // vários rounds, e escrever knownHead aqui mudaria o fallback G8 acima pra usar o
  // head de uma rodada antiga quando a leitura do head falhar numa rodada futura.
  if (headShaAtual) pr.headLido = headShaAtual;
  // rodada sem head conhecido não é neutra, é CEGA, e até aqui ela era silenciosa.
  // Sem head: o dedup compara com qualquer review meu antigo, o gate de "o head andou
  // durante a sessão" nunca arma, o review sai sem âncora de commit, a prova por
  // arquivo não é salva e o checkpoint nasce sem head (e entrada sem head segue
  // relevante em toda rodada futura). Medido em 30/08/2026: 12 de 247 rodadas desde
  // 15/08 correram assim, e uma delas (engine-ai#51) postou um SEGUNDO APPROVE no
  // mesmo commit. Continua degradando (falha de rede nunca cancela revisão), mas agora
  // deixa rastro no farol.log, que é a fonte do Diagnóstico.
  // CT-RET: a referência de retomada é validada ANTES de qualquer label, card ou sessão.
  // Descarte comprovado sai do Map agora (a sessão nova registra a dela no onSession);
  // head não confirmado é espera, levantada no início do try abaixo.
  const entradaRetomada = retomadaMod.lerRetomada(engine, pr.key);
  const validacaoRetomada = retomadaMod.validarRetomada(entradaRetomada, {
    prKey: pr.key, headConfirmado, contexto: contextoLocal,
    concluida: retomadaMod.concluidaDepois(engine, entradaRetomada),
  });
  if (validacaoRetomada.acao === 'descartar') retomadaMod.consumirRetomada(engine, pr.key);
  if (!headShaAtual && validacaoRetomada.acao !== 'aguardar') {
    engine.log('WARN', `${pr.key}: não consegui confirmar o head antes da revisão; a rodada segue sem âncora de commit (dedup e prova por arquivo ficam de fora).`);
  }
  engine.writeInflight();
  engine.pushState();
  // sinaliza que o review começou (a label "<conta>:revisando", de volta por
  // decisão do Wanderson de 28/08/2026 à tarde; ver o bloco da label acima).
  // Declarada FORA do try pra remoção no finally; atribuída DENTRO pra falha
  // inesperada nunca vazar a sessão registrada acima.
  let labelEmAndamento = '';
  // handle da coordenação entre aparelhos (null com ela desligada): cada desfecho grava
  // o recibo e o finally devolve o lease do que não chegou a desfecho
  let coord = null;
  let technicalContext;
  let reading;
  // Com a coordenação ligada a label entra na admissão, não aqui: antes dela seria escrita
  // pública no GitHub sem sessão nenhuma a cada recusa (a espera de 'indisponivel' é de
  // segundos) e, com lease alheio, uma label que ninguém tira. O runClaudeStream chama
  // isto entre a admissão e o spawn; de novo numa segunda admissão (retomada recusada),
  // e o gh trata o add repetido como no-op.
  const porLabelNaAdmissao = async () => { labelEmAndamento = await addInProgressLabel(engine, pr); };
  // Desfecho com lease: a label sai ANTES do recibo, porque complete() solta o lease, e um
  // aparelho que assumisse o head novo no intervalo teria a label dele (mesmo nome) apagada
  // pela remoção atrasada do finally. Sem coordenação o finally segue tirando a label.
  const fecharDesfecho = async (opcoes) => {
    if (coord) {
      const label = labelEmAndamento;
      labelEmAndamento = '';
      await removeInProgressLabel(engine, pr, label);
    }
    await concluirCoordenacao(engine, pr, coord, opcoes);
  };
  try {
    if (validacaoRetomada.acao === 'aguardar') throw erroAguardaRetomada(pr.key);
    conferirCancelamento(engine, id);
    if (!coordenacaoLigada(engine)) labelEmAndamento = await addInProgressLabel(engine, pr);
    reading = await prepareReviewReading(engine, pr, id, headShaAtual);
    const { inventory: inventario, files: arquivosAtuais, blobs: blobsAtuais, previous: provaAnterior, inheritance: heranca } = reading;
    if (!arquivosAtuais) engine.log('WARN', `inventário ${pr.key}: ${inventario.reason}; postagem automática impedida`);
    conferirCancelamento(engine, id);

    const { lotes, metricsLeitura } = await fanoutMod.medirEFatiar(engine, pr, heranca, id, inventario);
    conferirCancelamento(engine, id);
    // tempo típico de revisão deste tamanho, que a barra do cartão usa (estimativa-sessao.js)
    anotarEstimativa(engine, id, metricsLeitura);
    // roteador de modelo: quando reviewModel === 'auto', escolhe pelo contexto do PR
    // (repositório, caminhos, tamanho) e depois pelo tamanho, com as métricas já medidas.
    // Modelo pinado na config segue intacto. A escolha viaja em streamOpts pra
    // buildModelFlags, nunca como string 'auto' na cmdline.
    const rota = escolheModelo(metricsLeitura, engine.config || {}, { repo: String(pr.key || '').split('#')[0] });
    if (rota.origem && rota.origem.startsWith('auto')) {
      const partes = [`Modelo: ${rota.model || 'padrão'}`];
      if (rota.effort) partes.push(`esforço ${rota.effort}`);
      if (rota.fast) partes.push('rápido');
      engine.pushActivity(id, 'info', `${partes.join(' · ')} (${rotuloOrigem(rota.origem, rota.gatilho)}).`);
    }
    const specialist = await prepareSpecialist(engine, pr, inventario, { mode: reading.prepared.mode,
      relevantPaths: reading.prepared.map?.complete ? reading.prepared.selection?.impactedPaths : undefined });
    const roundContext = await roundsMod.prepareRoundReview(engine, pr, headShaAtual, inventario);
    let promptFinal = engine.headlessPromptFor(pr.url, pr.author, lotes, metricsLeitura) + roundsMod.roundMemoryBlock(roundContext) + specialist.block
      + preparedPatchBlock(reading.prepared, reading.scope, engine.config) + reading.prepared.block;
    technicalContext = await technicalRuntime.prepareTechnicalReview(engine, pr, headShaAtual, { sources: reading.prepared.source, sessionId: id,
      signal: engine.activeReviews.get(id)?.sourceAbort?.signal });
    promptFinal += technicalPrompt(technicalContext);
    conferirCancelamento(engine, id);
    const cardRes = await jiraMod.cardForPr(engine, pr);
    conferirCancelamento(engine, id);
    // recurso desligado é o app de antes, não falha: não loga, não etiqueta e não
    // derruba o cardMet.
    const jiraLigado = cardRes.code !== JIRA_CODES.DESLIGADO;
    const criteriaCtx = await criteriaContext(cardRes, engine, pr);
    Object.assign(roundContext, { criteriaCard: criteriaCtx.card, criteriaRelated: criteriaCtx.related, criteriaRelatedAvailable: criteriaCtx.relatedComplete });
    promptFinal += criteriaCtx.prompt;
    if (cardRes.ok) {
      engine.pushActivity(id, 'info', `Card ${cardRes.card.key} lido pelo Farol${cardRes.fromCache ? ' (cache)' : ''}: ${cardRes.card.criteria.length} critério(s) de aceite.`);
    } else if (jiraLigado && cardRes.code !== JIRA_CODES.SEM_CHAVE && cardRes.code !== JIRA_CODES.SITE_NAO_CONFIGURADO) {
      // PR sem chave e org sem site são rotina. O resto é falha de verdade e vai
      // pro farol.log, senão credencial recusada fica igual a "este PR não tem
      // card" na tela e no Diagnóstico.
      engine.log('WARN', `card do Jira ${pr.key} (${cardRes.code}): ${motivoDe(cardRes.code)}`);
      engine.pushActivity(id, 'warn', `Card não lido (${motivoDe(cardRes.code)}); a revisão segue com o card não verificável.`);
    }
    if (heranca.ativa) {
      promptFinal += fileProofBlock(heranca, provaAnterior.head);
      engine.pushActivity(id, 'info', `Revisão incremental: ${heranca.unchanged.length} arquivo(s) inalterados herdam a leitura anterior; lendo ${heranca.changed.length} alterado(s).`);
    }
    const modoRapido = !!rota.fast;
    if (modoRapido) {
      promptFinal += fastModeBlock();
      engine.pushActivity(id, 'info', 'Modo rápido ativado: leitura orientada a diff e verificação empírica só do que decide.');
    }
    // C7: o que OUTRO aparelho já verificou deste PR entra no disco antes da leitura, e a
    // operação registra se herdou tudo, parte ou nada. Herança é MEMÓRIA, nunca sessão: o
    // sid do CLI continua valendo só na máquina que o abriu (CT-RET).
    const doConjunto = await herdarDoConjunto(engine, pr, headShaAtual, blobsAtuais);
    conferirCancelamento(engine, id);
    // o desfecho vai para a sessão, e dela ao andamento que os outros aparelhos leem; só
    // quando a leitura do conjunto aconteceu de fato
    if (doConjunto.ok && engine.activeReviews.get(id)) engine.activeReviews.get(id).heranca = doConjunto.desfecho;
    if (doConjunto.herdadas) {
      engine.pushActivity(id, 'info', `Checkpoint do conjunto: ${doConjunto.herdadas} verificação(ões) de outro aparelho, herança ${doConjunto.desfecho}.`);
    }
    const cpAntesDeComecar = readCheckpoint(checkpointPath(pr.key));
    if (cpAntesDeComecar.ok) {
      const relevantesAntes = relevantEntries(cpAntesDeComecar.entries, headShaAtual, blobsAtuais);
      if (relevantesAntes.length) promptFinal += resumeBlock(relevantesAntes.length, checkpointPath(pr.key));
    }
    // retomada por queda: decidida aqui pra o bloco entrar no MESMO prompt de sempre
    // (não existe caminho de prompt paralelo pro relançamento, ver
    // test/checkpoint-retry-same-path.test.js).
    const retomada = sidDeRetomada(engine, pr, validacaoRetomada, entradaRetomada);
    // o bloco NÃO entra no promptFinal: quem só vale na tentativa com --resume é
    // ele, e a degradação pra sessão nova dentro do rodarSessao reusa o prompt
    // base. Vai como último argumento e é somado lá, na tentativa certa.
    const blocoRetomada = anunciaRetomada(engine, id, retomada);
    const streamOpts = {
      id,
      account: engine.accountForPr(pr),
      ref: pr.key,
      // modo rápido derruba o esforço de raciocínio na linha de comando (a parte
      // do tempo que o prompt não alcança); só a REVISÃO passa esta flag, chat,
      // autoanálise, pushback e ferramentas seguem no esforço configurado
      fast: modoRapido,
      recovery: engine.decisions.pending.some(d => d.key === pr.key && d.esperaProva),
      // override do roteador auto (quando reviewModel !== 'auto', model/effort
      // batem com a config e o buildModelFlags se comporta como antes)
      model: rota.model,
      effort: rota.effort,
      extraArgs: jiraMod.mcpArgsFor(engine, cardRes.site),
      onModel: (m) => engine.setSessionModel(id, m),
      // sid persiste assim que nasce (não só no fim): dispara uma vez, no primeiro
      // evento com session_id, e o registrarSessionId grava no inflight.json
      onSession: (sid2) => registrarSessionId(engine, id, sid2),
      // CLI recusou o --resume: a referência vira desfecho antes da sessão nova
      onRetomadaRecusada: () => retomadaMod.consumirRetomada(engine, pr.key),
      // a etapa é estampada AQUI, na entrada do feed: a esteira ao vivo da UI e o
      // resumo final (stageSummaryFrom) leem a mesma estampa, nunca reclassificam
      onEvent: (e) => engine.pushActivity(id, e.kind, e.text, e.agent,
        stageOfLine({ k: e.kind, text: e.text, a: e.agent })),
      // gate da coordenação entre aparelhos (runClaudeStream): tipo fechado + contexto
      operationKind: 'review',
      coordination: contextoCoordenacao(engine, pr, headShaAtual),
      onAdmitted: porLabelNaAdmissao,
    };
    // o sid da retomada já foi escolhido acima (sidDeRetomada), junto do bloco de
    // prompt que ele implica. Falha de retomada degrada pra sessão nova, nunca pra erro.
    const res = await sessaoVigiada(engine, pr, id, headShaAtual,
      [promptFinal, streamOpts, retomada.sid, retomada.aposFalha, blocoRetomada, retomada.semRetomada]);
    if (res.blocked) {
      conferirCancelamento(engine, id);
      if (labelEhDeOutraRevisao(res.coordination)) labelEmAndamento = '';
      return tratarBloqueioDeCoordenacao(engine, pr, res.coordination);
    }
    coord = res.coordination || null;
    conferirCancelamento(engine, id);
    // O MODELO terminou, a revisão não. Daqui até o finally ainda vem checkpoint, card,
    // checks obrigatórios, gate e postagem no GitHub, e nesse intervalo o cartão ficava
    // com o feed parado, o relógio andando e a esteira acumulando tempo na etapa da
    // última linha, como se o Claude ainda estivesse pensando. A fase é o que a tela
    // mostra no lugar disso.
    marcarFase(engine, id, 'fechando');
    const result = await recuperarResultado(engine, await resultadoComReparo(engine, res, id, streamOpts), res, id, streamOpts, roundContext, criteriaCtx.sources, headShaAtual, pr);
    conferirCancelamento(engine, id);
    // a sessão devolveu resultado: a referência de retomada cumpriu o papel (CT-RET)
    retomadaMod.consumirRetomada(engine, pr.key);
    // desfecho da retomada viaja no resultado até o recordDecision; quem persiste é a A1
    result.resumeOutcome = res.resumeOutcome || 'nenhuma';
    result.sessionId = res.sessionId || null;
    // tempo por etapa: calculado AGORA, porque o finally apaga o feed junto com a
    // sessão e este é o último momento em que o traço existe. O tamanho do PR vai junto,
    // para a estimativa das próximas revisões comparar PR de tamanho parecido.
    result.stages = etapasComTamanho(engine, id, metricsLeitura);
    // G12: o head que ESTA sessão leu viaja com o resultado, pra recordDecision carimbar
    // no item e a reconciliação saber de qual estado do PR a decisão fala. Vazio quando
    // desconhecido (rede), mesmo compromisso do resto: falta de dado nunca inventa prova.
    result.headSha = headShaAtual;
    result.inventarioDiff = { status: inventario.status, reason: inventario.reason,
      headSha: inventario.headSha, baseSha: inventario.baseSha, changedFiles: inventario.changedFiles,
      files: inventario.files || [] };
    // O selo é calculado pelo engine, nunca aceito da saída do modelo.
    result.technicalReview = await technicalRuntime.finishTechnicalReview(technicalContext, result.technicalAssessments, result.technicalDebt);
    delete result.technicalAssessments;
    delete result.technicalDebt;
    conferirCancelamento(engine, id);
    // o card passou a ser lido pelo FAROL, então "card atendido" deixa de ser
    // afirmação do modelo quando não houve card nenhum pra atender. Sem site
    // cadastrado o Farol não pode regredir o auto-approve de quem não usa o
    // recurso, por isso a trava só vale com o Jira ligado.
    if (!cardRes.ok && jiraLigado) result.cardMet = false;
    if (cardRes.ok) result.card = cardRes.card.key;

    // checkpoint de verificação: nesta função ele é lido em dois pontos, cada um com
    // seu propósito (a leitura antes da sessão, acima, decide se injeta o resumeBlock
    // de retomada no prompt; esta aqui, depois da sessão terminar, monta o resumo final
    // em result.verificationCheckpoint). Nunca lido dentro de decision.js (que continua
    // puro). Ver a seção "Checkpoint de verificação" do docs/REVIEW-GATES.md.
    const cpLido = readCheckpoint(checkpointPath(pr.key));
    result.verificationCheckpoint = cpLido.ok
      ? summarizeCheckpoint(cpLido.entries, headShaAtual, blobsAtuais)
      : { malformed: true, reason: cpLido.reason };

    // cobertura herdada (arquivo INALTERADO que a última sessão leu, com a origem em
    // coverage.inherited) e o diff medido no head, prontos ANTES do coverageGap, que segue
    // puro e confere a cobertura contra a medição (lib/engine/file-proof.js).
    const herdados = prepararCoberturaParaOGate(result, arquivosAtuais, heranca);
    if (herdados) engine.pushActivity(id, 'info', `${herdados} arquivo(s) cobertos pela prova da leitura anterior (blob idêntico).`);

    salvarProvaDaSessao(pr, headShaAtual, arquivosAtuais, result);

    // gate do app: aprova sozinho quando aprovável (revisão pedida a mim; clique
    // no panorama nunca auto-posta). Os diagnósticos operacionais permanecem no
    // estado interno e nunca são anexados ao corpo público.
    // reasons vira uma lista de { text, kind } aqui, uma vez só: o que a sessão
    // devolveu no envelope (kind 'content', é a IA apontando algo) fica intacto
    // como texto, só ganha a etiqueta. Todo prepend/append DAQUI PRA BAIXO empurra
    // objeto, nunca string solta, senão a tela não consegue mais distinguir "a IA
    // achou isso" de "o app travou por regra" de "falhou a postagem em si" (ver
    // reviewBoxHtml/resolvedRow em ui/pure.js).
    result.reasons = (result.reasons || []).map(asReason);
    applyCriteriaEvidence(result, roundContext, criteriaCtx.sources);
    // gate, não infra: 'infra' neste repo quer dizer que a POSTAGEM falhou (a tela
    // mostra "falha técnica ao postar" e o decision.js descarta esses motivos
    // quando o retry do post resolve, o que faria o motivo do Jira sumir da
    // história). Card não lido é regra do app segurando a decisão.
    if (!cardRes.ok && jiraLigado && cardRes.code !== JIRA_CODES.SEM_CHAVE) {
      result.reasons = [gateReason(`card não lido no Jira (${cardRes.code}): ${motivoDe(cardRes.code)}`), ...(result.reasons || [])];
    }
    // o que o gate lê do mundo, lido AQUI e entregue como campo do envelope (decision.js
    // continua puro): os checks obrigatórios no head e o uso fora do diff que a sessão
    // declarou, conferido no head (lib/engine/checks-exigidos.js, lib/engine/alcance.js)
    await anexarChecksObrigatorios(engine, pr, result);
    conferirCancelamento(engine, id);
    delete result.alcanceVerificado;
    await verificarAlcance(engine, pr, headShaAtual, result);
    conferirCancelamento(engine, id);
    // Toda prova obrigatória continua exigida, independentemente das tentativas de recuperação.
    result.approvalEvidence = buscaDaProva.lacunasDaRodada(engine, pr, result);
    result.reasons = [...buscaDaProva.pontosDaProvaEsgotada(result), ...(result.reasons || [])];
    const lacunasTecnicas = result.approvalEvidence.filter(g => !isCiGap(g));
    if (lacunasTecnicas.length && result.verdict === 'approve') {
      result.decision = 'needs_decision';
      result.reasons = [...lacunasTecnicas.map(g => gateReason(g)), ...result.reasons];
    }
    result.contextEvidence = reading.prepared.diagnostics;
    attachSpecialistEvidence(result, specialist.summary);
    await roundsMod.finishRoundReview(engine, pr, roundContext, inventario, result);
    confirmCriteriaPersistence(result, roundContext);
    rememberReview(engine, pr, result);
    // o desfecho (o que sai no GitHub e o que fica gravado) mora em desfecho-da-revisao.js
    await desfechoMod.concluirRevisao(engine, { pr, result, id, coord, headShaAtual, fecharDesfecho, continuidade });
  } catch (err) {
    if (engine.activeReviews.get(id)?.cancelled) Object.assign(err, { cancelled: true, message: 'cancelada por você' });
    // lease perdido no meio (D14): outro aparelho assumiu este PR com a mesma conta, e a
    // label de revisando passou a ser dele; tirá-la aqui apagaria o sinal dessa revisão
    if (err && err.coordenacao) labelEmAndamento = '';
    // último momento em que o feed existe: o finally apaga activity junto com a sessão
    anotarFalhaDaSessao(err, id, stageSummaryFrom(engine.activity.get(id), (engine.activeReviews.get(id) || {}).startedAt, Date.now()));
    // desfecho da retomada que a A5 mantém no registro ativo (retomada, recusada, nova)
    if (!err.resumeOutcome) err.resumeOutcome = (engine.activeReviews.get(id) || {}).resumeOutcome;
    throw err;
  } finally {
    encerrarTrabalho(continuidade);
    engine.activeReviews.get(id).cancellable = false;
    try { await technicalRuntime.cleanup(technicalContext); } finally {
      await releaseAnalysisSource(reading?.prepared, engine);
      // Label antes do lease: outro aparelho não pode perder a label que acabou de pôr.
      await removeInProgressLabel(engine, pr, labelEmAndamento);
      await devolverLease(coord);
      engine.activeReviews.delete(id);
      engine.activity.delete(id);
      engine.writeInflight();
      engine.pushState();
    }
  }
}

// --- re-revisão automática pós-push (round 2 sem clique, v2.41.0) -----------
// O caso medido que motivou (biud-frontend#756, 15/08/2026): CHANGES_REQUESTED às
// 00:51, autor corrigiu às 00:57, e a correção ficou parada até alguém pedir a
// re-análise à mão. O Farol era rápido pra abrir o round e passivo pra fechar.
// Aqui: PR do panorama onde o MEU último review foi pedido de mudanças e o head
// mudou (staleInfo, preenchido pelo refreshStaleStates no mesmo ciclo) volta pra
// fila headless sozinho. SÍNCRONA e sem IO, mesmo motivo do retryTargets: é o gate
// que decide gastar sessão Claude, então tem que ser testável sem rede.
// Rodadas PRESAS em sequência (v2.59.3): quantas revisões seguidas terminaram de novo
// em stale_head (o autor empurrou commit durante cada uma). É o desperdício que um teto
// existe pra conter; iteração legítima, que conclui, não conta. Chegou aqui, a espera
// de PR quieto passa de HEAD_QUIETO_MS pra HEAD_QUIETO_LONGO_MS, e o round volta
// sozinho depois dela: nunca vira dependência de clique.
// O teto DIÁRIO local (3 por PR por dia, até a v2.59.2) caiu junto: o 4º push do dia
// virava clique obrigatório até amanhã, anunciado por um toast de 5 segundos. O teto
// COMPARTILHADO entre aparelhos (SYNC.DAILY_ROUNDS_MAX, D13) caiu em 17/10/2026: a reserva
// segue amarrando a rodada ao lease, mas a coordenação a pede sem limite (coordinator.js).
const MAX_RODADAS_PRESAS = 3;

// Dia local (Brasília na prática) em YYYY-MM-DD, pro carimbo de dia da âncora (hoje só
// diagnóstico: o teto diário local saiu na v2.59.3).
function diaLocal(agora = Date.now()) {
  return new Date(agora).toLocaleDateString('sv-SE');
}

// A âncora reReviewLaunched guardou só o head (string) até esta versão; agora é
// { head, dia, rodadas, at }. Leitura sempre passa por aqui: string legada preserva
// o head (o dedup por round continua valendo) e nasce sem carimbo de hora.
function normalizeAncora(v) {
  if (typeof v === 'string') return { head: v, dia: '', rodadas: 1, at: 0 };
  if (v && typeof v === 'object' && typeof v.head === 'string') {
    return { head: v.head, dia: String(v.dia || ''), rodadas: Number(v.rodadas) || 0, at: Number(v.at) || 0 };
  }
  return { head: '', dia: '', rodadas: 0, at: 0 };
}

// `at` (v2.59.3) é quando o round saiu: o destrave por estado novo (destrava.js) só
// aceita commit ou pedido de revisão POSTERIOR a ele, porque o que chegou antes a
// própria rodada relançada já leu. `dia`/`rodadas` seguem gravados (diagnóstico e
// compatibilidade com a âncora do reinício), mas nenhum gate lê mais o contador.
function proximaAncora(ancoraAtual, head, agora = Date.now()) {
  const hoje = diaLocal(agora);
  const a = normalizeAncora(ancoraAtual);
  return { head, dia: hoje, rodadas: a.dia === hoje ? a.rodadas + 1 : 1, at: agora };
}

// Desde a v2.53.0 o gate respeita a AUTONOMIA da conta de verdade (decisão do
// Wanderson, 25/08/2026, medida no engine-ai#90): APPROVE stale também relança
// (antes só CHANGES_REQUESTED, e todo PR iterativo travava no primeiro APPROVE),
// e pendência bloqueada por stale_head DESTRAVA o round em vez de segurá-lo
// (antes o próprio bloqueio impedia o mecanismo que o resolveria). Proteções de
// orçamento, nunca de autonomia: debounce de head quieto (TEMPOS.HEAD_QUIETO_MS,
// contra rajada de pushes) e, desde a v2.59.3, espera longa depois de
// MAX_RODADAS_PRESAS rodadas presas seguidas. Conta com autoReview desligado: nada muda.

// pendência bloqueada por head velho deste PR, se houver (gatilho B)
function pendenciaStale(engine, key) {
  return (((engine.decisions || {}).pending) || []).find(d => d.key === key && d.blockedKind === 'stale_head') || null;
}

const parado = (motivo, detalhe) => ({ estado: 'parado', motivo, ...(detalhe ? { detalhe } : {}) });

// Travas da CONTA e do PR que seguram qualquer round automático. As MESMAS do toReview
// do check(): quem mexer lá, mexe aqui. Devolve o motivo nomeado ou null.
function travaDoRound(engine, pr) {
  if (pr.isDraft) return parado('rascunho'); // G10: draft é trabalho sabidamente em andamento
  const acct = engine.accountForPr(pr);
  if (engine.isMuted(acct)) return parado('conta_silenciada', acct);
  if (!engine.autoReviewFor(acct)) return parado('auto_desligado', acct);
  if (!politicaDeInicio(engine, pr).automatic) return parado('review_manual', acct);
  if (!engine.tokenFor(acct)) return parado('sem_token', acct);
  if (engine.budgetBlockedFor(acct)) return parado('orcamento', acct);
  if (engine.autoReviewParked.has(pr.key)) {
    return parado('estacionado', String(((engine.parkedMotivos || {})[pr.key] || {}).tipo || 'legado'));
  }
  // o gate lê outrosQueSeguram: com revisar junto ligado, ninguém segura (skip-review.js)
  const outros = outrosQueSeguram(engine, pr);
  if (outros.length) return parado('outros_revisando', outros.join(', '));
  if ((engine.skipComentado || {})[pr.key]) return parado('saiu_de_cena');
  if (seguraPelaCoordenacao(engine, pr.key)) return parado('coordenacao');
  const doGrupo = grupoSegura(engine, acct);
  if (doGrupo) return parado('grupo_nao_verificavel', doGrupo);
  return null;
}

// Relógio do debounce: no gatilho A é o carimbo do refreshStaleStates; no B é a idade
// da pendência, ou o `headQuietoDesde` que o destrave carimba quando vê commit novo
// depois de uma rodada presa (o mais novo dos dois vale). Carimbo ausente = espera um
// ciclo (falta de dado nunca dispara), e aí não há hora a prometer.
function relogioDoRound(engine, pr, viaStale, pend, headRound) {
  if (viaStale) {
    const q = (engine.headQuietoDesde || {})[pr.key];
    return { desde: (q && q.head === headRound) ? (Number(q.at) || 0) : null, janela: TEMPOS.HEAD_QUIETO_MS };
  }
  // a rodada que busca a prova no MESMO head sai na hora: nada a esperar do PR (espera-prova.js)
  if (pend.esperaProva && pend.blockedHead === (pend.esperaProva.alvo || pend.headSha)) return { desde: 0, janela: 0 };
  const desde = (pend.createdAt || pend.headQuietoDesde) ? Math.max(Number(pend.createdAt) || 0, Number(pend.headQuietoDesde) || 0) : null;
  const presas = Number(pend.rodadasPresas) || 0;
  return { desde, janela: presas >= MAX_RODADAS_PRESAS ? TEMPOS.HEAD_QUIETO_LONGO_MS : TEMPOS.HEAD_QUIETO_MS, longa: presas >= MAX_RODADAS_PRESAS };
}

/* O gate que EXPLICA (v2.59.3). Até a v2.59.2 era classificaReRound devolvendo
   'relanca' ou null por doze saídas silenciosas, e o card de commit novo não tinha
   como dizer se o Farol ia agir ou se estava esperando você: quem olhava no minuto 2
   concluía que tinha travado (Edicoes-CNBB/biblioteca-cnbb-api#22, 09/09/2026). Agora
   cada saída tem nome. Estados: sem_gatilho | revisando | parado (com motivo) |
   aguardando / espera_longa (com aPartirDe quando há relógio) | relanca.
   A ordem das travas não muda desfecho (todas seguram), só qual motivo a tela vê
   primeiro: o que está acontecendo, depois a conta, depois o PR, por último o relógio.
   SÍNCRONA e sem IO, mesmo contrato de sempre. */
const ESTADOS_DO_GATILHO_A = new Set(['CHANGES_REQUESTED', 'APPROVED', 'DISMISSED']);
function explicaReRound(engine, pr, inflightKeys, agora = Date.now()) {
  const info = (engine.staleInfo || {})[pr.key];
  const pend = pendenciaStale(engine, pr.key);
  // gatilho A: review meu postado ficou stale (APPROVED, CHANGES_REQUESTED ou a
  // aprovação que o push dispensou, DISMISSED, com prova completa). gatilho B:
  // resultado nunca postado, bloqueado por stale_head, com o head observado
  // carimbado na pendência.
  const viaStale = !!(info && info.stale && info.head && ESTADOS_DO_GATILHO_A.has(info.lastState));
  const viaPendencia = !!(pend && pend.blockedHead);
  if (!viaStale && !viaPendencia) return { estado: 'sem_gatilho' };
  const headRound = viaStale ? info.head : pend.blockedHead;
  if (inflightKeys.has(pr.key)) return { estado: 'revisando', headRound };
  const trava = travaDoRound(engine, pr);
  if (trava) return { ...trava, headRound };
  // retry pós-falha transitória: quem relança é o _repescarRetry, quando a rede volta
  if (engine.retryAfterNet.has(pr.key)) return { estado: 'aguardando', motivo: 'retry', headRound };
  // pendência VIVA na mesa segura (julgamento é humano); a stale_head NÃO segura,
  // ela é o sintoma que este gate existe pra resolver
  if ((((engine.decisions || {}).pending) || []).some(d => d.key === pr.key && d.blockedKind !== 'stale_head')) {
    return { ...parado('pendencia_viva'), headRound };
  }
  // âncora por head: cada estado do PR relança NO MÁXIMO uma vez. Chegar aqui sem
  // revisão em andamento é a rodada que já saiu e não concluiu; quem destrava é
  // commit novo ou pedido de revisão (lib/engine/destrava.js)
  if (normalizeAncora((engine.reReviewLaunched || {})[pr.key]).head === headRound) return { ...parado('ancora'), headRound };
  const relogio = relogioDoRound(engine, pr, viaStale, pend, headRound);
  const esperando = relogio.longa ? 'espera_longa' : 'aguardando';
  if (relogio.desde === null) return { estado: esperando, headRound };
  if (agora - relogio.desde < relogio.janela) return { estado: esperando, aPartirDe: relogio.desde + relogio.janela, headRound };
  return { estado: 'relanca', headRound, gatilho: viaStale ? 'A' : 'B' };
}

// Contrato antigo, preservado pros chamadores que só querem "relança ou não": carimba
// _headRound no objeto recebido quando relança (reReviewTargets passa cópia rasa).
function classificaReRound(engine, pr, inflightKeys, agora = Date.now()) {
  const r = explicaReRound(engine, pr, inflightKeys, agora);
  if (r.estado !== 'relanca') return null;
  pr._headRound = r.headRound;
  return 'relanca';
}

// candidatos = panorama + PRs que só existem numa pendência stale_head (a fila
// mine não filtra por owner, então o PR pode nem estar no panorama)
function candidatosReRound(engine) {
  const vistos = new Set((engine.panorama || []).map(p => p.key));
  const soPendencia = (((engine.decisions || {}).pending) || [])
    .filter(d => d.blockedKind === 'stale_head' && !vistos.has(d.key))
    .map(d => ({ ...(d.pr || {}), key: d.key, isDraft: !!(d.pr || {}).isDraft }));
  return [...(engine.panorama || []), ...soPendencia];
}

function reReviewTargets(engine, inflightKeys, agora = Date.now()) {
  // copia rasa ANTES de classificar: classificaReRound carimba _headRound no
  // objeto que recebe, e o candidato do panorama é o MESMO objeto que o resto do
  // engine enxerga; sem a cópia, essa mutação vazaria pro panorama compartilhado.
  return candidatosReRound(engine)
    .map(pr => ({ ...pr }))
    .filter(pr => classificaReRound(engine, pr, inflightKeys, agora) === 'relanca');
}

function inflightDoEngine(engine) {
  return new Set([
    ...(engine.headlessQueue || []).map(p => p.key),
    ...[...(engine.activeReviews || new Map()).values()].flatMap(s => s.keys || [])
  ]);
}

/* Projeção pro card de commit novo: { key: { estado, motivo?, detalhe?, aPartirDe?,
   rodadasPresas } }, só das pendências stale_head. Dois ajustes de TELA em cima do gate:
   'relanca' vira 'aguardando' com a hora do próximo ciclo (o gate liberou, quem dispara
   é o check), e vira 'parado'/'consciencia' quando a última consulta do gate de
   consciência barrou este head (bloqueioConsultado, memória do launchReReviews). */
function reRoundParaUi(engine, agora = Date.now()) {
  const out = {};
  const inflight = inflightDoEngine(engine);
  const porKey = new Map(candidatosReRound(engine).map(pr => [pr.key, pr]));
  for (const d of (((engine.decisions || {}).pending) || [])) {
    if (d.blockedKind !== 'stale_head' || out[d.key] || !porKey.has(d.key)) continue;
    const r = explicaReRound(engine, { ...porKey.get(d.key) }, inflight, agora);
    let proj = { estado: r.estado };
    if (r.estado === 'relanca') {
      const barrado = ((engine.bloqueioConsultado || {})[d.key] || {}).head === r.headRound;
      proj = barrado ? parado('consciencia') : { estado: 'aguardando', aPartirDe: Number(engine.nextCheckAt) || 0 };
    } else {
      if (r.motivo) proj.motivo = r.motivo;
      if (r.detalhe) proj.detalhe = r.detalhe;
      if (r.aPartirDe) proj.aPartirDe = r.aPartirDe;
    }
    proj.rodadasPresas = Number(d.rodadasPresas) || 0;
    out[d.key] = proj;
  }
  return out;
}

/* Memória do bloqueio do round automático: { key do PR: { head, at } }. NÃO é
   decisão e NÃO persiste em disco de propósito, é só o que evita reconsultar o
   mesmo head a cada ciclo de polling (2 chamadas gh por consulta). Reinício do
   app zera e a primeira consulta acontece de novo, que é barato e correto.
   Head diferente do carimbado sempre reconsulta na hora: commit novo é
   exatamente o evento que costuma desfazer o bloqueio. */
function bloqueioRecente(engine, pr, agora) {
  const reg = (engine.bloqueioConsultado || {})[pr.key];
  if (!reg || reg.head !== pr._headRound) return false;
  return (agora - Number(reg.at || 0)) < TEMPOS.HEAD_QUIETO_MS;
}

function marcaBloqueio(engine, pr, agora) {
  if (!engine.bloqueioConsultado || typeof engine.bloqueioConsultado !== 'object') engine.bloqueioConsultado = {};
  engine.bloqueioConsultado[pr.key] = { head: pr._headRound, at: agora };
}

function limpaBloqueio(engine, pr) {
  if (engine.bloqueioConsultado) delete engine.bloqueioConsultado[pr.key];
}

function saveReReviewLaunched(engine) {
  try { writeJsonAtomic(path.join(STATE_DIR, 'rereview-launched.json'), engine.reReviewLaunched); }
  catch { /* best-effort: perder a âncora só re-revisa um head já revisado; o dedup por head impede repostagem */ }
}

// G15: estacionamento pós-falha persistido (era Set em memória pura; cada
// reinício, inclusive o do próprio auto-update, relançava sessões fadadas
// à mesma falha conhecida). Mesmo padrão do saveReReviewLaunched/savePushbackScanned.
//
// Desde a v2.57.4 o arquivo guarda também POR QUE e QUANDO cada key estacionou
// (`motivos`), no MESMO arquivo, porque estado e motivo têm o mesmo ciclo de vida
// e dois arquivos divergiriam. Formato `{ keys, motivos }`; o loader do server.js
// aceita a lista crua antiga (só keys) e a lê sem motivo, nunca inventando um.
// O motivo existe pra tela: até aqui o estacionamento era invisível no card, o
// toast morria em cinco segundos e "nunca revisou" e "revisou, caiu e estacionou"
// eram idênticos pra quem olhava a fila (biud-core#317, 03/09/2026).
function saveAutoReviewParked(engine) {
  const keys = [...engine.autoReviewParked];
  const motivos = {};
  for (const k of keys) if (engine.parkedMotivos && engine.parkedMotivos[k]) motivos[k] = engine.parkedMotivos[k];
  try { writeJsonAtomic(path.join(STATE_DIR, 'auto-review-parked.json'), { keys, motivos }); }
  catch { /* best-effort: perder o arquivo só re-relança uma vez no boot */ }
}

// Os QUATRO pontos de estacionamento (cancelamento, retry esgotado, falha permanente
// e orçamento na boca da sessão) passam por aqui, e o delete do retry vem junto de
// propósito: entrada órfã de retry desfaz o estacionamento no ciclo seguinte
// (incidente de 04/08/2026, biud-frontend#702). `tipo` é a frase que a tela escolhe
// (cancelado | esgotado | falha | orcamento); `motivo` é o texto da falha, e é
// cortado só na projeção pra UI, não aqui (o log e o disco guardam inteiro).
// `head` (v2.59.3, opcional) é o commit que a sessão leu: é o que prova "chegou commit
// novo depois que parou" pro destrave (lib/engine/destrava.js). Fica fora da projeção.
// `sessionId` (A1, opcional) é o id opaco da sessão que falhou: liga o card ao registro
// durável de falha (lib/engine/falhas.js), que sobrevive a Limpar log e ao relançamento.
function estacionar(engine, key, motivo, tipo, head, sessionId) {
  engine.retryAfterNet.delete(key);
  engine.autoReviewParked.add(key);
  if (!engine.parkedMotivos || typeof engine.parkedMotivos !== 'object') engine.parkedMotivos = {};
  const marca = { at: new Date().toISOString(), motivo: String(motivo || ''), tipo: String(tipo || 'falha') };
  if (head) marca.head = String(head);
  if (sessionId) marca.sessionId = String(sessionId);
  engine.parkedMotivos[key] = marca;
  engine.saveAutoReviewParked();
}

// Tira do estacionamento SEM gravar: quem chama grava uma vez por lote (M2 do
// launchReview, e a poda do check). Devolve se algo mudou.
function desestacionar(engine, key) {
  const saiu = engine.autoReviewParked.delete(key);
  if (engine.parkedMotivos && engine.parkedMotivos[key]) delete engine.parkedMotivos[key];
  return saiu;
}

// Projeção do estacionamento pra UI: allowlist (at, motivo, tipo), motivo cortado
// (é mensagem de erro, pode carregar stderr), e SÓ keys que estão no Set, que é a
// fonte de verdade de "está estacionado"; motivo sem key é lixo de migração.
// Key SEM motivo (estacionada antes da v2.57.4, quando o arquivo era só a lista)
// também vai pra tela, como `legado`: o que a v2.57.4 corrigiu era o card idêntico
// ao de um PR nunca revisado, e deixar o estoque antigo invisível repetia o defeito
// justamente nos PRs que motivaram o conserto (biud-core#317 ficou assim).
const PARKED_MOTIVO_UI_MAX = 200;
function parkedParaUi(engine) {
  const out = {};
  const motivos = (engine.parkedMotivos && typeof engine.parkedMotivos === 'object') ? engine.parkedMotivos : {};
  for (const k of engine.autoReviewParked || []) {
    const m = motivos[k];
    if (!m) { out[k] = { at: '', motivo: '', tipo: 'legado' }; continue; }
    let tipo = String(m.tipo || 'falha');
    if (['falha', 'esgotado'].includes(tipo) && classify(m.motivo).id === 'oauth-expirado') tipo = 'autenticacao';
    out[k] = { at: String(m.at || ''), motivo: String(m.motivo || '').slice(0, PARKED_MOTIVO_UI_MAX), tipo, ...(m.sessionId ? { sessionId: String(m.sessionId) } : {}) };
  }
  return out;
}

// sid da sessão da última decisão registrada deste PR (round anterior), pra
// retomada opt-in do round 2. Busca direto nas decisões CRUAS (pending primeiro,
// depois histórico, ambos do mais novo pro mais velho), nunca via decisionByKey:
// a projeção da UI é allowlist e não carrega sessionId.
function lastReviewSessionId(engine, key) {
  const d = (((engine.decisions || {}).pending) || []).find(x => x.key === key && x.sessionId)
    || (((engine.decisions || {}).resolved) || []).find(x => x.key === key && x.sessionId);
  return (d && d.sessionId) || '';
}

// Push trivial (rebase limpo, merge da base que não toca o diff): se o diff
// efetivo está byte a byte igual ao que a última sessão leu, rodar o round 2 é
// custo certo pra chegar na mesma conclusão. Sem prova salva ou com a medição
// falhando, relança como sempre: na dúvida, gastar uma sessão é melhor que
// calar um round.
//
// Alvo do gatilho B (pendência stale_head na mesa) NUNCA entra no pulo: a
// prova salva é do head ANTERIOR ao bloqueio (a sessão que a gravou nem
// chegou a postar), e o payload da pendência está ancorado nesse head velho.
// Cenário real: sessão leu H1, o autor fez rebase limpo pra H2 durante a
// sessão, o resultado bloqueou por stale_head. Se H2 medisse "igual" à prova
// de H1, o pulo emitiria "a revisão anterior segue valendo" sem NENHUMA
// revisão postada (o GitHub recusa o payload ancorado em H1 com 422) e a
// âncora já queimou H2: deadlock com toast falso, exatamente o que esta
// feature existe pra matar. Só a sessão relançada produz payload postável no
// head novo, então este alvo relança sempre.
// chamada pelo check() logo depois do refreshStaleStates (que preenche staleInfo).
// A âncora é gravada ANTES de enfileirar: se a revisão falhar, quem cuida é o
// retry/estacionamento de sempre, nunca um relançamento em loop por este caminho.
// Async desde a prova por arquivo: cada alvo pode custar UMA chamada gh (pulls/files)
// pra detectar push trivial, e só quando existe prova salva do round anterior.
async function launchReReviews(engine) {
  launchTechnicalRechecks(engine);
  const agora = Date.now();
  const inflight = inflightDoEngine(engine);
  const alvos = reReviewTargets(engine, inflight, agora);
  // poda âncora de PR que saiu do panorama (fechou/mergeou): o arquivo não cresce
  // pra sempre. Numa busca parcialmente falha a âncora podada pode voltar a
  // relançar um head já visto, o que custa UMA sessão e zero postagem duplicada
  // (dedup por head no gate de postagem); aceito, mesmo compromisso do
  // reconcileHiddenPRs. Pendência stale_head (gatilho B) também conta como
  // "aberta": ela pode vir de PR fora do panorama (fila mine não filtra por
  // owner), e podar a âncora dele aqui faria o relançamento repetir sem parar.
  const abertos = new Set([
    ...(engine.panorama || []).map(p => p.key),
    ...(((engine.decisions || {}).pending) || []).filter(d => d.blockedKind === 'stale_head').map(d => d.key),
  ]);
  let mudou = false;
  for (const k of Object.keys(engine.reReviewLaunched || {})) {
    if (!abertos.has(k)) { delete engine.reReviewLaunched[k]; mudou = true; }
  }
  // poda segura de headQuietoDesde: é só memória em processo, e re-carimbar custa
  // apenas um ciclo de espera do debounce (nunca muda decisão). Mesmo critério de
  // "aberto" do reReviewLaunched acima.
  for (const k of Object.keys(engine.headQuietoDesde || {})) {
    if (!abertos.has(k)) delete engine.headQuietoDesde[k];
  }
  if (mudou) engine.saveReReviewLaunched();
  if (!alvos.length) return;
  // pulo de push trivial (ver pushTrivial acima): a âncora já foi gravada,
  // então o pulo vale até o próximo push DE VERDADE.
  const relancar = [];
  const queimaAncora = (pr) => {
    engine.reReviewLaunched[pr.key] = proximaAncora(engine.reReviewLaunched[pr.key], pr._headRound, agora);
    engine.saveReReviewLaunched();
  };
  for (const pr of alvos) {
    /* Gate de consciência do review automático (28/08/2026 à tarde), ANTES até
       do pushTrivial: se alguém decisivo já se manifestou neste head, nem a
       medição de diff é necessária, o round espera ação manual (o botão
       Re-revisar continua valendo).

       A ÂNCORA NÃO É QUEIMADA AQUI (correção de 29/08/2026, bug de campo
       relatado pelo Wanderson). Até a v2.54.2 ela era gravada pra TODOS os
       alvos antes deste gate, então alvo bloqueado saía pelo `continue` com a
       âncora de um round que nunca rodou, e o classificaReRound nunca mais
       devolvia 'relanca' naquele head: a autonomia morria e o PR passava a
       depender de clique. Era a mesma classe de defeito que o G7 do
       recoverInflight já tinha fechado no caminho do crash.

       O custo de gh que a âncora segurava (não reconsultar o mesmo head a cada
       ciclo) volta por `bloqueioConsultado`, que é MEMÓRIA e não decisão: ele
       adia a próxima consulta em HEAD_QUIETO_MS, nunca mata o round. Quando o
       motivo do bloqueio some (a pessoa dispensou, era ferramenta mal contada,
       entrou commit novo), o relançamento volta sozinho na janela seguinte. */
    if (bloqueioRecente(engine, pr, agora)) continue;
    if (await engine.bloqueiaAutomatico(pr)) { marcaBloqueio(engine, pr, agora); continue; }
    limpaBloqueio(engine, pr);
    relancar.push(pr);
  }
  const elegiveis = relancar.filter(pr => politicaDeInicio(engine, pr).automatic);
  if (!elegiveis.length) return;
  for (const pr of elegiveis) queimaAncora(pr);
  engine.emit('toast', {
    kind: 'info',
    text: elegiveis.length === 1
      ? `↻ ${elegiveis[0].key} recebeu commit novo depois da sua revisão: revisando de novo.`
      : `↻ ${elegiveis.length} PRs receberam commit novo depois das suas revisões: revisando de novo.`
  });
  // requested: true = round 2 é CONTINUAÇÃO de um review meu, não clique avulso.
  // A postagem continua atrás do shouldAutoApprove/shouldAutoReject (política da
  // conta, card, contestação, cobertura) e do dedup por head, como qualquer revisão.
  for (const pr of elegiveis) engine.enqueueHeadless({
    ...pr, account: engine.accountForPr(pr), requested: true,
    manual: false, automaticRetry: false,
    // D13: só o round automático pós-push reserva rodada no nó compartilhado (sem teto)
    rodadaAutomatica: true,
    // G8: o gate SÓ arma com head conhecido; carregá-lo evita que um flake de gh
    // no início da sessão degrade o dedup pro comportamento antigo e mate o round
    // 2 como already_reviewed com a âncora já queimada. _headRound cobre os DOIS
    // gatilhos (A via staleInfo, B via blockedHead da pendência, onde staleInfo
    // nem tem o PR); staleInfo.head fica como fallback do formato antigo.
    knownHead: pr._headRound || (engine.staleInfo[pr.key] || {}).head || '',
    // sid do round anterior: com config.reReviewResume ligado, o round 2 retoma a
    // conversa em vez de recomeçar (opt-in; a allowlist de formato é aplicada no
    // consumo, em runHeadlessReview)
    resumeSid: lastReviewSessionId(engine, pr.key),
  });
}

const { personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor } = promptMod;

const reviewMod = {
  prFromUrl, launchReview, enqueueHeadless, esperaParaTela, headlessAcct, headlessOrg, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, globalParallelLimit, freeHeadlessSlot, reReviewTargets, classificaReRound, explicaReRound, reRoundParaUi,
  launchReReviews, saveReReviewLaunched, saveAutoReviewParked, estacionar, desestacionar, parkedParaUi,
  inProgressLabelFor, addInProgressLabel, removeInProgressLabel, limparLabelsOrfas,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
  lastReviewSessionId, stageSummaryFrom, stageOfLine, fastModeBlock, rodarSessao, retomadaAposFalhaBlock, enfileirarDaDistribuicao, devolverAoLocal,
  lerResultadoDaRevisao,
  MAX_RODADAS_PRESAS, diaLocal, normalizeAncora, proximaAncora,
  escolheModelo, rotuloOrigem, asReason,
};
export default reviewMod;
export {
  prFromUrl, launchReview, enqueueHeadless, esperaParaTela, headlessAcct, headlessOrg, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, globalParallelLimit, freeHeadlessSlot, reReviewTargets, classificaReRound, explicaReRound, reRoundParaUi,
  launchReReviews, saveReReviewLaunched, saveAutoReviewParked, estacionar, desestacionar, parkedParaUi,
  inProgressLabelFor, addInProgressLabel, removeInProgressLabel, limparLabelsOrfas,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
  lastReviewSessionId, stageSummaryFrom, stageOfLine, fastModeBlock, rodarSessao, retomadaAposFalhaBlock, enfileirarDaDistribuicao,
  lerResultadoDaRevisao,
  MAX_RODADAS_PRESAS, diaLocal, normalizeAncora, proximaAncora,
  escolheModelo, rotuloOrigem, asReason,
};
