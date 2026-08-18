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
import { execFileSync } from 'node:child_process';

const RAIZ = path.join(import.meta.dirname, '..');
const TPL = path.join(RAIZ, 'workspace-template', '.claude');

// `git check-ignore` sozinho engana: com regra de negação ele imprime a regra e sai 0.
// A pergunta sem ambiguidade é se o arquivo está RASTREADO.
function rastreado(rel) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: RAIZ, stdio: 'pipe' });
    return true;
  } catch { return false; }
}
function ignorado(rel) {
  const r = execFileSync('git', ['check-ignore', '--no-index', '-q', rel], { cwd: RAIZ, stdio: 'pipe' })
    .toString();
  return r !== null;
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
  let ignora = false;
  try {
    execFileSync('git', ['check-ignore', '-q', '.claude/settings.local.json'], { cwd: RAIZ, stdio: 'pipe' });
    ignora = true;
  } catch { ignora = false; }
  assert.equal(ignora, true, '.claude/ da raiz precisa seguir ignorado');
});

test('o .gitignore diz POR QUE a exceção existe', () => {
  // sem o porquê, o próximo a limpar o arquivo remove a exceção e o bug volta
  const gi = fs.readFileSync(path.join(RAIZ, '.gitignore'), 'utf8');
  assert.match(gi, /!workspace-template\/\.claude\//, 'a exceção existe');
  const trecho = gi.slice(Math.max(0, gi.indexOf('!workspace-template') - 500), gi.indexOf('!workspace-template'));
  assert.match(trecho, /distribuido|distribuído/i, 'e explica que o template é artefato distribuído');
});
