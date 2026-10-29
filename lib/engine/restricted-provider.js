// Preparação por execução; a política e a associação existentes continuam no chamador.
import { restrictedLaunch } from './restricted-launch.js';
import { restrictedCodex } from './restricted-codex.js';
import { codexSelection } from '../codex/stream.js';
import { conferirCancelamento } from './cancelamento-revisao.js';

async function runPreparedProvider(engine, prompt, opts, auth, execute, modelFlags = '') {
  if (!opts.selfIsolation) return execute(engine, prompt, opts, auth);
  if (auth.kind === 'codex') {
    const restrictedCodexSpec = await restrictedCodex(opts, auth, engine.ghEnv(opts.account), codexSelection(engine.config, opts));
    conferirCancelamento(engine, opts.id);
    return execute(engine, prompt, { ...opts, restrictedCodex: restrictedCodexSpec }, auth);
  }
  const restricted = await restrictedLaunch(opts, auth, engine.ghEnv(opts.account), modelFlags);
  conferirCancelamento(engine, opts.id);
  return execute(engine, prompt, { ...opts, restricted }, auth);
}

export { runPreparedProvider };
