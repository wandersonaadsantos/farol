// Trava de arquivo com dono: storage-budget.lock (quota global) e writer.lock (escopo).
// Antes da 2.78.8 a trava nascia vazia e não tinha saída: um unlink recusado pelo Windows
// ou um processo morto no meio deixava o arquivo para sempre, e a quota global parava a
// análise técnica de todos os repositórios (27/10/2026, 13:18 até a remoção manual).
// Agora ela nasce com o dono escrito e só é retomada com prova de que ninguém a segura:
// este processo sem a trava em mãos, dono encerrado pelo SO, ou boot posterior a ela.
// Ausência de prova nunca significa morte: trava sem dono legível continua valendo.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { parseJson, safeStringify } from '../io.js';
import { atomic } from './files.js';
import { INSTANCE } from './instance.js';
import { recoveryBoot } from './recovery-boot.js';
import { processProbe } from '../technical-review/material-process.js';

const VERSION = 1;
// O Windows recusa apagar arquivo que antivírus ou indexador acabou de abrir; a recusa passa em instantes.
const UNLINK_WAITS = [25, 50, 100, 200, 400];
const TRANSITORIO = ['EPERM', 'EACCES', 'EBUSY'];
// Só estes erros do link significam algo além de "sem link aqui"; o resto cai no open exclusivo.
const LINK_DECISIVO = ['EEXIST', 'ENOENT', 'ENOSPC'];
// Travas que este processo segura agora, inclusive enquanto o unlink do fim é repetido.
// Dono igual a este processo fora desta lista é sobra.
const held = new Set();
const lockIo = { unlink: file => fs.unlink(file), link: (from, to) => fs.link(from, to) };
const lockLog = { write: null };
// Início do processo pelo próprio Node, sem consultar o SO a cada trava.
const STARTED_AT = Math.round(performance.timeOrigin);
// A data de criação do SO vem antes do início do runtime (medido: 20 a 25 ms); um processo que
// nasceu mais que isto depois do início gravado não é o dono.
const NASCEU_DEPOIS_MS = 5000;
// Pastas onde o link falhou: a queda para o open exclusivo vale para o processo inteiro.
const semLink = new Set();
let bootAt;
// O boot não muda enquanto o processo vive; os testes trocam o SO simulado.
const lockMemo = { clear() { bootAt = undefined; semLink.clear(); } };

function log(level, text) {
  try { lockLog.write?.(level, text); } catch { /* log nunca derruba a trava */ }
}
// Só o código da causa: a mensagem pode trazer caminho ou conteúdo externo, e o log não os recebe.
function describe(error) {
  return String(error?.code || error?.name || 'erro desconhecido');
}
function key(file) {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
// Nome legível no log: o arquivo e a pasta (o digest do escopo, nunca conteúdo externo).
function label(file) {
  return `${path.basename(path.dirname(file))}/${path.basename(file)}`;
}
// Memoriza só o que o SO respondeu: uma consulta lenta não pode fixar "sem boot" para sempre.
async function systemBoot() {
  if (bootAt) return bootAt;
  const value = await recoveryBoot.read().catch(() => null);
  if (Number.isSafeInteger(value) && value > 0 && value <= Date.now()) bootAt = value;
  return bootAt || null;
}

// Cria a trava já com o dono dentro: o temporário preenchido é ligado ao nome final, e o
// link falha com EEXIST como o open exclusivo. Sistema de arquivos sem link (FAT, exFAT,
// alguns compartilhamentos) cai no open exclusivo.
async function create(file, owner) {
  const tmp = `${file}.${randomUUID()}.novo`;
  await fs.writeFile(tmp, safeStringify(owner), { mode: 0o600, flag: 'wx' });
  const dir = key(path.dirname(file));
  try {
    if (!semLink.has(dir) && await linkWithRetry(tmp, file)) return;
    semLink.add(dir);
  } finally { await fs.rm(tmp, { force: true }); }
  const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(safeStringify(owner)); } finally { await handle.close(); }
}

// true: trava criada. false: sem link aqui (cai no open exclusivo). Recusa passageira de
// antivírus é repetida antes, porque o open exclusivo tem a janela da trava vazia.
async function linkWithRetry(tmp, file) {
  for (let attempt = 0; ; attempt++) {
    const error = await lockIo.link(tmp, file).then(() => null, failure => failure);
    if (!error) return true;
    if (LINK_DECISIVO.includes(error.code)) throw error;
    if (!TRANSITORIO.includes(error.code) || attempt === UNLINK_WAITS.length) return false;
    await delay(UNLINK_WAITS[attempt]);
  }
}

// Conteúdo e data pelo mesmo handle: lidos em separado, podiam ser de duas travas diferentes.
async function inspect(file) {
  let handle;
  try { handle = await fs.open(file, 'r'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  let raw, stat;
  try { [stat, raw] = [await handle.stat(), await handle.readFile('utf8')]; } finally { await handle.close(); }
  let owner = null;
  try {
    const value = parseJson(raw);
    if (value?.schema === VERSION && typeof value.instance === 'string' && Number.isInteger(value.pid) && value.pid > 0) owner = value;
  } catch { owner = null; }
  return { raw, owner, since: Math.min(stat.mtimeMs, Number.isSafeInteger(owner?.at) ? owner.at : Infinity) };
}

// O dono acabou? 'ended', 'alive' ou 'unknown'. Reaproveitado é o PID cujo processo atual
// nasceu depois do início gravado do dono. As duas datas são medidas na partida, então um
// salto do relógio depois dela não as afasta, e a demora do Electron para iniciar o Node
// só deixa a diferença negativa (lado de "vivo"). O mesmo PID deste processo com outro
// início é o Farol reaberto em segundos. Sem início gravado (writer.lock da 2.78.7), só o
// PID ausente prova.
async function ownerState(owner) {
  if (owner.pid === process.pid) return owner.startedAt === STARTED_AT ? 'alive' : 'ended';
  const current = await processProbe.read(owner.pid).catch(() => ({ status: 'unknown' }));
  if (current.status === 'absent') return 'ended';
  if (current.status !== 'found' || !Number.isSafeInteger(owner.startedAt)) return 'unknown';
  const born = Date.parse(current.birth);
  if (!Number.isFinite(born)) return 'unknown';
  return born - owner.startedAt > NASCEU_DEPOIS_MS ? 'ended' : 'alive';
}

// Prova de que ninguém segura a trava. null preserva a trava. Dono vivo confirmado nunca
// cai na prova de boot: o boot só decide com dono ilegível ou SO sem resposta.
async function orphanProof(file, found) {
  const { owner } = found;
  if (owner?.instance === INSTANCE && owner.pid === process.pid) return held.has(key(file)) ? null : 'own-leftover';
  const state = owner ? await ownerState(owner) : 'unknown';
  if (state === 'ended') return 'owner-ended';
  if (state === 'alive') return null;
  const boot = await systemBoot();
  return boot && found.since < boot ? 'previous-system-boot' : null;
}

// A retomada é serializada por uma trava auxiliar (<trava>.retomada), criada do mesmo jeito.
// Só quem a segura renomeia a órfã, então ninguém renomeia uma trava recém-criada por outro:
// enquanto a órfã existe, nenhuma trava nova nasce no mesmo nome. A auxiliar dura
// milissegundos; a órfã dela segue a mesma prova, sem nova auxiliar.
async function takeOver(file, owner) {
  const guard = `${file}.retomada`;
  if (!await claim(guard, owner, true)) return false;
  try {
    const found = await inspect(file);
    if (!found) return true;
    const proof = await orphanProof(file, found);
    if (!proof) return false;
    const tomb = await moveAway(file, found.raw);
    if (tomb === null) return false;
    if (!tomb) return true;
    const evidence = { at: Date.now(), lock: path.basename(file), proof, owner: found.owner, lockAgeMs: Math.max(0, Date.now() - found.since) };
    try { await atomic(`${file}-recovered.json`, evidence); }
    finally { await fs.rm(tomb, { force: true }); }
    log('WARN', `Trava órfã ${label(file)} retomada (${proof}), parada havia ${Math.round(evidence.lockAgeMs / 1000)} s.`);
    return true;
  } finally { await unlinkOwned(guard); }
}

// Renomeia a trava para uma lápide e confere que era a trava julgada (o nonce do dono a
// distingue de qualquer outra). Não era: devolve pelo link e registra, porque isso só
// acontece se a serialização da retomada falhou. '' quando ela já saiu (ninguém a segura).
async function moveAway(file, raw) {
  const tomb = `${file}.orfa-${randomUUID()}`;
  try { await fs.rename(file, tomb); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
  if (await fs.readFile(tomb, 'utf8').catch(() => null) === raw) return tomb;
  const back = await lockIo.link(tomb, file).then(() => true, () => false);
  log('ERROR', `Trava ${label(file)} mudou durante a retomada; ${back ? 'devolvida' : `não pôde ser devolvida, lápide ${path.basename(tomb)} preservada`} sem retomar.`);
  if (back) await fs.rm(tomb, { force: true });
  return null;
}

// Uma tentativa de criar e, sendo órfã, uma retomada. `simples` é a auxiliar: órfã dela
// sai direto, porque não há trabalho protegido por ela além da própria retomada.
async function claim(file, owner, simples = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await create(file, owner);
      if (held.has(key(file))) log('ERROR', `Trava ${label(file)} criada já constando como em mãos; registro em memória inconsistente.`);
      held.add(key(file));
      return true;
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (attempt) break;
    if (simples) {
      const found = await inspect(file);
      if (found && !await orphanProof(file, found)) break;
      const tomb = found ? await moveAway(file, found.raw) : '';
      if (tomb === null) break;
      if (tomb) await fs.rm(tomb, { force: true });
      continue;
    }
    if (!await takeOver(file, owner)) break;
  }
  return false;
}

// Devolve a trava, ou null quando outro a segura de verdade (ou falta prova de que não segura).
async function acquireLock(file) {
  const owner = { schema: VERSION, instance: INSTANCE, pid: process.pid, startedAt: STARTED_AT, at: Date.now(), nonce: randomUUID() };
  return await claim(file, owner) ? { file } : null;
}

// A trava só sai de `held` depois do unlink resolvido: durante as novas tentativas ela
// continua sendo deste processo, e ninguém daqui a confunde com sobra. Nenhum outro
// processo a retoma enquanto este vive (o dono vivo não prova nada), então o unlink pelo
// nome apaga só a nossa.
async function unlinkOwned(file) {
  try { return await unlinkWithRetry(file); } finally { held.delete(key(file)); }
}
async function unlinkWithRetry(file) {
  for (let attempt = 0; ; attempt++) {
    const error = await lockIo.unlink(file).then(() => null, failure => failure);
    if (!error || error.code === 'ENOENT') return true;
    if (!TRANSITORIO.includes(error.code) || attempt === UNLINK_WAITS.length) {
      log('ERROR', `Trava ${label(file)} não saiu (${describe(error)}); a próxima aquisição deste processo a retoma.`);
      return false;
    }
    await delay(UNLINK_WAITS[attempt]);
  }
}

// Nunca mascara o resultado do trabalho: a recusa que persiste fica no log com a causa.
async function releaseLock(lock) {
  return unlinkOwned(lock.file);
}

async function withLock(file, busy, work) {
  const lock = await acquireLock(file);
  if (!lock) return busy();
  try { return await work(); } finally { await releaseLock(lock); }
}

// Para quem só tenta (recuperação e reclaim de escopos): erro ao adquirir vira ocupado,
// em vez de derrubar a operação de outro repositório que os disparou.
async function tryWithLock(file, busy, work) {
  let lock;
  try { lock = await acquireLock(file); }
  catch (error) { log('WARN', `Trava ${label(file)} não verificável (${describe(error)}); a operação fica para depois.`); return busy(); }
  if (!lock) return busy();
  try { return await work(); } finally { await releaseLock(lock); }
}

export { acquireLock, releaseLock, withLock, tryWithLock, lockIo, lockLog, lockMemo, orphanProof, describe };
