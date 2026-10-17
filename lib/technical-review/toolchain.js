// Identidade e disponibilidade do runtime privado fixado.
import fs from 'node:fs';
import path from 'node:path';
import { HOME } from '../paths.js';
import io from '../io.js';
import env from '../env.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { TOOL } from './verdict.js';

const TOOL_HOME = path.join(HOME, 'toolchains', `eng-behaviour@${TOOL.version}`);

async function requireTool(home = env.engBehaviourHome() || TOOL_HOME) {
  const pkg = io.lerJsonTeimoso(path.join(home, 'package.json'));
  if (!pkg.ok || pkg.data.version !== TOOL.version) throw new Error('ferramenta técnica fixada não instalada');
  const gitOptions = { cwd: home, env: envSemRepositorioHerdado() };
  const head = await io.run('git', ['rev-parse', 'HEAD'], gitOptions);
  const dirty = await io.run('git', ['status', '--porcelain', '--untracked-files=no'], gitOptions);
  const stamp = fs.readFileSync(path.join(home, TOOL.buildStamp), 'utf8').trim();
  if (!head.ok || head.stdout.trim() !== TOOL.commit || !dirty.ok || dirty.stdout.trim() || stamp !== TOOL.commit) throw new Error('identidade da ferramenta técnica não comprovada');
  return home;
}

export { TOOL_HOME, requireTool };
