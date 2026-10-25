// Compara versões com o mesmo replay sintético, sem iniciar engine ou provedores.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { semAsVariaveis } from '../lib/env.js';
const args = process.argv.slice(2);
const rootArg = args.indexOf('--root');
const root = path.resolve(rootArg < 0 ? path.join(import.meta.dirname, '..') : args[rootArg + 1]);
const REPLAY_TIMEOUT_MS = 30000;
const outputArg = args.indexOf('--output');
if (outputArg < 0 || !args[outputArg + 1]) throw new Error('Informe --output <arquivo JSON>.');
const output = path.resolve(args[outputArg + 1]);
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-ui-replay-'));
try {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const env = { ...semAsVariaveis(['GH_TOKEN', 'GITHUB_TOKEN']), FAROL_HOME: home,
    FAROL_UI_REPLAY_ROOT: root, FAROL_UI_REPLAY_OUTPUT: output };
  const result = spawnSync(process.execPath, ['--test', path.join(import.meta.dirname, '../test/ui-render-replay.test.js')],
    { env, encoding: 'utf8', timeout: REPLAY_TIMEOUT_MS, windowsHide: true });
  fs.writeFileSync(`${output}.log`, `${result.stdout || ''}${result.stderr || ''}`);
  if (result.status !== 0) throw new Error(`Replay falhou: consulte ${output}.log`);
  console.log(`Replay concluído: ${output}`);
} finally {
  if (!path.resolve(home).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Sandbox fora da raiz temporária.');
  fs.rmSync(home, { recursive: true, force: true });
}
