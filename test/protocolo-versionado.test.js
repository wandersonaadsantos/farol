// O protocolo de review (agentes e comandos do workspace-template) tem que estar
// VERSIONADO, não só existir na máquina de quem escreveu.
//
// Bug real, PR #16 (18/08/2026): o `.gitignore` tinha `.claude/` pra manter fora a
// config local de ferramenta, e essa regra engoliu também
// `workspace-template/.claude/agents/claim-verifier.md`, que é artefato DISTRIBUÍDO.
// O agente existia na máquina do autor, os testes passavam lá, e no repositório o
// arquivo simplesmente não estava. Efeito: `prepareHome` pula o que não existe (sem
// derrubar o boot), então a verificação empírica em paralelo ficaria sem o agente que
// ela dispara, em silêncio. É a mesma classe do bug de fachada da v2.28.0: a peça
// existe e o caminho até ela não.
//
// Este teste cobre os dois lados da regra, porque consertar um quebrando o outro seria
// fácil: o template PRECISA entrar no git, e a config local da raiz PRECISA ficar fora.
// Runner nativo, ZERO deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { envGitLimpo } from './helpers/git-limpo.js';

const RAIZ = path.join(import.meta.dirname, '..');
const TPL = path.join(RAIZ, 'workspace-template', '.claude');

// Ambiente limpo em TODA consulta, e montado a cada chamada (ver
// test/helpers/git-limpo.js). Estes casos rodam dentro do pre-push, que exporta
// GIT_DIR: consulta que responde pelo repositorio errado nao estraga nada em
// disco, mas afirma o que nao mediu, e aqui ela afirma sobre a FONTE.
const opcoes = () => ({ cwd: RAIZ, env: envGitLimpo(), encoding: 'utf8' });

// `git check-ignore` sozinho engana: com regra de negação ele imprime a regra e sai 0.
// A pergunta sem ambiguidade é se o arquivo está RASTREADO.
function rastreado(rel) {
  return spawnSync('git', ['ls-files', '--error-unmatch', rel], opcoes()).status === 0;
}

/**
 * O que o git diz sobre ignorar, com "nao sei" separado de "nao ignora".
 *
 * `git check-ignore` responde em TRES estados, e juntar dois deles foi o defeito:
 * 0 = ignorado, 1 = nao ignorado, 128 = nao consegui responder. Um `catch` que
 * devolve `false` transforma o 128 em acusacao contra o `.gitignore`, e foi
 * exatamente isso que se viu em 30/08/2026: outro teste da suite corrompeu o
 * config do repositorio com `core.bare = true`, todo `check-ignore` passou a
 * morrer com "must be run in a work tree", e a suite apontou para a fonte quando
 * o defeito estava no ambiente. Diagnostico errado custa mais que teste vermelho.
 *
 * Sem `--no-index` de proposito: se o arquivo chegar a ser RASTREADO, a resposta
 * vira "nao ignorado" e o caso reprova, que e o desfecho certo. A propriedade e
 * que este arquivo nao entre no git, nao que exista uma regra escrita.
 */
function respostaDoIgnore(rel) {
  const r = spawnSync('git', ['check-ignore', '-q', rel], opcoes());
  if (r.error) return { erro: r.error.message };
  if (r.status === 0) return { ignorado: true };
  if (r.status === 1) return { ignorado: false };
  return { erro: `git saiu ${r.status}: ${String(r.stderr || '').trim()}` };
}

test('todo agente e comando do workspace-template está versionado', () => {
  const alvos = [];
  for (const sub of ['agents', 'commands']) {
    const dir = path.join(TPL, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.md'))) {
      alvos.push(path.posix.join('workspace-template', '.claude', sub, f));
    }
  }
  assert.ok(alvos.length >= 2, `esperava agentes e comandos no template, achei ${alvos.length}`);
  const fora = alvos.filter(rel => !rastreado(rel));
  assert.deepEqual(fora, [], 'protocolo que não está no git não chega em ninguém');
});

test('a config local de ferramenta da raiz continua FORA do git', () => {
  // o outro lado da mesma regra: a exceção do template não pode ter aberto a raiz,
  // que aponta pra caminho da máquina e não serve pra mais ninguém
  const r = respostaDoIgnore('.claude/settings.local.json');
  assert.equal(r.erro, undefined, `o git nao conseguiu responder, entao nada foi medido: ${r.erro}`);
  assert.equal(r.ignorado, true, '.claude/ da raiz precisa seguir ignorado');
});

test('a resposta sobre a fonte nao depende do ambiente git herdado', () => {
  // Regressao de 30/08/2026: empurrando de uma worktree ligada, os casos acima
  // reprovavam dentro do hook de pre-push e passavam rodados direto.
  //
  // Envenena com um repositorio BARE, que e a forma mais severa do problema: com
  // ele herdado o git recusa toda operacao que precise de arvore de trabalho, que
  // e o estado em que a suite se meteu sozinha ao ter o repositorio reinicializado
  // por outro teste (ver test/helpers/git-limpo.js).
  //
  // Os DOIS ajudantes entram no caso porque os dois estavam expostos, e o do
  // `ls-files` e o pior dos dois: sob ambiente herdado ele responde que o
  // protocolo versionado nao esta no git, que e uma acusacao grave e falsa.
  const casa = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-git-sujo-'));
  const salvo = process.env.GIT_DIR;
  try {
    const nu = path.join(casa, 'nu.git');
    execFileSync('git', ['init', '-q', '--bare', nu], { env: envGitLimpo(), stdio: 'pipe' });
    process.env.GIT_DIR = nu;

    const r = respostaDoIgnore('.claude/settings.local.json');
    assert.equal(r.erro, undefined, `ambiente herdado quebrou a consulta: ${r.erro}`);
    assert.equal(r.ignorado, true, 'a resposta sobre o .claude/ mudou por causa do ambiente');
    assert.equal(rastreado('.gitignore'), true, 'a resposta sobre o rastreamento mudou por causa do ambiente');
  } finally {
    if (salvo === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = salvo;
    fs.rmSync(casa, { recursive: true, force: true });
  }
});

test('o .gitignore diz POR QUE a exceção existe', () => {
  // sem o porquê, o próximo a limpar o arquivo remove a exceção e o bug volta
  const gi = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8');
  assert.match(gi, /!workspace-template\/\.claude\//, 'a exceção existe');
  const trecho = gi.slice(Math.max(0, gi.indexOf('!workspace-template') - 500), gi.indexOf('!workspace-template'));
  assert.match(trecho, /distribuido|distribuído/i, 'e explica que o template é artefato distribuído');
});
