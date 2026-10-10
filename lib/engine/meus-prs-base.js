// O que a base fez com os meus PRs (10/10/2026): conflito e PR superado pela base.
//
// Até aqui "Meus PRs" só lia a mergeabilidade de PR com autoanálise aprovável (é o que o
// botão Merge precisa), e a autoanálise só roda por clique. PR meu em conflito, ou com todo
// o conteúdo já levado para a base por outro PR, ficava calado até alguém clicar ou outra
// pessoa avisar no review. Medido num caso real: 18 horas entre o merge que absorveu a
// promoção e a autoanálise clicada que achou isso, e 38 até o PR ser fechado.
//
// Custo, que é a razão do desenho (ver leitura-por-mudanca.js, 05/10/2026):
// - UMA consulta GraphQL por conta e por ciclo traz conflito, estado do merge, head e a
//   ponta da base de todos os meus PRs abertos;
// - a conferência de "superado" só roda quando muda a dupla (head, ponta da base), e com o
//   cache em memória de processo: reiniciar custa uma conferência por PR, não estado durável;
// - quando a base não andou desde o ancestral comum, o compare sozinho já responde.
// Zero tokens de IA. Falha de leitura preserva o que se sabia da conta, nunca apaga.
import io from '../io.js';
import limiteGh from './limite-gh.js';
import superado from './superado-pela-base.js';

const CONSULTA_DOS_MEUS = `query($q:String!){search(query:$q,type:ISSUE,first:50){nodes{... on PullRequest{
  number mergeable mergeStateStatus baseRefName baseRefOid headRefOid repository{nameWithOwner}}}}}`;
// lotes da leitura de arquivos na base (um alias GraphQL por arquivo)
const ARQUIVOS_POR_CONSULTA = 100;
// arquivos cujo conteúdo na base é lido por inteiro para a conferência por linha; acima
// disso a resposta é "não deu pra provar", não uma conta de chamadas sem teto
const TEXTOS_POR_PR = 5;

function estadoDosMeus(engine) {
  if (!engine.baseDosMeusPRs) engine.baseDosMeusPRs = {};
  if (!(engine.superadoPorPar instanceof Map)) engine.superadoPorPar = new Map();
  if (!(engine.avisosDaBase instanceof Set)) engine.avisosDaBase = new Set();
}

async function lerMeusNaBase(engine, user) {
  if (!user || !engine.tokenFor(user) || limiteGh.emEspera(engine, user)) return null;
  const r = await io.run('gh', ['api', 'graphql', '-f', 'q=is:pr is:open author:@me archived:false',
    '-f', `query=${CONSULTA_DOS_MEUS}`], { env: engine.ghEnv(user) });
  if (!r.ok) {
    if (await limiteGh.tratarFalhaDeBusca(engine, user, r.stderr)) return null;
    engine.log('WARN', `estado da base dos meus PRs (${user}) falhou: ${String(r.stderr || '').trim().slice(0, 300)}`);
    return null;
  }
  const j = io.parseJson(r.stdout || '{}', null);
  const nodes = j && j.data && j.data.search && j.data.search.nodes;
  if (!Array.isArray(nodes)) return null;
  const porChave = new Map();
  for (const n of nodes) {
    if (!n || !n.repository || !n.number) continue;
    porChave.set(`${n.repository.nameWithOwner}#${n.number}`, {
      mergeable: n.mergeable || 'UNKNOWN', status: n.mergeStateStatus || 'UNKNOWN',
      // a regra do conflito mora aqui; a tela lê o booleano e não a refaz
      conflito: n.mergeable === 'CONFLICTING' || n.mergeStateStatus === 'DIRTY',
      base: n.baseRefName || '', baseOid: n.baseRefOid || '', headOid: n.headRefOid || '',
    });
  }
  return porChave;
}

async function lerCompare(engine, repo, e, user) {
  const r = await io.run('gh', ['api', `repos/${repo}/compare/${e.baseOid}...${e.headOid}`, '--jq',
    '{atrasDaBase: .behind_by, arquivos: [.files[] | {filename, status, sha, previous_filename, patch}]}'],
  { env: engine.ghEnv(user) });
  return r.ok ? io.parseJson(r.stdout || '{}', null) : null;
}

// Lê na ponta da base o sha (e, se pedido, o texto) de cada caminho, por GraphQL com um
// alias por arquivo. Caminho que não existe na base fica fora do mapa.
async function lerNaBase(engine, repo, oid, caminhos, user, comTexto) {
  const [owner, name] = String(repo).split('/');
  const blobs = new Map(), textos = new Map();
  for (let i = 0; i < caminhos.length; i += ARQUIVOS_POR_CONSULTA) {
    const lote = caminhos.slice(i, i + ARQUIVOS_POR_CONSULTA);
    const campos = comTexto ? 'oid text isBinary isTruncated' : 'oid';
    const vars = lote.map((_, k) => `$e${k}:String!`).join(',');
    const aliases = lote.map((_, k) => `f${k}:object(expression:$e${k}){... on Blob{${campos}}}`).join(' ');
    const args = ['api', 'graphql', '-f', `query=query($o:String!,$n:String!,${vars}){repository(owner:$o,name:$n){${aliases}}}`,
      '-f', `o=${owner}`, '-f', `n=${name}`, ...lote.flatMap((c, k) => ['-f', `e${k}=${oid}:${c}`])];
    const r = await io.run('gh', args, { env: engine.ghEnv(user) });
    if (!r.ok) return null;
    const j = io.parseJson(r.stdout || '{}', null);
    const repoNo = j && j.data && j.data.repository;
    if (!repoNo) return null;
    lote.forEach((c, k) => {
      const b = repoNo[`f${k}`];
      if (!b || !b.oid) return;
      blobs.set(c, b.oid);
      if (comTexto && typeof b.text === 'string' && !b.isBinary && !b.isTruncated) textos.set(c, b.text);
    });
  }
  return { blobs, textos };
}

// A conferência de um PR, ou null quando a leitura falhou (o chamador tenta no próximo ciclo).
async function conferirSuperado(engine, repo, e, user) {
  const compare = await lerCompare(engine, repo, e, user);
  if (!compare) return null;
  const arquivos = compare.arquivos || [];
  if (!(Number(compare.atrasDaBase) > 0) || arquivos.length >= superado.LIMITE_ARQUIVOS_DO_COMPARE) {
    return superado.superadoPelaBase(compare, { blobs: new Map(), textos: new Map() });
  }
  const caminhos = [...new Set(arquivos.flatMap(f => [f.filename, f.previous_filename]).filter(Boolean))];
  const base = await lerNaBase(engine, repo, e.baseOid, caminhos, user, false);
  if (!base) return null;
  const paraLer = superado.arquivosParaLer(arquivos, base.blobs);
  if (paraLer.length && paraLer.length <= TEXTOS_POR_PR) {
    const lidos = await lerNaBase(engine, repo, e.baseOid, paraLer, user, true);
    if (!lidos) return null;
    base.textos = lidos.textos;
  }
  return superado.superadoPelaBase(compare, base);
}

// O que mudou de estado vira aviso UMA vez por PR e head: o toast dentro do app e a
// notificação do sistema (main.js). Reiniciar avisa de novo uma vez, e só do que continua
// valendo.
function avisar(engine, pr, info) {
  const sup = info.superado && info.superado.veredito === 'superado';
  if (!sup && !info.conflito) return;
  const estado = sup ? 'superado' : 'conflito';
  const chave = `${pr.key}|${estado}|${info.headOid}`;
  if (engine.avisosDaBase.has(chave)) return;
  engine.avisosDaBase.add(chave);
  const texto = sup
    ? `${pr.key}: tudo o que ele muda já está em ${info.base}. Não sobrou nada para entregar, dá para fechar sem merge.`
    : `${pr.key}: em conflito com ${info.base}. Atualize a branch antes do merge.`;
  engine.emit('toast', { kind: 'info', text: texto });
  engine.emit('meu-pr-base', { pr: { key: pr.key, url: pr.url }, estado, texto });
}

// O estado de um PR neste ciclo, com a conferência de "superado" reaproveitada enquanto a
// dupla (head, ponta da base) não muda.
async function infoDoPr(engine, pr, e, user) {
  const info = { ...e, at: Date.now() };
  const par = `${e.headOid}|${e.baseOid}`;
  const guardado = engine.superadoPorPar.get(pr.key);
  if (guardado && guardado.par === par) return { ...info, superado: guardado.resultado };
  if (!e.headOid || !e.baseOid) return info;
  const resultado = await conferirSuperado(engine, pr.repo || pr.key.split('#')[0], e, user);
  if (!resultado) return info;
  engine.superadoPorPar.set(pr.key, { par, resultado });
  return { ...info, superado: resultado };
}

async function refreshBaseDosMeusPRs(engine) {
  estadoDosMeus(engine);
  const meus = engine.myPRs || [];
  const contas = [...new Set(meus.map(p => engine.accountForPr(p)).filter(Boolean))];
  const antes = engine.baseDosMeusPRs;
  const next = {};
  for (const user of contas) {
    const daConta = meus.filter(p => engine.accountForPr(p) === user);
    const estados = await lerMeusNaBase(engine, user);
    if (!estados) {
      for (const p of daConta) if (antes[p.key]) next[p.key] = antes[p.key];
      continue;
    }
    for (const pr of daConta) {
      const e = estados.get(pr.key);
      if (!e) continue;
      next[pr.key] = await infoDoPr(engine, pr, e, user);
      avisar(engine, pr, next[pr.key]);
    }
  }
  for (const k of engine.superadoPorPar.keys()) if (!meus.some(p => p.key === k)) engine.superadoPorPar.delete(k);
  engine.baseDosMeusPRs = next;
}

const meusPrsBase = { refreshBaseDosMeusPRs };
export default meusPrsBase;
export { refreshBaseDosMeusPRs };
