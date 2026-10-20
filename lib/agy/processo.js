// Abrir o `agy` (ou o agy falso dos testes) e encerrar a árvore dele. Um lugar só para o
// spawn, porque o comando muda com o stub (lib/agy/home.js, comandoDoAgy) e a sessão, o
// `/usage`, o login e o doctor abrem o mesmo binário.
//
// Sem shell no meio: os argumentos vão como lista, então nenhum valor de configuração passa
// por interpretação de shell (o modelo e o esforço já chegam saneados por allowlist em
// lib/parse.js, e o prompt vai pela entrada padrão). O POSIX abre o filho em grupo próprio
// (detached) para o encerramento levar a árvore inteira, como no headless do Claude.
import cp from 'node:child_process';
import { IS_WIN } from '../paths.js';
import { logSpawn } from '../spawnlog.js';
import { comandoDoAgy } from './home.js';

const SAIDA_MAX = 4 * 1024 * 1024;

function spawnAgy(args, { env, cwd, stdin = 'pipe', rotulo = 'agy' } = {}) {
  const { cmd, prefixo } = comandoDoAgy();
  // a linha registrada leva só os argumentos (o prompt nunca está neles)
  logSpawn(rotulo, [cmd, ...prefixo, ...args]);
  return cp.spawn(cmd, [...prefixo, ...args], {
    cwd, env, stdio: [stdin, 'pipe', 'pipe'], windowsHide: true, detached: !IS_WIN,
  });
}

function encerrarArvore(child) {
  if (!child || !child.pid) return;
  try {
    if (IS_WIN) cp.execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => { /* já saiu */ });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* o processo já saiu */ }
}

/**
 * Roda um comando curto do `agy` (`/usage`, `--version`) e devolve a saída. Nunca lança:
 * falha de spawn e teto de tempo voltam como `code: -1`, no molde do io.run.
 * @returns {Promise<{ code: number, stdout: string, stderr: string, tempoEsgotado: boolean }>}
 */
function rodar(args, { env, cwd, limiteMs }) {
  return new Promise((resolve) => {
    let child;
    try { child = spawnAgy(args, { env, cwd, stdin: 'ignore', rotulo: 'agy-comando' }); }
    catch (err) { resolve({ code: -1, stdout: '', stderr: String(err?.message || err), tempoEsgotado: false }); return; }
    let stdout = '', stderr = '', fim = false, tempoEsgotado = false;
    const acabar = (code) => {
      if (fim) return;
      fim = true;
      clearTimeout(teto);
      resolve({ code, stdout, stderr, tempoEsgotado });
    };
    const teto = setTimeout(() => { tempoEsgotado = true; encerrarArvore(child); acabar(-1); }, limiteMs);
    child.stdout.on('data', (c) => { if (stdout.length < SAIDA_MAX) stdout += String(c); });
    child.stderr.on('data', (c) => { if (stderr.length < SAIDA_MAX) stderr += String(c); });
    child.on('error', (err) => { stderr += String(err?.message || err); acabar(-1); });
    child.on('close', (code) => acabar(code === null ? -1 : code));
  });
}

export default { spawnAgy, encerrarArvore, rodar };
export { spawnAgy, encerrarArvore, rodar };
