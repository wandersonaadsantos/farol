// Contas do GitHub: o que o `gh` desta máquina tem logado, o que o Farol monitora, e a
// diferença entre os dois (v2.62.0). Medido em 18/09/2026 no Farol do mantenedor: uma conta
// monitorada sem login no `gh` gerava duas linhas de log por ciclo (167 no dia), um login do
// `gh` ficava invisível ao Farol, uma org estava em duas contas sem aviso, e a org onde a
// conta é só colaboradora não aparece em `user/orgs`.
//
// O diagnóstico é PURO (`diagnosticoDasContas`); as leituras de rede têm cache próprio, porque
// `gh auth status` valida cada token na API e roda dentro do ciclo de polling.
import io from '../io.js';
import limiteGh from './limite-gh.js';
import { semAsVariaveis } from '../env.js';
import { TEMPOS } from '../constants.js';

const HOST = 'github.com';

function objeto(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function minusculo(v) {
  return String(v || '').toLowerCase();
}

// `gh auth status --json hosts`: lista TODAS as contas logadas, sem token no texto. Saída que
// não tem a forma esperada é null ("não sei"), nunca lista vazia ("nenhuma conta").
function contasDoAuthStatus(stdout) {
  const dados = io.parseJson(String(stdout || ''), null);
  if (!objeto(dados) || !objeto(dados.hosts) || !Array.isArray(dados.hosts[HOST])) return null;
  return dados.hosts[HOST]
    .filter((h) => objeto(h) && typeof h.login === 'string' && h.login)
    .map((h) => ({ login: h.login, ativa: h.active === true, ok: h.state === 'success' }));
}

// Leitura que falha preserva a anterior: "não deu para ler agora" não é "não existe mais".
function anterior(atual, campo) {
  return atual ? atual[campo] : null;
}

function linhasDe(r) {
  if (!r || !r.ok) return null;
  return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// O `gh` escolheria a conta pelo GH_TOKEN herdado; aqui a pergunta é o chaveiro inteiro.
function ambienteSemToken() {
  return { ...semAsVariaveis(['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN']), GH_PAGER: 'cat' };
}

async function lerLoginsDoGh(engine, { agora = Date.now() } = {}) {
  const atual = objeto(engine.contasGh) ? engine.contasGh : null;
  if (atual && agora - atual.lidoEm < TEMPOS.CONTAS_GH_MS) return atual;
  const r = await io.run('gh', ['auth', 'status', '--json', 'hosts'], { env: ambienteSemToken() });
  // `gh auth status` sai com 1 quando ALGUMA conta está inválida, e o JSON vem assim mesmo
  const logins = contasDoAuthStatus(r && r.stdout);
  engine.contasGh = { lidoEm: agora, logins: logins || anterior(atual, 'logins') };
  return engine.contasGh;
}

// Orgs de que a conta é MEMBRO. Colaborador externo não aparece aqui, e por isso as orgs dos
// PRs pedidos a ela entram como segunda fonte no diagnóstico.
async function lerOrgsDaConta(engine, user, { agora = Date.now() } = {}) {
  if (!(engine.orgsDasContas instanceof Map)) engine.orgsDasContas = new Map();
  const chave = minusculo(user);
  const atual = engine.orgsDasContas.get(chave);
  if (atual && agora - atual.lidoEm < TEMPOS.ORGS_DA_CONTA_MS) return atual.orgs;
  if (!engine.tokenFor(user)) return anterior(atual, 'orgs');
  const r = await io.run('gh', ['api', 'user/orgs', '--paginate', '--jq', '.[].login'], { env: engine.ghEnv(user) });
  engine.orgsDasContas.set(chave, { lidoEm: agora, orgs: linhasDe(r) || anterior(atual, 'orgs') });
  return engine.orgsDasContas.get(chave).orgs;
}

// Uma leitura por ciclo no máximo, e só a cada TEMPOS.*: falha de rede aqui não pode travar
// nem atrasar a busca de PRs, então nada lança.
async function atualizarContasGh(engine, { agora = Date.now() } = {}) {
  try {
    await lerLoginsDoGh(engine, { agora });
    for (const conta of engine.accountList()) {
      if (conta.user && !conta.muted) await lerOrgsDaConta(engine, conta.user, { agora });
    }
  } catch { /* diagnóstico é auxiliar: o ciclo segue sem ele */ }
}

function orgsConhecidas(orgsPorConta, user) {
  const lista = orgsPorConta && orgsPorConta[minusculo(user)];
  return Array.isArray(lista) ? lista : [];
}

// Quem é dono de cada owner, entre as contas ativas (silenciada não conta: ela não age).
function donosPorOwner(contas) {
  const mapa = new Map();
  for (const c of contas) {
    if (c.muted) continue;
    for (const o of c.owners || []) {
      const k = minusculo(o);
      if (!mapa.has(k)) mapa.set(k, { owner: o, contas: [] });
      mapa.get(k).contas.push(c.user);
    }
  }
  return mapa;
}

function sugestoesDaConta(conta, { orgs, pedidos, donos }) {
  const saida = new Map();
  const acrescentar = (owner, origem) => {
    const k = minusculo(owner);
    if (!k || donos.has(k)) return;
    if (!saida.has(k)) saida.set(k, { conta: conta.user, owner, origens: [] });
    if (!saida.get(k).origens.includes(origem)) saida.get(k).origens.push(origem);
  };
  for (const o of orgs) acrescentar(o, 'membro');
  for (const o of pedidos) acrescentar(o, 'pedido');
  return [...saida.values()];
}

// PURO. `logins` null = não deu para ler o `gh`, e aí nada é afirmado sobre login.
// `pedidosPorConta` = owners dos PRs em que a conta foi pedida como revisora (a busca de
// review-requested não filtra por org, então ela acha a org onde a conta é colaboradora).
function diagnosticoDasContas({ contas = [], logins = null, orgsPorConta = {}, pedidosPorConta = {} } = {}) {
  const lidas = Array.isArray(logins);
  const monitoradas = new Set(contas.map((c) => minusculo(c.user)));
  const logados = new Set((logins || []).filter((l) => l.ok).map((l) => minusculo(l.login)));
  const donos = donosPorOwner(contas);
  const sugestoes = contas.filter((c) => !c.muted).flatMap((c) => sugestoesDaConta(c, {
    orgs: orgsConhecidas(orgsPorConta, c.user),
    pedidos: orgsConhecidas(pedidosPorConta, c.user),
    donos,
  }));
  return {
    lidas,
    naoMonitoradas: (logins || []).filter((l) => l.ok && !monitoradas.has(minusculo(l.login))).map((l) => l.login),
    // sem leitura do gh não se afirma nada sobre login: a lista vazia aqui é "não sei"
    semLogin: contas.filter((c) => lidas && !logados.has(minusculo(c.user))).map((c) => c.user),
    orgsDuplicadas: [...donos.values()].filter((d) => d.contas.length > 1),
    sugestoes,
  };
}

// "Sem token no gh" é estado, não evento: uma linha quando a conta perde o token, nenhuma
// enquanto continua sem, e a próxima só depois de o token voltar e sumir de novo.
function avisarSemToken(engine, user, texto) {
  if (!(engine.semTokenAvisado instanceof Set)) engine.semTokenAvisado = new Set();
  const chave = minusculo(user) || '(primaria)';
  if (engine.semTokenAvisado.has(chave)) return false;
  engine.semTokenAvisado.add(chave);
  engine.log('WARN', texto);
  return true;
}

function tokenVoltou(engine, user) {
  if (engine.semTokenAvisado instanceof Set) engine.semTokenAvisado.delete(minusculo(user) || '(primaria)');
}

// Por que um PR ficou com a conta que ficou. `reserva` é o caso em que, com duas ou mais
// contas, nenhuma cobre a org e o PR não veio marcado por busca nenhuma: agir ali seria agir
// com a identidade da primária por falta de opção, e a postagem recusa
// (lib/engine/decision.js). Com uma conta só é `unica`, e segue como sempre foi.
function atribuicaoDoPr(engine, pr) {
  if (pr && pr.account) return { conta: pr.account, por: 'busca' };
  const repo = (pr && (pr.repo || String(pr.key || '').split('#')[0])) || '';
  const owner = minusculo(repo.split('/')[0]);
  const dona = engine.accountList().find((a) => (a.owners || []).some((o) => minusculo(o) === owner));
  if (dona) return { conta: dona.user, por: 'org' };
  // com uma conta só, a primária é a única identidade que existe: não há conta errada
  const por = engine.accountList().length > 1 ? 'reserva' : 'unica';
  return { conta: engine.primaryUser(), por };
}

// A conta como a TELA a ve. Mora aqui, e nao no snapshot do server.js, porque e sobre
// conta: o que ela monitora, se tem token, se esta silenciada e ate quando as buscas
// dela estao paradas pelo limite do GitHub (0 = livre).
function projecaoDasContas(engine) {
  return engine.accountList().map((a, i) => ({
    user: a.user, owners: a.owners, tokenOk: !!(engine.tokens && engine.tokens[a.user]),
    limiteGhAte: limiteGh.limiteAte(engine, a.user),
    label: a.label, color: a.color, kind: a.kind, muted: !!a.muted, primary: i === 0,
    autoReview: a.autoReview, onClean: a.onClean, onCaveats: a.onCaveats, onReject: a.onReject,
    claudeProfileId: a.claudeProfileId, budgetWeight: a.budgetWeight
  }));
}

function diagnosticoDoEngine(engine) {
  const logins = objeto(engine.contasGh) ? engine.contasGh.logins : null;
  const orgsPorConta = {};
  if (engine.orgsDasContas instanceof Map) {
    for (const [k, v] of engine.orgsDasContas) if (v && Array.isArray(v.orgs)) orgsPorConta[k] = v.orgs;
  }
  const pedidosPorConta = objeto(engine.ownersPedidosPorConta) ? engine.ownersPedidosPorConta : {};
  return diagnosticoDasContas({ contas: engine.accountList(), logins, orgsPorConta, pedidosPorConta });
}

// Owners dos PRs pedidos a cada conta neste ciclo, para o diagnóstico sugerir a org.
function registrarPedidos(engine, prs) {
  const mapa = {};
  for (const pr of prs || []) {
    const conta = minusculo(pr && pr.account);
    const owner = String((pr && pr.repo) || '').split('/')[0];
    if (!conta || !owner) continue;
    if (!mapa[conta]) mapa[conta] = [];
    if (!mapa[conta].some((o) => minusculo(o) === minusculo(owner))) mapa[conta].push(owner);
  }
  engine.ownersPedidosPorConta = mapa;
}

export default {
  contasDoAuthStatus, lerLoginsDoGh, lerOrgsDaConta, atualizarContasGh, diagnosticoDasContas,
  avisarSemToken, tokenVoltou, atribuicaoDoPr, projecaoDasContas, diagnosticoDoEngine, registrarPedidos,
};
export {
  contasDoAuthStatus, lerLoginsDoGh, lerOrgsDaConta, atualizarContasGh, diagnosticoDasContas,
  avisarSemToken, tokenVoltou, atribuicaoDoPr, projecaoDasContas, diagnosticoDoEngine, registrarPedidos,
};
