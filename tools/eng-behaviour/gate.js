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
import { parseJson } from '../../lib/io.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { engBehaviourHome } from '../../lib/env.js';

const RAIZ = path.join(import.meta.dirname, '..', '..');

/**
 * Até quando vale a pena esperar o git responder antes de desistir dele.
 *
 * O conceito é a fronteira de uma decisão, e não o número: passado esse tempo, o
 * gate para de perguntar ao git e assume a raiz de onde o arquivo está. Uma
 * consulta local responde em dezenas de milissegundos, então o teto é folgado de
 * propósito; ele existe para o caso patológico, não para o caso comum.
 */
const TETO_DE_ESPERA_DO_GIT_MS = 5000;

/** Como cada entrada de `git worktree list --porcelain` comeca. */
const PREFIXO_WORKTREE = 'worktree ';

/** Assinatura deste projeto no package.json da raiz que o git apontar. */
const NOME_DO_PACOTE = 'farol';

/**
 * Ate quando esperar cada subcomando da CLI antes de desistir.
 *
 * Mesma fronteira do teto do git, aplicada onde o risco de fato mora: a CLI varre
 * o repositorio e abre processos de git por conta propria, sem teto nenhum. Mais
 * folgado porque aqui o trabalho e real, e nao uma consulta.
 */
const TETO_DA_CLI_MS = 120_000;

/** Teto de saida capturada, para achado nenhum ser descartado por estouro. */
const TETO_DE_SAIDA_BYTES = 32 * 1024 * 1024;

/**
 * Raiz do repositório PRINCIPAL, mesmo quando este arquivo roda de uma worktree.
 *
 * Em worktree, `import.meta.dirname` aponta para a cópia, e o irmão da cópia não
 * é o irmão do repositório: uma worktree em `.worktrees/x` procuraria o pacote em
 * `.worktrees/eng-behaviour`, que não existe, e o gate reprovaria dando uma
 * instrução que não resolve o problema.
 *
 * A pergunta é "onde fica a árvore de trabalho principal", e quem responde ISSO é
 * a primeira entrada de `git worktree list`. Derivar a resposta do
 * `--git-common-dir` responde outra pergunta, "onde fica o diretório git
 * compartilhado": as duas só coincidem quando o gitdir é `<raiz>/.git`, e a
 * diferença aparece em submódulo, onde ele devolve `<super>/.git/modules`, e em
 * clone com `--separate-git-dir`, onde devolve o pai do checkout. Nos dois casos o
 * gate procuraria o pacote num caminho que não é raiz de nada, com o mesmo
 * sintoma que ele existe para corrigir.
 *
 * Isto não é configuração: é derivação do próprio git, sem chave para preencher.
 */
function raizPrincipal(base = RAIZ) {
  // Teto de tempo porque isto roda dentro do pre-push: um git que trave por
  // qualquer motivo, rede, filesystem, credential helper esperando entrada,
  // travaria o push para sempre em vez de reprovar. Estourando o teto, `status`
  // vem nulo e a funcao cai no mesmo fallback da falha comum.
  //
  // Ambiente sem o repositorio herdado (ver tools/git-env.js). Este gate roda
  // DENTRO do pre-push, que exporta GIT_DIR: sem a limpeza, as duas perguntas
  // abaixo respondem pelo repositorio do hook em vez de pelo `base` que o
  // chamador escolheu, e a resolucao inteira sai errada sem nenhum erro.
  const env = envSemRepositorioHerdado();
  const git = (args) => spawnSync('git', args, {
    cwd: base,
    env,
    encoding: 'utf8',
    timeout: TETO_DE_ESPERA_DO_GIT_MS,
  });

  // `git` procura um repositório também nos diretórios-pai. Antes de perguntar
  // pela worktree principal, prova que `base` é a raiz do checkout consultado;
  // uma cópia extraída dentro de outro repositório deve continuar respondendo
  // por si mesma, e não pelo repositório que a contém.
  const atual = git(['rev-parse', '--show-toplevel']);
  const topoAtual = (atual.stdout || '').trim();
  if (atual.status !== 0 || !path.isAbsolute(topoAtual) || !mesmoDiretorio(topoAtual, base)) return base;

  const r = git(['worktree', 'list', '--porcelain']);
  const primeira = (r.stdout || '').split('\n', 1)[0] || '';
  if (r.status !== 0 || !primeira.startsWith(PREFIXO_WORKTREE)) return base;
  const raiz = primeira.slice(PREFIXO_WORKTREE.length).trim();
  // Caminho relativo aqui é sinal de que o git respondeu outra coisa: versão antiga
  // ecoa flag que não conhece e ainda sai 0, e aí `raiz` viraria algo resolvido
  // contra o cwd de quem chamou. Exigir absoluto é o que impede a guarda de status
  // de ser burlada por uma saída que só se parece com resposta.
  if (!path.isAbsolute(raiz)) return base;
  return ehEsteCheckout(raiz) ? raiz : base;
}

/**
 * Se a raiz que o git devolveu é mesmo o checkout DESTE projeto.
 *
 * Sem esta conferência, uma cópia do Farol que não seja repositório git mas esteja
 * DENTRO de um repositório qualquer faria o git responder pelo repositório de
 * fora, e o gate procuraria o pacote ao lado do repositório errado. Nesse caso a
 * chamada não falha, ela responde outra coisa, então o fallback de erro não pega.
 *
 * A assinatura é o nome no `package.json`, e não a presença de um arquivo deste
 * projeto: arquivo depende do commit que estiver na árvore principal, e o gate
 * passaria a depender de qual branch está lá.
 */
function ehEsteCheckout(raiz) {
  return leituraSemRastro(path.join(raiz, 'package.json'))?.name === NOME_DO_PACOTE;
}

/** Compara caminhos canonicos sem tropeçar em caixa ou nome curto no Windows. */
function mesmoDiretorio(a, b) {
  const canonico = (valor) => {
    let resolvido;
    try { resolvido = fs.realpathSync.native(valor); } catch { resolvido = path.resolve(valor); }
    return process.platform === 'win32' ? resolvido.toLowerCase() : resolvido;
  };
  return canonico(a) === canonico(b);
}

/**
 * A versão do pacote que o Farol ADOTA, com o commit que a identifica.
 *
 * O clone ao lado é de quem desenvolve o eng-behaviour, e o que está nele pode ser
 * trabalho em andamento (medido em 16/09/2026: 0.13.0 sem commit, com o `dist/`
 * reconstruído a partir dele). O gate do Farol não pode medir contra "o que estiver
 * lá": ele mede contra a versão que o baseline e o recorte versionados assumem, e
 * recusa qualquer outra.
 */
const CAMINHO_DA_FERRAMENTA = 'tools/eng-behaviour/ferramenta.json';

/** O que a construção grava em `dist/`, para o build ficar amarrado ao commit. */
const CARIMBO_DO_BUILD = path.join('dist', '.farol-construido-de');

const COMMIT_COMPLETO = /^[0-9a-f]{40}$/;

function ferramentaAdotada(raiz = RAIZ) {
  return leituraSemRastro(path.join(raiz, CAMINHO_DA_FERRAMENTA));
}

/**
 * Onde procurar a CLI, em ordem.
 *
 * `FAROL_ENG_BEHAVIOUR_HOME` explícito vale sozinho: quem aponta um caminho quer
 * aquele, e cair em outro calado seria medir contra o que ninguém escolheu. Sem
 * ele, a cópia fixada ao lado (`eng-behaviour@<versão>`, montada por
 * `preparar-copia.js`) vem antes do clone de desenvolvimento. Os dois passam pela
 * mesma conferência de identidade.
 */
function candidatosDeHome({ explicito = engBehaviourHome(), principal = raizPrincipal(), ferramenta = ferramentaAdotada() } = {}) {
  if (explicito) return [path.resolve(explicito)];
  const lista = [];
  if (ferramenta && ferramenta.versao) lista.push(path.join(principal, '..', `eng-behaviour@${ferramenta.versao}`));
  lista.push(path.join(principal, '..', 'eng-behaviour'));
  return lista;
}

function escolherHome(candidatos) {
  return candidatos.find((c) => fs.existsSync(c)) || candidatos[candidatos.length - 1];
}

function gitEm(home, args) {
  const r = spawnSync('git', args, {
    cwd: home,
    env: envSemRepositorioHerdado(),
    encoding: 'utf8',
    timeout: TETO_DE_ESPERA_DO_GIT_MS,
  });
  return { ok: r.status === 0, saida: (r.stdout || '').trim() };
}

function lerCarimbo(home) {
  try { return fs.readFileSync(path.join(home, CARIMBO_DO_BUILD), 'utf8').trim(); } catch { return ''; }
}

/**
 * A CLI encontrada é mesmo a versão adotada, construída do commit adotado?
 *
 * Quatro provas, todas obrigatórias, e cada falha diz qual foi: a versão do
 * `package.json`; o HEAD do checkout (que precisa ser a raiz do próprio
 * repositório, para um repositório de fora não responder por ele); a árvore sem
 * alteração em arquivo versionado; e o carimbo que a construção deixa em `dist/`,
 * porque `dist/` não é versionado e um build velho passaria pelas outras três.
 */
function conferirIdentidade(home, ferramenta) {
  if (!ferramenta || !ferramenta.versao || !COMMIT_COMPLETO.test(String(ferramenta.commit || ''))) {
    return { erro: `${CAMINHO_DA_FERRAMENTA} ausente, ou sem versao e commit completo: sem isso nao ha contra o que conferir a CLI.` };
  }
  const versao = versaoDo(home);
  if (versao !== ferramenta.versao) {
    return { erro: `eng-behaviour em ${home} declara a versao ${versao}, e o Farol adota a ${ferramenta.versao} (${CAMINHO_DA_FERRAMENTA}).` };
  }
  const topo = gitEm(home, ['rev-parse', '--show-toplevel']);
  if (!topo.ok || !mesmoDiretorio(topo.saida, home)) {
    return { erro: `eng-behaviour em ${home} nao e um checkout git proprio: o commit nao tem como ser conferido.` };
  }
  const head = gitEm(home, ['rev-parse', 'HEAD']);
  if (!head.ok || head.saida !== ferramenta.commit) {
    return { erro: `eng-behaviour em ${home} esta no commit ${head.saida || 'desconhecido'}, e o Farol adota o ${ferramenta.commit}.` };
  }
  const status = gitEm(home, ['status', '--porcelain', '--untracked-files=no']);
  if (!status.ok || status.saida) {
    return { erro: `eng-behaviour em ${home} tem alteracao local em arquivo versionado: o build nao corresponde ao commit.` };
  }
  if (lerCarimbo(home) !== ferramenta.commit) {
    return { erro: `eng-behaviour em ${home} nao tem ${CARIMBO_DO_BUILD} com o commit adotado: o dist/ nao se prova construido dele.` };
  }
  return { versao, commit: ferramenta.commit };
}

/**
 * A instrução de conserto, apontando para o caminho que o gate de fato espera.
 *
 * Era texto fixo dizendo "clone ao lado do farol", e dentro de uma worktree isso
 * mandava clonar em `.worktrees/`, que não resolveria nada. Metade do defeito que
 * este gate corrige é a resolução; a outra metade é a instrução parar de apontar
 * para o lugar errado, e ela precisa do caminho por parâmetro para isso.
 */
function ajudaPara(home) {
  return [
    'Como resolver:',
    `  1. clone https://github.com/wandersonaadsantos/eng-behaviour em ${home};`,
    '  2. dentro dele: pnpm install && pnpm build.',
    '  Para a versao adotada pelo Farol (tools/eng-behaviour/ferramenta.json):',
    '  node tools/eng-behaviour/preparar-copia.js, ou FAROL_ENG_BEHAVIOUR_HOME apontando uma copia construida.',
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
function resolverCli(home = escolherHome(candidatosDeHome())) {
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
 * bloqueio é pior.
 */
function versaoDo(home) {
  return leituraSemRastro(path.join(home, 'package.json'))?.version || 'desconhecida';
}

/**
 * Le um JSON de OUTRO repositorio sem deixar rastro nele.
 *
 * O `readJson` de `lib/io.js` preserva arquivo corrompido copiando um `.bad` ao
 * lado, o que e a decisao certa para o estado do proprio Farol e a errada aqui: o
 * alvo e o clone do eng-behaviour, e um `package.json` quebrado la faria este gate
 * criar arquivo dentro de um repositorio que nao e dele, sem dizer que criou. Ler
 * o texto e passar pelo `parseJson`, que e o outro endereco de JSON cru daqui,
 * responde a mesma pergunta sem tocar em disco alheio.
 */
function leituraSemRastro(caminho) {
  try {
    return parseJson(fs.readFileSync(caminho, 'utf8'), null);
  } catch {
    return null;
  }
}

/**
 * Roda um subcomando da CLI e devolve código e saída, os dois normalizados.
 *
 * Três cuidados que o caminho feliz não mostra.
 *
 * O teto de tempo está AQUI, e não só na consulta ao git. A justificativa escrita
 * neste arquivo, de que um travamento penduraria o push para sempre, vale para a
 * chamada que de fato pode travar, que é esta: a CLI varre o repositório e abre
 * processos de git por conta própria, sem teto nenhum.
 *
 * O `maxBuffer` é folgado porque o padrão de 1 MiB mata o processo por ENOBUFS e
 * joga fora TODOS os achados, entregando ao operador só a mensagem do erro.
 *
 * E o código de saída é traduzido para o vocabulário deste gate, nunca repassado
 * cru. Exit 1 significa achado no repositório; qualquer outro código significa que
 * a CLI não conseguiu rodar, que é problema de ambiente e não do código medido, e
 * mandar regenerar o recorte por causa disso apontaria para o repositório errado.
 */
/**
 * Base da entrega que o `audit` audita.
 *
 * A partir da v0.4.0 o `audit` exige `--base`, porque sem ela não há entrega
 * para auditar, só uma árvore. Sem a flag ele sai 2, e como este gate roda no
 * pre-push isso bloqueava TODO push do repositório.
 *
 * A base é DERIVADA do git e não configurada, pela mesma razão de
 * `raizPrincipal`: chave para alguém preencher seria configuração sem
 * consumidor, e o git já sabe a resposta. `origin/main` primeiro, porque é
 * contra ela que a entrega abre PR; `main` local é o degrau para o clone que
 * ainda não buscou o remoto. Sem nenhuma das duas devolve null, e quem chama
 * falha fechado: auditar árvore sem entrega é atestar o que não se verificou.
 *
 * Mesmo cuidado de ambiente e de teto do `raizPrincipal`, e pelo mesmo motivo:
 * rodando dentro do pre-push, um git que herde GIT_DIR responderia pelo
 * repositório do hook, e um git que trave penduraria o push em vez de reprovar.
 */
function baseDaEntrega(base = RAIZ) {
  const env = envSemRepositorioHerdado();
  for (const ref of ['origin/main', 'main']) {
    const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: base,
      env,
      encoding: 'utf8',
      timeout: TETO_DE_ESPERA_DO_GIT_MS,
    });
    if (r.status === 0 && (r.stdout || '').trim()) return ref;
  }
  return null;
}

function rodar(cli, args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: RAIZ,
    encoding: 'utf8',
    timeout: TETO_DA_CLI_MS,
    maxBuffer: TETO_DE_SAIDA_BYTES,
  });
  if (r.error) return { code: 2, saida: r.error.message };
  const saida = `${r.stdout || ''}${r.stderr || ''}`.trimEnd();
  // Piso anti-vacuidade, o mesmo que o check-syntax já usa: a CLI sempre diz o que
  // examinou, então rodada muda é sinal de que ela não mediu, e não de repositório
  // limpo. Sem isto o gate aprova o silêncio.
  if (!saida) return { code: 2, saida: 'a CLI do eng-behaviour nao produziu saida nenhuma' };
  if (r.status === 0) return { code: 0, saida };
  return { code: r.status === 1 ? 1 : 2, saida };
}

/** Onde mora a divida registrada que o `audit` desconta (ADR-0015 do eng-behaviour). */
const CAMINHO_DOS_BASELINES = 'tools/eng-behaviour/baselines.json';

/**
 * Os argumentos do `audit`, num lugar so.
 *
 * `--repo-id` e o nome do pacote, e nao o do diretorio. A CLI usa o nome do diretorio
 * quando a flag falta, e numa worktree ele e o nome da worktree: o baseline, registrado
 * para `farol`, deixaria de valer justamente onde as entregas grandes rodam, e a divida
 * registrada reprovaria como se fosse nova. As avaliacoes do `avaliacoes.jsonl` usam a
 * mesma identidade.
 *
 * `--baselines` aponta a divida registrada, versionada junto do codigo porque ela e o
 * numero que precisa descer entrega apos entrega e tem que ser o mesmo em toda maquina.
 */
function argumentosDoAudit(base) {
  return [
    'audit', '--repo', '.', '--base', base,
    '--assessments', 'avaliacoes.jsonl',
    '--baselines', CAMINHO_DOS_BASELINES,
    '--repo-id', NOME_DO_PACOTE,
  ];
}

function main() {
  const ferramenta = ferramentaAdotada();
  const esperado = escolherHome(candidatosDeHome({ ferramenta }));
  const { cli, home, erro } = resolverCli(esperado);
  if (erro) {
    console.error(`eng-behaviour: ${erro}`);
    console.error(ajudaPara(esperado));
    return 2;
  }
  const identidade = conferirIdentidade(home, ferramenta);
  if (identidade.erro) {
    console.error(`eng-behaviour: ${identidade.erro}`);
    console.error(ajudaPara(esperado));
    return 2;
  }
  console.log(`eng-behaviour ${identidade.versao} @ ${identidade.commit} (${home})`);

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

  const base = baseDaEntrega();
  if (!base) {
    console.error('eng-behaviour: nao achei origin/main nem main para servir de base da entrega.');
    console.error('Busque o remoto (git fetch origin) ou rode o gate de um clone que tenha a main.');
    return 2;
  }

  const audit = rodar(cli, argumentosDoAudit(base));
  console.log(audit.saida);
  if (audit.code !== 0) {
    console.error('eng-behaviour: o gate reprovou.');
    console.error('Regra de julgamento sem avaliacao para o head atual? Cada uma precisa da PROPRIA');
    console.error('fundamentacao sobre ESTE diff. Repetir a mesma frase em todas passa no gate sem');
    console.error('avaliar nada, e ai o registro deixa de significar o que ele existe para significar.');
    return audit.code;
  }
  return 0;
}

// `main` ja devolve so 0, 1 ou 2. O clamp existe porque esta e a ultima linha
// antes do SO e o codigo de saida e truncado em 8 bits: um engano futuro que
// devolvesse 256 daqui viraria aprovacao silenciosa.
//
// Ele protege a saida DESTE processo, e so ela. Medido em CI: quando o truncamento
// acontece no filho, em Linux e macOS ele ocorre antes de o pai ler, entao 256
// chega ao `rodar` como 0 e nao ha o que traduzir. No Windows chega inteiro. A
// assimetria e do sistema, nao do codigo.
if (executadoDireto(import.meta.url)) process.exit(Math.min(main(), 2));
// Exporta so o que tem leitor, e todos os leitores sao a suite: sem essa costura
// nao havia como observar os comportamentos, que e a excecao que a
// core.abstraction.no-premature nomeia. `ehEsteCheckout`, `escolherHome` e `gitEm`
// ficam de fora porque ninguem as le daqui, e exportar o que ninguem le e o campo
// sem leitor que a mesma regra condena.
export default { resolverCli, versaoDo, raizPrincipal, ajudaPara, rodar, baseDaEntrega, argumentosDoAudit, candidatosDeHome, conferirIdentidade, ferramentaAdotada, CARIMBO_DO_BUILD };
export { resolverCli, versaoDo, raizPrincipal, ajudaPara, rodar, baseDaEntrega, argumentosDoAudit, candidatosDeHome, conferirIdentidade, ferramentaAdotada, CARIMBO_DO_BUILD };
