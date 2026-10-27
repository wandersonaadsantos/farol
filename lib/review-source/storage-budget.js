// Admissões interprocessos e reservas duráveis para o conjunto de escopos.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { check, aborted, limitsFor } from './contract.js';
import { atomic, contained, read, withinQueue } from './files.js';
import { storageInventory } from './storage-inventory.js';
import { STATE_DIR } from '../paths.js';
import { reclaimInactiveObjects } from './storage-reclaim.js';
import { recoverInterruptedSources, interruptedProof } from './recovery.js';

class StorageBudget {
  constructor(base, root, limits, options = {}) {
    this.base = base; this.scope = path.basename(root); this.limits = limitsFor(limits);
    this.materialRoot = options.materialRoot || path.join(STATE_DIR, 'technical-review');
    this.diskFree = options.diskFree || (async root => { const disk = await fs.statfs(root); return Number(disk.bavail) * Number(disk.bsize); });
    this.file = path.join(base, 'storage-budget.json');
  }
  async transaction(work) {
    return withinQueue(this.base + ':budget', async () => {
      await contained(this.base, this.file);
      const file = path.join(this.base, 'storage-budget.lock');
      let lock;
      try { lock = await fs.open(file, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') throw new Error('Quota global ocupada ou interrompida; aquisição adiada.'); throw error; }
      try { return await work(); }
      finally { await lock.close(); await fs.unlink(file); }
    });
  }
  async state() {
    const state = await read(this.file) || { schema: 1, reservations: {} };
    check(state.schema === 1 && state.reservations && typeof state.reservations === 'object', 'Quota global corrompida; materiais preservados.');
    return state;
  }
  async inventory() {
    const result = await this.scan(), state = await this.state();
    return { ...result, reservedBytes: this.remaining(state, result), reservations: Object.keys(state.reservations).length,
      observedLegacy: result.legacy, globalMaxBytes: this.limits.globalMaxBytes,
      globalReserveBytes: this.limits.globalReserveBytes };
  }
  async recover() {
    const proof = await interruptedProof(this.base, this.materialRoot);
    return this.transaction(async () => recoverInterruptedSources(this.base, this.materialRoot, await this.state(), proof));
  }
  async scan() { return storageInventory(this.base, this.materialRoot); }
  remaining(state, inventory, scope) {
    const credited = new Map();
    const ordered = Object.values(state.reservations).sort((a, b) => a.baselineBytes - b.baselineBytes);
    return ordered.reduce((total, reservation) => {
      if (scope && reservation.scope !== scope) return total;
      const previous = credited.get(reservation.scope) || 0;
      const growth = Math.max(0, (inventory.scopes[reservation.scope]?.bytes || 0) - reservation.baselineBytes - previous);
      const credit = Math.min(reservation.bytes, growth);
      credited.set(reservation.scope, previous + credit);
      return total + reservation.bytes - credit;
    }, 0);
  }
  async verify(state, inventory) {
    check(!Object.values(state.reservations).some(value => value.terminationUnconfirmed)
      && !Object.values(inventory.scopes).some(value => value.terminationUnconfirmed), 'Término de aquisição anterior não confirmado; nova aquisição adiada.');
    const remaining = this.remaining(state, inventory);
    check(inventory.managedBytes + remaining <= this.limits.globalMaxBytes, 'Quota global sem espaço recuperável; aquisição adiada, materiais preservados.');
    const scope = inventory.scopes[this.scope]?.bytes || 0;
    check(scope + this.remaining(state, inventory, this.scope) <= this.limits.maxBytes, 'Quota do escopo insuficiente; consumidores ativos preservados.');
    const floor = Math.max(this.limits.reserveBytes, this.limits.globalReserveBytes);
    await this.verifyDisk(remaining, floor);
  }
  async verifyDisk(remaining, floor) {
    for (const root of new Set([this.base, this.materialRoot])) {
      let free;
      try { free = await this.diskFree(root); }
      catch (error) { if (error.code === 'ENOENT' && root !== this.base) continue; throw error; }
      check(free - remaining >= floor, 'Reserva global de disco insuficiente; aquisição adiada.');
    }
  }
  async admit(state, inventory) {
    check(!Object.values(inventory.scopes).some(value => value.pendingGitProcess), 'Término de processo Git anterior não confirmado; nova aquisição adiada.');
    try { await this.verify(state, inventory); }
    catch (error) {
      if (!/Quota global|Reserva global/.test(error.message)) throw error;
      await reclaimInactiveObjects(this.base, inventory.scopes);
      await this.verify(state, await this.scan());
    }
  }
  async reserve(kind, bytes, signal) {
    aborted(signal);
    check(Number.isSafeInteger(bytes) && bytes >= 0, 'Reserva de aquisição inválida.');
    const proof = await interruptedProof(this.base, this.materialRoot);
    return this.transaction(async () => {
      aborted(signal);
      const state = await this.state();
      await recoverInterruptedSources(this.base, this.materialRoot, state, proof);
      const inventory = await this.scan(), id = randomUUID();
      state.reservations[id] = { scope: this.scope, kind, bytes, baselineBytes: inventory.scopes[this.scope]?.bytes || 0, createdAt: Date.now() };
      await this.admit(state, inventory);
      await atomic(this.file, state);
      return id;
    });
  }
  async sample(id, extend = true) {
    return this.transaction(async () => {
      const state = await this.state(), reservation = state.reservations[id];
      check(reservation?.scope === this.scope, 'Reserva global não verificável.');
      const inventory = await this.scan();
      const growth = Math.max(0, (inventory.scopes[this.scope]?.bytes || 0) - reservation.baselineBytes);
      if (extend && growth >= reservation.bytes) {
        // O conteúdo do objeto já tem tamanho conhecido. A folga em blocos
        // pertence às aquisições de crescimento desconhecido, como Git.
        const headroom = reservation.kind === 'object-cache' ? 0 : this.limits.acquisitionReserveBytes;
        reservation.bytes = growth + headroom;
      }
      await this.verify(state, inventory);
      state.lastInventory = inventory; state.measuredAt = Date.now();
      await atomic(this.file, state);
      return inventory;
    });
  }
  async finish(id, failed) {
    return this.transaction(async () => {
      const state = await this.state();
      state.lastInventory = await this.scan();
      state.measuredAt = Date.now();
      if (failed) state.lastInterrupted = { scope: this.scope, at: Date.now(), reason: 'operation-interrupted-partials-counted' };
      if (failed?.sourceTerminationUnconfirmed) state.reservations[id].terminationUnconfirmed = true;
      else delete state.reservations[id];
      await atomic(this.file, state);
    });
  }
  async run(kind, bytes, signal, work) {
    const id = await this.reserve(kind, bytes, signal), controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let failure, sampling = Promise.resolve(), checking = false;
    const sample = () => {
      if (checking || failure) return;
      checking = true;
      sampling = this.sample(id).catch(error => { failure ||= error; controller.abort(); }).finally(() => { checking = false; });
    };
    const timer = setInterval(sample, this.limits.monitorIntervalMs);
    let result;
    try { result = await work(combined); await sampling; if (failure) throw failure; aborted(combined); await this.sample(id, false); }
    catch (error) { if (error.sourceTerminationUnconfirmed) failure = error; else failure ||= error; throw failure; }
    finally { clearInterval(timer); await sampling; await this.finish(id, failure); }
    return result;
  }
}
export { StorageBudget };
