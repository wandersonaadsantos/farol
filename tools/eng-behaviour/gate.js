// Gate do eng-behaviour, a constituição de engenharia que o Farol assina.
//
// POR QUE NÃO ESTÁ NO `npm run lint`, e portanto não está no CI: duas razões
// independentes, e cada uma sozinha já bastaria.
//
//  1. O CI roda SEM `npm install` de propósito (invariante 1: zero dependências
//     além do Electron). O eng-behaviour é um pacote à parte, com dependências
//     próprias, e não é publicado em registro nenhum. Trazê-lo para dentro do CI
//     exigiria ou quebrar a invariante 1, ou dar ao runner acesso a um segundo
//     repositório privado. Nenhuma das duas é decisão deste arquivo.
//  2. O `audit` lê o registro de avaliação das regras de julgamento, e esse
//     registro vive FORA do controle de versão por decisão do próprio pacote
//     (`avaliacoes.jsonl` no .gitignore; ver o comentário lá). O runner não tem
//     como enxergá-lo. Rodar o audit no CI reprovaria toda rodada por evidência
//     ausente, que é falha de arranjo e não do código.
//
// Então ele mora no pre-push, que é onde o Farol já põe o gate que o CI não
// alcança. Como o pre-push também proíbe push direto na main, todo caminho até
// a main atravessa este gate.
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
import { engBehaviourHome } from '../../lib/env.js';

const RAIZ = path.join(import.meta.dirname, '..', '..');

// Arranjo mais comum: o clone do pacote ao lado do clone do Farol. Quem tiver
// outro layout aponta ENG_BEHAVIOUR_HOME; a leitura da variavel mora em
// lib/env.js, que e o endereco unico de process.env aqui.
const IRMAO = path.join(RAIZ, '..', 'eng-behaviour');

const AJUDA = [
  'Como resolver:',
  `  1. clone ${'https://github.com/wandersonaadsantos/eng-behaviour'} ao lado do farol,`,
  '     ou aponte a variavel ENG_BEHAVIOUR_HOME para o clone;',
  '  2. dentro dele: pnpm install && pnpm build.',
].join('\n');

/**
 * Caminho da CLI construída, ou um motivo por que ela não serve.
 *
 * Devolve o motivo em vez de lançar porque as duas falhas possíveis pedem
 * mensagens diferentes: pacote ausente é problema de checkout, pacote presente
 * sem `dist/` é problema de build, e mandar rodar o build num diretório que não
 * existe manda a pessoa para o lugar errado.
 */
function resolverCli(home = engBehaviourHome() || IRMAO) {
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
  const { cli, home, erro } = resolverCli();
  if (erro) {
    console.error(`eng-behaviour: ${erro}`);
    console.error(AJUDA);
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
export default { resolverCli, versaoDo };
export { resolverCli, versaoDo };
