// Spawn compartilhado, com argumentos fechados para a execução restrita.
import cp from 'node:child_process';
import { IS_WIN, WORKSPACE } from '../paths.js';
import { claudeAuthPosixPrefix } from '../parse.js';

function spawnClaudeChild(opts, cmdline, env, auth) {
  if (opts.restricted) return cp.spawn(opts.restricted.command, opts.restricted.args, {
    cwd: opts.restricted.cwd, env: opts.restricted.env, stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true, detached: !IS_WIN
  });
  if (IS_WIN) return cp.spawn('cmd.exe', ['/d', '/s', '/c', `"${cmdline}"`], {
    cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, windowsVerbatimArguments: true
  });
  // O shell de login pode repor credenciais: o prefixo restaura o perfil após o sourcing.
  return cp.spawn('/bin/sh', ['-lc', claudeAuthPosixPrefix(auth) + cmdline], {
    cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true
  });
}

export { spawnClaudeChild };
