// O gate da constituição precisa FALHAR quando não consegue rodar, nunca passar
// calado. Gate que se cala quando não sabe passa a atestar o que não verificou,
// e é o modo de falha mais caro que existe aqui: o pre-push fica verde sem ter
// medido nada, e ninguém descobre até o dano aparecer em outro lugar.
//
// Os dois casos são as duas maneiras concretas de o pacote não estar
// disponível, e elas pedem mensagens diferentes: diretório ausente é problema de
// checkout, diretório presente sem `dist/` é problema de build. Mandar rodar o
// build num caminho que não existe manda a pessoa para o lugar errado.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { envGitLimpo } from './helpers/git-limpo.js';
import { resolverCli, versaoDo, raizPrincipal, ajudaPara, rodar, baseDaEntrega } from '../tools/eng-behaviour/gate.js';

/**
 * Ate quando esperar cada chamada de git da montagem antes de desistir.
 *
 * Mesma fronteira que a producao nomeia, pelo mesmo motivo: passado esse tempo,
 * desistir e falhar com mensagem vale mais que esperar. O numero e outro porque
 * aqui a chamada escreve em disco, e nao so consulta.
 */
const TETO_DO_GIT_NO_TESTE_MS = 20_000;

/**
 * Todos os diretorios deste arquivo moram dentro de um so, apagado no fim.
 *
 * Antes cada caso fazia o proprio `mkdtemp` e chamava `rmSync` no corpo, fora de
 * `finally`: o caso que so monta o caminho nunca apagava, e os outros vazavam
 * sempre que a asercao caia. Medido: 166 diretorios `farol-eng-` acumulados na
 * maquina. Com uma raiz so, o hook de fim fecha os dois buracos de uma vez.
 */
let raizDeTestes = '';

before(() => {
  raizDeTestes = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-eng-'));
});

after(() => {
  fs.rmSync(raizDeTestes, { recursive: true, force: true });
});

let criados = 0;

function temporario() {
  criados += 1;
  const dir = path.join(raizDeTestes, `caso-${criados}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Argumentos que neutralizam o que a maquina de quem roda a suite pode ter ligado.
 *
 * `commit.gpgsign=false` porque assinatura obrigatoria faz o `git commit` esperar
 * o pinentry, e `execFileSync` bloqueia o event loop: nem o teto do runner
 * interromperia. `core.hooksPath=` porque um `pre-commit` que reprova derruba a
 * montagem por um motivo que nao tem nada a ver com o que este arquivo mede.
 *
 * Os dois sobrevivem ao config neutro do `envGitLimpo` de proposito: eles tambem
 * cobrem hook no caminho padrao (`.git/hooks`), que config nenhum desliga.
 *
 * Mora aqui, e nao no ajudante compartilhado, porque este e o unico arquivo que
 * ESCREVE com git. Quem so consulta nao precisa deles.
 */
const ARGS_GIT_NEUTROS = ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath='];

test('recusa quando o pacote nao esta no caminho', () => {
  const ausente = path.join(temporario(), 'nao-existe');
  const r = resolverCli(ausente);
  assert.equal(r.cli, undefined);
  assert.match(r.erro, /nao encontrado/);
});

test('recusa quando o pacote existe mas nao foi construido, e diz que o problema e o build', () => {
  // A distinção importa: aqui o clone está no lugar, e mandar clonar de novo
  // seria a orientação errada.
  const home = temporario();
  const r = resolverCli(home);
  assert.equal(r.cli, undefined);
  assert.match(r.erro, /sem build/);
});

test('aceita quando dist/cli/main.js existe, e devolve o home junto', () => {
  const home = temporario();
  fs.mkdirSync(path.join(home, 'dist', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(home, 'dist', 'cli', 'main.js'), '', 'utf8');
  const r = resolverCli(home);
  assert.equal(r.erro, undefined);
  assert.equal(r.home, home);
  assert.ok(r.cli.endsWith(path.join('dist', 'cli', 'main.js')));
});

test('a versao vem do package.json do pacote, e nao do farol', () => {
  const home = temporario();
  fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf8');
  assert.equal(versaoDo(home), '9.9.9');
});

/*
 * A raiz que o gate usa para achar o pacote precisa ser a do repositório
 * PRINCIPAL, e não a do diretório em que o arquivo está. Em worktree os dois são
 * diferentes, e a diferença não é cosmética: uma worktree em `.worktrees/x`
 * procuraria o pacote em `.worktrees/eng-behaviour`, reprovaria o pre-push e
 * ainda mandaria clonar num lugar que não resolveria nada.
 *
 * O caso monta repositório e worktree de verdade, sem dublê de git: o
 * comportamento sob teste É a resposta do git, e substituí-la trocaria a
 * pergunta que importa por uma pergunta sobre o dublê.
 */
function repoComWorktree(nomeDoPacote = 'farol') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-wt-'));
  // `git worktree` recusa caminho dentro do próprio .git, então principal e
  // worktree ficam lado a lado dentro da base.
  const principal = path.join(base, 'principal');
  const wt = path.join(base, 'copia');
  fs.mkdirSync(principal);
  // A identidade é parâmetro porque os dois casos precisam de repositórios com
  // papéis opostos: um que É este projeto, e um que é outro projeto qualquer com
  // uma cópia do Farol dentro.
  fs.writeFileSync(
    path.join(principal, 'package.json'),
    JSON.stringify({ name: nomeDoPacote }),
    'utf8',
  );
  // Tres protecoes, com motivos diferentes, e nenhuma e opcional.
  //
  // O TETO por chamada existe para este bloco nao poder pendurar a suite:
  // `execFileSync` bloqueia o event loop, entao nem o teto do runner de testes
  // interromperia uma chamada travada. So o teto do proprio processo resolve.
  //
  // Os ARGS_GIT_NEUTROS desligam assinatura (que faria o `git commit` esperar o
  // pinentry, o jeito mais provavel de travar) e hooks (um `pre-commit` global
  // que reprova derrubaria a montagem por um motivo alheio ao que se mede aqui).
  //
  // O ENV LIMPO e o mais serio dos tres, e a razao esta no `git-limpo.js`: sem
  // ele, `git init` e `git config` herdam o GIT_DIR do hook de push e escrevem no
  // repositorio REAL em vez do temporario. Ja aconteceu, e o estrago foi
  // `core.bare = true` mais a identidade do teste no config do Farol.
  const env = envGitLimpo();
  const git = (args, cwd) =>
    execFileSync('git', [...ARGS_GIT_NEUTROS, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: TETO_DO_GIT_NO_TESTE_MS,
    });

  // A base nasce antes da primeira chamada e só é devolvida no fim, então uma
  // chamada que estoure o teto sairia daqui sem passar pelo `finally` do caso,
  // que só existe depois do retorno. O diretório vazaria exatamente no caminho de
  // falha, que é o caminho que o teto passou a tornar possível.
  try {
    git(['init', '-q', '-b', 'main'], principal);
    git(['config', 'user.email', 'teste@exemplo'], principal);
    git(['config', 'user.name', 'teste'], principal);
    fs.writeFileSync(path.join(principal, 'a.txt'), 'a', 'utf8');
    git(['add', '-A'], principal);
    git(['commit', '-qm', 'inicial'], principal);
    git(['worktree', 'add', '-q', '-b', 'ramo', wt, 'main'], principal);
  } catch (erro) {
    fs.rmSync(base, { recursive: true, force: true });
    throw erro;
  }
  return { base, principal, wt };
}

/*
 * A montagem acima escreve em disco, e por isso ela mesma precisa de teste: um
 * `git init` que erra o alvo nao falha, ele acerta OUTRO repositorio calado.
 *
 * Regressao de 30/08/2026. Empurrando de uma worktree ligada, o hook de pre-push
 * exportou GIT_DIR para o `npm test`, a montagem herdou, e as tres primeiras
 * chamadas foram parar no repositorio do proprio Farol: o `git init` o
 * reinicializou como BARE (gitdir de worktree nao tem arvore ao lado) e o
 * `git config` gravou `teste` / `teste@exemplo` no config compartilhado. A
 * identidade contaminada teria posto autor errado em qualquer commit, e o
 * `core.bare` derrubou em seguida todo `git check-ignore` da suite.
 *
 * O caso compara o config do repositorio de fora byte a byte, e nao so procura
 * `[user]`: os dois estragos foram diferentes, e a proxima variante tambem sera.
 */
test('a montagem do repositorio de prova nao escreve no repositorio apontado por GIT_DIR', () => {
  const casa = temporario('farol-vitima-');
  // Um `finally` so, e a limpeza condicionada ao que existe: sem o conserto a
  // montagem LANCA no meio, e o caminho de falha e justamente o que precisa
  // limpar. E a mesma licao que a propria montagem ja aprendeu logo acima.
  let montado;
  try {
    const vitima = path.join(casa, 'vitima');
    fs.mkdirSync(vitima);
    execFileSync('git', [...ARGS_GIT_NEUTROS, 'init', '-q', '-b', 'main'], {
      cwd: vitima,
      env: envGitLimpo(),
      stdio: 'pipe',
      timeout: TETO_DO_GIT_NO_TESTE_MS,
    });
    const config = path.join(vitima, '.git', 'config');
    const antes = fs.readFileSync(config, 'utf8');

    // Envenena do jeito exato que o hook de push envenenava, e restaura sempre: o
    // processo de teste e compartilhado com os outros casos deste arquivo.
    const salvo = process.env.GIT_DIR;
    try {
      process.env.GIT_DIR = path.join(vitima, '.git');
      montado = repoComWorktree();
    } finally {
      if (salvo === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = salvo;
    }

    assert.equal(
      fs.readFileSync(config, 'utf8'),
      antes,
      'a montagem alterou o config de um repositorio que nao e dela',
    );
    // E o repositorio de prova precisa ter sido montado de verdade, senao o caso
    // passaria tambem se a montagem nao tivesse feito nada.
    assert.ok(fs.existsSync(path.join(montado.principal, '.git')), 'o repositorio de prova nasceu');
    assert.ok(fs.existsSync(path.join(montado.wt, 'a.txt')), 'a worktree de prova nasceu');
  } finally {
    if (montado) fs.rmSync(montado.base, { recursive: true, force: true });
    fs.rmSync(casa, { recursive: true, force: true });
  }
});

/**
 * Compara caminho sem depender de separador nem da forma do nome no Windows.
 *
 * `realpathSync.native` e não o `realpathSync` comum: no Windows o `os.tmpdir()`
 * devolve o nome curto 8.3 (`WANDER~1`) e o git devolve o longo, e só a variante
 * nativa canoniza os dois para a mesma coisa.
 *
 * E ela NÃO pode lançar. O valor que chega aqui num caso que reprova costuma ser
 * um caminho que não existe, e `realpathSync.native` responde a isso com ENOENT:
 * o caso morreria com pilha de erro de sistema de arquivos, e a mensagem que diria
 * qual caminho veio nunca apareceria. Caminho que não resolve cai na comparação
 * textual, que é pior mas ainda responde.
 *
 * A caixa só é dobrada onde o sistema de arquivos de fato ignora caixa. No Linux
 * dobrar afrouxaria a comparação e deixaria passar divergência real.
 */
function mesmoCaminho(a, b) {
  const dobraCaixa = process.platform !== 'linux';
  const norm = (p) => {
    let resolvido;
    try {
      resolvido = fs.realpathSync.native(p);
    } catch {
      resolvido = path.resolve(p);
    }
    const barras = resolvido.replace(/\\/g, '/');
    return dobraCaixa ? barras.toLowerCase() : barras;
  };
  return norm(a) === norm(b);
}

test('a raiz resolvida a partir de uma worktree e a do repositorio principal', () => {
  const { base, principal, wt } = repoComWorktree();
  try {
    const daWorktree = raizPrincipal(wt);
    assert.ok(mesmoCaminho(daWorktree, principal), `esperava ${principal}, veio ${daWorktree}`);
    // E o principal continua respondendo por si mesmo, que é o caso comum.
    const doPrincipal = raizPrincipal(principal);
    assert.ok(mesmoCaminho(doPrincipal, principal), `esperava ${principal}, veio ${doPrincipal}`);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a raiz nao vem de um repositorio de fora quando o farol nao e repositorio', () => {
  // Cópia do Farol extraída dentro de um repositório qualquer. Aqui o git NÃO
  // falha, ele responde pelo repositório de fora, então o fallback de erro não
  // pega: é preciso provar que a pasta consultada é uma raiz git antes de aceitar
  // a worktree listada. Sem isso, o gate procuraria o pacote ao lado do repositório errado.
  const { base, principal } = repoComWorktree();
  const dentro = path.join(principal, 'copia-do-farol');
  try {
    fs.mkdirSync(dentro);
    fs.writeFileSync(path.join(dentro, 'package.json'), JSON.stringify({ name: 'farol' }), 'utf8');
    const resolvida = raizPrincipal(dentro);
    assert.ok(
      mesmoCaminho(resolvida, dentro),
      `esperava a propria copia ${dentro}, veio ${resolvida}`,
    );
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('fora de repositorio git, a raiz e o proprio diretorio consultado', () => {
  // O fallback existe para o gate não morrer onde o git não responde; ali o
  // comportamento antigo, o irmão de onde o arquivo está, continua correto.
  const solto = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sem-git-'));
  try {
    assert.ok(mesmoCaminho(raizPrincipal(solto), solto));
  } finally {
    fs.rmSync(solto, { recursive: true, force: true });
  }
});

test('a instrucao de conserto aponta para o caminho que o gate espera', () => {
  // A outra metade do defeito da worktree: a resolução passou a acertar, mas a
  // instrução era texto fixo mandando clonar "ao lado do farol", que dentro de
  // uma worktree apontava para `.worktrees/`. Sem este caso, voltar ao texto fixo
  // deixa a suíte inteira verde com metade do defeito de volta.
  const alvo = path.join('qualquer', 'lugar', 'eng-behaviour');
  const texto = ajudaPara(alvo);
  assert.ok(texto.includes(alvo), 'a ajuda precisa nomear o caminho resolvido');
  assert.ok(texto.includes('pnpm build'), 'a ajuda precisa dizer que o pacote e construido');
});

test('versao ilegivel nao derruba o gate, so deixa de ser afirmada', () => {
  // A versão é transparência, não gate. Um package.json quebrado no pacote é
  // problema dele, e travar o Farol por causa disso trocaria uma informação
  // perdida por um bloqueio, que é pior.
  const home = temporario();
  fs.writeFileSync(path.join(home, 'package.json'), '{ nao e json', 'utf8');
  assert.equal(versaoDo(home), 'desconhecida');
});

/*
 * O `rodar` traduz o resultado de um processo externo para o vocabulario deste
 * gate, e cada uma das quatro traducoes sumiria calada. A CLI de mentira e um
 * script node que responde o que o caso pedir: nao e duble do comportamento sob
 * teste, e sim o processo externo de verdade, que e justamente a parte que o
 * `rodar` precisa saber tratar. Dublar o `spawnSync` trocaria a pergunta.
 */
function cliDeMentira(corpo) {
  // `.mjs` e nao `.js`: o diretorio temporario nao tem `package.json`, entao um
  // `.js` seria lido como CommonJS e o `import` viraria erro de sintaxe. O erro
  // sai em stderr e vira saida, o que quebraria justamente o caso que exige
  // saida vazia.
  const arq = path.join(temporario(), 'falsa-cli.mjs');
  fs.writeFileSync(arq, `import fs from 'node:fs';\n${corpo}`, 'utf8');
  return arq;
}

test('saida vazia e tratada como nao tendo medido, e nao como repositorio limpo', () => {
  // Piso anti-vacuidade. Sem ele o gate aprova o silencio: a CLI sempre diz o que
  // examinou, entao rodada muda significa que ela nao rodou.
  const cli = cliDeMentira('process.exit(0);\n');
  const r = rodar(cli, []);
  assert.equal(r.code, 2, 'saida vazia com exit 0 precisa reprovar como ambiente');
  assert.match(r.saida, /nao produziu saida nenhuma/);
});

test('exit 1 com saida e achado do repositorio', () => {
  const cli = cliDeMentira('console.log("um achado"); process.exit(1);\n');
  assert.equal(rodar(cli, []).code, 1);
});

test('exit fora de 0 e 1 e problema de ambiente, nao achado do repositorio', () => {
  // A CLI que nao consegue subir tambem sai diferente de zero. Reportar isso como
  // achado mandaria regenerar o recorte, ou seja, corrigir o repositorio errado.
  const cli = cliDeMentira('console.log("nao consegui rodar"); process.exit(3);\n');
  assert.equal(rodar(cli, []).code, 2);
});

/*
 * Não existe caso para "filho sai com 256", e a ausência é a conclusão de uma
 * medição, não um esquecimento.
 *
 * Eu escrevi esse caso. Ele passou no Windows e REPROVOU no Linux e no macOS: em
 * POSIX o próprio sistema trunca o código do filho em 8 bits ANTES de o pai ler,
 * então 256 chega ao `rodar` como 0 e não há como distinguir de sucesso. Não há o
 * que traduzir ali, e um caso que afirmasse o contrário estaria afirmando uma
 * verdade de um sistema só.
 *
 * O que a tradução protege de verdade está no caso acima, de código fora de 0 e 1.
 * O clamp da última linha do módulo protege a saída DESTE processo, que é a parte
 * que está na nossa mão.
 */

test('saida grande nao e descartada por estouro de buffer', () => {
  // Com o `maxBuffer` padrao de 1 MiB o processo morre por ENOBUFS e TODOS os
  // achados sao jogados fora, sobrando so a mensagem do erro.
  //
  // A escrita e `writeSync` e nao `console.log`: escrever num pipe e assincrono, e
  // sair logo depois trunca o que ainda nao saiu. Medido no CI, o caso reprovou so
  // no macOS, entregando 8192 bytes dos 4 MiB. Era corrida da fixture, nao defeito
  // do que ela mede, e um `console.log` aqui deixaria o caso mentir conforme o SO.
  const cli = cliDeMentira(
    'fs.writeSync(1, "x".repeat(4 * 1024 * 1024)); process.exit(1);\n',
  );
  const r = rodar(cli, []);
  assert.equal(r.code, 1);
  assert.ok(r.saida.length > 1024 * 1024, `esperava a saida inteira, veio ${r.saida.length} bytes`);
});

test('a leitura do package.json alheio nao escreve nada ao lado dele', () => {
  // `versaoDo` le o clone do eng-behaviour. O `readJson` de lib/io.js preserva
  // arquivo corrompido criando um `.bad` do lado, o que aqui seria escrever dentro
  // de um repositorio que nao e nosso, sem avisar.
  const home = temporario();
  const alvo = path.join(home, 'package.json');
  fs.writeFileSync(alvo, '{ isto nao e json', 'utf8');
  assert.equal(versaoDo(home), 'desconhecida');
  assert.deepEqual(fs.readdirSync(home), ['package.json'], 'nada pode ter sido criado ao lado');
});

/*
 * A base da entrega.
 *
 * O `audit` do eng-behaviour 0.4.0 passou a exigir `--base`, porque sem ela não
 * há entrega para auditar, só uma árvore. O gate não passava a flag, e o efeito
 * foi imediato e amplo: `npm run eng` saía 2 em qualquer clone, e como ele roda
 * no pre-push, NENHUM push passava sem `--no-verify`.
 *
 * A base é derivada do git, não configurada: `origin/main` quando existe, e
 * `main` como degrau para o clone que ainda não buscou o remoto. Sem nenhuma das
 * duas o gate falha fechado, que é a doutrina deste arquivo.
 *
 * Repositório de verdade, com o mesmo cuidado de ambiente do resto do arquivo: o
 * comportamento sob teste É a resposta do git.
 */
function repoComBase(criarOriginMain, nomeDoRamo = 'main') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-base-'));
  const env = envGitLimpo();
  const git = (args) =>
    execFileSync('git', [...ARGS_GIT_NEUTROS, ...args], {
      cwd: dir, env, encoding: 'utf8', stdio: 'pipe', timeout: 20_000,
    });
  git(['init', '-q', '-b', nomeDoRamo]);
  git(['config', 'user.email', 'teste@exemplo.invalido']);
  git(['config', 'user.name', 'teste']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'conteudo inicial');
  git(['add', '-A']);
  git(['commit', '-qm', 'inicial']);
  if (criarOriginMain) git(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  return dir;
}

test('a base da entrega e origin/main quando o remoto ja foi buscado', { timeout: 30_000 }, () => {
  const dir = repoComBase(true);
  try {
    assert.equal(baseDaEntrega(dir), 'origin/main');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sem origin/main, a base cai na main local (clone que ainda nao buscou o remoto)', { timeout: 30_000 }, () => {
  const dir = repoComBase(false);
  try {
    assert.equal(baseDaEntrega(dir), 'main');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('sem base nenhuma o gate falha fechado, em vez de auditar arvore sem entrega', { timeout: 30_000 }, () => {
  const dir = repoComBase(false, 'outra');
  try {
    assert.equal(baseDaEntrega(dir), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
