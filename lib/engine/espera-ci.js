// A aprovação que espera o CI e sai sozinha quando ele fecha verde (30/09/2026).
//
// Pedido do dono: "A configuração tem de cumprir o que promete, sem exceção: se é pra aprovar
// automaticamente, ele realmente aprova, sem desculpas pra passar por um approve humano."
// De 27 a 30/09/2026 um resultado aprovável com check obrigatório vermelho ou ainda rodando
// virava card em "Precisa de você" pedindo o clique quando a pipe fechasse: a conta estava
// em "aprova sozinho" e a pessoa aprovava na mão do mesmo jeito. Aprovar por cima de CI
// vermelho continua proibido (biud-frontend#896, 02/09/2026); o que muda é que ESPERAR o CI
// é trabalho do app.
//
// Como funciona, no molde do reenvio de postagem (retryFailedPosts, decision.js):
//   - o runHeadlessReview guarda o resultado como pendência com a marca `esperaCi`
//     ({ desde, checks, pontos }), gravada no decisions.json, então sobrevive a reinício;
//   - a cada ciclo do check(), DEPOIS do reconcilePending (que tira o PR fechado, mergeado
//     ou já revisado por fora) e ANTES do retryFailedPosts, `aprovarQuandoOCiFechar` faz UMA
//     leitura `gh` por PR em espera (estado, head e checks no mesmo
//     `--json`; a exigência da branch vem do cache de checks-exigidos.js);
//   - checks todos verdes no MESMO head que a sessão leu: confere a política da conta de
//     novo (ela pode ter mudado na espera), faz o dedup por head e posta pelo postReview
//     de sempre (identidade, fila por PR, arbitragem entre aparelhos, PR fechado);
//   - head diferente: larga a espera e marca a pendência como commit novo, que é o que
//     devolve o PR ao round automático (reReviewTargets); nunca posta em head que não leu;
//   - CI ainda vermelho ou rodando: segue esperando, sem teto. Não aprova e não pede clique;
//   - com tudo verde e o head igual, ANTES de postar, o gate de consciência é consultado de
//     novo (bloqueadoPorHistorico, skip-review.js, a mesma função do lançamento automático).
//     Desde 18/10/2026 (a decisão sem mesa) nenhum desfecho dele vai para a mesa: duas
//     aprovações de gente neste commit resolvem a pendência como "aprovação automática não
//     necessária" (nada é postado), e um pedido de mudanças de gente não segura: o APPROVE
//     sai pela política da conta e o pedido continua registrado no GitHub. Só lê reviews
//     nesse momento, nunca a cada ciclo de espera;
//   - CI obrigatório VERMELHO no commit revisado com a conta reprovando sozinha: o
//     REQUEST_CHANGES citando os checks encerra a espera: outro commit permite nova análise.
//
// AQUI A FALTA DE DADO SEGURA, ao contrário do gate de lançamento (bloqueadoPorChecks, onde
// leitura que falha deixa passar): lá o pior caso é uma revisão refeita, aqui é um APPROVE
// por cima de CI que ninguém conseguiu ler. Sem token, gh fora, rollup ilegível ou exigência
// da branch desconhecida = espera o próximo ciclo.
//
// Aprovação manual também exige prova atual do CI. A opção antiga não dispensa a espera.
import io from '../io.js';
import { classify } from '../log-taxonomy.js';
import { checksExigidosDoRepo, checksExigidosVerdes } from './checks-exigidos.js';
import { coordenacaoForaDoAr } from './postagem-arbitragem.js';
import { publicarRecibo, decisaoAutomaticaJaPublicada } from './decision.js';
import contasConfig from './contas-config.js';
import { origemDoDono, payloadDoCiVermelho, reconstruirPayload } from './desfecho-automatico.js';
import { aguardaCiParaAprovar, avisoDoCi, motivoDeEspera, textoDaEspera } from './gate-espera.js';

const TETO_DE_CHECKS = 20;
const TETO_DO_NOME = 120;
const ESTADOS = ['vermelho', 'rodando', 'ausente'];

function checksLimpos(lista) {
  return (Array.isArray(lista) ? lista : [])
    .filter((c) => c && ESTADOS.includes(String(c.estado || '')) && String(c.nome || '').trim())
    .slice(0, TETO_DE_CHECKS)
    .map((c) => ({ nome: String(c.nome).trim().slice(0, TETO_DO_NOME), estado: String(c.estado) }));
}

function assinatura(checks) {
  return checksLimpos(checks).map((c) => `${c.nome}:${c.estado}`).join(',');
}

// O motivo que o card mostra enquanto espera, com o texto de gate-espera.js (um lugar só).
// `espera: true` é o que deixa a varredura trocar ou tirar esta linha sem farejar o texto.
function motivoDaEspera(checks) {
  if (!checks.length) return { text: 'verificação do CI obrigatório pendente; aguardo a confirmação no commit revisado', kind: 'gate', espera: true };
  const r = { checksObrigatorios: checks };
  return { text: textoDaEspera(motivoDeEspera(r), r), kind: 'gate', espera: true };
}

function semMotivoDaEspera(reasons) {
  return (Array.isArray(reasons) ? reasons : []).filter((r) => !(r && typeof r === 'object' && r.espera === true));
}

// O que o runHeadlessReview grava quando o gate devolve ci_vermelho ou ci_em_andamento;
// qualquer outro motivo devolve null (não há espera). `extra` vai para o recordDecision e
// `reasons` é o que o card mostra. `pontos` são as ressalvas do resultado (attentionPoints),
// guardadas porque a classe (limpo ou com ressalvas) é relida a cada ciclo contra a
// política VIGENTE da conta.
const MOTIVOS_DE_ESPERA = ['ci_vermelho', 'ci_em_andamento'];
function armar(motivo, result, pontos) {
  if (!MOTIVOS_DE_ESPERA.includes(motivo)) return null;
  const checks = checksLimpos(result && result.checksObrigatorios);
  const ressalvas = Array.isArray(pontos) ? pontos : [];
  return { extra: { esperaCi: { desde: Date.now(), checks, pontos: ressalvas } }, reasons: [motivoDaEspera(checks), ...ressalvas] };
}

// Não é "precisa da sua atenção": o app vai agir sozinho, e o aviso diz isso.
function avisarDaEspera(engine, pr) {
  engine.emit('toast', { kind: 'info', text: `⏳ ${pr.key}: aprovável, esperando o CI obrigatório; aprovo sozinho quando ele fechar verde neste commit.` });
}

// A leitura única do ciclo. null = não deu pra provar nada, e quem chama espera.
async function lerCi(engine, item) {
  const pr = { ...item.pr, key: item.key };
  const conta = engine.accountForPr(pr);
  if (!pr.url || !engine.tokenFor(conta)) return null;
  const r = await io.run('gh', ['pr', 'view', pr.url, '--json', 'state,headRefOid,baseRefName,statusCheckRollup'], { env: engine.ghEnv(conta) });
  if (!r.ok) return null;
  const j = io.parseJson(r.stdout, null);
  if (!j || !j.state || !j.headRefOid) return null;
  const lido = { estado: String(j.state), head: String(j.headRefOid), faltando: null };
  if (!Array.isArray(j.statusCheckRollup)) return lido;
  const exigidos = await checksExigidosDoRepo(engine, pr.repo || String(item.key).split('#')[0], j.baseRefName);
  if (!Array.isArray(exigidos)) return lido;
  lido.faltando = checksExigidosVerdes(j.statusCheckRollup, exigidos).faltando;
  return lido;
}

function indiceDe(engine, item) {
  return engine.decisions.pending.findIndex((d) => d.id === item.id);
}

// Larga a espera e deixa a pendência com o motivo dito. É o único caminho pelo qual uma espera
// vira "Precisa de você", e desde 18/10/2026 só sobram a política da conta mudada para esperar
// você, a falha permanente ao postar (infra, dita no card) e a pendência gravada sem o commit
// lido ou sem o APPROVE; o commit novo também passa por aqui, mas vira round automático.
function largar(engine, item, motivo, extra) {
  const idx = indiceDe(engine, item);
  if (idx < 0) return null;
  const d = engine.decisions.pending[idx];
  d.esperaCi = null;
  d.reasons = [motivo, ...semMotivoDaEspera(d.reasons)];
  Object.assign(d, extra || {});
  engine.saveDecisions();
  return d;
}

function avisarQueFoiParaAMesa(engine, d) {
  if (!d) return;
  const publico = engine.decisionForUi(d);
  engine.emit('needs-decision', { pr: { ...d.pr, key: d.key }, item: publico });
  engine.emit('toast', { kind: 'info', text: `🟡 ${d.key} precisa da sua atenção: ${((publico.reasons || [])[0] || {}).text || 'ver relatório'}` });
}

const curto = (sha) => String(sha || '').slice(0, 7) || '?';

function largarPorCommitNovo(engine, item, head) {
  const motivo = { text: `o autor empurrou commit novo enquanto a aprovação esperava o CI (${curto(item.headSha)} -> ${curto(head)}), então não posto: este texto fala do código anterior`, kind: 'gate' };
  const d = largar(engine, item, motivo, { blockedKind: 'stale_head', blockedHead: head });
  if (!d) return;
  engine.log('INFO', `${item.key}: head andou de ${curto(item.headSha)} pra ${curto(head)} na espera do CI; larguei a espera, a pendência ficou marcada stale_head.`);
  engine.emit('toast', { kind: 'info', text: `↻ ${item.key}: chegou commit novo enquanto eu esperava o CI, então nada foi postado; o card mostra quando reviso de novo.` });
}

// A política da conta pode ter mudado durante a espera. Sem IO, então roda antes da leitura.
function politicaAindaAprova(engine, item) {
  const conta = engine.accountForPr({ ...item.pr, key: item.key });
  const limpo = !(item.esperaCi.pontos || []).length;
  if (engine.approvePolicyFor(conta, limpo) === 'approve') return true;
  avisarQueFoiParaAMesa(engine, largar(engine, item, { text: contasConfig.motivoDaPolitica(engine, conta, limpo), kind: 'gate' }));
  return false;
}

// O CI ainda não fechou: atualiza a lista de checks do card só quando ela mudou, senão cada
// ciclo regravaria o decisions.json e empurraria estado para a tela à toa.
function seguirEsperando(engine, item, faltando) {
  const checks = checksLimpos(faltando);
  if (assinatura(checks) === assinatura(item.esperaCi.checks)) return;
  const idx = indiceDe(engine, item);
  if (idx < 0) return;
  const d = engine.decisions.pending[idx];
  d.esperaCi = { ...d.esperaCi, checks };
  d.reasons = [motivoDaEspera(checks), ...semMotivoDaEspera(d.reasons)];
  engine.saveDecisions();
}

function resolver(engine, item, extra) {
  const idx = indiceDe(engine, item);
  if (idx < 0) return null;
  engine.decisions.pending.splice(idx, 1);
  const resolvido = { ...item, esperaCi: null, reasons: semMotivoDaEspera(item.reasons), ...extra };
  engine.resolveIntoHistory(resolvido);
  engine.saveDecisions();
  return resolvido;
}

async function encerrarJaDecidido(engine, item, action) {
  if (!resolver(engine, item, { status: 'already_reviewed', action })) return false;
  await publicarRecibo(engine, item, item.headSha);
  return true;
}

function falhaAoPostar(engine, item, post) {
  // incerto, posse de outro aparelho ou estado desconhecido: nada a concluir, o próximo ciclo decide
  if (post.estado && post.estado !== 'recusada') return;
  // falha passageira passa a ser assunto do reenvio de sempre (retryFailedPosts); falha
  // permanente (texto barrado, credencial) é a única que exige você, e o card diz qual foi
  const transitoria = classify(String(post.error || '')).kind === 'transitorio';
  // o texto reconstruído depois da trava de linguagem substitui o barrado: o reenvio manda ele
  const usado = post.payloadUsado ? { payloads: { ...item.payloads, approve: { ...post.payloadUsado, commit_id: undefined } } } : {};
  const d = largar(engine, item, { text: `falha ao postar o APPROVE: ${post.error || 'erro desconhecido'}`, kind: 'infra' },
    { postRetry: transitoria ? { event: 'approve', attempts: 0 } : null, ...usado });
  if (!transitoria) avisarQueFoiParaAMesa(engine, d);
}

// Duas aprovações de gente neste commit chegaram durante a espera: a aprovação automática não
// é necessária. Resolve sem postar e sem mesa (18/10/2026). Os nomes vêm do
// bloqueadoPorHistorico, que já tirou ferramenta (acrity) e a própria conta.
async function dispensar(engine, item, hist) {
  const nomes = (hist.quem || []).map((u) => `@${u}`).join(', ');
  const motivo = { text: `o PR já tem duas aprovações de pessoas neste commit (${nomes}), que chegaram enquanto eu esperava o CI: a aprovação automática não é necessária, nada foi postado`, kind: 'gate' };
  const resolvido = resolver(engine, item, { status: 'approval_not_needed', action: 'skip', reasons: [motivo, ...semMotivoDaEspera(item.reasons)] });
  if (!resolvido) return 0;
  await publicarRecibo(engine, item, item.headSha);
  engine.emit('toast', { kind: 'info', text: `${item.key}: duas pessoas já aprovaram este commit (${nomes}); a aprovação automática não é necessária.` });
  return 1;
}

// O gate de consciência, na hora em que o post acontece de verdade: 'posta', 'dispensada' ou
// 'espera' (head não confirmado: o próximo ciclo decide com a leitura única de sempre).
async function consciencia(engine, item, pr) {
  const hist = await engine.bloqueadoPorHistorico(pr);
  if (!hist || hist.head !== item.headSha) return 'espera';
  if (!hist.bloqueado) return 'posta';
  engine.log('INFO', `${item.key}: espera do CI resolvida sem postar, duas aprovações de gente no head ${curto(item.headSha)} (${(hist.quem || []).join(', ')})`);
  return (await dispensar(engine, item, hist)) ? 'dispensada' : 'espera';
}

// A trava de linguagem barrou o texto: reconstrói UMA vez (desfecho-automatico.js). Sem
// reconstrução possível, a falha é permanente e vai para o card como infra (falhaAoPostar).
async function postarReconstruindo(engine, pr, payload, item) {
  const post = await engine.postReview(pr, payload, { via: 'espera-ci', continuidade: item });
  if (post.ok || post.blocked !== 'internal_language') return post;
  const novo = reconstruirPayload(payload, engine.accountForPr(pr));
  if (!novo) return post;
  // o texto que de fato foi tentado viaja junto: é ele que o reenvio precisa mandar (achado 7)
  return { ...(await engine.postReview(pr, novo, { via: 'espera-ci', continuidade: item })), payloadUsado: novo };
}

// CI obrigatório VERMELHO no commit que a sessão leu, com a conta reprovando sozinha: o
// REQUEST_CHANGES citando os checks encerra o head. Sem a política, sem origem do dono ou sem conseguir
// conferir os meus reviews, só espera, como antes.
async function reprovarPeloCi(engine, item, faltando) {
  const vermelhos = faltando.filter((c) => c && c.estado === 'vermelho');
  const pr = { ...item.pr, key: item.key };
  if (!vermelhos.length || !origemDoDono(item.pr)) return;
  if (engine.rejectPolicyFor(engine.accountForPr(pr)) !== 'request_changes') return;
  const states = await engine.myReviewStates(pr, item.headSha);
  if (states === null) return;
  if (decisaoAutomaticaJaPublicada(pr, states)) {
    return encerrarJaDecidido(engine, item, 'request_changes');
  }
  const payload = { ...payloadDoCiVermelho(vermelhos, item.headSha), commit_id: item.headSha };
  if (!states.includes('CHANGES_REQUESTED')) {
    const post = await postarReconstruindo(engine, pr, payload, item);
    if (!post.ok) { engine.log('WARN', `espera do CI ${item.key}: pedido de mudanças pelo CI vermelho não saiu: ${post.error || 'erro desconhecido'}`); return; }
    if (post.alreadyReviewed) return encerrarJaDecidido(engine, item, 'request_changes');
    engine.emit('toast', { kind: 'ok', text: `🔴 ${item.key}: CI obrigatório vermelho neste commit, mudanças pedidas; nova revisão automática somente em outro commit.` });
  }
  if (resolver(engine, item, { status: 'auto_rejected', action: 'request_changes', verdict: 'request_changes',
    payloads: { ...item.payloads, request_changes: payload } })) await publicarRecibo(engine, item, item.headSha);
}

function textoDaAprovacao(key, ressalvas, desligada) {
  const com = ressalvas ? `, com ${ressalvas} ressalva(s)` : '';
  if (desligada) return `✅ ${key}: a espera do CI está desligada, então a aprovação que esperava saiu sozinha${com}.`;
  if (ressalvas) return `⚠️ ${key}: o CI fechou verde e a aprovação saiu sozinha${com}.`;
  return `✅ ${key}: o CI fechou verde e a aprovação saiu sozinha, sem ressalvas.`;
}

// CI verde no mesmo head (ou espera desligada) e política mandando aprovar: posta pelo
// caminho de sempre. `ciNaoVerde` só vem com a espera desligada: é a lista de checks
// obrigatórios que ainda não fecharam verdes (ou null, se não deu pra ler), e vira ressalva.
async function postar(engine, item, ciNaoVerde) {
  const pr = { ...item.pr, key: item.key };
  const vez = await consciencia(engine, item, pr);
  if (vez !== 'posta') return vez === 'dispensada' ? 1 : 0;
  // dedup por head, e aqui null NÃO libera: a espera pode ter durado horas e você pode ter
  // aprovado por fora nesse meio tempo; sem conseguir conferir, tenta no próximo ciclo
  const states = await engine.myReviewStates(pr, item.headSha);
  if (states === null) return 0;
  if (decisaoAutomaticaJaPublicada(pr, states) || states.includes('APPROVED')) {
    if (!await encerrarJaDecidido(engine, item, 'approve')) return 0;
    engine.emit('toast', { kind: 'info', text: `${item.key}: você já tinha decidido sobre este commit no GitHub; não postei de novo.` });
    return 1;
  }
  const post = await postarReconstruindo(engine, pr, { ...item.payloads.approve, commit_id: item.headSha }, item);
  if (post.waitForCi) return 0;
  if (!post.ok) { falhaAoPostar(engine, item, post); return 0; }
  if (post.alreadyReviewed) return await encerrarJaDecidido(engine, item, 'approve') ? 1 : 0;
  const desligada = ciNaoVerde !== undefined;
  const pontos = [...(item.esperaCi.pontos || []),
    ...(desligada ? avisoDoCi({ checksObrigatorios: ciNaoVerde || item.esperaCi.checks }) : [])];
  const resolvido = resolver(engine, item, { status: 'auto_approved', action: 'approve', attention: pontos });
  if (!resolvido) return 0;
  await publicarRecibo(engine, item, item.headSha);
  engine.writeMemory(resolvido, 'APPROVE');
  const publico = engine.decisionForUi(resolvido);
  engine.emit('auto-approved', { pr: { ...item.pr, key: item.key }, result: publico, points: publico.attention || [] });
  engine.emit('toast', {
    kind: 'ok', text: textoDaAprovacao(item.key, pontos.length, desligada),
  });
  return 1;
}

async function umaEspera(engine, item) {
  if (!item.payloads || !item.payloads.approve || !item.headSha) {
    // sem o APPROVE gravado ou sem o head que a sessão leu não há como provar de que código
    // o texto fala: não posta às cegas (pendência corrompida ou de leitura de head que falhou)
    avisarQueFoiParaAMesa(engine, largar(engine, item, { text: 'a revisão ficou sem o commit lido ou sem o texto da aprovação gravados, então a aprovação não sai sozinha depois do CI', kind: 'gate' }));
    return 0;
  }
  if (!politicaAindaAprova(engine, item)) return 0;
  const lido = await lerCi(engine, item);
  // PR fechado ou mergeado é do reconcilePending, que roda antes e resolve a pendência
  if (!lido || lido.estado !== 'OPEN') return 0;
  if (lido.head !== item.headSha) { largarPorCommitNovo(engine, item, lido.head); return 0; }
  // "A revisão ainda está pedida a mim?" NÃO é conferido aqui, de propósito. A espera só é
  // armada com `requested === true`, e o GitHub tira a conta de reviewRequests assim que ela
  // posta um review: no round 2 (pedi mudanças, o autor corrigiu, o CI está rodando), que é
  // o caso mais comum de espera, a lista vem sem mim e a aprovação iria para a mesa.
  // espera desligada depois de armada: o head já foi conferido acima, o CI não segura mais
  // A preferência de espera não dispensa os checks necessários à aprovação.
  if (!lido.faltando) return 0;
  if (lido.faltando.length) {
    await reprovarPeloCi(engine, item, lido.faltando);
    if (indiceDe(engine, item) < 0) return 1;
    seguirEsperando(engine, item, lido.faltando);
    return 0;
  }
  return postar(engine, item);
}

// A varredura do ciclo. Devolve quantas esperas se resolveram.
async function aprovarQuandoOCiFechar(engine) {
  // coordenação entre aparelhos ligada e fora do ar: a postagem automática seria recusada na
  // arbitragem depois de gastar a leitura. Espera a conexão, como o reenvio.
  if (coordenacaoForaDoAr(engine)) return 0;
  const esperando = engine.decisions.pending.filter((d) => d && d.esperaCi);
  let resolvidas = 0;
  for (const item of esperando) {
    try { resolvidas += await umaEspera(engine, item); }
    catch (err) { engine.log('WARN', `espera do CI ${item.key}: ${err.message}`); }
  }
  return resolvidas;
}

export default { armar, avisarDaEspera, aprovarQuandoOCiFechar, checksLimpos };
export { armar, avisarDaEspera, aprovarQuandoOCiFechar, checksLimpos };
