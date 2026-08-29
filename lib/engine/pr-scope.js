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
// regex. Fora da raiz, a propria raiz e entrada vazia devolvem null.
function prPathFromRead(root, filePath) {
  if (!root || !filePath) return null;
  let rel;
  try { rel = path.relative(path.resolve(String(root)), path.resolve(String(filePath))); }
  catch { return null; }
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

// caminho do PR que tenta escapar da raiz (`../`, absoluto) e DESCARTADO: nunca
// escrito e nunca contado no total. Um caminho desses so aparece por resposta
// adulterada ou bug, e escrever fora da raiz seria escrita arbitraria no disco.
function dentroDaRaiz(root, prPath) {
  const alvo = path.resolve(root, prPath);
  const rel = path.relative(path.resolve(root), alvo);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// Escreve um arquivo por caminho do PR sob `root` e devolve o TOTAL (denominador da
// cobertura). Limpa a raiz antes: sobra de um head anterior contaria como cobertura
// de um conteudo que a sessao desta rodada nunca viu.
//
// Arquivo SEM patch (binario, renomeacao pura, diff grande demais pra API) continua
// no total, com um marcador no lugar do patch. Tira-lo do total daria cobertura de
// graca justamente no arquivo que ninguem consegue ler.
function materializeScope(root, files) {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best-effort */ }
  const total = [];
  for (const f of (files || [])) {
    const prPath = String((f && f.path) || '').trim();
    if (!prPath || !dentroDaRaiz(root, prPath)) continue;
    const destino = path.resolve(root, prPath);
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    const corpo = String((f && f.patch) || '');
    const status = String((f && f.status) || '');
    fs.writeFileSync(destino, corpo || `(sem patch textual: arquivo ${status || 'alterado'} sem diff legível pela API)\n`, 'utf8');
    total.push(prPath);
  }
  return { root, total };
}

// Le o patch POR ARQUIVO do PR. Endpoint `pulls/{n}/files` porque e o unico que
// devolve o patch de cada arquivo; o `gh pr view --json files` nao traz.
async function fetchPrPatches(engine, pr) {
  if (!pr || !pr.repo || !pr.number) return null;
  const acc = engine.accountForPr(pr);
  if (!engine.tokenFor(acc)) return null;
  const r = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/files`, '--paginate',
    '--jq', '[.[] | {path: .filename, status: (.status // ""), patch: (.patch // "")}]'],
    { env: engine.ghEnv(acc) });
  if (!r.ok) return null;
  const j = parseJson(r.stdout || '[]', null);
  if (!Array.isArray(j) || !j.length) return null;
  return j.filter(f => f && f.path);
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

const prScopeMod = { scopesDir, scopeRootFor, prPathFromRead, materializeScope, fetchPrPatches, pruneScopes };
export default prScopeMod;
export { scopesDir, scopeRootFor, prPathFromRead, materializeScope, fetchPrPatches, pruneScopes };
