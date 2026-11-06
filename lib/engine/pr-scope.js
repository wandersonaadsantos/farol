// Escopo materializado do PR: a peca que torna a COBERTURA observavel pelo engine.
//
// Por que existe (achado do preflight do P0b, 29/08/2026): o protocolo de review le
// um `.patch` UNICO (`gh pr diff <NN> --patch > pr<NN>.patch` e um `Read` nele), entao
// nunca existe um `Read` por arquivo do PR. Observar "Read · caminho" nao cobriria
// nada, e inferir cobertura de string de comando seria heuristica frouxa justamente
// no dado que autoriza merge. Em vez disso o engine ESCREVE o patch de cada arquivo
// num diretorio que ele controla e a sessao le dali: `Read` por arquivo passa a ser o
// mecanismo real, e mapear caminho-lido -> caminho-do-PR vira aritmetica de path.
//
// LIMITE HONESTO, que esta fase NAO resolve: `Read` observado prova que o conteudo
// foi ENTREGUE ao agente, nunca que ele raciocinou bem sobre aquilo. O que isto
// elimina e a classe "o modelo afirmou ter coberto o que o engine nunca observou".
// A classe "abriu e raciocinou mal" continua viva e nao tem solucao por instrumento.
import fs from 'node:fs';
import path from 'node:path';
import io from '../io.js';
import { parseJson } from '../io.js';
import { TEMPOS } from '../constants.js';
import { STATE_DIR } from '../paths.js';
import { PASTA_REDIGIDA, caminhoProtegido, patchParaASessao, nomeMaterializado, caminhoDoPr } from '../review-source/caminho-protegido.js';

const SCOPES_DIR = path.join(STATE_DIR, 'pr-scope');

function scopesDir() { return SCOPES_DIR; }

// mesma convencao do checkpoint: encodeURIComponent, nunca troca de `/`#` por `__`
// (a troca colide, `a__b/c` e `a/b__c` dariam o mesmo diretorio)
function scopeRootFor(key, base = SCOPES_DIR) {
  return path.join(base, encodeURIComponent(String(key || '')));
}

// PURA. Caminho absoluto lido pela sessao -> caminho do PR, ou null quando a leitura
// nao pertence ao escopo. Resolve os dois lados e usa path.relative, entao separador
// do Windows, separador POSIX e caminho relativo equivalente convergem sozinhos, sem
// regex. Fora da raiz, a propria raiz e entrada vazia devolvem null. A projeção do caminho
// protegido mora na pasta redigida (caminho-protegido.js): a leitura dela vira o caminho do PR,
// e o caminho protegido lido no lugar comum, onde nada foi escrito, não vira nada.
function prPathFromRead(root, filePath) {
  if (!root || !filePath) return null;
  let rel;
  try { rel = path.relative(path.resolve(String(root)), path.resolve(String(filePath))); }
  catch { return null; }
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return caminhoDoPr(rel.split(path.sep).join('/'));
}

// O arquivo no disco que corresponde a um caminho do PR dentro da raiz do escopo.
function arquivoMaterializado(root, prPath) {
  return path.join(root, ...nomeMaterializado(prPath).split('/'));
}

// caminho do PR que tenta escapar da raiz (`../`, absoluto) e DESCARTADO: nunca
// escrito e nunca contado no total. Um caminho desses so aparece por resposta
// adulterada ou bug, e escrever fora da raiz seria escrita arbitraria no disco.
function dentroDaRaiz(root, prPath) {
  const alvo = path.resolve(root, prPath);
  const rel = path.relative(path.resolve(root), alvo);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Pasta com config do autor do PR, onde o git rodado ali executaria core.fsmonitor. Pega as formas
// que o sistema de arquivos dobra para .git: caixa, invisível, ponto ou espaço no fim, stream do NTFS
// e nome curto do Windows. O GitHub costuma recusar essa árvore, mas a garantia não fica com ele.
function temComponenteDeGit(prPath) {
  return prPath.split(/[\\/]/).some((parte) => {
    const nome = parte.split(':')[0].replace(/\p{Cf}/gu, '').replace(/[. ]+$/, '').toLowerCase();
    return nome === '.git' || nome === 'git~1';
  });
}

// Escreve um arquivo por caminho do PR sob `root` e devolve o TOTAL (denominador da
// cobertura). Limpa a raiz antes: sobra de um head anterior contaria como cobertura
// de um conteudo que a sessao desta rodada nunca viu.
//
// Arquivo SEM patch (binario, renomeacao pura, diff grande demais pra API) continua
// no total, com um marcador no lugar do patch. Tira-lo do total daria cobertura de
// graca justamente no arquivo que ninguem consegue ler.
//
// Caminho PROTEGIDO (`.env*` e companhia) vai para a pasta redigida com o nome que a regra
// `deny: Read(.env.*)` das settings do usuário não casa (nomeMaterializado); o conteúdo é a
// projeção que a fonte já entregou, nunca o patch cru. `redigidos` diz ao prompt onde cada um
// está. Caminho do PR que colide com a pasta redigida não é escrito (fica no total).
function materializeScope(root, files) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  const total = [];
  const redigidos = {};
  // os metadados do diff que a prova de leitura precisa: o rename vindo de caminho protegido
  const arquivos = [];
  const vistos = new Set();
  for (const f of (files || [])) {
    const prPath = String((f && f.path) || '').trim();
    if (!prPath || vistos.has(prPath) || !dentroDaRaiz(root, prPath)) continue;
    vistos.add(prPath);
    // O caminho vem da API do GitHub e o STATE_DIR pode estar sob o temp do SO
    // (FAROL_HOME aponta pra onde mandarem), entao a escrita e feita com permissao
    // restrita e criacao EXCLUSIVA: `wx` falha em vez de seguir um symlink plantado
    // no lugar do destino. Alerta js/insecure-temporary-file do CodeQL, PR #41.
    const relativo = nomeMaterializado(prPath);
    const destino = path.resolve(root, relativo);
    const corpo = String((f && f.patch) || '');
    const status = String((f && f.status) || '');
    if (relativo !== prPath) redigidos[prPath] = relativo;
    try {
      if (temComponenteDeGit(prPath)) throw new Error('caminho de controle do git');
      if (prPath.split('/')[0] === PASTA_REDIGIDA) throw new Error('caminho colide com a pasta redigida');
      fs.mkdirSync(path.dirname(destino), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destino, corpo || `(sem patch textual: arquivo ${status || 'alterado'} sem diff legível pela API)\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    } catch { /* falhou de escrever: o push abaixo mantem o arquivo no DENOMINADOR */ }
    // Entra no total mesmo se a escrita falhou, e a direcao importa: sem o arquivo
    // no disco a sessao nunca consegue abri-lo, entao ele fica em `missing` pra
    // sempre e a cobertura nao fecha. Tira-lo do total encolheria o denominador e
    // um arquivo que ninguem leu viraria cobertura completa.
    total.push(prPath);
    arquivos.push({ path: prPath, previousPath: (f && (f.previousPath || f.previous_filename)) || null });
  }
  return { root, total, redigidos, arquivos };
}

// materializa e carimba o DENOMINADOR no registro da sessão ativa: é o que deixa a barra
// do cartão dizer "12 de 20 arquivos lidos" (progressoDaSessao, ui/pure/sessao.js)
function materializarNaSessao(rec, root, files) {
  const escopo = materializeScope(root, files);
  if (rec && escopo) rec.totalArquivos = escopo.total.length;
  return escopo;
}

// Le o patch POR ARQUIVO do PR. Endpoint `pulls/{n}/files` porque e o unico que
// devolve o patch de cada arquivo; o `gh pr view --json files` nao traz.
async function fetchPrPatches(engine, pr) {
  if (!pr || !pr.repo || !pr.number) return null;
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/files`, '--paginate', '--slurp'],
    { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  return parsePatchPages(parseJson(r.stdout, null));
}

function parsePatchPages(pages) {
  if (!Array.isArray(pages)) return null;
  const files = pages.some(Array.isArray) ? pages.flat() : pages;
  if (files.some(f => !f || typeof (f.path ?? f.filename) !== 'string' || !(f.path ?? f.filename))) return null;
  const result = files.map((f) => {
    const caminho = f.path ?? f.filename, previousPath = f.previous_filename || f.previousPath || null;
    // a mesma política da fonte preparada (caminho-protegido.js): protegido e segredo nunca vão crus
    const patch = patchParaASessao(caminho, previousPath, f.patch);
    return { path: caminho, status: f.status || '', patch, previousPath, patchStatus: patch ? 'available' : 'unavailable' };
  });
  if (new Set(result.map(f => f.path)).size !== result.length) return null;
  return result;
}

// Caminho protegido: a sessão lê a projeção redigida no nome que o engine escolheu e declara o
// caminho do PR. O conteúdo cru desse caminho é proibido por qualquer outra via.
function blocoDosRedigidos(redigidos) {
  const entradas = Object.entries(redigidos || {});
  if (!entradas.length) return '';
  return '\n\nCaminho PROTEGIDO (arquivo de ambiente, credencial): o Farol gravou só uma projeção redigida, com outro nome, '
    + 'porque o nome original é recusado pela política de leitura. Leia a projeção com Read no caminho abaixo e declare o caminho do PR em coverage.reviewed. '
    + 'É PROIBIDO buscar o conteúdo cru desse caminho por qualquer outra via (gh pr diff, gh api pulls/N/files, compare, commits, contents, tarball, clone): '
    + 'o app só credita a leitura observada da projeção, e caminho protegido sem essa leitura fica sem cobertura.\n'
    + entradas.map(([pr, rel]) => `- \`${pr}\` -> leia \`${rel}\` (sob a raiz acima)`).join('\n');
}

function scopeBlock(scope, config = {}) {
  if (!scope || !Array.isArray(scope.total)) return '\n\n## Escopo do PR\nO Farol NAO conseguiu medir os arquivos deste PR. Sem escopo medido, a analise nao consegue comprovar cobertura.\n';
  return '\n\n## Escopo do PR (medido pelo Farol)\n'
    + `Sao ${scope.total.length} arquivo(s). O Farol JA gravou o patch de cada um em \`${scope.root}\`, preservando o caminho do repositorio.\n`
    + scope.total.map(p => `- \`${p}\``).join('\n')
    + blocoDosRedigidos(scope.redigidos)
    + (config.reviewBatchedReads === true
      ? '\nCada responsável lê seu arquivo/lote com uma chamada Read por arquivo, no caminho acima. Não use gh pr diff para substituir essa leitura. '
      : '\nCada responsável lê seu arquivo/lote com Read, um por vez, no caminho acima. Não use gh pr diff para substituir essa leitura. ')
    + 'Leituras observadas de subagentes também contam; o coordenador consolida referências e releituras justificadas. '
    + 'Arquivo sem leitura observada conta como NAO analisado. Cache não comprova compreensão. '
    + 'Patch ausente, binário ou avaliação insuficiente devem constar em coverageLimitations, que só subtrai cobertura.\n';
}

// poda por idade, best-effort e por entrada (padrao G20 do pruneFileProofs): lixo
// que nao sai hoje sai amanha, e falhar a analise por diretorio travado seria pior
function pruneScopes(base = SCOPES_DIR, maxAgeMs = TEMPOS.ESCOPO_PR_MAX_AGE_MS, agora = Date.now()) {
  let entradas;
  try { entradas = fs.readdirSync(base, { withFileTypes: true }); } catch { return 0; }
  let removidos = 0;
  for (const e of entradas) {
    const alvo = path.join(base, e.name);
    try {
      if (agora - fs.statSync(alvo).mtimeMs <= maxAgeMs) continue;
      fs.rmSync(alvo, { recursive: true, force: true });
      removidos++;
    } catch { /* best-effort */ }
  }
  return removidos;
}

const prScopeMod = { scopesDir, scopeRootFor, prPathFromRead, arquivoMaterializado, materializeScope, materializarNaSessao, fetchPrPatches, pruneScopes };
export default prScopeMod;
export { scopesDir, scopeRootFor, prPathFromRead, arquivoMaterializado, materializeScope, materializarNaSessao, fetchPrPatches, parsePatchPages, scopeBlock, blocoDosRedigidos, pruneScopes };
