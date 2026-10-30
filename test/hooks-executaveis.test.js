// Todo hook em tools/hooks/ tem que estar VERSIONADO como executável (modo 100755).
//
// Bug real (29/10/2026, PR #320): o pre-push estava no git como 100644. No Windows
// o Git Bash não confere o bit e o hook rodava, então ninguém viu. Num clone Linux
// (WSL) o git avisou "hook was ignored because it's not set as executable" e o push
// saiu sem gate nenhum: check, lint, suíte e eng pulados, em silêncio. No macOS e no
// CI seria igual. O modo vale pelo que está no índice do git, não pelo arquivo na
// máquina de quem escreveu, por isso a pergunta é feita ao `git ls-files -s`.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { envGitLimpo } from './helpers/git-limpo.js';

const RAIZ = path.join(import.meta.dirname, '..');

// Ambiente limpo: dentro do pre-push o GIT_DIR herdado faria a consulta responder
// pelo repositório errado (ver test/helpers/git-limpo.js).
function modosDosHooks() {
  const r = spawnSync('git', ['ls-files', '-s', '--', 'tools/hooks'], { cwd: RAIZ, env: envGitLimpo(), encoding: 'utf8' });
  assert.equal(r.status, 0, `git ls-files falhou: ${r.stderr}`);
  return r.stdout.trim().split('\n').filter(Boolean).map((linha) => {
    const [meta, arquivo] = linha.split('\t');
    return { modo: meta.split(' ')[0], arquivo };
  });
}

test('todo hook de tools/hooks/ está versionado como executável', () => {
  const hooks = modosDosHooks();
  assert.ok(hooks.some((h) => h.arquivo === 'tools/hooks/pre-push'), 'o pre-push precisa estar versionado');
  const semBit = hooks.filter((h) => h.modo !== '100755').map((h) => `${h.arquivo} (${h.modo})`);
  assert.deepEqual(semBit, [], 'hook sem bit de execução é ignorado pelo git fora do Windows; corrija com git update-index --chmod=+x');
});
