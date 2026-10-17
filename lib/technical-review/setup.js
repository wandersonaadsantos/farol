// Instalação explícita do runtime privado, sem dependências no engine ou nos PRs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TOOL_HOME, requireTool } from './runtime.js';
import { TOOL } from './verdict.js';
import { executadoDireto, IS_WIN } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { envSemRepositorioHerdado } from '../git-env.js';

function step(binary, args, cwd, shell = false) {
  const result = spawnSync(binary, args, { cwd, shell, env: envSemRepositorioHerdado(), stdio: 'inherit', windowsHide: true, timeout: TEMPOS.CONSTRUCAO_FERRAMENTA_MS });
  if (result.status !== 0) throw new Error('a instalação da ferramenta técnica não terminou');
}

async function setup(argv = process.argv.slice(2)) {
  if (fs.existsSync(TOOL_HOME)) return requireTool(TOOL_HOME);
  fs.mkdirSync(path.dirname(TOOL_HOME), { recursive: true });
  const index = argv.indexOf('--source');
  const source = index >= 0 ? argv[index + 1] : TOOL.origem;
  if (!source) throw new Error('origem da ferramenta ausente');
  // Sem shell para caminhos fornecidos por quem opera a instalação.
  step('git', ['clone', '--no-hardlinks', '--', source, TOOL_HOME], path.dirname(TOOL_HOME));
  step('git', ['-c', 'advice.detachedHead=false', 'checkout', '--detach', TOOL.commit], TOOL_HOME);
  for (const [binary, ...args] of TOOL.construcao) step(binary, args, TOOL_HOME, IS_WIN);
  fs.writeFileSync(path.join(TOOL_HOME, TOOL.buildStamp), TOOL.commit + '\n');
  return requireTool(TOOL_HOME);
}

if (executadoDireto(import.meta.url)) setup().then(home => process.stdout.write(`Ferramenta técnica instalada em ${home}\n`)).catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 2;
});

export { setup };
