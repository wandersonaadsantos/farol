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

   CAPÍTULO DE 28/08/2026 (duas decisões do Wanderson no MESMO dia):
   - De manhã (incidente do biud-frontend#845), a label pública
     `<conta>:revisando` foi tratada como vazamento e a v2.53.9 a trocou por
     refs git invisíveis, matando junto o COMENTÁRIO público de pulo (template
     fixo, a mesma frase saindo de contas diferentes minutos depois do sinal
     alheio subir, denunciava a ferramenta).
   - À tarde ele corrigiu o rumo: a label visível é DESEJADA ("deixa os demais
     membros cientes da revisão") e voltou a ser o sinal ESCRITO (lib/engine/
     review.js). O que continua proibido é TEXTO público não-humanizado: o
     comentário de pulo segue morto, a saída de cena segue SILENCIOSA no GitHub
     (a âncora nasce da DECISÃO e o aviso é um toast no app), e o firewall de
     linguagem dos reviews fica como está.
   O sinal de "revisando agora" segue com DUAS fontes na transição: a label
   `<login>:revisando` (o sinal de sempre, que chega de graça no campo labels do
   gh search prs) e a ref git de lib/engine/review-signal.js (escrita só pelas
   cópias que rodaram a v2.53.9 por algumas horas; hoje aquele módulo é leitura
   de transição). `outrosRevisando` é a UNIÃO das duas.

   Na MESMA tarde nasceu o gate de CONSCIÊNCIA do review automático (a regra do
   Wanderson: "se alguém já aprovou, se alguém tá revisando e se alguém já
   reprovou que não seja o acrity, não fazemos review a menos que haja ação
   manual"): ver bloqueadoPorHistorico/bloqueiaAutomatico no fim deste arquivo. */
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import { TEMPOS } from '../constants.js';
import io, { writeJsonAtomic } from '../io.js';
import { parseCodeowners, souAutoridade } from './codeowners.js';
import { sinalVivo } from './review-signal.js';

const SKIP_FILE = path.join(STATE_DIR, 'skip-comentado.json');
const SUFIXO = ':revisando';

// Contas que carregam label no formato de pessoa mas NÃO são pessoas: review de
// ferramenta não dispensa olho humano, então ver a label dela não pode calar o Farol.
const NAO_SAO_PESSOAS = new Set(['acrity']);

// Quantas aprovações humanas no head ativo seguram o review automático. É o
// "(máximo 2)" da regra do Wanderson (28/08/2026): o fluxo do time usa até 2
// aprovações por PR, então com UMA a revisão automática ainda vale como a
// segunda; com DUAS ela não acrescenta e o PR espera ação manual. Reprovação
// não tem teto: a primeira já segura (ver bloqueadoPorHistorico).
const APROVACOES_QUE_SEGURAM = 2;

/* ---------- leitura dos sinais (PURA) ---------- */

// Quem MAIS está revisando agora SEGUNDO AS LABELS, tirando a minha conta e as
// ferramentas. Desde a tarde de 28/08/2026 a label voltou a ser o sinal ESCRITO
// por esta versão (lib/engine/review.js), então esta é a fonte principal. Ordem
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

// Quem está revisando SEGUNDO AS REFS de review-signal.js (sinal de transição
// da v2.53.9, que ninguém mais escreve; sai quando a frota convergir). PURA:
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
   Desde 28/08/2026 o CODEOWNERS serve a UMA pergunta só: sou autoridade nos
   arquivos deste PR? A resposta gateia a co-assinatura ("nunca co-assino onde
   sou autoridade"). A cobertura de exigência (cobreMinhaExigencia, v2.51.0) caiu
   junto com a regra plana da saída de cena; ver autoridadeNaSaida abaixo e o
   cabeçalho de lib/engine/codeowners.js. */

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

/* Autoridade na saída de cena. A saída virou regra PLANA em 28/08/2026 (decisão
   do Wanderson, à tarde): ver alguém revisando SEMPRE segura o automático, e
   caiu a exceção da v2.51.0 (que mandava revisar por cima quando quem pegou o
   PR não cobria a minha exigência de CODEOWNERS, via cobreMinhaExigencia, que
   saiu junto de lib/engine/codeowners.js). O PR espera ação manual, e o botão
   Revisar continua valendo. O CODEOWNERS segue consultado por UMA razão: o
   guarda "NUNCA co-assino onde sou autoridade" PERMANECE, então a saída de cena
   precisa saber se eu sou autoridade nos arquivos do PR. Falta de dado
   (CODEOWNERS ilegível, diff não medido) cai no lado seguro TRUE: co-assinar
   sem saber se sou autoridade é pior que não co-assinar. Repo sem CODEOWNERS é
   conclusivo e aí autoridade é false. */
async function autoridadeNaSaida(engine, pr) {
  const regras = await codeownersDoRepo(engine, pr);
  if (regras === null) return true; // ilegível: não co-assinar é o lado seguro
  if (!regras.length) return false; // repo sem dono de código, conclusivo
  const caminhos = await caminhosDoPr(engine, pr);
  if (!caminhos) return true; // diff não medido: mesmo lado seguro do ilegível
  return souAutoridade(regras, caminhos, engine.accountForPr(pr));
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

/* ---------- gate de consciência do review automático (28/08/2026 à tarde) ----------
   A regra do Wanderson: "se alguém já aprovou, se alguém tá revisando e se
   alguém já reprovou que não seja o acrity, não fazemos review a menos que haja
   ação manual. Se ninguém está revisando e não temos histórico de review no
   head ativo então devemos seguir na revisão automatizada, claro se for essa a
   configuração aplicada." A metade do "tá revisando" já mora acima
   (outrosRevisando/saiDeCena); daqui pra baixo é a metade do HISTÓRICO. */

// O head ATIVO do PR já tem histórico que segura o automático? Decisivo é
// APPROVED ou CHANGES_REQUESTED; DISMISSED e COMMENTED não contam, e as contas
// de NAO_SAO_PESSOAS (ferramenta) também não (comparação sem caixa). Cada pessoa
// conta pelo ÚLTIMO estado decisivo dela no head. Segura: reprovação de gente
// (a primeira já basta) ou APROVACOES_QUE_SEGURAM aprovações humanas (com menos
// que isso a revisão automática ainda vale como a aprovação que falta). Head
// novo zera o histórico por construção: reviewsDeOutros filtra por
// commit_id === head.
// Custo: no MÁXIMO 2 chamadas gh (headSha + a lista de reviews), e ela SÓ roda
// na boca do lançamento automático (bloqueiaAutomatico), nunca por ciclo em todo
// PR do panorama. Falta de dado NUNCA bloqueia (rede, sem token, head
// desconhecido devolvem o caminho livre): o pior caso de deixar passar é uma
// revisão redundante, nunca um post errado (o gate de postagem e o dedup por
// head continuam na frente de qualquer escrita).
async function bloqueadoPorHistorico(engine, pr) {
  let head = '';
  try { head = String((await engine.headSha(pr)) || '').trim(); }
  catch { head = ''; }
  if (!head) return { bloqueado: false, head: '', quem: [], decisivos: [] };
  const reviews = await reviewsDeOutros(engine, pr, head);
  if (!Array.isArray(reviews)) return { bloqueado: false, head, quem: [], decisivos: [] };
  // reduz ao ÚLTIMO estado decisivo POR PESSOA (a lista vem em ordem de
  // submissão, então a entrada mais nova vence): quem pediu mudanças e depois
  // aprovou o mesmo head conta como aprovação, nunca como as duas coisas.
  const porPessoa = new Map(); // chave minúscula -> { quem: primeira grafia, state: último decisivo }
  for (const r of reviews) {
    if (r.state !== 'APPROVED' && r.state !== 'CHANGES_REQUESTED') continue;
    const login = String(r.quem || '').trim();
    if (!login || NAO_SAO_PESSOAS.has(login.toLowerCase())) continue;
    const chave = login.toLowerCase();
    const atual = porPessoa.get(chave);
    porPessoa.set(chave, { quem: atual ? atual.quem : login, state: r.state });
  }
  const finais = [...porPessoa.values()];
  const reprovadores = finais.filter(p => p.state === 'CHANGES_REQUESTED');
  const aprovadores = finais.filter(p => p.state === 'APPROVED');
  // Calibração do Wanderson ("se alguém já aprovou (máximo 2)", 28/08/2026):
  // reprovação de gente segura na PRIMEIRA; aprovação só segura quando o head
  // já tem as DUAS que o fluxo do time usa como teto, porque com uma só a
  // revisão automática ainda é útil como a segunda aprovação.
  let responsaveis = [];
  if (reprovadores.length) responsaveis = reprovadores;
  else if (aprovadores.length >= APROVACOES_QUE_SEGURAM) responsaveis = aprovadores;
  return {
    bloqueado: responsaveis.length > 0,
    head,
    quem: responsaveis.map(p => p.quem).sort((a, b) => a.localeCompare(b)),
    // os estados viajam junto pro toast acertar a concordância (aprovou x
    // pediu mudanças); quem consome a decisão usa só `bloqueado`
    decisivos: responsaveis.map(p => ({ quem: p.quem, state: p.state })),
  };
}

// Texto do toast do bloqueio por histórico. PURA, mesma régua de redação do
// textoDoPulo: português, sem travessão, sem pronome de gênero.
function textoDoBloqueio(key, hist) {
  const nomes = ((hist && hist.quem) || []).map(u => `@${u}`);
  if (!nomes.length) return '';
  let lista = nomes[0];
  if (nomes.length > 1) lista = `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
  const estados = new Set(((hist && hist.decisivos) || []).map(d => d.state));
  const um = nomes.length === 1;
  let verbo;
  if (estados.size === 1 && estados.has('APPROVED')) {
    verbo = um ? 'já aprovou este head' : 'já aprovaram este head';
  } else if (estados.size === 1 && estados.has('CHANGES_REQUESTED')) {
    verbo = um ? 'já pediu mudanças neste head' : 'já pediram mudanças neste head';
  } else {
    verbo = um ? 'já revisou este head' : 'já revisaram este head';
  }
  return `${key}: ${lista} ${verbo}, então deixei a revisão automática aguardando você (o botão Revisar continua valendo).`;
}

// Aviso ÚNICO por PR+head (Set em memória, engine.historicoAvisado): o mesmo PR
// pode voltar à boca do lançamento em ciclos seguintes, e o que a pessoa precisa
// saber cabe num toast só. Head novo zera o aviso do PR (a chave carrega o head,
// e as chaves velhas do mesmo PR são apagadas na entrada).
function avisaBloqueioHistorico(engine, pr, hist) {
  if (!(engine.historicoAvisado instanceof Set)) engine.historicoAvisado = new Set();
  const chave = `${pr.key}@${hist.head}`;
  if (engine.historicoAvisado.has(chave)) return;
  for (const k of [...engine.historicoAvisado]) {
    if (k.slice(0, k.lastIndexOf('@')) === pr.key) engine.historicoAvisado.delete(k);
  }
  engine.historicoAvisado.add(chave);
  const texto = textoDoBloqueio(pr.key, hist);
  if (texto) engine.emit('toast', { kind: 'info', text: texto });
}

// A boca ÚNICA do gate: consulta o histórico SÓ no caminho automático (clique
// manual atravessa sem nenhuma chamada gh) e, quando bloqueia, avisa uma vez por
// PR+head. Devolve true = não enfileire (o PR espera ação manual, sem sumir da
// tela); false = siga. Os três caminhos automáticos aguardam esta função antes
// do enqueueHeadless: launchReview e launchReReviews (lib/engine/review.js) e o
// retry pós-transitório (server.js, _dispararAutomacoes).
async function bloqueiaAutomatico(engine, pr) {
  if (!pr || pr.manual) return false;
  const hist = await engine.bloqueadoPorHistorico(pr);
  if (!hist || !hist.bloqueado) return false;
  avisaBloqueioHistorico(engine, pr, hist);
  return true;
}

// Poda da memória de aviso: some junto com o PR (mesma fonte do
// podarSkipComentado). É memória em processo, e podar errado custa no máximo UM
// toast repetido, nunca sessão nem postagem.
function podarHistoricoAvisado(engine, abertos) {
  if (!(engine.historicoAvisado instanceof Set)) return;
  for (const chave of [...engine.historicoAvisado]) {
    if (!abertos.has(chave.slice(0, chave.lastIndexOf('@')))) engine.historicoAvisado.delete(chave);
  }
}

const skipMod = {
  SKIP_FILE, NAO_SAO_PESSOAS, revisandoPorOutros, revisandoPorSinais, outrosRevisando,
  textoDoPulo, textoDaCoassinatura, loadSkipComentado, saveSkipComentado,
  saiDeCena, autoridadeNaSaida, codeownersDoRepo, caminhosDoPr, reviewsDeOutros, standDownCaducou, quemAprovou, coAssinar,
  seguirForaDeCena, podarSkipComentado,
  bloqueadoPorHistorico, textoDoBloqueio, avisaBloqueioHistorico, bloqueiaAutomatico, podarHistoricoAvisado,
};
export default skipMod;
export {
  SKIP_FILE, NAO_SAO_PESSOAS, revisandoPorOutros, revisandoPorSinais, outrosRevisando,
  textoDoPulo, textoDaCoassinatura, loadSkipComentado, saveSkipComentado,
  saiDeCena, autoridadeNaSaida, codeownersDoRepo, caminhosDoPr, reviewsDeOutros, standDownCaducou, quemAprovou, coAssinar,
  seguirForaDeCena, podarSkipComentado,
  bloqueadoPorHistorico, textoDoBloqueio, avisaBloqueioHistorico, bloqueiaAutomatico, podarHistoricoAvisado,
};
