// O escopo materializado da revisão no terminal (06/11/2026): o botão "Revisar no terminal"
// abre `claude "/pr-review <urls>"` numa sessão conduzida pela pessoa, e essa sessão recebe as
// mesmas guardas da revisão headless (`--settings` em session.js), que recusam `gh pr diff` e
// `pulls/N/files`. Sem patch gravado, ela ficaria sem o diff e sem as linhas que o comentário
// inline precisa. Então o engine grava aqui, ANTES de abrir a janela, o patch de cada arquivo
// pela mesma régua da headless (pr-scope.js: protegido só como projeção redigida, no nome que o
// `deny: Read(.env.*)` do usuário não casa) e diz à sessão onde está: `escopo=<raiz>` logo
// depois da URL do PR.
//
// A raiz vai RELATIVA ao workspace (o cwd da sessão de terminal, e o `state/` mora dentro
// dele) e com nome sem `%`: o caminho atravessa um `.cmd` do Windows, onde `%2F` seria lido
// como parâmetro do script, e um caminho absoluto com espaço quebraria a leitura do argumento.
// Falha ao ler os patches não impede a sessão: a URL vai sem `escopo=` e o pr-reviewer segue o
// caminho "sem raiz de escopo" do protocolo, que nunca lê o conteúdo cru do protegido.
import path from 'node:path';
import scopeMod from './pr-scope.js';
import { WORKSPACE } from '../paths.js';

async function escopoDoPr(engine, pr, chave) {
  let arquivos = null;
  try { arquivos = await scopeMod.fetchPrPatches(engine, pr); } catch { arquivos = null; }
  if (!Array.isArray(arquivos) || !arquivos.length) return null;
  const root = scopeMod.scopeRootFor(chave);
  scopeMod.materializeScope(root, arquivos);
  return path.relative(WORKSPACE, root).split(path.sep).join('/');
}

// O texto do slash: cada URL seguida do `escopo=` do próprio PR, quando o patch foi gravado.
async function slashDoTerminal(engine, prs, agora = Date.now()) {
  const partes = [];
  for (const [i, pr] of (prs || []).entries()) {
    partes.push(pr.url);
    const rel = await escopoDoPr(engine, pr, `terminal-${agora}-${i}`);
    if (rel) partes.push(`escopo=${rel}`);
  }
  return `/pr-review ${partes.join(' ')}`;
}

// Abre a janela: o escopo gravado antes, o slash com `escopo=` e o aviso na tela. A sessão no
// terminal usa 1 token; pega a conta do 1o PR (lotes costumam ser da mesma conta), e a mistura
// de contas num mesmo terminal recai na 1a.
//
// Ler os patches é assíncrono, e a exclusão local (revisao-em-curso.js) só enxerga a sessão depois
// do spawn. Durante a preparação as chaves ficam em `headlessIniciando`, a mesma janela anterior ao
// spawn que a fila headless usa: um segundo pedido do mesmo PR é recusado como duplicado.
async function abrirRevisaoNoTerminal(engine, liberados) {
  const keys = liberados.map(p => p.key);
  const label = keys.length === 1 ? `Revisão de ${keys[0]}` : `Revisão de ${keys.length} PRs`;
  const reservados = engine.headlessIniciando ||= new Set();
  for (const k of keys) reservados.add(k);
  try {
    engine.spawnConsole(await slashDoTerminal(engine, liberados), label, keys, engine.accountForPr(liberados[0]));
  } finally {
    for (const k of keys) reservados.delete(k);
  }
  engine.emit('toast', { kind: 'ok', text: `${label} aberta no terminal do Claude.` });
}

export { slashDoTerminal, abrirRevisaoNoTerminal };
