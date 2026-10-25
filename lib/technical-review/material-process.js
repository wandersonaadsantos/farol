// Identidade de processo conferida pelo SO. Ausência de prova nunca significa morte.
import io from '../io.js';
import { IS_WIN } from '../paths.js';
import { envSemRepositorioHerdado } from '../git-env.js';

const QUERY_MS = 5000;
async function processBirth(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return { status: 'unknown' };
  let result;
  if (IS_WIN) {
    const query = `Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -Property CreationDate | ForEach-Object { $_.CreationDate.ToUniversalTime().ToString('o') }`;
    result = await io.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: QUERY_MS });
  } else {
    result = await io.run('ps', ['-p', String(pid), '-o', 'lstart='], { env: { ...envSemRepositorioHerdado(), LC_ALL: 'C' }, timeout: QUERY_MS });
  }
  if (result.ok && result.stdout.trim()) return { status: 'found', birth: result.stdout.trim() };
  try { process.kill(pid, 0); return { status: 'unknown' }; }
  catch (error) { return { status: error.code === 'ESRCH' ? 'absent' : 'unknown' }; }
}

const processProbe = { read: processBirth };
async function processState(identity) {
  if (!identity?.birth) return 'unknown';
  const current = await processProbe.read(identity.pid);
  if (current.status === 'absent') return 'ended';
  if (current.status !== 'found') return 'unknown';
  return current.birth === identity.birth ? 'alive' : 'reused';
}

export { processProbe, processState };
