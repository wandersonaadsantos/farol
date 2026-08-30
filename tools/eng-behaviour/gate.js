// Gate do eng-behaviour, a constituição de engenharia que o Farol assina.
//
// Ele roda no pre-push e NÃO no CI. O porquê tem um endereço só, em
// `docs/QUALITY.md`, seção "A constituição vem do eng-behaviour"; repetir o
// argumento aqui obrigaria a achar os dois para mudar um comportamento só.
//
// FALHA FECHADO. Sem a CLI resolvida, o gate reprova em vez de pular. Gate que
// se cala quando não sabe é pior que gate nenhum: ele passa a atestar o que não
// verificou.
//
// Exit codes: 0 limpo, 1 achado no repositório, 2 o gate não conseguiu rodar.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { executadoDireto } from '../../lib/paths.js';
import { readJson } from '../../lib/io.js';

const RAIZ = path.join(import.meta.dirname, '..', '..');

/**
 * Raiz do repositório PRINCIPAL, mesmo quando este arquivo roda de uma worktree.
 *
 * Em worktree, `import.meta.dirname` aponta para a cópia, e o irmão da cópia não
 * é o irmão do repositório: uma worktree em `.worktrees/x` procuraria o pacote em
 * `.worktrees/eng-behaviour`, que não existe, e o gate reprovaria dando uma
 * instrução que não resolve o problema. O `.git` compartilhado é o único endereço
 * que a worktree e o principal enxergam igual, e `--git-common-dir` é o que o
 * git responde para ele nos dois casos.
 *
 * Isto não é configuração: é derivação do próprio git, sem chave para ninguém
 * preencher. Falhando a chamada, cai na raiz de onde o arquivo está, que é o
 * comportamento anterior e continua correto fora de worktree.
 */
function raizPrincipal(base = RAIZ) {
  const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: base,
    encoding: 'utf8',
  });
  const saida = (r.stdout || '').trim();
  if (r.status !== 0 || !saida) return base;
  return path.dirname(saida);
}

/** O clone do pacote ao lado do clone principal do Farol. */
function irmaoDoRepositorio() {
  return path.join(raizPrincipal(), '..', 'eng-behaviour');
}

function ajudaPara(home) {
  return [
    'Como resolver:',
    `  1. clone https://github.com/wandersonaadsantos/eng-behaviour em ${home};`,
    '  2. dentro dele: pnpm install && pnpm build.',
  ].join('\n');
}

/**
 * Caminho da CLI construída, ou um motivo por que ela não serve.
 *
 * Devolve o motivo em vez de lançar porque as duas falhas possíveis pedem
 * mensagens diferentes: pacote ausente é problema de checkout, pacote presente
 * sem `dist/` é problema de build, e mandar rodar o build num diretório que não
 * existe manda a pessoa para o lugar errado.
 */
function resolverCli(home = irmaoDoRepositorio()) {
  if (!fs.existsSync(home)) {
    return { erro: `eng-behaviour nao encontrado em ${home}.` };
  }
  const cli = path.join(home, 'dist', 'cli', 'main.js');
  if (!fs.existsSync(cli)) {
    return { erro: `eng-behaviour encontrado em ${home}, mas sem build: ${cli} nao existe.` };
  }
  return { cli, home };
}

/**
 * Versão que o pacote declara, para a saída dizer contra o que o gate mediu.
 *
 * A versão é transparência, não gate: `package.json` ilegível deixa de ser
 * afirmada em vez de travar o Farol, porque trocar uma informação perdida por um
 * bloqueio é pior. A leitura passa pelo `readJson`, que é o endereço único de
 * JSON cru aqui.
 */
function versaoDo(home) {
  const pkg = readJson(path.join(home, 'package.json'), null);
  return pkg?.version || 'desconhecida';
}

function rodar(cli, args) {
  const r = spawnSync(process.execPath, [cli, ...args], { cwd: RAIZ, encoding: 'utf8' });
  if (r.error) return { code: 2, saida: r.error.message };
  return { code: r.status ?? 2, saida: `${r.stdout || ''}${r.stderr || ''}`.trimEnd() };
}

function main() {
  const esperado = irmaoDoRepositorio();
  const { cli, home, erro } = resolverCli(esperado);
  if (erro) {
    console.error(`eng-behaviour: ${erro}`);
    console.error(ajudaPara(esperado));
    return 2;
  }
  console.log(`eng-behaviour ${versaoDo(home)} (${home})`);

  // Ordem importa: o `check` prova que o recorte versionado é o que o catalogo
  // gera hoje. Rodar o audit antes mediria o codigo contra um catalogo que o
  // repositorio talvez nem conheca ainda.
  const drift = rodar(cli, ['check', '--repo', '.']);
  console.log(drift.saida);
  if (drift.code !== 0) {
    console.error('eng-behaviour: o recorte versionado divergiu do catalogo.');
    console.error('Regenere com: node <eng-behaviour>/dist/cli/main.js excerpt --repo . > eng-behaviour.rules.md');
    return drift.code;
  }

  const audit = rodar(cli, ['audit', '--repo', '.', '--assessments', 'avaliacoes.jsonl']);
  console.log(audit.saida);
  if (audit.code !== 0) {
    console.error('eng-behaviour: o gate reprovou.');
    console.error('Regra de julgamento sem avaliacao para o head atual? Cada uma precisa da PROPRIA');
    console.error('fundamentacao sobre ESTE diff. Repetir a mesma frase nas oito passa no gate sem');
    console.error('avaliar nada, e ai o registro deixa de significar o que ele existe para significar.');
    return audit.code;
  }
  return 0;
}

if (executadoDireto(import.meta.url)) process.exit(main());
export default { resolverCli, versaoDo, raizPrincipal, irmaoDoRepositorio };
export { resolverCli, versaoDo, raizPrincipal, irmaoDoRepositorio };
