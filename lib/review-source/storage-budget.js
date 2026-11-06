// Admissões interprocessos e reservas duráveis para o conjunto de escopos.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { check, aborted, limitsFor } from './contract.js';
import { atomic, contained, read, withinQueue } from './files.js';
import { storageInventory, scopeInventory } from './storage-inventory.js';
import { STATE_DIR } from '../paths.js';
import { reclaimInactiveObjects, reclaimScopeGit, scopesWithIdleGit } from './storage-reclaim.js';
import { withLock } from './lock-file.js';
import { INSTANCE } from './instance.js';
import { STARTED_AT } from './process-owner.js';

// Dono gravado em cada reserva: a recuperação sem marcador prova o fim dele (recovery-orphans.js).
const DONO = Object.freeze({ instance: INSTANCE, pid: process.pid, startedAt: STARTED_AT });
import { recoverInterruptedSources, interruptedProof } from './recovery.js';

const SEM_ESPACO = /Quota global|Reserva global/;
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
      return withLock(path.join(this.base, 'storage-budget.lock'),
        () => { throw new Error('Quota global ocupada ou interrompida; aquisição adiada.'); }, work);
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
  async scanScope() { return scopeInventory(path.join(this.base, this.scope)); }
  // Inventário completo com o próprio escopo trocado pela medida fresca. Só os escritores deste escopo,
  // presos ao writer.lock que a aquisição segura, mudam os bytes que a reserva acompanha; os outros escopos
  // são atualizados pelas próprias amostras e por toda reserva e finalização, que medem tudo. Sem um
  // inventário anterior legível, devolve null e quem chama mede tudo: nunca admissão otimista.
  composeInventory(state, scope) {
    const last = state.lastInventory;
    const numeros = ['controlBytes', 'unclassifiedBytes', 'unregisteredManagedBytes', 'externalManagedMetadataBytes'];
    if (!last || typeof last !== 'object' || !last.scopes || typeof last.scopes !== 'object' || Array.isArray(last.scopes)
      || !numeros.every(key => Number.isSafeInteger(last[key]) && last[key] >= 0)
      || !Object.values(last.scopes).every(value => Number.isSafeInteger(value?.bytes) && value.bytes >= 0)) return null;
    const scopes = { ...last.scopes, [this.scope]: scope };
    const managedBytes = Object.values(scopes).reduce((total, value) => total + value.bytes, numeros.reduce((total, key) => total + last[key], 0));
    return { ...last, scopes, managedBytes };
  }
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
  // Escopos com Git sem término confirmado. O próprio escopo segue adiado; os outros entram na conta
  // pelo que ainda falta para chegarem ao teto de escopo, porque o órfão pode continuar gravando.
  unconfirmedScopes(state, inventory) {
    const scopes = new Set(Object.values(state.reservations).filter(value => value.terminationUnconfirmed).map(value => value.scope));
    // Término não confirmado, ou Git pendente de outro processo (o Farol pode ter morrido no meio do fetch,
    // sem marcador). O Git em curso deste processo segue coberto pela própria reserva, que o monitor estende.
    for (const [scope, value] of Object.entries(inventory.scopes)) if (value.terminationUnconfirmed || value.foreignGitProcess) scopes.add(scope);
    return scopes;
  }
  async verify(state, inventory, discoLiberavel = 0) {
    const unconfirmed = this.unconfirmedScopes(state, inventory);
    check(!unconfirmed.has(this.scope), 'Término de aquisição anterior não confirmado; nova aquisição adiada.');
    let cushion = 0;
    for (const scope of unconfirmed) cushion += Math.max(0, this.limits.maxBytes - (inventory.scopes[scope]?.bytes || 0));
    const remaining = this.remaining(state, inventory) + cushion;
    check(inventory.managedBytes + remaining <= this.limits.globalMaxBytes, 'Quota global sem espaço recuperável; aquisição adiada, materiais preservados.');
    const scope = inventory.scopes[this.scope]?.bytes || 0;
    // A compactação é o que devolve espaço ao escopo no limite: o teto dela é o global, verificado acima.
    const compactando = Object.values(state.reservations).some(value => value.scope === this.scope && value.kind === 'git-compaction');
    check(compactando || scope + this.remaining(state, inventory, this.scope) <= this.limits.maxBytes, 'Quota do escopo insuficiente; consumidores ativos preservados.');
    const floor = Math.max(this.limits.reserveBytes, this.limits.globalReserveBytes);
    await this.verifyDisk(remaining, floor - discoLiberavel);
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
    check(!inventory.scopes[this.scope]?.pendingGitProcess, 'Término de processo Git anterior não confirmado; nova aquisição adiada.');
    try { await this.verify(state, inventory); }
    catch (error) {
      if (!SEM_ESPACO.test(error.message)) throw error;
      await reclaimInactiveObjects(this.base, inventory.scopes);
      await this.verifyEvictingIdleGit(state);
    }
  }
  // Sem isto, repositórios parados somados ao teto global travavam a aquisição de todos os outros, e o
  // limite por escopo não ajudava: cada um só despeja o próprio cache. Um por vez, até caber, e só depois
  // de conferir que despejar todos resolveria: pedido grande demais ou disco cheio por causa alheia não
  // pode custar um fetch cheio a cada repositório parado e ser recusado do mesmo jeito.
  async verifyEvictingIdleGit(state) {
    const inventory = await this.scan();
    try { return await this.verify(state, inventory); }
    catch (error) { if (!SEM_ESPACO.test(error.message)) throw error; }
    const idle = await scopesWithIdleGit(this.base, inventory.scopes, this.scope);
    const liberaveis = idle.reduce((total, item) => total + item.gitBytes, 0);
    await this.verify(state, { ...inventory, managedBytes: inventory.managedBytes - liberaveis }, liberaveis);
    let atual = inventory;
    for (const { scope } of idle) {
      if (!await reclaimScopeGit(this.base, path.join(this.base, scope))) continue;
      atual = await this.scan();
      try { return await this.verify(state, atual); }
      catch (error) { if (!SEM_ESPACO.test(error.message)) throw error; }
    }
    return this.verify(state, atual);
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
      state.reservations[id] = { scope: this.scope, kind, bytes, baselineBytes: inventory.scopes[this.scope]?.bytes || 0, createdAt: Date.now(), owner: DONO };
      await this.admit(state, inventory);
      // Base das amostras desta aquisição: sem ela a primeira amostra comporia sobre a última finalização,
      // que pode ser antiga.
      state.lastInventory = inventory; state.measuredAt = Date.now();
      await atomic(this.file, state);
      return id;
    });
  }
  // A amostra mede só o próprio escopo, e fora da trava global. Medido em 06/11/2026: o scan completo
  // dentro da trava, repetido a cada 250 ms (`monitorIntervalMs`), levava de 1,6 s (depois de limpeza
  // manual) a 31 s (frio, 857 mil arquivos), e as amostras emendavam uma na outra segurando a trava: as
  // outras sessões só preparavam quando a anterior terminava. Sob a trava agora só há leitura do estado,
  // composição, verificação e gravação. O inventário composto erra para mais (fora de uma aquisição os
  // outros escopos e materiais só encolhem) ou fica coberto pela reserva do escopo que cresce, cuja folga
  // não creditada compensa o tamanho defasado dele. Por isso a recusa por espaço com ele é
  // conferida com o scan completo antes de valer: perto do teto o custo volta a ser o de antes, e uma
  // limpeza feita por outra admissão não derruba a aquisição em curso.
  async sample(id, extend = true) {
    const scope = await this.scanScope();
    return this.transaction(async () => {
      const state = await this.state(), reservation = state.reservations[id];
      check(reservation?.scope === this.scope, 'Reserva global não verificável.');
      const inventory = await this.inventarioDaAmostra(state, reservation, scope, extend);
      state.lastInventory = inventory; state.measuredAt = Date.now();
      await atomic(this.file, state);
      return inventory;
    });
  }
  async inventarioDaAmostra(state, reservation, scope, extend) {
    const composto = this.composeInventory(state, scope);
    if (!composto) return this.conferirAmostra(state, reservation, await this.scan(), extend);
    try { return await this.conferirAmostra(state, reservation, composto, extend); }
    catch (error) { if (!SEM_ESPACO.test(error.message)) throw error; }
    return this.conferirAmostra(state, reservation, await this.scan(), extend);
  }
  async conferirAmostra(state, reservation, inventory, extend) {
    const growth = Math.max(0, (inventory.scopes[this.scope]?.bytes || 0) - reservation.baselineBytes);
    if (extend && growth >= reservation.bytes) {
      // O conteúdo do objeto já tem tamanho conhecido. A folga em blocos
      // pertence às aquisições de crescimento desconhecido, como Git.
      const headroom = reservation.kind === 'object-cache' ? 0 : this.limits.acquisitionReserveBytes;
      reservation.bytes = growth + headroom;
    }
    await this.verify(state, inventory);
    return inventory;
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
