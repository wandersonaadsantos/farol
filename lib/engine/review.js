// Concern do pipeline de revisão headless (Onda 2, colaborador): lançar review (terminal
// ou headless), a fila com 1 revisão por conta em paralelo (escalonador), o worker que roda
// cada uma com retry de erro transitório, a montagem do prompt (perfil do autor + formato
// humano) e a revisão em si com o gate de auto-aprovar/reprovar. Funções recebem o engine
// como ctx; a Engine mantém fachadas finas. Gate intacto (docs/REVIEW-GATES.md, invariante 4). Ver docs/QUALITY.md.
import fs from 'node:fs';
import path from 'node:path';
import { WORKSPACE, TEMPLATE_DIR, STATE_DIR } from '../paths.js';
import io, { writeJsonAtomic } from '../io.js';
import fanoutMod from './fanout.js';
import reparoMod from './reparo-envelope.js';
import vigiaMod from './vigia-sessao.js';
import promptMod from './review-prompt.js';
import * as jiraMod from './jira.js';
import { JIRA_CODES, motivoDe } from '../jira/errors.js';
import { classify, resetAtFrom } from '../log-taxonomy.js';
import retomadaMod, { RESUME_SID_RE, AVISO_DESCARTE } from './retomada-duravel.js';
// reasons/attention viajam como { text, kind } desde a v2.48.0: o unwrap tem UM
// endereço (lib/format.js), senão cada consumidor reinventa e um deles esquece
import { reasonText, staleHeadText, textoBloqueio } from '../format.js';
import { TEMPOS } from '../constants.js';
import { checkpointPath, readCheckpoint, relevantEntries, summarizeCheckpoint, resumeBlock } from './verification-checkpoint.js';
import {
  blobMapFrom, sameEffectiveDiff, splitByProof, reconcileInheritedCoverage,
  fileProofBlock, saveFileProof, readFileProof,
} from './file-proof.js';
import { escolheModelo, rotuloOrigem } from './model-router.js';
// repoDoPr mora em review-signal.js desde a v2.53.9 (a label o usava antes, a
// leitura de transição das refs o usa ainda): importa de lá em vez de duplicar
import { repoDoPr } from './review-signal.js';
import { lancarSePossePerdida, falhaPassageira, postarComRetentativas } from './postagem-arbitragem.js';
import { novoIdDeSessao } from './sessao-id.js';
import { registrarLimite, limiteAte, liberarLimite } from './limite-plano.js';
import admissao from './admissao.js';
import distribuicao from './sync-distribuicao.js';
import fechamento from './sync-fechamento.js';
import checkpointSync from './sync-checkpoint.js';
import { marcarErroNoConsumo, registrarFalha, detalheDaFalha, anotarFalhaDaSessao } from './falhas.js';
import {
  PAPEL_LEVELS, PAPEL_LABEL, PAPEL_TONE,
  DOMAINS, DOMAIN_LEVELS, DOMAIN_LABEL, DOMAIN_LEVEL_LABEL, DOMAIN_POSTURE,
  PUSHBACK_LABEL,
} from '../taxonomy.js';

// Motivo cru do envelope da sessão vira { text, kind }. String solta é 'content':
// quem escreveu foi a revisão, apontando algo sobre o código. Objeto que já veio
// etiquetado passa direto.
function asReason(r) {
  if (r && typeof r === 'object' && typeof r.text === 'string') return r;
  return { text: String(r), kind: 'content' };
}

// Motivo de GATE: o app segurou por regra (cobertura, contestação, política,
// clique), não porque a revisão achou algo. Construtor curto porque os pontos que
// prependam vivem dentro de if aninhado, e o literal ali dentro empurrava a
// profundidade acima do teto do gate de qualidade.
const gateReason = (text) => ({ text, kind: 'gate' });
// Motivo de INFRA: a postagem em si falhou (rede, gateway fora do ar).
const infraReason = (text) => ({ text, kind: 'infra' });
// Classe da taxonomia (lib/log-taxonomy.js) que o runOneHeadless NUNCA trata como
// transitória comum: coordenação entre dispositivos fora do ar volta pra fila sem
// retry e sem estacionar (D11 do contrato da sincronização).
const CLASSE_COORDENACAO = 'coordenacao-indisponivel';
// Desfechos que viram recibo de coordenação (D14): no nível do módulo porque os pontos
// de uso vivem em if aninhado, e o literal ali dentro estourava a profundidade do gate.
const RECIBO_PUBLICADO = Object.freeze({ publicationState: 'published' });
const RECIBO_EXTERNO = Object.freeze({ outcome: 'external_review', publicationState: 'published' });

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
// A marca do round automático (D13) é consumida pelo mesmo motivo: o teto compartilhado
// conta o round UMA vez, na admissão desta sessão. O retry transitório (prComRetomada
// copia o objeto), a fila de volta (tratarBloqueioDeCoordenacao e o catch do
// runOneHeadless empurram este objeto) e o clique que copia da fila herdariam a marca, e
// cada um reservaria outra rodada do dia pro mesmo round lógico. Admissão recusada antes
// da reserva (lease alheio, recibo, coordenação fora) deixa o round sem contar: é o lado
// seguro, porque o teto existe pra conter gasto, e aqui nenhuma sessão rodou.
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

// D14 vale até o POST, não só enquanto a sessão roda: o heartbeat segue batendo na fase
// pós-sessão (dedup, checks, head), e o cancelamento que ele dispara ali é inócuo
// porque a sessão já saiu de engine.running. Lease perdido quer dizer que outro aparelho
// pode ser o dono do PR agora, então nada sai no GitHub. O erro carrega a mesma marca
// da perda durante a sessão, e o runOneHeadless trata os dois do mesmo jeito: PR de
// volta pra fila, sem estacionar e sem retry. Chamado colado em cada postReview, porque
// entre a checagem e o POST não pode caber nenhum await AQUI.
// LIMITE, e ele é real: o POST de verdade sai dentro da lane do postReview
// (lib/engine/decision.js), que serializa as postagens do mesmo PR pela mesma conta.
// Se outra postagem do mesmo PR estiver na frente, a nossa espera na fila, e nesse
// intervalo o lease pode cair sem que esta guarda perceba. O que cobre essa janela é o
// dedup por head, que faz a postagem repetida virar no-op; a guarda daqui é o que evita
// abrir o POST quando a perda já é conhecida.
function pararSeLeasePerdido(coord) {
  if (!coord) return;
  // valido() cobre o lease VENCIDO que o heartbeat ainda não percebeu (máquina que
  // dormiu); `lost` cobre a perda que ele já percebeu. Handle antigo sem valido() cai
  // no comportamento anterior, em vez de virar postagem barrada por falta de método.
  if (typeof coord.valido === 'function' && !coord.valido()) {
    throw Object.assign(new Error('lease de coordenação vencido antes de postar; nada foi postado'), { coordenacao: 'perdido' });
  }
  if (!coord.lost) return;
  throw Object.assign(new Error('lease de coordenação perdido antes de postar; nada foi postado'), { coordenacao: 'perdido' });
}

// A tentativa com --resume já reservou (e iniciou) a rodada do dia no teto
// compartilhado; a sessão nova que a substitui é a MESMA rodada, e contar de novo
// gastaria o teto em dobro por causa de uma retomada recusada.
function semNovaRodada(streamOpts) {
  if (!streamOpts.coordination) return streamOpts;
  return { ...streamOpts, coordination: { ...streamOpts.coordination, contaRodada: false } };
}

// Marcador de retry da postagem. Só nasce quando a falha é claramente transitória
// (mesma tabela de log-taxonomy.js, invariante 3); null pra todo o resto, porque
// insistir em falha permanente não resolve e ainda esconde de você o problema que
// exige ação humana. Função e não literal no ponto de uso: ali dentro já são dois
// if aninhados, e o objeto estourava a profundidade do gate de qualidade.
// A recusa passageira da coordenação (nada saiu, a causa passa sozinha) também arma o
// reenvio dos ciclos: a mensagem dela não casa classe transitória nenhuma da taxonomia,
// e sem isto o PR ia direto para a sua mesa como "falha técnica ao postar".
function postRetryFor(event, erro, post) {
  if (falhaPassageira(post)) return { event, attempts: 0 };
  return classify(erro).kind === 'transitorio' ? { event, attempts: 0 } : null;
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
// ter vindo de uma sessão que caiu antes da admissão, ainda com a marca, e o teto
// compartilhado barraria no spawn justamente o botão que o aviso de teto diz que vale.
function marcarOrigem(it, porClique, extras) {
  it.semCoordenacao = porClique && extras.semCoordenacao === true;
  it.ignorarRecibo = porClique && extras.ignorarRecibo === true;
  if (porClique) {
    it.manual = true;
    it.rodadaAutomatica = false;
  }
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

async function launchReview(engine, urls, mode = 'auto', origem = 'auto', extras = {}) {
  if (!urls || !urls.length) return { ok: false, error: 'sem PRs para revisar' };
  if (!engine.token) await engine.refreshTokens();
  // requested = o PR pediu a MINHA revisão (fila). Revisão iniciada por clique
  // no panorama (ou por URL avulsa) nunca posta nada sozinha: sempre passa
  // pela seção "Precisa de você". Cada item carrega a conta dona (accountForPr
  // deduz pela org quando veio de URL avulsa) pro token certo em todo o fluxo.
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
  const prontos = items.filter(it => engine.tokenFor(it.account));
  if (!prontos.length) return { ok: false, error: 'gh sem token' };
  // o clique é marcado ANTES do gate de consciência logo abaixo: pr.manual é o
  // que faz o gate deixar passar sem consultar nada (quem mandou revisar foi você)
  const porClique = origem === 'clique';
  for (const it of prontos) marcarOrigem(it, porClique, extras || {});
  /* Gate de consciência do review automático (decisão do Wanderson, 28/08/2026 à
     tarde): head ativo com review decisivo de OUTRA pessoa deixa o caminho
     automático aguardando ação manual (ver bloqueadoPorHistorico em
     lib/engine/skip-review.js). Roda AQUI, antes do markSeen e da saída da fila,
     de propósito: o PR bloqueado fica exatamente onde estava, com o card visível
     e o botão Revisar valendo. Clique manual atravessa dentro do próprio
     bloqueiaAutomatico (pr.manual acima). */
  const conscientes = [];
  for (const it of prontos) {
    if (await engine.bloqueiaAutomatico(it)) continue;
    conscientes.push(it);
  }
  if (!conscientes.length) return { ok: false, error: 'head ativo com review decisivo de outra pessoa: aguardando ação manual' };
  // coordenação entre aparelhos no clique (D12): o bloqueado fica na fila, com o card
  // visível, e volta na resposta pra tela confirmar o override. Desligada, nada disto roda.
  const coordenaClique = porClique && coordenacaoLigada(engine);
  const { liberados, coordenacao } = coordenaClique ? await preflightDoClique(engine, conscientes) : { liberados: conscientes, coordenacao: [] };
  const seguradosPelaCoordenacao = coordenacao.length ? { coordenacao } : {};
  if (!liberados.length) return { ok: false, error: 'a coordenação entre aparelhos segurou a revisão: confirme na tela', ...seguradosPelaCoordenacao };
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
  // mandou revisar foi quem está na frente deste aparelho.
  if (!pr.manual && !pr.viaDistribuicao && !guardada && distribuicao.distribuindo(engine, cfgDaSync(engine))) {
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

// "21:00" pro toast do limite de plano. Hora local da máquina, o mesmo fuso em que
// resetAtFrom interpreta a mensagem (ver a nota de FUSO em lib/log-taxonomy.js).
function horaCurta(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// conta que "ocupa" o slot da revisão (uma por conta de cada vez)
function headlessAcct(engine, pr) { return String(engine.accountForPr(pr) || '').toLowerCase() || '(sem conta)'; }

// Teto de revisões SIMULTÂNEAS da mesma conta (config.parallelReviews, opt-in do
// Wanderson em 15/08/2026). Clampado AQUI, no consumidor, além do updateSettings:
// defesa em profundidade no padrão do buildModelFlags, porque config torta vinda de
// config.json editado à mão não pode virar teto 0 (fila travada) nem NaN (loop).
// Com a admissão ativa quem limita é o teto do APARELHO, não o da conta: o teto de conta
// sai do caminho (vira o máximo que o escalonador aceita) para não limitar duas vezes.
const LIMITE_SEM_TETO_DE_CONTA = 4;

function parallelLimit(engine) {
  const n = parseInt((engine.config || {}).parallelReviews, 10);
  return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 1;
}

// devolve o slot da conta ao escalonador. Zera LIMPO (delete, não set 0): o
// isBusy do update.js pergunta headlessBusyAccounts.size, e uma conta ociosa
// registrada com contagem 0 seguraria o auto-update pra sempre.
function freeHeadlessSlot(engine, acct, pr) {
  if (pr && pr.admissaoId) { admissao.liberar(engine, pr.admissaoId); delete pr.admissaoId; }
  const n = (engine.headlessBusyAccounts.get(acct) || 0) - 1;
  if (n > 0) engine.headlessBusyAccounts.set(acct, n);
  else engine.headlessBusyAccounts.delete(acct);
}

// org (owner) dona do PR, pro rodízio da Política 1. Mesmo caminho que accountForPr
// usa pra achar a conta: o owner sai do `repo`, e da `key` (owner/repo#n) quando ele
// não veio. Sem owner resolvível, cai num balde próprio que DISPUTA o rodízio como
// qualquer org (não é fila de castigo: um PR sem repo legível não pode ser punido por
// isso). Minúsculo, porque owner do GitHub não diferencia caixa e o Map diferenciaria.
const SEM_ORG = '(sem org)';
function headlessOrg(pr) {
  const repo = (pr && (pr.repo || String((pr.key || '')).split('#')[0])) || '';
  return String(repo).split('/')[0].toLowerCase() || SEM_ORG;
}

// Teto GLOBAL de revisões simultâneas somando todas as contas (Política 3,
// config.globalParallelReviews). 0/ausente/torto = DESLIGADO, que é o comportamento de
// sempre: o único teto é o por conta. Ligado, clampa em 1..8 aqui no consumidor, o
// mesmo padrão de defesa em profundidade do parallelLimit (config.json editado à mão
// não pode virar teto infinito nem NaN).
//
// Esta política só é segura porque o rodízio de org existe: teto global sozinho
// CONCENTRA, porque quem tem mais PR na fila ocupa o teto inteiro. Com o rodízio
// decidindo quem ocupa cada vaga, o teto vira distribuição de vazão em vez de corrida.
function globalParallelLimit(engine) {
  const n = parseInt((engine.config || {}).globalParallelReviews, 10);
  if (!Number.isFinite(n) || n <= 0) return Infinity;
  return Math.min(8, n);
}

// quantas revisões headless estão em curso somando TODAS as contas
function headlessBusyTotal(engine) {
  let total = 0;
  for (const n of engine.headlessBusyAccounts.values()) total += n;
  return total;
}

/* Escolhe o PRÓXIMO PR a disparar entre os ELEGÍVEIS (conta abaixo do teto dela).
   Elegível é pré-requisito, nunca critério: a política só decide QUAL, jamais SE, e é
   por isso que ela é work-conserving por construção (se existe elegível, ele sai).

   Critério (Política 1, spec 2026-09-10): ganha o PR da org atendida HÁ MAIS TEMPO.
   Org nunca atendida vale -Infinity, então ela fura a fila da que já rodou. Empate
   (mesma org, ou duas orgs nunca atendidas) resolve pela ORDEM DE CHEGADA, porque o
   findIndex original é FIFO e uma org só na fila tem que se comportar exatamente como
   antes desta feature.

   "Última vez atendida" e não contagem de propósito: contagem pune eternamente quem
   teve um pico de manhã e exige janela deslizante e decaimento pra não mentir. "Quem
   esperou mais" é a definição direta de justiça de fila e é uma comparação de dois
   números. */
function proximoHeadless(engine, limite, seguradas = null) {
  let escolhido = -1;
  let maisAntigo = Infinity;
  for (let i = 0; i < engine.headlessQueue.length; i++) {
    const pr = engine.headlessQueue[i];
    if ((engine.headlessBusyAccounts.get(engine.headlessAcct(pr)) || 0) >= limite) continue;
    if (seguradas && seguradas.has(engine.headlessAcct(pr))) continue;
    // orgLastStart pode não existir em engine antigo/parcial (fachada fina, testes de
    // outras suítes): sem ele, toda org empata e o rodízio degrada pro FIFO de antes.
    const visto = engine.orgLastStart && engine.orgLastStart.get(headlessOrg(pr));
    const quando = (visto && Number.isFinite(visto.seq)) ? visto.seq : -Infinity;
    if (quando < maisAntigo) { maisAntigo = quando; escolhido = i; }
    if (maisAntigo === -Infinity) break; // org virgem ganha de todas; a 1ª achada é a mais antiga na fila
  }
  return escolhido;
}

// escalonador: dispara quantas revisões der, até parallelLimit por conta (default 1,
// o comportamento de sempre: série dentro da conta, contas diferentes em paralelo) e
// até globalParallelLimit no total (default: sem teto). Entre os elegíveis, a vaga vai
// pro rodízio de org (proximoHeadless), não pro primeiro da fila.
// Síncrono (não await): cada revisão roda em paralelo e reprograma no fim.
function processHeadless(engine) {
  const tetoGlobal = globalParallelLimit(engine);
  const comAdmissao = admissao.ativa(engine);
  // contas que o teto do grupo segura por não dar para verificar (C4b): nem o clique
  // atravessa, e o PR espera na fila sem estacionar
  const seguradas = new Set();
  // O laço só avança porque o item sai da fila ou a conta entra em `seguradas`. Um teto de
  // voltas pelo tamanho da fila é a rede de segurança disso: descobrir em produção que uma
  // condição nova não fez nenhuma das duas coisas seria o engine travado num laço quente.
  for (let voltas = engine.headlessQueue.length + 1; voltas > 0; voltas--) {
    if (headlessBusyTotal(engine) >= tetoGlobal) break; // teto global cheio
    const limite = comAdmissao ? LIMITE_SEM_TETO_DE_CONTA : parallelLimit(engine);
    const idx = proximoHeadless(engine, limite, seguradas);
    if (idx < 0) break; // fila vazia ou todas as contas pendentes já no teto
    const contaDoItem = engine.headlessAcct(engine.headlessQueue[idx]);
    if (comAdmissao && grupoSegura(engine, engine.accountForPr(engine.headlessQueue[idx]))) {
      seguradas.add(contaDoItem);
      continue;
    }
    // Com a admissão ativa, a vaga é do APARELHO e é tomada ANTES de tirar o PR da fila:
    // sem vaga o PR CONTINUA na fila (espera, nunca estacionamento como falha).
    // item que veio da distribuição JÁ tem vaga reservada no aceite: reservar de novo
    // contaria a mesma execução duas vezes na ocupação do aparelho
    const jaReservado = !!engine.headlessQueue[idx].admissaoId;
    const grupoDoItem = grupoDaConta(engine, engine.accountForPr(engine.headlessQueue[idx]));
    const vaga = comAdmissao && !jaReservado ? admissao.reservar(engine, { tipo: 'review', ref: engine.headlessQueue[idx].key, grupo: grupoDoItem }) : null;
    if (vaga && !vaga.ok) break;
    const pr = engine.headlessQueue.splice(idx, 1)[0];
    if (vaga) pr.admissaoId = vaga.id;
    const acct = engine.headlessAcct(pr);
    engine.headlessBusyAccounts.set(acct, (engine.headlessBusyAccounts.get(acct) || 0) + 1);
    /* Carimba no MESMO ponto em que o slot é tomado: o rodízio conta revisão INICIADA,
       não terminada, senão duas revisões longas da mesma org sairiam juntas por ainda
       não ter voltado nenhuma.

       A ORDEM é por `seq` (contador monotônico) e não por relógio: Date.now() tem
       granularidade de milissegundo, e o escalonador dispara várias revisões no mesmo
       tick. Duas orgs carimbadas no mesmo milissegundo empatariam, o desempate cairia
       pro FIFO e a alternância sumiria justamente no caso que a feature existe pra
       resolver (lote de PRs chegando junto). O `at` fica junto só pra tela poder dizer
       "atendida há 12 min"; ele NUNCA decide a vez. */
    if (engine.orgLastStart) {
      engine.headlessSeq = (engine.headlessSeq || 0) + 1;
      engine.orgLastStart.set(headlessOrg(pr), { seq: engine.headlessSeq, at: Date.now() });
    }
    engine.runOneHeadless(pr, acct);
  }
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

// Retomada que não pode ser validada porque o head atual não foi confirmado no GitHub:
// espera, sem gastar tentativa e sem abrir sessão. O retryAfterNet é o gatilho certo,
// porque o _repescarRetry só roda quando a checagem do ciclo funcionou. A referência
// fica no Map (e no disco) em estado pendente.
function aguardarConfirmacaoDeHead(engine, pr, msg) {
  const guardado = engine.retryAfterNet.get(pr.key);
  engine.retryAfterNet.set(pr.key, { tries: (guardado && guardado.tries) || 0, pr, notBefore: null });
  engine.log('WARN', `revisao ${pr.key} (retomada aguardando confirmação do head): ${msg}`);
}

async function runOneHeadless(engine, pr, acct) {
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
      engine.freeHeadlessSlot(acct, pr);
      engine.writeInflight();
      engine.pushState();
      engine.processHeadless();
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
    engine.freeHeadlessSlot(acct, pr);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
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
    engine.freeHeadlessSlot(acct, pr);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
    return;
  }
  const perfilEstourado = engine.budgetBlockedFor(engine.accountForPr(pr));
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
    engine.freeHeadlessSlot(acct, pr);
    engine.writeInflight();
    engine.pushState();
    engine.processHeadless();
    return;
  }

  try {
    await engine.runHeadlessReview(pr);
    engine.retryAfterNet.delete(pr.key);
    liberarLimite(engine, engine.accountForPr(pr));
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
    if (err.aguardaRetomada) {
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
    } else if (transient) {
      // limite do plano se resolve no reset; rede/binário costumam voltar rápido.
      // Retoma sozinho no próximo ciclo bem-sucedido, até um teto (aí estaciona).
      registrarFalhaHeadless(engine, pr, err, 'review');
      const cap = limitErr ? 12 : 3;
      const guardado = engine.retryAfterNet.get(pr.key);
      const tries = (guardado && guardado.tries) || 0;
      engine.log('WARN', `revisao ${pr.key} (transitório, tenta de novo): ${msg}`);
      if (tries < cap) {
        // Limite de plano tem HORA pra voltar, e ela vem escrita na própria mensagem
        // ("resets 9pm"). Antes disso o PR era tratado como flake qualquer e tentava
        // de novo a cada ciclo: em 07/08/2026 foram 70 linhas de log em 8 PRs pra UMA
        // condição de hora conhecida. Agora a entrada carrega o instante do reset e o
        // retryTargets pula quem ainda não chegou lá. notBefore null (mensagem sem
        // hora, ou falha que não é de limite) = comportamento de sempre.
        const reset = limitErr ? resetAtFrom(msg) : null;
        // o limite é da ASSINATURA: registra para os outros PRs dela não baterem nele um a um
        if (reset) registrarLimite(engine, engine.accountForPr(pr), reset.getTime());
        // guarda o PR junto das tentativas: o relançamento não pode depender de o
        // PR seguir na fila mine (clique no panorama sai da queue no rebuild do check).
        // Junto vai o sid da sessão que caiu (session.js estampa err.sessionId), pra o
        // relançamento CONTINUAR aquela sessão em vez de reler o PR inteiro. Queda antes
        // de a sessão nascer não traz sid novo: nesse caso mantém o anterior, senão uma
        // cascata de quedas de rede jogaria fora a leitura já feita.
        const prRetomada = prComRetomada(engine, pr, err, guardado);
        engine.retryAfterNet.set(pr.key, { tries: tries + 1, pr: prRetomada, notBefore: reset ? reset.getTime() : null });
        engine.emit('toast', { kind: 'error', text: limitErr
          ? `Limite do teu plano Claude atingido. Retomo ${pr.key} sozinho ${reset ? `depois das ${horaCurta(reset)}` : 'quando resetar'}; ele está na sua fila.`
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

// métrica do que precisa ser LIDO nesta sessão: no round incremental, arquivo
// inalterado já tem prova herdada e não conta pro limiar do fan-out nem entra
// nos lotes. PURA (recebe metrics e a herança), extraída pra ter teste direto.
function metricsIncrementais(metrics, heranca) {
  if (!heranca || !heranca.ativa || !metrics || !Array.isArray(metrics.files)) return metrics;
  const mudados = new Set(heranca.changed);
  const files = metrics.files.filter(f => mudados.has(f.path));
  return { lines: files.reduce((s, f) => s + f.lines, 0), changedFiles: files.length, files };
}

// PR grande: mede e monta os lotes (determinístico, sem IA). Falha na medição
// degrada pro fluxo de sempre, que é sempre seguro. Extraída do runHeadlessReview
// pra achatar o fluxo (contrato: profundidade máxima 3).
async function medirEFatiar(engine, pr, heranca, id) {
  try {
    const metrics = await fanoutMod.prMetrics(engine, pr);
    const metricsLeitura = metricsIncrementais(metrics, heranca);
    if (!fanoutMod.shouldFanOut(metricsLeitura)) return { lotes: null, metricsLeitura };
    const planejados = fanoutMod.planLotes(metricsLeitura.files);
    if (planejados.length < 2) return { lotes: null, metricsLeitura };
    engine.pushActivity(id, 'info', `PR grande (${metricsLeitura.changedFiles} arquivos, ~${metricsLeitura.lines} linhas a ler): revisando em ${planejados.length} lotes com subagentes.`);
    return { lotes: planejados, metricsLeitura };
  } catch (err) {
    engine.log('ERROR', `fan-out ${pr.key}: medição falhou, seguindo em passe único — ${err.message}`);
    return { lotes: null, metricsLeitura: null };
  }
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

// Um resultado em prosa pode encobrir verificação interrompida ou recusada: não
// autoriza outra sessão nem um veredito fabricado. Mantém a falha no caminho de
// estacionamento existente, com diagnóstico útil e o sid apenas como metadado.
function lerResultadoDaRevisao(engine, res, id) {
  try {
    return engine.parseHeadlessResult(res.text);
  } catch (err) {
    // resultado recusado: o gasto aconteceu e não virou revisão (A1, item 3). A linha de
    // consumo já existe (registrada no close da sessão); o que muda é o desfecho.
    marcarErroNoConsumo(engine, id);
    if (err.code !== 'FAROL_RESULT_MISSING') throw err;
    err.message = `revisão não concluída: a sessão terminou sem entregar o resultado estruturado; ${err.message}. Confira a sessão e as verificações pendentes antes de tentar novamente.`;
    if (res.sessionId) err.sessionId = res.sessionId;
    throw err;
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
    engine.markSeen(pr.key);
    engine.queue = engine.queue.filter(p => p.key !== pr.key);
    engine.emit('toast', { kind: 'info', text: `${pr.key}: a revisão deste head já existia; a sessão foi encerrada sem gastar o resto.` });
    return;
  }
  engine.emit('toast', { kind: 'info', text: `${pr.key}: chegou commit novo durante a revisão; a sessão foi encerrada e o head novo entra na fila.` });
}

// Sessao que trabalhou e terminou em PROSA ganha UMA rodada de reparo, pedindo so o
// envelope na mesma conversa (lib/engine/reparo-envelope.js). Reparo que nao acontece ou
// nao resolve cai no estacionamento de sempre, com a falha de contrato original.
async function resultadoComReparo(engine, res, id, streamOpts) {
  try {
    return lerResultadoDaRevisao(engine, res, id);
  } catch (err) {
    const novo = await reparoMod.pedirEnvelope(engine, err, res, id, streamOpts);
    if (!novo) throw err;
    const result = lerResultadoDaRevisao(engine, novo, id);
    // o reparo pode nascer com id proprio: o resultado tem que apontar pra sessao que de
    // fato o entregou, senao o card e o Consumo mandam pra conversa errada
    res.sessionId = novo.sessionId || res.sessionId;
    return result;
  }
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
   dos dois lados: nada aqui toca a revisão em si. Só a remoção que falha DEPOIS de
   uma adição bem-sucedida vira WARN, porque label presa no PR é visível pro time.
   O repoDoPr vem de review-signal.js (a leitura de transição das refs ainda o usa). */
function inProgressLabelFor(user) {
  const u = String(user || '').trim();
  return u ? `${u}:revisando` : '';
}

const IN_PROGRESS_LABEL_COLOR = 'FBCA04';
const IN_PROGRESS_LABEL_DESC = 'revisão em andamento';

// devolve a label aplicada ('' quando não aplicou), pra remoção só acontecer
// depois de uma adição comprovada (remover o que não entrou é chamada gh à toa).
// `run` é injetável só pra teste (o default é o io.run de sempre).
async function addInProgressLabel(engine, pr, run = io.run) {
  const acc = engine.accountForPr(pr);
  const label = inProgressLabelFor(acc);
  if (!label || !pr.url || !engine.tokenFor(acc)) return '';
  try {
    const env = engine.ghEnv(acc);
    const adiciona = () => run('gh', ['pr', 'edit', pr.url, '--add-label', label], { env });
    let r = await adiciona();
    if (r.ok) return label;
    // a causa mais comum da falha é a label não existir no repo: cria e tenta
    // de novo UMA vez. Falha por outra causa (rede, permissão) derruba também
    // a criação ou a retentativa, e o resultado segue best-effort ('').
    const repo = repoDoPr(pr);
    if (!repo) return '';
    const c = await run('gh', ['label', 'create', label, '--repo', repo,
      '--color', IN_PROGRESS_LABEL_COLOR, '--description', IN_PROGRESS_LABEL_DESC], { env });
    if (!c.ok) return '';
    r = await adiciona();
    return r.ok ? label : '';
  } catch { return ''; }
}

async function removeInProgressLabel(engine, pr, label) {
  if (!label) return;
  try {
    const acc = engine.accountForPr(pr);
    const r = await io.run('gh', ['pr', 'edit', pr.url, '--remove-label', label], { env: engine.ghEnv(acc) });
    if (!r.ok) engine.log('WARN', `label ${label} não saiu de ${pr.key}: ${String(r.stderr || '').trim().slice(0, 200)}`);
  } catch (err) {
    engine.log('WARN', `label ${label} não saiu de ${pr.key}: ${err.message}`);
  }
}

/* Limpeza das labels que ESTA cópia deixou presas (29/08/2026). O
   `removeInProgressLabel` mora num `finally`, e finally não roda quando o
   processo morre: queda de renderer, kill, reinício do auto-update. A label
   presa não caducava em lugar nenhum, então um Farol morto calava a frota
   inteira naquele PR ("o Farol tem pulado review sem ninguém estar analisando").
   O `labelVistaDesde` cobre o lado de QUEM LÊ a label alheia; isto aqui cobre o
   lado de QUEM ESCREVE, que é onde o lixo nasce.

   Roda uma vez no boot, sobre a lista que o recoverInflight recuperou, e é
   best-effort dos dois lados: label que já não está lá devolve erro do gh e é
   silêncio (o caso comum, sessão que terminou bem), e falha de rede só adia pro
   próximo boot. Nada aqui pode derrubar a subida do app. */
async function limparLabelsOrfas(engine, prs, run = io.run) {
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!pr || !pr.url) continue;
    try {
      const acc = engine.accountForPr(pr);
      const label = inProgressLabelFor(acc);
      if (!label || !engine.tokenFor(acc)) continue;
      const r = await run('gh', ['pr', 'edit', pr.url, '--remove-label', label], { env: engine.ghEnv(acc) });
      // só avisa quando SAIU algo: "not found" é o caso comum e não é notícia
      if (r && r.ok) engine.log('WARN', `label ${label} tinha ficado presa em ${pr.key} (app morreu no meio da revisão); removida no boot.`);
    } catch { /* best-effort: o boot nunca cai por causa de limpeza */ }
  }
}

/* ---------- tempo por etapa da revisão (instrumentação) ----------
   Motivado por 17/08/2026 (#775, "por que demorou 10 minutos?"): o feed de
   atividade tem timestamp por linha mas morre com a sessão, então a pergunta
   ficava sem resposta. O resumo é calculado do feed ANTES do finally apagar e
   persiste na decisão. Heurística determinística e honesta: o intervalo entre
   uma linha e a anterior é atribuído à etapa da linha que o ENCERRA (o gap é o
   trabalho que produziu a linha), e a fatia final (última linha até o fim) é a
   redação do envelope. É aproximação de traço, não cronômetro. */
const STAGE_ORDER = ['preparo', 'leitura', 'card', 'verificacao', 'raciocinio', 'fechamento'];
// `fechamento`, e não `redação`: a última fatia NÃO é medida de nenhuma linha, é o
// silêncio entre a última atividade do feed e o fim da sessão (ver stageSummaryFrom).
// Costuma ser o modelo compondo o envelope, mas o rótulo antigo prometia uma medição
// que não existe. Decisões gravadas antes disto guardam o próprio label, então o
// histórico continua mostrando "redação" sem migração.
const STAGE_LABEL = {
  preparo: 'preparo', leitura: 'leitura', card: 'card',
  verificacao: 'verificação', raciocinio: 'raciocínio', fechamento: 'fechamento',
};

function stageOfLine(it) {
  // linha já estampada (item.s do feed) é a fonte: classificar duas vezes abriria
  // espaço pra esteira ao vivo e o resumo final divergirem sobre a mesma linha
  if (it && it.s && STAGE_LABEL[it.s]) return it.s;
  const t = String((it && it.text) || '');
  if (t.includes('FAROL_CHECKPOINT')) return 'verificacao';
  if (it && it.a) return /^claim-verifier/i.test(String(it.a)) ? 'verificacao' : 'leitura';
  // `card` só a partir de FERRAMENTA. Casando o texto de qualquer linha, prosa que
  // apenas MENCIONA o Jira ("o card não cobre esse caso") virava consulta ao card, e
  // todo o raciocínio até ali era creditado à etapa errada. Medido: as três frases de
  // exemplo do teste caíam em `card`, sendo que duas eram raciocínio puro.
  if (it && it.k === 'tool' && /atlassian|jira/i.test(t)) return 'card';
  if (it && it.k === 'text') return 'raciocinio';
  if (it && it.k === 'tool') return 'leitura';
  return 'preparo';
}

// PURA: { totalMs, stages: [{id, label, ms}] } na ordem canônica, só etapas > 0.
function stageSummaryFrom(items, startedAt, endedAt) {
  const linhas = (items || []).filter(i => i && i.t);
  if (!linhas.length || !startedAt || !endedAt) return null;
  const ms = {};
  let prev = startedAt;
  for (const it of linhas) {
    const etapa = stageOfLine(it);
    ms[etapa] = (ms[etapa] || 0) + Math.max(0, it.t - prev);
    prev = it.t;
  }
  ms.fechamento = (ms.fechamento || 0) + Math.max(0, endedAt - prev);
  return {
    totalMs: Math.max(0, endedAt - startedAt),
    stages: STAGE_ORDER.filter(s => ms[s] > 0).map(s => ({ id: s, label: STAGE_LABEL[s], ms: ms[s] })),
  };
}

// Modo rápido (config.reviewFast, opt-in): corta o tempo da revisão SEM afrouxar
// gate nenhum. A troca honesta: menos experimento empírico = mais needs_decision
// quando a prova exigiria tempo; o que o modo nunca faz é afirmar sem prova.
function fastModeBlock() {
  return `\n\n## MODO RÁPIDO (ativado pelo dono do app)\n` +
    `Otimize o TEMPO desta revisão. O que muda:\n` +
    `1. **Leitura orientada a diff**: leia o diff completo de TODOS os arquivos; abra o arquivo inteiro só quando o trecho não se explica sozinho (função cortada, contrato definido em outro ponto). O envelope coverage continua completo e honesto.\n` +
    `2. **Verificação empírica só do que sustenta a decisão**: experimento (simulação, consulta gh extra) apenas para afirmação que muda verdict/decision (blocker, ou a prova de que o card foi atendido). O resto vira observação de leitura, sem experimento. Os subagentes claim-verifier em paralelo continuam valendo para o que for verificado.\n` +
    `3. **Verificação que exigiria experimento LONGO** (simular pipeline de CI, comparar históricos extensos): NÃO execute; registre em reasons como não-verificado e prefira needs_decision. Rápido significa devolver a decisão pro humano mais cedo, nunca afirmar sem prova.\n` +
    `4. **Pule o histórico do autor** (state/authors): tom neutro nesta revisão.\n` +
    `O que NÃO muda: o schema do envelope, a cobertura completa, os gates de decisão e o formato humano do texto postado.\n`;
}

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

async function runHeadlessReview(engine, pr) {
  const { id, rotulo } = novoIdDeSessao(engine, 'a');
  engine.activeReviews.set(id, {
    id, rotulo, keys: [pr.key], label: `Revisão automática de ${pr.key}`, mode: 'auto', checkpoint: 'review',
    startedAt: Date.now(), cancellable: true, resumeOutcome: 'nenhuma',
    pr: { key: pr.key, url: pr.url, title: pr.title || '', author: pr.author || '' }
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
  // head novo observado no gate de "andou durante a sessão", logo abaixo. Vive no
  // escopo da função pra carimbar a pendência no recordDecision, lá no fim.
  let staleHeadNovo = '';
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
  // o recibo da pendência diz se ela nasceu de uma postagem que falhou
  let postFalhou = false;
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
    if (!coordenacaoLigada(engine)) labelEmAndamento = await addInProgressLabel(engine, pr);
    // prova por arquivo: o diff efetivo atual (blob SHA por arquivo) e a prova da
    // última leitura completa. Qualquer falha aqui degrada pra revisão cheia de
    // sempre, que é sempre segura (falta de dado nunca vira herança).
    let arquivosAtuais = null;
    try { arquivosAtuais = await engine.fetchPrFiles(pr); }
    catch (err) { engine.log('WARN', `prova por arquivo ${pr.key}: medição falhou, revisão cheia: ${err.message}`); }
    const blobsAtuais = blobMapFrom(arquivosAtuais);
    // o mapa viaja no registro da sessão pro session.js carimbar blobSha em cada
    // entrada de checkpoint (writeInflight só serializa s.pr, então não incha nada)
    if (blobsAtuais && engine.activeReviews.get(id)) engine.activeReviews.get(id).fileBlobs = blobsAtuais;
    const provaAnterior = readFileProof(pr.key);
    // herança só entre heads DIFERENTES: no mesmo head quem retoma é o checkpoint
    // (retry de falha); herdar tudo num relançamento manual do mesmo head faria a
    // sessão não ler nada e "confirmar" a si mesma.
    const heranca = (provaAnterior && provaAnterior.head && headShaAtual && provaAnterior.head !== headShaAtual)
      ? splitByProof(arquivosAtuais, provaAnterior)
      : { ativa: false, unchanged: [], changed: [] };

    const { lotes, metricsLeitura } = await medirEFatiar(engine, pr, heranca, id);
    // roteador de modelo: quando reviewModel === 'auto', escolhe haiku/sonnet
    // (e esforço/fast) pelas métricas já medidas. Modelo pinado na config segue
    // intacto. A escolha viaja em streamOpts pra buildModelFlags, nunca como
    // string 'auto' na cmdline.
    const rota = escolheModelo(metricsLeitura, engine.config || {});
    if (rota.origem && rota.origem.startsWith('auto')) {
      const partes = [`Modelo: ${rota.model || 'padrão'}`];
      if (rota.effort) partes.push(`esforço ${rota.effort}`);
      if (rota.fast) partes.push('rápido');
      engine.pushActivity(id, 'info', `${partes.join(' · ')} (${rotuloOrigem(rota.origem)}).`);
    }
    let promptFinal = engine.headlessPromptFor(pr.url, pr.author, lotes, metricsLeitura);
    const cardRes = await jiraMod.cardForPr(engine, pr);
    // recurso desligado é o app de antes, não falha: não loga, não etiqueta e não
    // derruba o cardMet.
    const jiraLigado = cardRes.code !== JIRA_CODES.DESLIGADO;
    promptFinal += jiraMod.cardBlock(cardRes);
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
      if (labelEhDeOutraRevisao(res.coordination)) labelEmAndamento = '';
      return tratarBloqueioDeCoordenacao(engine, pr, res.coordination);
    }
    coord = res.coordination || null;
    const result = await resultadoComReparo(engine, res, id, streamOpts);
    // a sessão devolveu resultado: a referência de retomada cumpriu o papel (CT-RET)
    retomadaMod.consumirRetomada(engine, pr.key);
    // desfecho da retomada viaja no resultado até o recordDecision; quem persiste é a A1
    result.resumeOutcome = res.resumeOutcome || 'nenhuma';
    result.sessionId = res.sessionId || null;
    // tempo por etapa: calculado AGORA, porque o finally apaga o feed junto com a
    // sessão e este é o último momento em que o traço existe
    result.stages = stageSummaryFrom(
      engine.activity.get(id),
      (engine.activeReviews.get(id) || {}).startedAt,
      Date.now()
    );
    // G12: o head que ESTA sessão leu viaja com o resultado, pra recordDecision carimbar
    // no item e a reconciliação saber de qual estado do PR a decisão fala. Vazio quando
    // desconhecido (rede), mesmo compromisso do resto: falta de dado nunca inventa prova.
    result.headSha = headShaAtual;
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

    // cobertura herdada: arquivo INALTERADO que a última sessão leu conta como coberto
    // neste head, com a origem separada em coverage.inherited (leitura desta sessão e
    // prova herdada nunca se confundem). Roda ANTES do coverageGap, que segue puro.
    if (heranca.ativa && result.coverage && typeof result.coverage === 'object') {
      result.coverage = reconcileInheritedCoverage(result.coverage, heranca.unchanged);
      const herdados = (result.coverage.inherited || []).length;
      if (herdados) engine.pushActivity(id, 'info', `${herdados} arquivo(s) cobertos pela prova da leitura anterior (blob idêntico).`);
    }

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
    // gate, não infra: 'infra' neste repo quer dizer que a POSTAGEM falhou (a tela
    // mostra "falha técnica ao postar" e o decision.js descarta esses motivos
    // quando o retry do post resolve, o que faria o motivo do Jira sumir da
    // história). Card não lido é regra do app segurando a decisão.
    if (!cardRes.ok && jiraLigado && cardRes.code !== JIRA_CODES.SEM_CHAVE) {
      result.reasons = [gateReason(`card não lido no Jira (${cardRes.code}): ${motivoDe(cardRes.code)}`), ...(result.reasons || [])];
    }
    // estado dos checks OBRIGATÓRIOS no head, lido AQUI (a única leitura de rede deste
    // trecho) e entregue ao gate como campo do envelope, no mesmo desenho do
    // verificationCheckpoint: decision.js continua puro. É a mesma consulta que o
    // gate de lançamento faz (bloqueadoPorChecks), só que na SAÍDA, porque o clique
    // no Revisar atravessa o gate de entrada por desenho e a política de ressalvas
    // não olhava CI (biud-frontend#896, 02/09/2026: APPROVE postado com o `audit`
    // obrigatório vermelho, e o PR mergeado por bypass em cima dessa aprovação).
    // Leitura que falha devolve [] e o gate não inventa CI vermelho.
    try {
      const checks = await engine.bloqueadoPorChecks(pr);
      result.checksObrigatorios = Array.isArray(checks && checks.faltando) ? checks.faltando : [];
    } catch { result.checksObrigatorios = []; }
    const autoDec = engine.shouldAutoApprove(pr, result);
    let canAuto = autoDec.ok === true;
    let canReject = engine.shouldAutoReject(pr, result);
    if (pr.requested === false && (result.verdict === 'approve' || result.verdict === 'request_changes')) {
      result.reasons = [gateReason('revisão iniciada por você (não era seu review pedido): nada é postado sem sua decisão'),
        ...(result.reasons || [])];
    }
    // lacuna de cobertura: é a diferença entre "está limpo" e "não olhei", e explica
    // por que um PR grande sem achado nenhum caiu na sua mesa em vez de auto-aprovar.
    // (cada bloco abaixo faz unshift, então a ordem final das reasons é: contestação,
    // cobertura, clique; o último a prepender lidera)
    const semCobertura = engine.coverageGap(result);
    if (semCobertura.length) {
      const amostra = semCobertura.slice(0, 3).join(', ');
      result.reasons = [gateReason(`a revisão não cobriu o diff inteiro (${semCobertura.length} pendência(s): ${amostra}${semCobertura.length > 3 ? ', ...' : ''}), então não posto sozinho`),
        ...(result.reasons || [])];
    }
    // checkpoint malformado ou com divergência entre passadas: mesma régua da cobertura
    const gapCheckpoint = engine.checkpointGap(result);
    if (gapCheckpoint.length) {
      result.reasons = [gateReason(`verificação de afirmações com problema (${gapCheckpoint.join('; ')}), então não posto sozinho`),
        ...(result.reasons || [])];
    }
    // contestação a review de terceiro lidera as reasons QUANDO foi ela que segurou a
    // postagem: é o que você precisa conferir antes de deixar sair, porque é afirmação
    // pública contra outro revisor. Se você liberou esse cenário (Sistema > Automação),
    // não entra nada aqui: `attentionPoints` já publica a discordância com rótulo e
    // prova, e prepender de novo daria linha dobrada na tela dizendo "antes de postar"
    // num PR que já foi postado.
    const contested = engine.contestations(result);
    if (contested.length && autoDec.motivo === 'contestacao') {
      const label = contested.length === 1 ? 'discordância' : 'discordâncias';
      result.reasons = [gateReason(`${contested.length} ${label} de outro review no PR, confira a redação antes de postar (detalhe no relatório)`),
        ...(result.reasons || [])];
    }

    // O head pode ter andado ENQUANTO a sessão lia o PR (caso medido: biud-esg#224,
    // 21/08/2026, o autor empurrou b8722a3 dois minutos antes do POST). Postar assim é
    // escolher entre duas coisas erradas: com a âncora do G1 o GitHub recusa (422 opaco,
    // e o clique na fila repete a recusa pra sempre), e sem a âncora o review sai
    // carimbado num código que ninguém leu, convencendo o staleForReview de que o head
    // novo já foi revisado (o buraco do #742). Então não posta: o achado vira pendência
    // com o motivo em português e quem fecha o PR é o round seguinte, sobre o head certo.
    // Head desconhecido ('' por rede/token) degrada pro comportamento antigo, a mesma
    // regra do dedup por round: falta de dado nunca é lida como "head novo".
    if (canAuto || canReject) {
      let headAgora = '';
      try { headAgora = await engine.headSha(pr); } catch { /* sem sha não inventa rodada nova */ }
      if (headAgora && headShaAtual && headAgora !== headShaAtual) {
        result.reasons = [gateReason(`${staleHeadText(headShaAtual, headAgora)}, então não posto: este texto fala do código anterior`),
          ...(result.reasons || [])];
        canAuto = false;
        canReject = false;
        staleHeadNovo = headAgora;
        // rastro durável do bloqueio: visto de fora, uma sessão barrada aqui é
        // indistinguível de uma sessão que morreu (label entra, label sai, nada
        // é postado). Foi o que atrapalhou o diagnóstico do engine-ai#108.
        engine.log('INFO', `${pr.key}: head andou de ${headShaAtual.slice(0, 8)} pra ${headAgora.slice(0, 8)} durante a sessão; não postei, a pendência ficou marcada stale_head.`);
      }
    }

    if (canAuto) {
      // dedup: se eu ja aprovei ESTE HEAD (review manual ou via chat), nao posta um
      // segundo APPROVE (aconteceu no biud-frontend#635). Aprovação minha de um head
      // ANTERIOR não conta: o autor empurrou código novo desde então (#742).
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('APPROVED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'approve' });
        await fecharDesfecho(RECIBO_EXTERNO);
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha aprovado no GitHub; não postei de novo.` });
        return;
      }
      // o corpo do APPROVE vai LIMPO, do jeito que o review escreveu (tem que
      // parecer humano, teu). As ressalvas ficam guardadas no app (campo attention,
      // visível em Revisões recentes), não coladas no PR com carimbo de automação.
      const points = engine.attentionPoints(result);
      // G1: ancora o review no head que ESTA sessão leu (headShaAtual vem do
      // início da revisão); vazio = omite e o comportamento antigo vale
      pararSeLeasePerdido(coord);
      const post = await postarComRetentativas(
        () => engine.postReview(pr, { ...result.payloads.approve, commit_id: headShaAtual }, { via: 'revisao', handle: coord }),
        { antes: () => pararSeLeasePerdido(coord) });
      lancarSePossePerdida(post);
      if (post.ok) {
        // a memória recebe o item gravado (pr da fila), não o envelope cru: o
        // result.pr/memory.author da sessão não escolhem repo nem dossiê (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_approved', action: 'approve', attention: points });
        const publicItem = engine.decisionForUi(item);
        const publicPoints = publicItem.attention || [];
        engine.writeMemory(item, 'APPROVE');
        await fecharDesfecho(RECIBO_PUBLICADO);
        // points viaja no evento pro alerta distinguir os desfechos (sem ressalvas x com ressalvas)
        engine.emit('auto-approved', { pr, result: publicItem, points: publicPoints });
        engine.emit('toast', {
          kind: 'ok', text: publicPoints.length
            ? `⚠️ ${pr.key} aprovado com ${publicPoints.length} ressalva(s): ${reasonText(publicPoints[0])}`
            : `✅ ${pr.key} aprovado sem ressalvas.`
        });
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o APPROVE: ${post.error}`)];
      postFalhou = true;
      // falha claramente transitória (rede, gateway do GitHub fora do ar):
      // marca pro retryFailedPosts tentar de novo sozinho nos próximos ciclos,
      // reusando o payload já pronto, sem reabrir sessão. Mesma tabela de
      // classificação que decide o retry da sessão inteira (log-taxonomy.js,
      // invariante 3 do CLAUDE.md: uma fonte só pro que é transitório).
      result.postRetry = postRetryFor('approve', post.error, post);
    }

    // reprova sozinho (opt-in por conta): posta REQUEST_CHANGES com os bloqueios
    // que a revisão levantou. Mesmo gate do approve (review pedido a mim; clique
    // nunca posta) e dedup (não re-pede mudanças se eu já pedi PARA ESTE HEAD).
    // Este era o caminho do #742: o autor corrigia, o 2º round achava outro buraco e
    // o pedido de mudanças do round anterior fazia o achado novo morrer aqui dentro.
    if (canReject) {
      const states = await engine.myReviewStates(pr, headShaAtual);
      if (states && states.includes('CHANGES_REQUESTED')) {
        engine.recordDecision(pr, result, { status: 'already_reviewed', action: 'request_changes' });
        await fecharDesfecho(RECIBO_EXTERNO);
        engine.emit('toast', { kind: 'info', text: `${pr.key}: você já tinha pedido mudanças no GitHub; não postei de novo.` });
        return;
      }
      const rc = { ...result.payloads.request_changes, body: engine.rejectBodyWithMark(result.payloads.request_changes.body), commit_id: headShaAtual };
      pararSeLeasePerdido(coord);
      const post = await postarComRetentativas(
        () => engine.postReview(pr, rc, { via: 'revisao', handle: coord }),
        { antes: () => pararSeLeasePerdido(coord) });
      lancarSePossePerdida(post);
      if (post.ok) {
        // mesma regra do approve: memória atribuída pelo item, nunca pelo envelope (M6)
        const item = engine.recordDecision(pr, result, { status: 'auto_rejected', action: 'request_changes' });
        const publicItem = engine.decisionForUi(item);
        engine.writeMemory(item, 'REQUEST_CHANGES');
        await fecharDesfecho(RECIBO_PUBLICADO);
        engine.emit('auto-rejected', { pr, result: publicItem });
        engine.emit('toast', { kind: 'ok', text: `🔴 ${pr.key} reprovado (mudanças pedidas): ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}` });
        return;
      }
      result.reasons = [...(result.reasons || []), infraReason(`falha ao postar o REQUEST_CHANGES: ${post.error}`)];
      postFalhou = true;
      result.postRetry = postRetryFor('request_changes', post.error, post);
    }
    // transparência: o gate disse POR QUE não auto-postou (autoDec.motivo). Só
    // quando o motivo é a POLÍTICA da conta a recusa é atribuída à política;
    // contestação e cobertura já prependam a própria explicação nos blocos acima
    // (era o M7: o bloco antigo culpava a política em recusa de contestação/cobertura).
    // dois motivos de recusa não tinham tradução nenhuma e viravam card mudo ("precisa
    // da sua atenção: ver relatório"), sem dizer que o problema foi o ENVELOPE e não o
    // código. `nao_aprovavel` só é notícia quando a revisão de fato concluiu "aprovar":
    // em request_changes e needs_decision ele é o caminho normal, e falar dele ali seria
    // ruído em cima das razões que a própria revisão escreveu.
    if (autoDec.motivo === 'analise_incompleta') {
      result.reasons = [gateReason('a revisão não terminou a análise (o envelope voltou com status incompleto), então não posto sozinho'),
        ...(result.reasons || [])];
    }
    if (autoDec.motivo === 'sem_texto') {
      result.reasons = [gateReason('a revisão aprovou sem escrever nada (nem corpo, nem comentário de linha), e aprovação em branco não sai sozinha'),
        ...(result.reasons || [])];
    }
    if (autoDec.motivo === 'nao_aprovavel' && result.verdict === 'approve') {
      result.reasons = [gateReason('a revisão concluiu aprovar, mas não devolveu o APPROVE pronto pra postar (envelope incompleto), então não posto sozinho'),
        ...(result.reasons || [])];
    }
    if (autoDec.motivo === 'ci_vermelho') {
      const nomes = engine.checksVermelhos(result).join(', ');
      result.reasons = [gateReason(`check obrigatório vermelho no head (${nomes}): aprovação não sai sozinha com CI reprovando, mesmo aprovável com ressalvas; o merge está travado pelo ruleset até a pipe ficar verde`),
        ...(result.reasons || [])];
    }
    if (autoDec.motivo === 'politica') {
      const acc = engine.accountForPr(pr);
      const label = engine.scopeLabel(acc) || acc || 'esta conta';
      const clean = engine.attentionPoints(result).length === 0 && result.decision === 'auto_approve';
      const why = clean
        ? `aprovável sem ressalvas, mas a política da conta ${label} manda aguardar sua aprovação (ajuste em Sistema > Contas)`
        : `aprovável com ressalvas, e a política da conta ${label} é aguardar você (mude pra "aprova e destaca as ressalvas" em Sistema > Contas se quiser que aprove sozinho)`;
      result.reasons = [gateReason(why), ...(result.reasons || [])];
    }
    // bloqueio mecânico por head que andou: o carimbo é o que permite ao round
    // automático (reReviewTargets, gatilho por pendência) destravar sozinho
    const item = engine.recordDecision(pr, result, {
      status: 'pending',
      ...(staleHeadNovo ? { blockedKind: 'stale_head', blockedHead: staleHeadNovo } : {})
    });
    await fecharDesfecho({ publicationState: postFalhou ? 'failed' : 'pending' });
    const publicItem = engine.decisionForUi(item);
    engine.emit('needs-decision', { pr, item: publicItem });
    // o alerta lidera com o MOTIVO (transparência), não com uma contagem
    const extra = (publicItem.reasons || []).length > 1 ? ` (+${publicItem.reasons.length - 1})` : '';
    // commit novo durante a sessão NÃO é "precisa da sua atenção": o round automático
    // fecha sozinho, e o card diz quando (ou por que não). O toast antigo mandava a
    // pessoa agir exatamente no caso em que o app ia agir por ela.
    const texto = staleHeadNovo
      ? `↻ ${pr.key}: chegou commit novo durante a revisão, então nada foi postado; o card mostra quando reviso de novo.`
      : `🟡 ${pr.key} precisa da sua atenção: ${reasonText((publicItem.reasons || [])[0]) || 'ver relatório'}${extra}`;
    engine.emit('toast', { kind: 'info', text: texto });
  } catch (err) {
    // lease perdido no meio (D14): outro aparelho assumiu este PR com a mesma conta, e a
    // label de revisando passou a ser dele; tirá-la aqui apagaria o sinal dessa revisão
    if (err && err.coordenacao) labelEmAndamento = '';
    // último momento em que o feed existe: o finally apaga activity junto com a sessão
    anotarFalhaDaSessao(err, id, stageSummaryFrom(engine.activity.get(id), (engine.activeReviews.get(id) || {}).startedAt, Date.now()));
    // desfecho da retomada que a A5 mantém no registro ativo (retomada, recusada, nova)
    if (!err.resumeOutcome) err.resumeOutcome = (engine.activeReviews.get(id) || {}).resumeOutcome;
    throw err;
  } finally {
    // label antes do lease: com o lease devolvido primeiro, outro aparelho poderia
    // assumir e pôr a label dele, que esta remoção apagaria. Os desfechos já tiraram a
    // label no fecharDesfecho (labelEmAndamento volta vazio); aqui chega o que não teve
    // desfecho, e sem coordenação, tudo.
    await removeInProgressLabel(engine, pr, labelEmAndamento);
    await devolverLease(coord);
    engine.activeReviews.delete(id);
    engine.activity.delete(id);
    engine.writeInflight();
    engine.pushState();
  }
}

// Quem volta do retry pós-transitório neste ciclo (o check() chama quando a checagem
// funcionou, ou seja, a rede voltou). SÍNCRONA e sem IO, mesmo motivo do pushbackTargets:
// testável sem rede. A promessa do toast ("retomo sozinho") NÃO depende da política
// autoReview da conta nem de o PR estar na fila: revisão por clique no panorama e conta
// com autoReview desligado também são retomadas. Ficam de fora: conta silenciada, conta
// sem token no gh (guarda da Onda 1: sem token não abre sessão, o PR espera o token
// voltar), PR recém-chegado (o toReview do ciclo cuida dele), o que já está na fila
// headless/rodando, e conta cujo perfil de chave de API está com o orçamento
// estourado (mesmo gate do toReview, via budgetBlockedFor: é exatamente o caminho
// automático que causou o incidente de 04/08/2026, retry sem noção de gasto), e o PR
// cujo `notBefore` ainda está no futuro (limite de plano com hora de reset conhecida:
// tentar antes da hora é gasto certo com falha certa). O "agora" entra por parâmetro
// pra o teste ser determinístico; em produção é sempre o default.
function retryTargets(engine, freshKeys, inflightKeys, agora = Date.now()) {
  return [...engine.retryAfterNet.values()]
    .filter(v => !(v && v.notBefore && v.notBefore > agora))
    .map(v => v && v.pr)
    .filter(pr => pr &&
      !freshKeys.has(pr.key) &&
      !inflightKeys.has(pr.key) &&
      !engine.isMuted(engine.accountForPr(pr)) &&
      engine.tokenFor(engine.accountForPr(pr)) &&
      // saí de cena neste PR: o retry não pode ressuscitar o que eu prometi não
      // revisar (o enqueueHeadless barraria de qualquer jeito; aqui é pra não
      // ficar repescando em silêncio a cada ciclo)
      !(engine.skipComentado || {})[pr.key] &&
      // coordenação entre aparelhos segurando (conexão fora, ou espera anotada): o
      // retry espera com o resto das automações, sem gastar tentativa (D11)
      !seguraPelaCoordenacao(engine, pr.key) &&
      !grupoSegura(engine, engine.accountForPr(pr)) &&
      !engine.budgetBlockedFor(engine.accountForPr(pr)) &&
      // o limite da assinatura vale mesmo que a espera própria do PR já tenha passado
      !limiteAte(engine, engine.accountForPr(pr), agora));
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
// COMPARTILHADO entre aparelhos (SYNC.DAILY_ROUNDS_MAX, D13) é contrato da sincronização
// e continua valendo lá, só com ela ligada; o card mostra esse caso como coordenação.
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
  if (!engine.tokenFor(acct)) return parado('sem_token', acct);
  if (engine.budgetBlockedFor(acct)) return parado('orcamento', acct);
  if (engine.autoReviewParked.has(pr.key)) {
    return parado('estacionado', String(((engine.parkedMotivos || {})[pr.key] || {}).tipo || 'legado'));
  }
  const outros = engine.outrosRevisando(pr);
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
function explicaReRound(engine, pr, inflightKeys, agora = Date.now()) {
  const info = (engine.staleInfo || {})[pr.key];
  const pend = pendenciaStale(engine, pr.key);
  // gatilho A: review meu postado ficou stale (APPROVED ou CHANGES_REQUESTED,
  // com prova completa). gatilho B: resultado nunca postado, bloqueado por
  // stale_head, com o head observado carimbado na pendência.
  const viaStale = !!(info && info.stale && info.head &&
    (info.lastState === 'CHANGES_REQUESTED' || info.lastState === 'APPROVED'));
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
async function pushTrivial(engine, pr) {
  if (pendenciaStale(engine, pr.key)) return false;
  const prova = readFileProof(pr.key);
  if (!prova) return false;
  try { return sameEffectiveDiff(await engine.fetchPrFiles(pr), prova.files); }
  catch { return false; } // medição falhou: relança, que é o caminho seguro
}

// chamada pelo check() logo depois do refreshStaleStates (que preenche staleInfo).
// A âncora é gravada ANTES de enfileirar: se a revisão falhar, quem cuida é o
// retry/estacionamento de sempre, nunca um relançamento em loop por este caminho.
// Async desde a prova por arquivo: cada alvo pode custar UMA chamada gh (pulls/files)
// pra detectar push trivial, e só quando existe prova salva do round anterior.
async function launchReReviews(engine) {
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
    const trivial = await pushTrivial(engine, pr);
    if (trivial) {
      // aqui a âncora É desejada: o round foi decidido e concluído como "nada a
      // rever", e o pulo vale até o próximo push DE VERDADE.
      queimaAncora(pr);
      engine.emit('toast', { kind: 'info', text: `${pr.key}: o push não mudou o diff efetivo (rebase ou merge da base); a revisão anterior segue valendo.` });
    } else {
      relancar.push(pr);
    }
  }
  if (!relancar.length) return;
  for (const pr of relancar) queimaAncora(pr);
  engine.emit('toast', {
    kind: 'info',
    text: relancar.length === 1
      ? `↻ ${relancar[0].key} recebeu commit novo depois da sua revisão: revisando de novo.`
      : `↻ ${relancar.length} PRs receberam commit novo depois das suas revisões: revisando de novo.`
  });
  // requested: true = round 2 é CONTINUAÇÃO de um review meu, não clique avulso.
  // A postagem continua atrás do shouldAutoApprove/shouldAutoReject (política da
  // conta, card, contestação, cobertura) e do dedup por head, como qualquer revisão.
  for (const pr of relancar) engine.enqueueHeadless({
    ...pr, account: engine.accountForPr(pr), requested: true,
    // D13: só o round automático pós-push conta no teto compartilhado entre aparelhos
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
  prFromUrl, launchReview, enqueueHeadless, headlessAcct, headlessOrg, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, globalParallelLimit, freeHeadlessSlot, reReviewTargets, classificaReRound, explicaReRound, reRoundParaUi,
  bloqueioRecente, marcaBloqueio, limpaBloqueio,
  launchReReviews, saveReReviewLaunched, saveAutoReviewParked, estacionar, desestacionar, parkedParaUi,
  inProgressLabelFor, addInProgressLabel, removeInProgressLabel, limparLabelsOrfas,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
  lastReviewSessionId, stageSummaryFrom, stageOfLine, fastModeBlock, rodarSessao, retomadaAposFalhaBlock, enfileirarDaDistribuicao, devolverAoLocal,
  lerResultadoDaRevisao,
  MAX_RODADAS_PRESAS, diaLocal, normalizeAncora, proximaAncora,
  escolheModelo, rotuloOrigem,
};
export default reviewMod;
export {
  prFromUrl, launchReview, enqueueHeadless, headlessAcct, headlessOrg, processHeadless, runOneHeadless, retryTargets,
  parallelLimit, globalParallelLimit, freeHeadlessSlot, reReviewTargets, classificaReRound, explicaReRound, reRoundParaUi,
  bloqueioRecente, marcaBloqueio, limpaBloqueio,
  launchReReviews, saveReReviewLaunched, saveAutoReviewParked, estacionar, desestacionar, parkedParaUi,
  inProgressLabelFor, addInProgressLabel, removeInProgressLabel, limparLabelsOrfas,
  personProfileBlock, reviewFormatBlock, thirdPartyReviewBlock, headlessPromptFor, runHeadlessReview,
  lastReviewSessionId, stageSummaryFrom, stageOfLine, fastModeBlock, rodarSessao, retomadaAposFalhaBlock, enfileirarDaDistribuicao,
  lerResultadoDaRevisao,
  MAX_RODADAS_PRESAS, diaLocal, normalizeAncora, proximaAncora,
  escolheModelo, rotuloOrigem,
};
