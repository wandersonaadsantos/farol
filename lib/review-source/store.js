// Cache privado limitado, com contabilidade incremental e consumidores duráveis.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { HOME } from '../paths.js';
import { parseJson, safeStringify } from '../io.js';
import { digest, check, aborted, limitsFor } from './contract.js';

const VERSION = 1;
const INSTANCE = randomUUID();
const serial = new Map();
async function contained(root, target) {
  const resolved = path.resolve(target), base = path.resolve(root);
  check(resolved === base || resolved.startsWith(base + path.sep), 'Cache fora da raiz privada.');
  const relative = path.relative(base, resolved).split(path.sep).filter(Boolean);
  let current = base;
  for (const part of ['', ...relative]) {
    if (part) current = path.join(current, part);
    try { check(!(await fs.lstat(current)).isSymbolicLink(), 'Cache com link externo foi preservado.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}
async function read(file) {
  try { const value = parseJson(await fs.readFile(file, 'utf8')); check(value && typeof value === 'object', 'Arquivo do cache corrompido; dados preservados.'); return value; }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function atomic(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const handle = await fs.open(tmp, 'wx', 0o600);
  try { await handle.writeFile(safeStringify(value)); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(tmp, file);
}
async function withinQueue(key, work) {
  const previous = serial.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  serial.set(key, next);
  try { return await next; } finally { if (serial.get(key) === next) serial.delete(key); }
}
class SourceStore {
  constructor(scope, options = {}) {
    this.scope = scope;
    this.limits = limitsFor(options.limits);
    this.base = options.root || path.join(HOME, 'source-cache');
    this.root = path.join(this.base, digest([scope.host, scope.account, scope.repositoryId, scope.repo]));
    this.metrics = { cacheHits: 0, acquisitions: 0, bytesWritten: 0 };
  }
  async initialize() {
    await contained(this.base, this.root);
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    await contained(this.base, this.root);
    for (const name of ['objects', 'leases']) await fs.mkdir(path.join(this.root, name), { recursive: true, mode: 0o700 });
    return this;
  }
  async transaction(work, signal) {
    return withinQueue(this.root, async () => {
      aborted(signal);
      const file = path.join(this.root, 'writer.lock');
      await contained(this.base, file);
      let lock;
      try { lock = await fs.open(file, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('Cache ocupado ou com escritor interrompido; preparação adiada com segurança.'); throw error; }
      const owner = { schema: VERSION, instance: INSTANCE, pid: process.pid };
      try {
        await lock.writeFile(safeStringify(owner));
        return await work();
      } finally { await lock.close(); await fs.unlink(file); }
    });
  }
  async catalogue() {
    const value = await read(path.join(this.root, 'catalogue.json'));
    if (!value) return { schema: VERSION, bytes: 0, entries: {} };
    check(value.schema === VERSION && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && value.entries && typeof value.entries === 'object', 'Contabilidade do cache indisponível.');
    return value;
  }
  objectPath(key) { return path.join(this.root, 'objects', digest(key) + '.json'); }
  async get(key, lease) {
    if (lease) return this.transaction(async () => { const data = await this.get(key); if (data) await this.pin(lease, digest(key)); return data; });
    const file = this.objectPath(key);
    await contained(this.base, file);
    const value = await read(file);
    if (!value || value.schema !== VERSION || value.key !== key || digest(value.data) !== value.digest) return null;
    this.metrics.cacheHits++;
    return value.data;
  }
  async put(key, data, lease, signal) {
    return this.transaction(async () => {
      const catalogue = await this.catalogue(), file = this.objectPath(key), id = digest(key);
      const envelope = { schema: VERSION, key, data, digest: digest(data) };
      const bytes = Buffer.byteLength(safeStringify(envelope));
      const needed = Math.max(0, bytes - (catalogue.entries[id]?.bytes || 0));
      await this.makeRoom(catalogue, needed);
      const stat = await fs.statfs(this.root);
      check(Number(stat.bavail) * Number(stat.bsize) - needed >= this.limits.reserveBytes, 'Reserva de disco insuficiente; preparação adiada.');
      catalogue.bytes += bytes - (catalogue.entries[id]?.bytes || 0);
      catalogue.entries[id] = { key, bytes, at: Date.now(), pending: true };
      // Reserva durável antes do conteúdo: interrupção pode supercontar, nunca ocultar bytes.
      await atomic(path.join(this.root, 'catalogue.json'), catalogue);
      await atomic(file, envelope);
      catalogue.entries[id].pending = false;
      await atomic(path.join(this.root, 'catalogue.json'), catalogue);
      this.metrics.bytesWritten += bytes;
      if (lease) await this.pin(lease, id);
    }, signal);
  }
  async makeRoom(catalogue, needed) {
    const git = await read(path.join(this.root, 'git-usage.json'));
    const otherBytes = (git?.bytes || 0) + (git?.materialBytes || 0) + await this.metadataBytes();
    const active = new Set();
    for (const name of await fs.readdir(path.join(this.root, 'leases'))) {
      const lease = await read(path.join(this.root, 'leases', name));
      check(lease?.schema === VERSION && Array.isArray(lease.objects), 'Consumidor do cache não verificável.');
      if (lease.state !== 'released' && lease.scopePinned) for (const id of Object.keys(catalogue.entries)) active.add(id);
      if (lease.state !== 'released') for (const id of lease.objects) active.add(id);
    }
    const entries = Object.entries(catalogue.entries).sort((a, b) => a[1].at - b[1].at);
    for (const [id, entry] of entries) {
      if (catalogue.bytes + otherBytes + needed <= this.limits.maxBytes) break;
      if (active.has(id)) continue;
      const file = this.objectPath(entry.key);
      await contained(this.base, file);
      await fs.rm(file, { force: true });
      catalogue.bytes -= entry.bytes;
      delete catalogue.entries[id];
      await atomic(path.join(this.root, 'catalogue.json'), catalogue);
    }
    check(catalogue.bytes + otherBytes + needed <= this.limits.maxBytes, 'Cache sem espaço recuperável; materiais ativos foram preservados.');
  }
  async acquire(target) {
    return this.transaction(async () => {
      await this.pruneReleased();
      const id = randomUUID();
      const value = { schema: VERSION, id, instance: INSTANCE, pid: process.pid, target,
        state: 'active', objects: [], createdAt: Date.now() };
      await atomic(path.join(this.root, 'leases', id + '.json'), value);
      return id;
    });
  }
  async pin(lease, id) {
    const file = path.join(this.root, 'leases', lease + '.json'), value = await read(file);
    check(value?.state === 'active' && value.instance === INSTANCE, 'Consumidor do cache não está ativo.');
    // Um consumidor vivo protege o escopo inteiro. Evita regravar uma lista crescente por blob.
    if (!value.scopePinned) await atomic(file, { ...value, scopePinned: true, objects: [id] });
  }
  async pruneReleased() {
    const released = [];
    for (const name of await fs.readdir(path.join(this.root, 'leases'))) {
      const value = await read(path.join(this.root, 'leases', name));
      check(value?.schema === VERSION, 'Consumidor do cache não verificável.');
      if (value.state === 'released') released.push({ name, at: value.releasedAt || 0 });
    }
    released.sort((a, b) => b.at - a.at);
    for (const value of released.slice(this.limits.maxReleasedLeases)) await fs.unlink(path.join(this.root, 'leases', value.name));
  }
  async release(lease) {
    return this.transaction(async () => {
      const file = path.join(this.root, 'leases', lease + '.json'), value = await read(file);
      if (!value || value.state === 'released') return;
      check(value.instance === INSTANCE, 'Consumidor pertence a outra instância.');
      await atomic(file, { ...value, state: 'released', releasedAt: Date.now() });
    });
  }
  async touch(key, lease) { return this.transaction(() => this.pin(lease, digest(key))); }
  async attach(lease, destination) {
    return this.transaction(async () => {
      const file = path.join(this.root, 'leases', lease + '.json'), value = await read(file);
      check(value?.state === 'active' && value.instance === INSTANCE, 'Consumidor do material inválido.');
      check(!value.destination || value.destination === destination, 'Consumidor já materializado em outro destino.');
      await atomic(file, { ...value, destination });
    });
  }
  async releaseAfterRemoval(lease, destination) {
    return this.transaction(async () => {
      const file = path.join(this.root, 'leases', lease + '.json'), value = await read(file);
      if (!value) return;
      check(!value.destination || value.destination === destination, 'Material não pertence ao consumidor informado.');
      if (value.state === 'released') return;
      try { await fs.lstat(destination); throw new Error('Material ainda existe; cache preservado.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      await atomic(file, { ...value, state: 'released', releasedAt: Date.now() });
    });
  }
  async lease(lease) { return read(path.join(this.root, 'leases', lease + '.json')); }
  async recordMaterial(lease, bytes) {
    const file = path.join(this.root, 'leases', lease + '.json'), value = await read(file);
    check(value?.state === 'active' && Number.isSafeInteger(bytes) && bytes >= 0, 'Tamanho de material inválido.');
    await atomic(file, { ...value, materialBytes: bytes });
  }
  async markGitPrepared(lease) {
    const file = path.join(this.root, 'leases', lease + '.json'), value = await read(file);
    check(value?.state === 'active', 'Consumidor Git não está ativo.');
    await atomic(file, { ...value, gitPrepared: true });
  }
  async gitConsumers(exceptLease) {
    const result = [];
    for (const name of await fs.readdir(path.join(this.root, 'leases'))) {
      const value = await read(path.join(this.root, 'leases', name));
      check(value?.schema === VERSION, 'Consumidor Git não verificável.');
      if (value.id !== exceptLease && value.state !== 'released' && value.gitPrepared) result.push(value.id);
    }
    return result;
  }
  async metadataBytes() {
    const direct = (await fs.readdir(this.root, { withFileTypes: true })).filter(e => e.isFile()).map(e => path.join(this.root, e.name));
    const leases = (await fs.readdir(path.join(this.root, 'leases'))).map(name => path.join(this.root, 'leases', name));
    let bytes = 0;
    for (const file of [...direct, ...leases]) {
      await contained(this.base, file);
      try { bytes += (await fs.stat(file)).size; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return bytes;
  }
  async usage() {
    const value = await this.catalogue(), git = await read(path.join(this.root, 'git-usage.json'));
    const gitBytes = git?.bytes || 0, materialBytes = git?.materialBytes || 0;
    const metadataBytes = await this.metadataBytes();
    return { bytes: value.bytes + gitBytes + materialBytes + metadataBytes, objectCacheBytes: value.bytes, gitBytes, materialBytes, metadataBytes,
      gitSizeEstimated: git?.estimate === true, maxBytes: this.limits.maxBytes, reserveBytes: this.limits.reserveBytes, ...this.metrics };
  }
}
export { SourceStore, contained, withinQueue, atomic };
