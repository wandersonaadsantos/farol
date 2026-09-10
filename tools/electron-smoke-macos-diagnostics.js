// Observação somente leitura do desktop efêmero da CI. Roda no driver Node,
// fora do bootstrap que proíbe processos externos. Não concede permissões.
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { readJson, writeJsonAtomic } from '../lib/io.js';
import { IS_MAC } from '../lib/paths.js';

const exec = promisify(execFile);
const COMMAND_TIMEOUT_MS = 6000;
const PERMISSION_STAGE = 'notification-permission-requested';

// A hierarquia é descoberta no runner, sem presumir o processo/posição do
// diálogo. Limites evitam percorrer toda a árvore de acessibilidade do browser.
const AX_SCRIPT = `(() => {
  const system = Application('System Events');
  const read = fn => { try { return fn(); } catch (error) { return { error: String(error) }; } };
  const processes = [];
  for (const process of system.applicationProcesses()) {
    const windows = read(() => process.windows());
    if (!Array.isArray(windows) || !windows.length) continue;
    const entry = { name: read(() => process.name()), pid: read(() => process.unixId()),
      bundleId: read(() => process.bundleIdentifier()), windows: [] };
    for (const window of windows.slice(0, 6)) {
      let remaining = 120;
      const visit = (element, depth) => {
        if (--remaining < 0 || depth > 10) return { truncated: true };
        const node = { role: read(() => element.role()), name: read(() => element.name()),
          description: read(() => element.description()), value: read(() => element.value()) };
        const children = read(() => element.uiElements());
        if (Array.isArray(children) && children.length) node.children = children.slice(0, 30).map(child => visit(child, depth + 1));
        return node;
      };
      entry.windows.push(visit(window, 0));
    }
    processes.push(entry);
  }
  return JSON.stringify({ uiEnabled: read(() => system.UIElementsEnabled()), processes });
})()`;

function permissionStageObserved(report, probeId) {
  return report?.probeId === probeId && report.stage === PERMISSION_STAGE;
}

async function capture(report, context, label, command, args) {
  const startedAt = new Date().toISOString();
  try {
    const result = await exec(command, args, { timeout: COMMAND_TIMEOUT_MS, killSignal: 'SIGKILL',
      signal: context.signal, maxBuffer: 2 * 1024 * 1024 });
    report.actions.push({ label, startedAt, status: 'captured', ...result });
  } catch (error) {
    report.actions.push({ label, startedAt, status: 'failed', error: error.message,
      stdout: error.stdout || '', stderr: error.stderr || '' });
  }
  writeJsonAtomic(path.join(context.output, 'macos-diagnostics.json'), report);
}

async function snapshot(report, context, afterMs) {
  await delay(Math.max(0, context.requestedAt + afterMs - Date.now()), undefined, { signal: context.signal });
  await Promise.all([
    capture(report, context, `accessibility-${afterMs}ms`, '/usr/bin/osascript', ['-l', 'JavaScript', '-e', AX_SCRIPT]),
    capture(report, context, `desktop-${afterMs}ms`, '/usr/sbin/screencapture', ['-x', path.join(context.output, `macos-desktop-${afterMs}ms.png`)])
  ]);
}

async function collectDiagnostics(context) {
  const { output, binary, probeId, signal } = context;
  const report = { probeId, status: 'observing', actions: [], readOnly: true };
  try {
    while (!permissionStageObserved(readJson(path.join(output, 'result.json'), null), probeId)) {
      await delay(100, undefined, { signal });
    }
    context.requestedAt = Date.now();
    report.permissionStageObservedAt = new Date(context.requestedAt).toISOString();
    const bundle = path.resolve(binary, '../../..');
    await Promise.allSettled([
      capture(report, context, 'signature-description', '/usr/bin/codesign', ['-dvv', bundle]),
      capture(report, context, 'signature-verification', '/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]),
      snapshot(report, context, 2000), snapshot(report, context, 10000)
    ]);
    report.status = signal.aborted ? 'interrupted' : 'finished';
  } catch (error) {
    report.status = 'interrupted';
    report.error = error.message;
  }
  writeJsonAtomic(path.join(output, 'macos-diagnostics.json'), report);
}

function startMacosDiagnostics({ output, binary, probeId, child }) {
  if (!IS_MAC) throw new Error('Diagnóstico de desktop reservado ao runner macOS.');
  const controller = new AbortController();
  const stop = () => controller.abort();
  const deadline = setTimeout(stop, 55000);
  child.once('exit', stop);
  const done = collectDiagnostics({ output, binary, probeId, signal: controller.signal }).finally(() => {
    clearTimeout(deadline);
    child.removeListener('exit', stop);
  });
  return { done, stop };
}

export { PERMISSION_STAGE, permissionStageObserved, startMacosDiagnostics };
