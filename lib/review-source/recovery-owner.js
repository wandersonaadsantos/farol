// Prova de término no mesmo boot: o dono da aquisição acabou, ou é este processo com a operação já encerrada,
// e nenhum Git anterior à interrupção segue vivo.
import path from 'node:path';
import io from '../io.js';
import { IS_WIN } from '../paths.js';
import { envSemRepositorioHerdado } from '../git-env.js';
import { cpuTime } from '../capacity/processes.js';
import { read, contained } from './files.js';
import { readRecord, instance } from '../technical-review/material-record.js';
import { processState } from '../technical-review/material-process.js';

const QUERY_MS = 5000;
// O ps do POSIX mede o tempo decorrido em segundos; a folga mantém o Git do mesmo segundo como anterior.
const FOLGA_DO_RELOGIO_MS = 2000;
// git, git-remote-https, git-upload-pack e afins; aplicativo cujo nome só começa com "git" fica de fora.
const GIT = /^git(?:-[a-z0-9-]+)?(?:\.exe)?$/i;
const WINDOWS_QUERY = "$ErrorActionPreference='Stop';Get-CimInstance Win32_Process -Property Name,ProcessId,CreationDate | Where-Object { $_.Name -like 'git*' } | ForEach-Object { $born = if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { -1 }; '{0}|{1}|{2}' -f $_.Name, $_.ProcessId, $born }";

// Início desconhecido vira NaN, e NaN impede a recuperação.
function windowsGit(raw) {
  return String(raw).split(/\r?\n/).filter(line => line.trim()).map(line => {
    const [name, , born] = line.trim().split('|');
    return { name, born: Number(born) > 0 ? Number(born) : NaN };
  }).filter(row => GIT.test(row.name || ''));
}
// Lê o argv[0], não o comm: no proot do Termux o comm pode ser o nome do loader, e o argv é preservado.
function posixGit(raw, now) {
  return String(raw).split('\n').filter(line => line.trim()).map(line => {
    const m = /^\s*(\d+)\s+(\S+)\s+(\S+)/.exec(line);
    return m ? { name: path.basename(m[3]), born: now - cpuTime(m[2]) } : { name: 'git', born: NaN };
  }).filter(row => GIT.test(row.name));
}
async function gitProcesses() {
  // O instante antes do ps: o etime arredonda para baixo, e só assim o nascimento estimado fica do lado seguro.
  const now = Date.now();
  const result = IS_WIN
    ? await io.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_QUERY], { timeout: QUERY_MS, maxBuffer: 4 * 1024 * 1024 })
    : await io.run('ps', ['-A', '-o', 'pid=,etime=,args='], { env: { ...envSemRepositorioHerdado(), LC_ALL: 'C' }, timeout: QUERY_MS, maxBuffer: 4 * 1024 * 1024 });
  if (!result.ok) return null; // Sem a lista do SO a operação continua protegida.
  return IS_WIN ? windowsGit(result.stdout) : posixGit(result.stdout, now);
}
const recoveryProcesses = { list: gitProcesses };

// Consulta de SO fora das travas, como a do boot; a recuperação confere de novo lease, instante e PID.
// `listarGit` é a lista compartilhada da rodada, consultada só quando o dono já está provadamente encerrado.
async function ownerEndedProof(base, root, materialRoot, listarGit = recoveryProcesses.list) {
  const pending = await read(path.join(root, 'operation-pending.json'));
  if (pending?.schema !== 1 || !/^[a-f0-9-]{36}$/.test(pending.lease || '') || !Number.isSafeInteger(pending.at)) return null;
  const leaseFile = path.join(root, 'leases', pending.lease + '.json');
  await contained(base, leaseFile);
  const lease = await read(leaseFile);
  if (!lease?.destination || !Number.isInteger(lease.pid)) return null;
  const destination = path.resolve(lease.destination);
  if (path.dirname(destination) !== path.resolve(materialRoot)) return null;
  await contained(materialRoot, destination);
  const record = readRecord(destination);
  if (!record || record.owner.pid !== lease.pid) return null;
  // Timeout no próprio processo (biud-frontend#1558, 26/10/2026): o dono segue vivo, mas a operação acabou;
  // material liberado e sem consumidores é conferido de novo sob a trava, e só a lista de Git decide.
  const self = record.owner.instance === instance && record.owner.pid === process.pid;
  const owner = self ? 'self' : await processState(record.owner);
  if (!['ended', 'reused', 'self'].includes(owner)) return null;
  const git = await listarGit();
  if (!git || git.some(row => !Number.isFinite(row.born) || row.born <= pending.at + FOLGA_DO_RELOGIO_MS)) return null;
  return { lease: pending.lease, pendingAt: pending.at, ownerPid: lease.pid, owner };
}
export { ownerEndedProof, recoveryProcesses, windowsGit, posixGit };
