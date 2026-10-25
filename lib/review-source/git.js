// Objetos Git por autorização, refs por consumidor e worktrees descartáveis.
import fs from 'node:fs/promises';
import path from 'node:path';
import io from '../io.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { STATE_DIR } from '../paths.js';
import { SHA, check, aborted } from './contract.js';
import { contained, atomic } from './store.js';

const FLAGS = ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', '-c', 'fetch.fsckObjects=true'];
class GitSource {
  constructor(engine, store, lease, target, options = {}) {
    this.engine = engine; this.store = store; this.leaseId = lease; this.target = target;
    this.options = options; this.gitDir = path.join(store.root, 'repository.git');
  }
  async run(args, options = {}) {
    const signal = options.cleanup ? undefined : this.options.signal;
    aborted(signal);
    const auth = this.engine.ghEnv(this.store.scope.authAccount || this.store.scope.account);
    const env = { ...envSemRepositorioHerdado(), GH_TOKEN: auth.GH_TOKEN, GITHUB_TOKEN: auth.GITHUB_TOKEN, GIT_TERMINAL_PROMPT: '0' };
    const result = await io.run('git', [...FLAGS, '--git-dir', this.gitDir, ...args],
      { env, signal, timeout: this.store.limits.timeoutMs, maxBuffer: 32 * 1024 ** 2, ...options });
    aborted(signal);
    check(result.ok, 'Não foi possível preparar os objetos Git da fonte.');
    return result.stdout;
  }
  ref(side) { return `refs/farol/consumers/${this.leaseId}/${side}`; }
  async missingCommits(hashes) {
    const missing = [];
    for (const sha of hashes) {
      const value = await io.run('git', [...FLAGS, '--git-dir', this.gitDir, 'cat-file', '-e', `${sha}^{commit}`],
        { env: envSemRepositorioHerdado(), signal: this.options.signal });
      if (!value.ok) missing.push(sha);
    }
    return missing;
  }
  async prepare() {
    return this.store.transaction(async () => {
      await contained(this.store.base, this.gitDir);
      const existing = await this.store.usage();
      if (existing.bytes > this.store.limits.maxBytes) await this.evictInactive();
      try { await fs.access(path.join(this.gitDir, 'HEAD')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await this.run(['init', '--bare', this.gitDir]); }
      const hashes = [...new Set([this.target.head, this.target.base, this.target.mergeBase])];
      check(hashes.every(sha => SHA.test(sha)), 'Commits Git inválidos.');
      const missing = await this.missingCommits(hashes);
      if (missing.length) {
        const disk = await fs.statfs(this.store.root);
        check(Number(disk.bavail) * Number(disk.bsize) >= this.store.limits.reserveBytes, 'Reserva de disco insuficiente para aquisição Git.');
        await this.run(['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential',
          'fetch', '--no-tags', '--no-auto-maintenance', `https://${this.store.scope.host}/${this.store.scope.repo}.git`, ...missing]);
        this.store.metrics.acquisitions++;
      }
      for (const side of ['head', 'base', 'mergeBase']) await this.run(['update-ref', this.ref(side), this.target[side]]);
      await this.run(['fsck', '--full', '--no-reflogs']);
      const measured = (await this.run(['merge-base', this.target.base, this.target.head])).trim();
      check(measured === this.target.mergeBase, 'Merge-base Git diverge da fonte GitHub.');
      const usage = await this.measure();
      const total = await this.store.usage();
      if (total.bytes > this.store.limits.maxBytes) {
        await this.evictInactive();
        throw new Error('Objetos Git acima do limite; preparação adiada, consumidores ativos preservados.');
      }
      await this.store.markGitPrepared(this.leaseId);
    }, this.options.signal);
  }
  async evictInactive() {
    check((await this.store.gitConsumers(this.leaseId)).length === 0, 'Objetos Git ativos não podem ser removidos pelo limite.');
    const own = await this.store.lease(this.leaseId);
    check(!own?.gitPrepared, 'Consumidor atual já utiliza os objetos Git; cache preservado.');
    await contained(this.store.base, this.gitDir);
    await fs.rm(this.gitDir, { recursive: true, force: true });
    await atomic(path.join(this.store.root, 'git-usage.json'), { bytes: 0, materialBytes: 0, estimate: true, measuredAt: Date.now() });
  }
  async measure(cleanup = false) {
    const output = await this.run(['count-objects', '-v'], { cleanup });
    const metrics = Object.fromEntries(output.trim().split('\n').map(line => line.split(':').map(v => v.trim())));
    const bytes = (Number(metrics.size || 0) + Number(metrics['size-pack'] || 0)) * 1024;
    let materialBytes = 0;
    for (const name of await fs.readdir(path.join(this.store.root, 'leases'))) {
      const value = await this.store.lease(name.replace(/\.json$/, ''));
      if (value?.state !== 'released') materialBytes += value?.materialBytes || 0;
    }
    const value = { bytes, materialBytes, estimate: true, measuredAt: Date.now() };
    await atomic(path.join(this.store.root, 'git-usage.json'), value);
    return value;
  }
  async materialize(destination) {
    const resolved = path.resolve(destination);
    await contained(this.options.materialRoot || path.join(STATE_DIR, 'technical-review'), resolved);
    check(path.basename(resolved).startsWith('review-'), 'Material de revisão fora do formato esperado.');
    const stat = await fs.lstat(resolved);
    check(stat.isDirectory() && !stat.isSymbolicLink() && (await fs.readdir(resolved)).length === 0, 'Material de revisão deve ser diretório vazio sem links.');
    await this.store.attach(this.leaseId, resolved);
    await this.prepare();
    return this.store.transaction(async () => {
      const entries = await this.run(['ls-tree', '-r', '-l', this.target.head]);
      check(!/^(?:120000|160000) /m.test(entries), 'Links ou submódulos exigem materialização adicional isolada.');
      const materialBytes = entries.split('\n').reduce((total, row) => total + Number(/^\d+ \w+ [a-f0-9]+\s+(\d+)\t/.exec(row)?.[1] || 0), 0);
      const usage = await this.store.usage();
      check(usage.bytes + materialBytes <= this.store.limits.maxBytes, 'Materialização adiada pelo limite do cache.');
      await this.run(['worktree', 'add', '--detach', resolved, this.target.head]);
      await this.run(['worktree', 'lock', resolved]);
      await this.store.recordMaterial(this.leaseId, materialBytes);
      await this.measure(true);
      return resolved;
    }, this.options.signal);
  }
  async release(destination) {
    return this.store.transaction(async () => {
      try { await fs.access(path.join(this.gitDir, 'HEAD')); }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      if (destination) await this.removeWorktreeRegistration(destination);
      for (const side of ['head', 'base', 'mergeBase']) await this.run(['update-ref', '-d', this.ref(side)], { cleanup: true });
      await this.measure(true);
    });
  }
  async removeWorktreeRegistration(destination) {
    const worktrees = await this.run(['worktree', 'list', '--porcelain', '-z'], { cleanup: true });
    const registered = worktrees.split('\0').filter(line => line.startsWith('worktree '))
      .some(line => path.resolve(line.slice(9)) === path.resolve(destination));
    if (!registered) return;
    await this.run(['worktree', 'unlock', destination], { cleanup: true });
    await this.run(['worktree', 'remove', '--force', destination], { cleanup: true });
  }
}
export { GitSource };
