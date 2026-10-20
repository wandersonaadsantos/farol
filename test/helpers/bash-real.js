import { execFileSync } from 'node:child_process';
import { IS_WIN } from '../../lib/paths.js';
import { detectGitBash } from '../../lib/io.js';

// WSL aceita --version, mas não recebe caminhos e variáveis do Windows como o Git Bash.
const candidato = IS_WIN ? detectGitBash() : 'bash';
let bashDoTeste = null;
if (candidato) {
  try {
    execFileSync(candidato, ['--version'], { stdio: 'ignore', windowsHide: true, timeout: 5000 });
    bashDoTeste = candidato;
  } catch { /* ausência do shell é reportada como teste não executado */ }
}
export { bashDoTeste };
