// Instalação explícita do runtime privado, sem dependências no engine ou nos PRs.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TOOL_HOME, requireTool } from './runtime.js';
import { TOOL } from './verdict.js';
import { executadoDireto, IS_WIN } from '../paths.js';
import { TEMPOS } from '../constants.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { randomUUID } from 'node:crypto';
import { privateChild, removePrivateDirectory } from './cleanup.js';

function step(binary, args, cwd, shell = false) {
  const result = spawnSync(binary, args, { cwd, shell, env: envSemRepositorioHerdado(), stdio: 'inherit', windowsHide: true, timeout: TEMPOS.CONSTRUCAO_FERRAMENTA_MS });
  if (result.status !== 0) throw new Error('a instalação da ferramenta técnica não terminou');
}

async function setup(argv = process.argv.slice(2), { home = TOOL_HOME, run = step, verify = requireTool } = {}) {
  let valid = false;
  if (fs.existsSync(home)) {
    try { await verify(home); valid = true; } catch { valid = false; }
  }
  if (valid) return home;
  const parent = path.dirname(home);
  fs.mkdirSync(parent, { recursive: true });
  const index = argv.indexOf('--source');
  const source = index >= 0 ? argv[index + 1] : TOOL.origem;
  if (!source) throw new Error('origem da ferramenta ausente');
  const staging = fs.mkdtempSync(path.join(parent, '.install-'));
  try {
    // Sem shell para caminhos fornecidos por quem opera a instalação.
    run('git', ['clone', '--no-hardlinks', '--', source, staging], parent);
    run('git', ['-c', 'advice.detachedHead=false', 'checkout', '--detach', TOOL.commit], staging);
    for (const [binary, ...args] of TOOL.construcao) run(binary, args, staging, IS_WIN);
    fs.writeFileSync(path.join(staging, TOOL.buildStamp), TOOL.commit + '\n');
    await verify(staging);
    if (fs.existsSync(home)) {
      const previous = privateChild(home, parent, 'eng-behaviour@');
      const backup = privateChild(`${home}.incomplete-${randomUUID()}`, parent, 'eng-behaviour@');
      fs.renameSync(previous, backup); // Preserva uma instalação anterior que não validou.
    }
    fs.renameSync(privateChild(staging, parent, '.install-'), privateChild(home, parent, 'eng-behaviour@'));
    return await verify(home);
  } finally { removePrivateDirectory(staging, parent, '.install-'); }
}

if (executadoDireto(import.meta.url)) setup().then(home => process.stdout.write(`Ferramenta técnica instalada em ${home}\n`)).catch(error => {
  process.stderr.write(error.message + '\n');
  process.exitCode = 2;
});

export { setup };
