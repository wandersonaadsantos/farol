// Trava de arquivo com dono: storage-budget.lock (quota global) e writer.lock (escopo).
// Antes da 2.78.8 a trava nascia vazia e não tinha saída: um unlink recusado pelo Windows
// ou um processo morto no meio deixava o arquivo para sempre, e a quota global parava a
// análise técnica de todos os repositórios (27/10/2026, 13:18 até a remoção manual).
// Agora ela nasce com o dono escrito e só é retomada com prova de que ninguém a segura:
// este processo sem a trava em mãos, boot posterior a ela, ou dono encerrado pelo SO.
// Ausência de prova nunca significa morte: trava sem dono legível continua valendo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseJson, safeStringify } from '../io.js';
import { atomic } from './files.js';
import { INSTANCE } from './instance.js';
import { recoveryBoot } from './recovery-boot.js';
import { processProbe, processState } from '../technical-review/material-process.js';

const VERSION = 1;
// O Windows recusa apagar arquivo que antivírus ou indexador acabou de abrir; a recusa passa em instantes.
const UNLINK_WAITS = [25, 50, 100, 200, 400];
const TRANSITORIO = ['EPERM', 'EACCES', 'EBUSY'];
// Travas que este processo segura agora. Dono igual a este processo fora desta lista é sobra.
const held = new Set();
const lockIo = { unlink: file => fs.unlink(file), link: (from, to) => fs.link(from, to) };
const lockLog = { write: null };
let birth;

function log(level, text) {
  try { lockLog.write?.(level, text); } catch { /* log nunca derruba a trava */ }
}
async function ownBirth() {
  if (!birth) birth = processProbe.read(process.pid).then(found => found.status === 'found' ? found.birth : null, () => null);
  return birth;
}
// Só o código da causa: a mensagem pode trazer caminho ou conteúdo externo, e o log não os recebe.
function describe(error) {
  return String(error?.code || error?.name || 'erro desconhecido');
}

// Cria a trava já com o dono dentro: o arquivo temporário é ligado ao nome final, e o link
// falha com EEXIST como o open exclusivo. Sistema de arquivos sem link cai no open exclusivo.
async function create(file, owner) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, safeStringify(owner), { mode: 0o600, flag: 'wx' });
  try {
    await lockIo.link(tmp, file);
    return;
  } catch (error) {
    if (error.code === 'EEXIST') throw error;
    if (!['EPERM', 'ENOTSUP', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
  } finally { await fs.rm(tmp, { force: true }); }
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(safeStringify(owner)); } finally { await handle.close(); }
}

async function inspect(file) {
  let raw, stat;
  try { [raw, stat] = await Promise.all([fs.readFile(file, 'utf8'), fs.stat(file)]); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let owner = null;
  try {
    const value = parseJson(raw);
    if (value?.schema === VERSION && typeof value.instance === 'string' && Number.isInteger(value.pid) && value.pid > 0) owner = value;
  } catch { owner = null; }
  return { raw, owner, since: Math.min(stat.mtimeMs, Number.isSafeInteger(owner?.at) ? owner.at : Infinity) };
}

// Prova de que ninguém segura a trava. null preserva a trava.
async function orphanProof(file, found) {
  const { owner } = found;
  if (owner?.instance === INSTANCE && owner.pid === process.pid) return held.has(file) ? null : 'own-leftover';
  const bootAt = await recoveryBoot.read().catch(() => null);
  if (Number.isSafeInteger(bootAt) && bootAt <= Date.now() && found.since < bootAt) return 'previous-system-boot';
  if (!owner) return null;
  if (owner.birth) return ['ended', 'reused'].includes(await processState(owner)) ? 'owner-ended' : null;
  return (await processProbe.read(owner.pid)).status === 'absent' ? 'owner-ended' : null;
}

// Retoma a trava órfã sem apagar a de outro: renomeia (só um processo consegue), confere que
// era a mesma trava julgada e devolve pelo link quando não era. Evidência fica ao lado.
async function takeOver(file, found, proof) {
  const tomb = `${file}.orfa-${randomUUID()}`;
  try { await fs.rename(file, tomb); }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  const moved = await fs.readFile(tomb, 'utf8').catch(() => null);
  if (moved !== found.raw) {
    await lockIo.link(tomb, file).catch(() => {});
    await fs.rm(tomb, { force: true });
    return false;
  }
  const evidence = { at: Date.now(), lock: path.basename(file), proof, owner: found.owner, lockAgeMs: Math.max(0, Date.now() - found.since) };
  await atomic(`${file}-recovered.json`, evidence);
  await fs.rm(tomb, { force: true });
  log('WARN', `Trava órfã ${evidence.lock} retomada (${proof}), parada havia ${Math.round(evidence.lockAgeMs / 1000)} s.`);
  return true;
}

// Devolve a trava, ou null quando outro a segura de verdade (ou falta prova de que não segura).
async function acquireLock(file) {
  const owner = { schema: VERSION, instance: INSTANCE, pid: process.pid, birth: await ownBirth(), at: Date.now() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await create(file, owner);
      held.add(file);
      return { file };
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (attempt) break;
    const found = await inspect(file);
    if (!found) continue;
    const proof = await orphanProof(file, found);
    if (!proof || !await takeOver(file, found, proof)) break;
  }
  return null;
}

// Nunca mascara o resultado do trabalho: unlink recusado de vez fica registrado com a causa,
// e a sobra, com o dono deste processo, é retomada na próxima aquisição.
async function releaseLock(lock) {
  held.delete(lock.file);
  for (let attempt = 0; ; attempt++) {
    try { await lockIo.unlink(lock.file); return true; }
    catch (error) {
      if (error.code === 'ENOENT') return true;
      if (!TRANSITORIO.includes(error.code) || attempt === UNLINK_WAITS.length) {
        log('ERROR', `Trava ${path.basename(lock.file)} não saiu (${describe(error)}); a próxima aquisição deste processo a retoma.`);
        return false;
      }
    }
    await delay(UNLINK_WAITS[attempt]);
  }
}

async function withLock(file, busy, work) {
  const lock = await acquireLock(file);
  if (!lock) return busy();
  try { return await work(); } finally { await releaseLock(lock); }
}

export { acquireLock, releaseLock, withLock, lockIo, lockLog, orphanProof, describe };
