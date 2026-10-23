// Snapshot sem nome, comando, caminho, usuário ou ambiente dos processos.
import io, { parseJson } from '../io.js';
import { IS_WIN } from '../paths.js';
import { semAsVariaveis } from '../env.js';
const PROCESS_QUERY_TIMEOUT_MS = 8000;
const WINDOWS_QUERY = '$ErrorActionPreference="Stop"; @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime,CreationDate | Where-Object { $_.ProcessId -gt 0 -and $null -ne $_.CreationDate -and $null -ne $_.WorkingSetSize -and $null -ne $_.KernelModeTime -and $null -ne $_.UserModeTime } | Select-Object ProcessId,ParentProcessId,WorkingSetSize,KernelModeTime,UserModeTime,@{n="Born";e={$_.CreationDate.ToUniversalTime().ToString("o")}}) | ConvertTo-Json -Compress';
function number(value) {
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) return Number(value);
  return NaN;
}
function validProcess(row) {
  return Number.isInteger(row.pid) && row.pid > 0 && Number.isInteger(row.parent) && row.parent >= 0
    && Number.isFinite(row.rss) && row.rss >= 0 && Number.isFinite(row.cpuMs) && row.cpuMs >= 0 && Number.isFinite(row.born);
}
function windowsProcesses(raw) {
  const json = parseJson(raw);
  if (!Array.isArray(json) || !json.length) return null;
  const rows = json.map(r => ({ pid: number(r.ProcessId), parent: number(r.ParentProcessId), rss: number(r.WorkingSetSize),
    cpuMs: (number(r.KernelModeTime) + number(r.UserModeTime)) / 10000, born: Date.parse(r.Born) }));
  return rows.every(validProcess) && new Set(rows.map(r => r.pid)).size === rows.length ? rows : null;
}
function cpuTime(raw) {
  const m = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(raw);
  if (!m) return NaN;
  return ((Number(m[1] || 0) * 86400) + (Number(m[2] || 0) * 3600) + Number(m[3]) * 60 + Number(m[4])) * 1000;
}
function posixProcesses(raw) {
  const rows = String(raw).trim().split('\n').map(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!m) return null;
    return { pid: Number(m[1]), parent: Number(m[2]), rss: Number(m[3]) * 1024, cpuMs: cpuTime(m[4]), born: Date.parse(m[5]) };
  });
  return rows.length && rows.every(r => r && validProcess(r)) && new Set(rows.map(r => r.pid)).size === rows.length ? rows : null;
}
async function readProcesses() {
  const result = IS_WIN
    ? await io.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_QUERY], { timeout: PROCESS_QUERY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 })
    : await io.run('ps', ['-axo', 'pid=,ppid=,rss=,time=,lstart='], { env: { ...semAsVariaveis([]), LC_ALL: 'C' }, timeout: PROCESS_QUERY_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });
  if (!result.ok) return null;
  return IS_WIN ? windowsProcesses(result.stdout) : posixProcesses(result.stdout);
}
function descendants(rows, roots) {
  const owned = new Set(roots), children = new Map();
  for (const r of rows) {
    if (!children.has(r.parent)) children.set(r.parent, []);
    children.get(r.parent).push(r);
  }
  const queue = [...roots];
  for (const pid of queue) for (const child of children.get(pid) || []) {
    const parent = rows.find(r => r.pid === pid);
    if (!owned.has(child.pid) && (!parent || child.born >= parent.born)) { owned.add(child.pid); queue.push(child.pid); }
  }
  return owned;
}
function classifyProcesses(rows, rootPid, sessions) {
  const own = descendants(rows, [rootPid]), cliRoots = [], missing = [], measured = [];
  for (const session of sessions) {
    const row = rows.find(r => r.pid === session.pid);
    if (row && own.has(row.pid) && row.born >= session.startedAt - 2000) { cliRoots.push(row.pid); measured.push(session); }
    else missing.push(session.id);
  }
  const clis = descendants(rows, cliRoots);
  const bySession = measured.map(session => {
    const ids = descendants(rows, [session.pid]);
    return { id: session.id, rows: rows.filter(r => ids.has(r.pid)) };
  });
  return { farol: rows.filter(r => own.has(r.pid) && !clis.has(r.pid)), clis: rows.filter(r => clis.has(r.pid)), missing, bySession };
}
export { readProcesses, windowsProcesses, posixProcesses, classifyProcesses, cpuTime };
