// Resolve e materializa somente a base e o head confirmados do PR.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { TEMPOS } from '../constants.js';
import { cleanup, criarMaterial } from './cleanup.js';
const SHA = /^[a-f0-9]{40}$/;

async function command(cmd, args, options) {
  const r = await io.run(cmd, args, { timeout: TEMPOS.CONSTRUCAO_FERRAMENTA_MS, ...options });
  if (!r.ok) throw new Error('não foi possível preparar o material da revisão técnica');
  return r.stdout;
}

async function targetFor(engine, pr, expectedHead) {
  const raw = await command('gh', ['pr', 'view', pr.url || `${pr.repo}#${pr.number}`, '--json', 'headRefOid,baseRefOid,url,number,state'], { env: engine.ghEnv(engine.accountForPr(pr)) });
  const target = io.parseJson(raw);
  const expectedUrl = `https://github.com/${pr.repo}/pull/${pr.number}`;
  if (String(target?.url || '').toLowerCase() !== expectedUrl.toLowerCase() || target.number !== pr.number || target.state !== 'OPEN') throw new Error('identidade ou estado do PR não confirmados');
  if (!SHA.test(target?.headRefOid || '') || !SHA.test(target?.baseRefOid || '') || target.headRefOid !== expectedHead) throw new Error('base e commit da revisão técnica não confirmados');
  return { base: target.baseRefOid, head: target.headRefOid };
}

async function snapshotFor(engine, pr, target) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(pr.repo || '')) throw new Error('repositório inválido');
  const root = path.join(STATE_DIR, 'technical-review');
  io.ensureDir(root);
  const snapshot = criarMaterial(root);
  try {
    const credentials = engine.ghEnv(engine.accountForPr(pr));
    const gitEnv = { ...envSemRepositorioHerdado(), GH_TOKEN: credentials.GH_TOKEN, GIT_TERMINAL_PROMPT: '0' };
    const options = { cwd: snapshot, env: gitEnv };
    await command('git', ['init', '--quiet'], options);
    await command('git', ['remote', 'add', 'origin', `https://github.com/${pr.repo}.git`], options);
    await command('git', ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', 'fetch', '--no-tags', 'origin', target.base, target.head], options);
    await command('git', ['-c', 'core.hooksPath=', '-c', 'advice.detachedHead=false', 'checkout', '--detach', target.head], options);
    const entries = await command('git', ['ls-files', '--stage'], options);
    if (/^(?:120000|160000) /m.test(entries)) throw new Error('material com links ou submódulos exige preparação isolada adicional');
    return snapshot;
  } catch (error) { cleanup({ snapshot }); throw error; }
}

export { targetFor, snapshotFor };
