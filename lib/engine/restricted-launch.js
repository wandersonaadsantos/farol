// O launcher é fechado: sem shell, shim, ferramenta de comando ou fallback de provedor.
import fs from 'node:fs';
import path from 'node:path';
import io from '../io.js';
import { IS_WIN } from '../paths.js';
import { applyClaudeAuthEnv } from '../parse.js';
import { assertSelfIsolation } from './self-isolation.js';

function restrictedEnvironment(inherited, auth, root) {
  const clean = {};
  const allowed = new Set(['path', 'home', 'userprofile', 'systemroot', 'windir', 'comspec', 'pathext',
    'lang', 'lc_all', 'term', 'appdata', 'localappdata']);
  for (const [key, value] of Object.entries(inherited)) if (allowed.has(key.toLowerCase())) clean[key] = value;
  applyClaudeAuthEnv(clean, auth);
  clean.TEMP = path.join(root, 'runtime'); clean.TMP = clean.TEMP; clean.TMPDIR = clean.TEMP;
  return clean;
}

function restrictedExecutable(environment, binary = 'claude') {
  const search = environment.PATH || environment.Path || environment.path || '';
  for (const directory of search.split(path.delimiter).filter(Boolean)) {
    let candidates = [binary];
    if (IS_WIN) candidates = binary === 'codex' ? ['codex.exe'] : ['claude.exe', 'node_modules/@anthropic-ai/claude-code/bin/claude.exe'];
    for (const relative of candidates) {
      const file = path.resolve(directory, relative);
      try { if (fs.statSync(file).isFile()) return fs.realpathSync(file); }
      catch (error) { if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error; }
    }
  }
  throw new Error('Executável nativo do Claude indisponível para execução restrita.');
}

function assertRestrictedTools(event) {
  if (!Array.isArray(event.tools) || event.tools.length !== 3
    || !['Read', 'Grep', 'Glob'].every(name => event.tools.includes(name))) {
    throw new Error('Ferramentas efetivas divergem do contrato restrito.');
  }
}

function acceptRestrictedInit(engine, child, finish, event) {
  try { assertRestrictedTools(event); return true; }
  catch (error) { rejectRestrictedStream(engine, child, finish, error); return false; }
}

function rejectRestrictedStream(engine, child, finish, error) {
  try { engine.killTree(child.pid); }
  catch { /* Material exclusivo preservado; falha ao interromper nunca autoriza resultado. */ }
  finish(error);
}

function restrictedStreamEvent(engine, child, finish, event, state) {
  if (event.type === 'system' && event.subtype === 'init') {
    state.ready = acceptRestrictedInit(engine, child, finish, event);
    return state.ready;
  }
  if (!state.ready && ['assistant', 'user', 'result'].includes(event.type)) {
    rejectRestrictedStream(engine, child, finish, new Error('Evento de modelo sem inicialização restrita comprovada.'));
    return false;
  }
  return true;
}

async function restrictedLaunch(opts, auth, inherited, modelFlags = '') {
  assertSelfIsolation(opts.selfIsolation);
  if (opts.operationKind !== 'self' || auth.kind !== 'dir' || !auth.dir || opts.extraArgs?.length) {
    throw new Error('Execução restrita exige autoanálise e perfil de assinatura, sem argumentos adicionais.');
  }
  const cwd = opts.selfIsolation.root;
  const env = restrictedEnvironment(inherited, auth, cwd);
  const command = restrictedExecutable(env);
  const help = await io.run(command, ['--help'], { env, cwd });
  if (!help.ok || !['--restricted', '--permission-prompts', '--no-session-persistence'].every(flag => help.stdout.includes(flag))) {
    throw new Error('Claude sem contrato restrito compatível; nenhum fallback foi iniciado.');
  }
  return { command, cwd, env, args: ['-p', '--output-format', 'stream-json', '--verbose',
    '--restricted', '--tools', 'Read,Grep,Glob', '--safe-mode', '--strict-mcp-config',
    '--mcp-config', path.join(cwd, 'mcp.json'), '--disable-slash-commands', '--no-session-persistence',
    '--permission-mode', 'dontAsk', '--permission-prompts', 'none', ...modelFlags.trim().split(/\s+/).filter(Boolean)] };
}

export { restrictedEnvironment, restrictedExecutable, restrictedLaunch, assertRestrictedTools, restrictedStreamEvent };
