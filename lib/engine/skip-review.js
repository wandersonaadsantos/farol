/* UM Farol por PR (v2.50.1, decisão do Wanderson em 20/08/2026).

   A v2.49.0 estreou o pulo por label e ele estava ERRADO de origem. A label
   `<conta>:revisando` é um marcador TRANSITÓRIO: o próprio Farol a remove ao fim
   da sessão. Gatear nela respondia "tem alguém revisando neste segundo", e essa
   resposta volta a ser "não" em minutos. Medido no biudtech/engine-ai#60:

     18:48:42  label do thiagocarvalho-dev entra
     18:50:29  Farol do Alexpraxedes comenta "não vou duplicar a revisão"
     18:52:15  label do thiagocarvalho-dev SAI (a revisão dele terminou)
     18:55:46  Farol do Alexpraxedes entra e revisa
     18:59:09  Alexpraxedes APROVA

   Ou seja: o pulo era um adiamento de cinco minutos com uma promessa pública
   quebrada em cima. Pior, quem se calou era o CODEOWNERS do repo (`* @Alexpraxedes`).

   O que vale agora: ver a label de outra pessoa faz o Farol SAIR DE CENA naquele
   head, de forma DURÁVEL, e é isso que o comentário passa a descrever com verdade.
   Ele não revisa depois. Duas saídas a partir daí:

   - `coAssinarReview` LIGADO (opt-in em Sistema > Automação): quando a pessoa que
     pegou o PR aprova, o Farol aprova em seu nome, sem abrir sessão nem gastar
     token. É o caminho que mantém a aprovação exigida chegando (codeowner) sem
     duplicar trabalho. O preço, assumido por decisão: você endossa uma revisão
     que não fez e não tem como saber com que rigor (nem com que modelo) ela foi
     feita. Por isso é opt-in e nunca padrão.
   - DESLIGADO: o Farol fica de fora e o PR espera você. O clique manual em
     Revisar sempre funciona e nunca passa por este gate.

   CADUCIDADE (a rede de segurança): se a label da outra pessoa sumiu e ela NÃO
   postou review nenhum naquele head, a sessão dela morreu no meio. Aí a saída de
   cena caduca e o Farol volta a revisar normalmente, senão um crash na máquina
   do colega deixaria o PR órfão pra sempre.

   LIMITE CONHECIDO: dois Farols que começam no mesmo segundo não se veem (nenhum
   dos dois tem sinal ainda) e os dois revisam. O sinal reduz duplicata, não é
   trava distribuída, e fingir o contrário seria mentira.

   CAPÍTULO DE 28/08/2026 (incidente do biud-frontend#845): a revisão do Farol
   tem que parecer 100% humana, então NADA de automação pode aparecer
   publicamente no GitHub. Duas consequências aqui:
   - O COMENTÁRIO público de pulo morreu. Era um template fixo, e a mesma frase,
     palavra por palavra, saindo de contas diferentes minutos depois do sinal
     alheio subir, denunciava a ferramenta. A saída de cena virou SILENCIOSA no
     GitHub: a âncora nasce da DECISÃO (não mais de um comentário que saiu) e o
     aviso é um toast no app.
   - O sinal de "revisando agora" tem DUAS fontes na transição: a label legada
     `<login>:revisando` (colegas com versões antigas ainda escrevem e só leem
     labels; ela chega de graça no campo labels do gh search prs) e a ref git
     invisível de lib/engine/review-signal.js (o que a versão nova escreve).
     `outrosRevisando` é a UNIÃO das duas. */
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import io, { writeJsonAtomic } from '../io.js';
import { parseCodeowners, souAutoridade, cobreMinhaExigencia } from './codeowners.js';
import { sinalVivo } from './review-signal.js';

const SKIP_FILE = path.join(STATE_DIR, 'skip-comentado.json');
const SUFIXO = ':revisando';

// Contas que carregam label no formato de pessoa mas NÃO são pessoas: review de
// ferramenta não dispensa olho humano, então ver a label dela não pode calar o Farol.
const NAO_SAO_PESSOAS = new Set(['acrity']);

/* ---------- leitura dos sinais (PURA) ---------- */

// Quem MAIS está revisando agora SEGUNDO AS LABELS LEGADAS, tirando a minha
// conta e as ferramentas. É o sinal das cópias antigas do Farol (transição de
// 28/08/2026: a versão nova só escreve refs, mas segue lendo as labels). Ordem
// estável porque a lista entra em texto visível, que não pode variar por sorte
// do gh. Comparação sem caixa: o GitHub preserva a caixa do login.
function revisandoPorOutros(labels, minhaConta) {
  const me = String(minhaConta || '').trim().toLowerCase();
  const achados = new Set();
  for (const nome of Array.isArray(labels) ? labels : []) {
    const texto = String(nome || '');
    if (!texto.toLowerCase().endsWith(SUFIXO)) continue;
    const login = texto.slice(0, -SUFIXO.length).trim();
    if (!login) continue;
    const chave = login.toLowerCase();
    if (chave === me || NAO_SAO_PESSOAS.has(chave)) continue;
    achados.add(login);
  }
  return [...achados].sort((a, b) => a.localeCompare(b));
}

// Quem está revisando SEGUNDO AS REFS de review-signal.js (o sinal novo). PURA:
// recebe as entries já buscadas ({ number, login, epochMs }), filtra pelo número
// do PR, exclui a minha conta e as ferramentas (sem caixa), aplica o TTL dos
// dois lados do relógio (sinalVivo) e devolve logins ordenados, sem duplicata.
function revisandoPorSinais(entries, prNumber, minhaConta, agora, ttlMs) {
  const me = String(minhaConta || '').trim().toLowerCase();
  const achados = new Map(); // chave minúscula -> primeira grafia vista
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || e.number !== prNumber) continue;
    const login = String(e.login || '').trim();
    if (!login) continue;
    const chave = login.toLowerCase();
    if (chave === me || NAO_SAO_PESSOAS.has(chave)) continue;
    if (!sinalVivo(e.epochMs, agora, ttlMs)) continue;
    if (!achados.has(chave)) achados.set(chave, login);
  }
  return [...achados.values()].sort((a, b) => a.localeCompare(b));
}

// entries do repo deste PR, do snapshot que refreshReviewSignals mantém no
// engine (Map repoLower -> entries). Sem snapshot (busca nunca rodou, engine de
// teste), degrada pra lista vazia: falta de dado nunca pula revisão.
function sinaisDoRepo(engine, pr) {
  const repo = String((pr && pr.repo) || (pr && pr.key) || '').split('#')[0].trim().toLowerCase();
  const mapa = engine.reviewSignals;
  return (repo && mapa instanceof Map) ? (mapa.get(repo) || []) : [];
}

// número do PR pro filtro das entries (mesmo fallback do reviewsDeOutros).
function numeroDoPr(pr) {
  const n = pr && pr.number;
  if (Number.isInteger(n) && n > 0) return n;
  const daKey = parseInt(String((pr && pr.key) || '').split('#')[1], 10);
  return (Number.isInteger(daKey) && daKey > 0) ? daKey : 0;
}

// Gate SÍNCRONO e sem IO (mesmo contrato do reReviewTargets: quem decide gastar
// sessão Claude tem que ser testável sem rede). Lê só o que os ciclos anteriores
// já trouxeram: labels do gh search prs + refs do refreshReviewSignals. UNIÃO
// das duas fontes, dedup sem caixa preservando a primeira grafia (label legada
// primeiro), ordem estável por localeCompare.
function outrosRevisando(engine, pr) {
  const minha = engine.accountForPr(pr);
  const porLabel = revisandoPorOutros(pr && pr.labels, minha);
  const porRef = revisandoPorSinais(sinaisDoRepo(engine, pr), numeroDoPr(pr), minha, Date.now(), TEMPOS.SINAL_REVISAO_TTL_MS);
  const uniao = new Map();
  for (const login of [...porLabel, ...porRef]) {
    const chave = String(login).toLowerCase();
    if (!uniao.has(chave)) uniao.set(chave, login);
  }
  return [...uniao.values()].sort((a, b) => a.localeCompare(b));
}

/* ---------- textos ---------- */

// Desde 28/08/2026 este texto alimenta só o TOAST no app (o comentário público
// de pulo morreu, ver o cabeçalho). A régua de redação continua a mesma: sem
// citar automação, sem travessão, e sem pronome de gênero pra quem o app não
// tem como saber.
function textoDoPulo(outros) {
  const nomes = (outros || []).map(u => `@${u}`);
  if (!nomes.length) return '';
  const lista = nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  const verbo = nomes.length === 1 ? 'já está revisando' : 'já estão revisando';
  return `Vi que ${lista} ${verbo} este PR, então não vou duplicar a revisão.`;
}

function textoDaCoassinatura(quem) {
  return `De acordo com a revisão do @${quem}.`;
}

/* ---------- estado ---------- */

function loadSkipComentado(log) {
  const bruto = io.readJson(SKIP_FILE, {}, log);
  return (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) ? bruto : {};
}

function saveSkipComentado(engine) {
  try { writeJsonAtomic(SKIP_FILE, engine.skipComentado || {}); }
  catch (err) { engine.log('WARN', `salvar skip-comentado: ${err.message}`); }
}

/* ---------- autoridade do repo (CODEOWNERS) ----------
   Aprovação NÃO é fungível quando o repo tem dono de código, e foi esse o furo da
   v2.50.1: sair de cena porque alguém está revisando podia calar justamente quem o
   repo exige. Ver o cabeçalho de lib/engine/codeowners.js pros dois casos medidos. */

// CODEOWNERS mora em um de três lugares. Cache por repo em memória (o arquivo
// muda raramente e a decisão roda a cada ciclo). null = NÃO DEU pra saber (rede,
// permissão) e o chamador tem que cair no lado seguro; [] = repo sem CODEOWNERS,
// que é conclusivo e libera a saída de cena.
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];
// TTL do cache: CODEOWNERS muda raramente e a decisão roda a cada ciclo.
// Sai de TEMPOS, junto das outras durações do app (gate de qualidade).
const CODEOWNERS_TTL_MS = TEMPOS.HORA_MS;

async function codeownersDoRepo(engine, pr) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const acc = engine.accountForPr(pr);
  if (!repo || !engine.tokenFor(acc)) return null;
  if (!engine.codeownersCache) engine.codeownersCache = new Map();
  const cache = engine.codeownersCache.get(repo);
  if (cache && (Date.now() - cache.at) < CODEOWNERS_TTL_MS) return cache.regras;
  let achou = null;
  let houveFalhaDura = false;
  for (const caminho of CODEOWNERS_PATHS) {
    const r = await io.run('gh', ['api', `repos/${repo}/contents/${caminho}`, '--jq', '.content'], { env: engine.ghEnv(acc) });
    if (r.ok) { achou = Buffer.from(String(r.stdout || '').replace(/\s+/g, ''), 'base64').toString('utf8'); break; }
    // 404 é resposta CONCLUSIVA (não existe ali); qualquer outra falha é ignorância
    if (!/not found|404/i.test(String(r.stderr || ''))) houveFalhaDura = true;
  }
  if (achou === null && houveFalhaDura) return null;
  const regras = achou === null ? [] : parseCodeowners(achou);
  engine.codeownersCache.set(repo, { regras, at: Date.now() });
  return regras;
}

// Caminhos que o PR mexe. null = não deu pra medir (lado seguro pro chamador).
async function caminhosDoPr(engine, pr) {
  try {
    const arquivos = await engine.fetchPrFiles(pr);
    return Array.isArray(arquivos) ? arquivos.map(f => f.path).filter(Boolean) : null;
  } catch { return null; }
}

/* Posso sair de cena? Só quando ALGUÉM que está revisando cobre a mesma exigência
   que eu cobriria. Devolve { pode, autoridade }: `autoridade` também gateia a
   co-assinatura, porque se a minha aprovação é a que filtra o que sobe, ela tem
   que vir de revisão de verdade e não de endosso (decisão do Wanderson, 20/08/2026).
   Falta de dado (CODEOWNERS ilegível, diff não medido) NUNCA libera a saída: melhor
   revisar à toa que calar quem o repo exige. */
async function podeSairDeCena(engine, pr, outros) {
  const regras = await codeownersDoRepo(engine, pr);
  if (regras === null) return { pode: false, autoridade: false };
  if (!regras.length) return { pode: true, autoridade: false }; // repo sem dono de código
  const caminhos = await caminhosDoPr(engine, pr);
  if (!caminhos) return { pode: false, autoridade: false };
  const eu = engine.accountForPr(pr);
  return {
    pode: (outros || []).some(o => cobreMinhaExigencia(regras, caminhos, eu, o)),
    autoridade: souAutoridade(regras, caminhos, eu),
  };
}

/* ---------- saída de cena ---------- */

// Grava a âncora POR HEAD e avisa NO APP, sem postar nada no GitHub. O contrato
// antigo ("a âncora só nasce de um comentário que SAIU") morreu junto com o
// comentário público em 28/08/2026: agora a âncora nasce da DECISÃO de sair de
// cena, e quem avisa é o toast. A exigência que fica é `outros` não vazio (sair
// de cena por ninguém não é decisão, é bug do chamador).
async function saiDeCena(engine, pr, outros, head, autoridade) {
  const texto = textoDoPulo(outros);
  if (!texto) return false;
  engine.skipComentado[pr.key] = { head: head || '', quem: outros, at: Date.now(), autoridade: !!autoridade };
  saveSkipComentado(engine);
  engine.emit('toast', { kind: 'info', text: `${texto} (${pr.key}: saí de cena sem postar nada público no GitHub)` });
  return true;
}

// Reviews postados por OUTRAS pessoas naquele head. null = não deu pra confirmar
// (rede, token), e nesse caso nada caduca e nada é co-assinado: falta de prova
// nunca vira ação, nos dois sentidos.
async function reviewsDeOutros(engine, pr, head) {
  const repo = pr.repo || (pr.key || '').split('#')[0];
  const number = pr.number || parseInt((pr.key || '').split('#')[1], 10);
  const acc = engine.accountForPr(pr);
  const me = (acc || '').toLowerCase();
  if (!repo || !number || !me || !engine.tokenFor(acc)) return null;
  const jq = `[.[] | select((.user.login | ascii_downcase) != "${me}") | {quem: .user.login, state, commit_id}]`;
  const r = await io.run('gh', ['api', `repos/${repo}/pulls/${number}/reviews`, '--jq', jq], { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  const raw = io.parseJson(r.stdout, null);
  if (!Array.isArray(raw)) return null;
  return raw
    .filter(x => !head || !x.commit_id || x.commit_id === head)
    .map(x => ({ quem: String(x.quem || ''), state: String(x.state || '') }));
}

// PURA: a saída de cena caducou? Sim quando a pessoa por quem eu saí não está
// mais com sinal nenhum (label legada ou ref) E não deixou review naquele head
// (a sessão dela morreu no meio). Sem a lista de reviews (rede fora), NUNCA
// caduca: na dúvida, fico fora, que é o lado seguro de "um Farol por PR".
function standDownCaducou(registro, aindaRevisando, reviews) {
  if (!registro || !Array.isArray(reviews)) return false;
  const quem = (registro.quem || []).map(u => String(u).toLowerCase());
  if (!quem.length) return false;
  const comLabel = new Set((aindaRevisando || []).map(u => String(u).toLowerCase()));
  const comReview = new Set(reviews.map(r => String(r.quem).toLowerCase()));
  return quem.every(u => !comLabel.has(u) && !comReview.has(u));
}

// Quem, entre as pessoas por quem eu saí de cena, APROVOU aquele head.
function quemAprovou(registro, reviews) {
  const quem = new Set(((registro || {}).quem || []).map(u => String(u).toLowerCase()));
  const achado = (reviews || []).find(r => r.state === 'APPROVED' && quem.has(String(r.quem).toLowerCase()));
  return achado ? achado.quem : '';
}

/* ---------- co-assinatura (opt-in) ---------- */

// Aprova em meu nome com base na aprovação de quem pegou o PR. NÃO abre sessão e
// NÃO gasta token. É um caminho de postagem novo e por isso carrega os próprios
// gates, explícitos aqui em vez de herdados: config ligada (conferida pelo
// chamador), aprovação comprovada no head atual, e dedup por head (não co-assino
// o que eu já assinei). `myReviewStates` null = não deu pra confirmar, e aí NÃO
// posta: postar review não é idempotente.
async function coAssinar(engine, pr, quem, head) {
  const jaMeus = await engine.myReviewStates(pr, head);
  if (jaMeus === null || jaMeus.includes('APPROVED')) return false;
  const post = await engine.postReview(pr, { event: 'APPROVE', body: textoDaCoassinatura(quem), comments: [] });
  if (!post.ok) {
    engine.log('WARN', `co-assinatura de ${pr.key} não saiu: ${post.error}`);
    return false;
  }
  engine.skipComentado[pr.key] = { ...(engine.skipComentado[pr.key] || {}), coAssinado: true, at: Date.now() };
  saveSkipComentado(engine);
  engine.emit('toast', { kind: 'ok', text: `✅ ${pr.key} aprovado junto com @${quem} (você não gastou revisão).` });
  return true;
}

/* ---------- orquestração por ciclo ---------- */

// PR que já tem saída de cena registrada NAQUELE head: decide entre caducar (volta
// a revisar), co-assinar (se ligado e a pessoa aprovou) ou seguir fora. Devolve
// true quando o PR deve continuar FORA da fila de revisão.
async function seguirForaDeCena(engine, pr, registro, head) {
  const reviews = await reviewsDeOutros(engine, pr, head);
  if (standDownCaducou(registro, outrosRevisando(engine, pr), reviews)) {
    delete engine.skipComentado[pr.key];
    saveSkipComentado(engine);
    engine.emit('toast', { kind: 'info', text: `${pr.key}: a revisão de quem tinha pegado não saiu, então assumi de volta.` });
    return false;
  }
  // NUNCA co-assino onde eu sou a autoridade: se a minha aprovação é a que
  // filtra o que sobe, ela precisa vir de revisão de verdade, não de endosso.
  // (E é inútil ali: quem cobriu a minha exigência já satisfez o gate.)
  if (!registro.coAssinado && !registro.autoridade && (engine.config || {}).coAssinarReview) {
    const aprovou = quemAprovou(registro, reviews || []);
    if (aprovou) await coAssinar(engine, pr, aprovou, head);
  }
  return true;
}

// Poda a âncora dos PRs que saíram do panorama, no mesmo compromisso do
// reReviewLaunched: busca parcialmente falha pode custar UM comentário repetido,
// nunca um comentário perdido.
function podarSkipComentado(engine, abertos) {
  let mudou = false;
  for (const key of Object.keys(engine.skipComentado || {})) {
    if (!abertos.has(key)) { delete engine.skipComentado[key]; mudou = true; }
  }
  if (mudou) saveSkipComentado(engine);
}

const skipMod = {
  SKIP_FILE, NAO_SAO_PESSOAS, revisandoPorOutros, revisandoPorSinais, outrosRevisando,
  textoDoPulo, textoDaCoassinatura, loadSkipComentado, saveSkipComentado,
  saiDeCena, podeSairDeCena, codeownersDoRepo, caminhosDoPr, reviewsDeOutros, standDownCaducou, quemAprovou, coAssinar,
  seguirForaDeCena, podarSkipComentado,
};
export default skipMod;
export {
  SKIP_FILE, NAO_SAO_PESSOAS, revisandoPorOutros, revisandoPorSinais, outrosRevisando,
  textoDoPulo, textoDaCoassinatura, loadSkipComentado, saveSkipComentado,
  saiDeCena, podeSairDeCena, codeownersDoRepo, caminhosDoPr, reviewsDeOutros, standDownCaducou, quemAprovou, coAssinar,
  seguirForaDeCena, podarSkipComentado,
};
