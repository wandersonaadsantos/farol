// A leitura da faixa de prontidão (07/11/2026): checks obrigatórios, reviewers e merge de
// cada PR do Radar, em `estado().prontidao[key]`, que vai ao snapshot. Zero tokens de IA e
// nada escrito no GitHub. A interpretação é PURA e mora em prontidao-pr-estado.js.
//
// Custo, que é a razão do desenho:
// - Meus PRs: ZERO chamada nova. A consulta GraphQL que a base dos meus PRs já faz por conta
//   e por ciclo (meus-prs-base.js) traz o fragmento da prontidão, e o nó fica em
//   `engine.nosDosMeusPRs` (memória de processo, fora do snapshot);
// - Panorama e Pra mim: uma consulta GraphQL por conta com até 15 PRs por alias, só para o PR
//   que precisa (nunca lido, mudou o updatedAt, ainda espera o GitHub, ou registro com mais
//   de 10 min). No ciclo calmo, quase nada sai;
// - regra da branch: uma leitura de `rules/branches/{base}` por repo@base, em cache de 30 min,
//   que também alimenta o cache dos checks exigidos do gate (checks-exigidos.js).
// Falha de leitura preserva o último registro do PR e não derruba o ciclo.
import io from '../io.js';
import { TEMPOS } from '../constants.js';
import limiteGh from './limite-gh.js';
import estado from './prontidao-pr-estado.js';

// Medido em 07/11/2026 contra o GitHub: perto de 0,3 s por PR com este fragmento, e 34 PRs
// numa consulta só passaram de 10 s e voltaram 502. Lotes de 15 ficam na casa de 5 s.
const PRS_POR_CONSULTA = 15;

function contaDoRepo(engine, repo, conta) {
  if (conta) return conta;
  return typeof engine.accountForOwner === 'function' ? engine.accountForOwner(String(repo).split('/')[0]) : '';
}

// A regra da branch de destino, com cache por repo@base. Falha também entra no cache, por
// menos tempo, para um repo sem acesso não custar uma chamada por ciclo, e PRESERVA a regra
// que já se sabia: uma leitura que falhou depois do cache vencer não pode apagar a exigência
// de todos os PRs daquele repo@base. Conta em pausa por limite do GitHub não lê (a tentativa
// consome cota e prolonga a pausa, lib/engine/limite-gh.js). null = não legível.
async function regraDaBranch(engine, repo, base, conta) {
  if (!repo || !base) return null;
  if (!(engine.regraDaBranchCache instanceof Map)) engine.regraDaBranchCache = new Map();
  const chave = `${repo}@${base}`;
  const c = engine.regraDaBranchCache.get(chave);
  const validade = c && !c.falhou ? TEMPOS.CHECKS_EXIGIDOS_TTL_MS : TEMPOS.REGRA_DA_BRANCH_FALHA_MS;
  if (c && (Date.now() - c.at) < validade) return c.regra;
  const anterior = (c && c.regra) || null;
  const acc = contaDoRepo(engine, repo, conta);
  if (!acc || !engine.tokenFor(acc) || limiteGh.emEspera(engine, acc)) return anterior;
  const r = await io.run('gh', ['api', `repos/${repo}/rules/branches/${base}`, '--jq', '[.[]|{type, parameters}]'], { env: engine.ghEnv(acc) });
  const regra = r.ok ? estado.regraDaResposta(io.parseJson(r.stdout, null)) : null;
  const at = Date.now();
  if (!regra) {
    engine.regraDaBranchCache.set(chave, { regra: anterior, at, falhou: true });
    return anterior;
  }
  engine.regraDaBranchCache.set(chave, { regra, at });
  // a mesma leitura responde à pergunta do gate de checks: uma chamada para os dois
  if (regra) {
    if (!(engine.checksExigidosCache instanceof Map)) engine.checksExigidosCache = new Map();
    engine.checksExigidosCache.set(chave, { lista: regra.checks, at });
  }
  return regra;
}

async function registrar(engine, no, eu, conta) {
  const repo = (no.repository && no.repository.nameWithOwner) || '';
  const regra = await regraDaBranch(engine, repo, no.baseRefName, conta);
  return estado.interpretarProntidao(no, { exigidos: regra ? regra.checks : null, regra, eu, at: Date.now() });
}

function precisaLer(reg, pr, agora) {
  if (!reg || estado.emTransicao(reg)) return true;
  if (pr.updatedAt && reg.updatedAt !== pr.updatedAt) return true;
  return (agora - Number(reg.at || 0)) > TEMPOS.PRONTIDAO_PR_TTL_MS;
}

function consultaDoLote(lote) {
  const vars = [], aliases = [], args = [];
  lote.forEach((pr, k) => {
    const [owner, name] = String(pr.repo || '').split('/');
    vars.push(`$o${k}:String!,$n${k}:String!,$k${k}:Int!`);
    aliases.push(`p${k}:repository(owner:$o${k},name:$n${k}){pullRequest(number:$k${k}){...Prontidao}}`);
    args.push('-f', `o${k}=${owner}`, '-f', `n${k}=${name}`, '-F', `k${k}=${Number(pr.number)}`);
  });
  return ['api', 'graphql', '-f', `query=query(${vars.join(',')}){${aliases.join(' ')}} ${estado.FRAGMENTO_PRONTIDAO}`, ...args];
}

// Um lote de até 15 PRs da mesma conta numa chamada. O gh sai com erro quando um dos aliases
// falha (repo sem acesso) e mesmo assim entrega o `data` dos outros: o que veio é usado.
async function lerLote(engine, user, lote, lidos) {
  const r = await io.run('gh', consultaDoLote(lote), { env: engine.ghEnv(user) });
  const j = io.parseJson(r.stdout || '', null);
  const data = j && j.data;
  if (!data) {
    if (await limiteGh.tratarFalhaDeBusca(engine, user, r.stderr)) return;
    engine.log('WARN', `prontidão dos PRs do Radar (${user}) falhou: ${String(r.stderr || '').trim().slice(0, 300)}`);
    return;
  }
  lote.forEach((pr, k) => {
    const no = data[`p${k}`] && data[`p${k}`].pullRequest;
    if (no) lidos.set(pr.key, no);
  });
}

async function lerEmLote(engine, prs) {
  const lidos = new Map();
  const porConta = new Map();
  for (const pr of prs) {
    const user = engine.accountForPr(pr);
    if (!user || !engine.tokenFor(user) || limiteGh.emEspera(engine, user) || !pr.repo || !pr.number) continue;
    if (!porConta.has(user)) porConta.set(user, []);
    porConta.get(user).push(pr);
  }
  for (const [user, lista] of porConta) {
    for (let i = 0; i < lista.length; i += PRS_POR_CONSULTA) await lerLote(engine, user, lista.slice(i, i + PRS_POR_CONSULTA), lidos);
  }
  return lidos;
}

// Meus PRs: o nó chega pela busca da base. Só reinterpreta o que a busca trouxe DEPOIS do
// registro; PR sem nó novo (conta que falhou, busca que voltou sem o fragmento) segue para a
// leitura em lote, que só relê o que precisa.
async function prontidaoDosMeus(engine, next) {
  const nos = engine.nosDosMeusPRs instanceof Map ? engine.nosDosMeusPRs : new Map();
  for (const pr of engine.myPRs || []) {
    const antes = engine.prontidao[pr.key];
    const lido = nos.get(pr.key);
    if (!lido || (antes && Number(lido.at) <= Number(antes.at))) continue;
    const conta = engine.accountForPr(pr);
    next[pr.key] = await registrar(engine, lido.no, conta, conta);
  }
}

async function prontidaoDoRadar(engine, next) {
  const agora = Date.now();
  const vistos = new Set();
  const alvos = [...(engine.myPRs || []), ...(engine.panorama || [])]
    .filter(pr => pr && pr.key && !next[pr.key] && !vistos.has(pr.key) && vistos.add(pr.key));
  const lidos = await lerEmLote(engine, alvos.filter(pr => precisaLer(engine.prontidao[pr.key], pr, agora)));
  for (const pr of alvos) {
    const no = lidos.get(pr.key);
    if (no) next[pr.key] = await registrar(engine, no, engine.accountForPr(pr));
    else if (engine.prontidao[pr.key]) next[pr.key] = engine.prontidao[pr.key];
  }
}

// O ciclo: chamado pelo check() depois da base dos meus PRs. PR que saiu do Radar sai daqui.
async function refreshProntidao(engine) {
  if (!engine.prontidao || typeof engine.prontidao !== 'object') engine.prontidao = {};
  const next = {};
  await prontidaoDosMeus(engine, next);
  await prontidaoDoRadar(engine, next);
  engine.prontidao = next;
}

const prontidaoPr = { refreshProntidao, regraDaBranch, precisaLer, consultaDoLote };
export default prontidaoPr;
export { refreshProntidao, regraDaBranch, precisaLer, consultaDoLote };
