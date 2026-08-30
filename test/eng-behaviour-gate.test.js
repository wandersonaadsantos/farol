// O gate da constituição precisa FALHAR quando não consegue rodar, nunca passar
// calado. Gate que se cala quando não sabe passa a atestar o que não verificou,
// e é o modo de falha mais caro que existe aqui: o pre-push fica verde sem ter
// medido nada, e ninguém descobre até o dano aparecer em outro lugar.
//
// Os dois casos são as duas maneiras concretas de o pacote não estar
// disponível, e elas pedem mensagens diferentes: diretório ausente é problema de
// checkout, diretório presente sem `dist/` é problema de build. Mandar rodar o
// build num caminho que não existe manda a pessoa para o lugar errado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolverCli, versaoDo, raizPrincipal } from '../tools/eng-behaviour/gate.js';

function temporario(prefixo) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

test('recusa quando o pacote nao esta no caminho', () => {
  const ausente = path.join(temporario('farol-eng-'), 'nao-existe');
  const r = resolverCli(ausente);
  assert.equal(r.cli, undefined);
  assert.match(r.erro, /nao encontrado/);
});

test('recusa quando o pacote existe mas nao foi construido, e diz que o problema e o build', () => {
  // A distinção importa: aqui o clone está no lugar, e mandar clonar de novo
  // seria a orientação errada.
  const home = temporario('farol-eng-');
  const r = resolverCli(home);
  assert.equal(r.cli, undefined);
  assert.match(r.erro, /sem build/);
  fs.rmSync(home, { recursive: true, force: true });
});

test('aceita quando dist/cli/main.js existe, e devolve o home junto', () => {
  const home = temporario('farol-eng-');
  fs.mkdirSync(path.join(home, 'dist', 'cli'), { recursive: true });
  fs.writeFileSync(path.join(home, 'dist', 'cli', 'main.js'), '', 'utf8');
  const r = resolverCli(home);
  assert.equal(r.erro, undefined);
  assert.equal(r.home, home);
  assert.ok(r.cli.endsWith(path.join('dist', 'cli', 'main.js')));
  fs.rmSync(home, { recursive: true, force: true });
});

test('a versao vem do package.json do pacote, e nao do farol', () => {
  const home = temporario('farol-eng-');
  fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ version: '9.9.9' }), 'utf8');
  assert.equal(versaoDo(home), '9.9.9');
  fs.rmSync(home, { recursive: true, force: true });
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
function repoComWorktree() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-wt-'));
  // `git worktree` recusa caminho dentro do próprio .git, então principal e
  // worktree ficam lado a lado dentro da base.
  const principal = path.join(base, 'principal');
  const wt = path.join(base, 'copia');
  fs.mkdirSync(principal);
  // Teto por chamada: sem ele, um git que trave deixa o runner de testes pendurado
  // sem mensagem, e no CI isso vira um job em curso por tempo indeterminado em vez
  // de uma falha que alguém consegue ler. Aconteceu de verdade no runner de macOS.
  const git = (args, cwd) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 20_000 });

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

/**
 * Compara caminho sem depender de separador, caixa ou forma do nome no Windows.
 *
 * `realpathSync.native` e não o `realpathSync` comum: no Windows o `os.tmpdir()`
 * devolve o nome curto 8.3 (`WANDER~1`) e o git devolve o longo, e só a variante
 * nativa canoniza os dois para a mesma coisa. Com o `realpathSync` comum este
 * caso reprovava por causa da comparação, com o valor certo do lado de dentro.
 */
function mesmoCaminho(a, b) {
  const norm = (p) => fs.realpathSync.native(p).replace(/\\/g, '/').toLowerCase();
  return norm(a) === norm(b);
}

test('a raiz resolvida a partir de uma worktree e a do repositorio principal', { timeout: 60_000 }, () => {
  const { base, principal, wt } = repoComWorktree();
  try {
    assert.ok(
      mesmoCaminho(raizPrincipal(wt), principal),
      `esperava a raiz principal, veio ${raizPrincipal(wt)}`,
    );
    // E o principal continua respondendo por si mesmo, que é o caso comum.
    assert.ok(mesmoCaminho(raizPrincipal(principal), principal));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('fora de repositorio git, a raiz e o proprio diretorio consultado', { timeout: 30_000 }, () => {
  // O fallback existe para o gate não morrer onde o git não responde; ali o
  // comportamento antigo, o irmão de onde o arquivo está, continua correto.
  const solto = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-sem-git-'));
  try {
    assert.ok(mesmoCaminho(raizPrincipal(solto), solto));
  } finally {
    fs.rmSync(solto, { recursive: true, force: true });
  }
});

test('versao ilegivel nao derruba o gate, so deixa de ser afirmada', () => {
  // A versão é transparência, não gate. Um package.json quebrado no pacote é
  // problema dele, e travar o Farol por causa disso trocaria uma informação
  // perdida por um bloqueio, que é pior.
  const home = temporario('farol-eng-');
  fs.writeFileSync(path.join(home, 'package.json'), '{ nao e json', 'utf8');
  assert.equal(versaoDo(home), 'desconhecida');
  fs.rmSync(home, { recursive: true, force: true });
});
