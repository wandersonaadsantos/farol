// O boot do SO comprova o término de toda a árvore, inclusive filhos órfãos.
import fs from 'node:fs/promises';
import io from '../io.js';
import { IS_WIN, IS_MAC } from '../paths.js';

const QUERY_MS = 5000;
async function bootEpoch() {
  let value;
  if (IS_WIN) {
    const query = "$ErrorActionPreference='Stop';Get-CimInstance Win32_OperatingSystem -Property LastBootUpTime | ForEach-Object {([DateTimeOffset]$_.LastBootUpTime).ToUnixTimeMilliseconds()}";
    const result = await io.run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { timeout: QUERY_MS });
    if (!result.ok) return null;
    value = Number(result.stdout.trim());
  } else if (IS_MAC) {
    const result = await io.run('sysctl', ['-n', 'kern.boottime'], { timeout: QUERY_MS });
    if (!result.ok) return null;
    const match = /\bsec\s*=\s*(\d+)/.exec(result.stdout);
    if (match) value = Number(match[1]) * 1000;
  } else {
    let text;
    try { text = await fs.readFile('/proc/stat', 'utf8'); }
    catch { return null; } // Sem prova do SO a operação continua protegida.
    const match = /^btime\s+(\d+)$/m.exec(text);
    if (match) value = Number(match[1]) * 1000;
  }
  return Number.isSafeInteger(value) && value > 0 && value <= Date.now() ? value : null;
}
const recoveryBoot = { read: bootEpoch };
export { recoveryBoot };
