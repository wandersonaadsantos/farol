// Resolve e materializa somente a base e o head confirmados do PR.
import path from 'node:path';
import { STATE_DIR } from '../paths.js';
import io from '../io.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { TEMPOS } from '../constants.js';
import { cleanup, criarMaterial, prepareRecord, ready, afterRemoval } from './cleanup.js';
import { readRecord, updateRecord } from './material-record.js';
import { prepareSources, releaseMaterialReference } from '../review-source/index.js';
import { SHA } from '../review-source/contract.js';

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

async function snapshotFor(engine, pr, target, options = {}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(pr.repo || '')) throw new Error('repositório inválido');
  const root = path.join(STATE_DIR, 'technical-review');
  io.ensureDir(root);
  const snapshot = criarMaterial(root, { repo: pr.repo, prKey: `${pr.repo}#${pr.number}`, account: engine.accountForPr(pr), ...target, sessionId: options.sessionId });
  if (readRecord(snapshot)?.state === 'in-use') return snapshot;
  try {
    await prepareRecord(snapshot);
    const sources = await acquireSources(engine, pr, target, options);
    updateRecord(snapshot, r => ({ ...r, sourceReference: sources.reference,
      context: { ...r.context, mergeBase: sources.manifest.M || null } }));
    afterRemoval(snapshot, async () => {
      await sources.release();
      await releaseMaterialReference(sources.reference, snapshot);
    });
    await sources.materialize(snapshot);
    const entries = await command('git', ['ls-files', '--stage'], { cwd: snapshot, env: envSemRepositorioHerdado() });
    if (/^(?:120000|160000) /m.test(entries)) throw new Error('material com links ou submódulos exige preparação isolada adicional');
    ready(snapshot);
    return snapshot;
  } catch (error) { await cleanup({ snapshot }); throw error; }
}
async function acquireSources(engine, pr, target, options) {
  let sources;
  if (options.sources) {
    if (options.sources.status !== 'complete' || !options.sources.retain) throw new Error('não foi possível preparar fontes verificáveis da revisão técnica');
    sources = await options.sources.retain();
  } else sources = await prepareSources(engine, pr, { expectedHead: target.head, expectedBase: target.base, signal: options.signal });
  const scope = sources.manifest?.scope;
  const sameScope = scope?.repo === pr.repo.toLowerCase() && scope?.account === engine.accountForPr(pr).toLowerCase();
  if (sources.status !== 'complete' || !sameScope || sources.manifest.H !== target.head || sources.manifest.B !== target.base) {
    await sources.release();
    throw new Error('não foi possível preparar o material da revisão técnica');
  }
  return sources;
}

export { targetFor, snapshotFor };
