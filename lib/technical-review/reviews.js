// Snapshot privado das objeções: mudanças durante a revisão invalidam a decisão.
import { createHash } from 'node:crypto';
import io from '../io.js';

async function readList(engine, pr, suffix) {
  const response = await io.run('gh', ['api', `repos/${pr.repo}/pulls/${pr.number}/${suffix}`, '--paginate', '--slurp'], {
    env: engine.ghEnv(engine.accountForPr(pr)),
  });
  const pages = response.ok && io.parseJson(response.stdout);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error('histórico de objeções não conferido');
  return pages.flat().filter(r => r.user)
    .map(r => ({ id: r.id, author: r.user.login, state: r.state || '', head: r.commit_id || '',
      body: r.body || '', file: r.path || '', line: r.line || r.original_line || null }))
    .sort((a, b) => a.id - b.id);
}

async function reviewSnapshot(engine, pr) {
  const [reviews, comments] = await Promise.all([readList(engine, pr, 'reviews'), readList(engine, pr, 'comments')]);
  const data = { reviews, comments };
  return { ...data, fingerprint: createHash('sha256').update(io.safeStringify(data)).digest('hex') };
}

export { reviewSnapshot };
