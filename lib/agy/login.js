// O login de um perfil do Antigravity CLI pela própria tela (o mesmo painel do Claude,
// lib/engine/login-web.js), para quem não tem terminal: o modo servidor (Hostinger), o
// celular e o Linux sem emulador.
//
// Medido (spec, seção 6, e de novo em 20/10/2026 com o `/usage`): sem credencial na pasta, o
// `agy` imprime
//   "Authentication required. Please visit the URL to log in:"
//   "  https://accounts.google.com/o/oauth2/auth?...&redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback..."
//   "Or, paste the authorization code here and press Enter:"
// e espera o código na entrada padrão por 60 segundos. O `redirect_uri` é a página do Google
// que MOSTRA o código, então o navegador pode estar em outra máquina. O comando do login é o
// `/usage`, que autentica do mesmo jeito e não vai ao modelo: depois do código, a saída 0 é o
// sucesso e nenhum token de cota foi gasto. Tudo com o ambiente da pasta do perfil
// (lib/agy/ambiente.js), então o token vai para o arquivo dela.
//
// O código colado é credencial de uso único: vai só para a entrada padrão do CLI, nunca para
// log, spawns.log, snapshot ou toast (a rota é `recebe-segredo` no inventário da A4).
import fs from 'node:fs';
import { IS_WIN, IS_LINUX } from '../paths.js';
import { agyEnv } from './ambiente.js';
import { garantirPasta, gitconfigReal, comandoDoAgy } from './home.js';

// o link de autorização do Google, inteiro até o primeiro espaço
const LINK = /https:\/\/accounts\.google\.com\/o\/oauth2\/\S+/;
// o código que a página do Google mostra (`4/0A...`): barra e sinais de base64 entram
const CODIGO = /^[A-Za-z0-9._~#/+=-]{8,2048}$/;
const ARGS_DO_LOGIN = Object.freeze(['-p', '/usage', '--output-format', 'json']);

function linkDaSaida(texto) {
  const m = String(texto || '').match(LINK);
  return m ? m[0] : '';
}

function codigoValido(v) {
  const s = String(v == null ? '' : v).trim();
  return CODIGO.test(s) ? s : '';
}

// O motivo que pode ir para a tela: as frases conhecidas do CLI, sem link e sem código.
function motivoDaFalha(texto) {
  const s = String(texto || '');
  if (/authentication (?:failed|interrupted)|timed out/i.test(s)) return 'o Antigravity não aceitou o código (ou o prazo de 60 segundos passou)';
  return 'o Antigravity não confirmou o login';
}

/** Abre o `agy` na pasta do perfil; o login-web lê o link e entrega o código. */
function abrirProcesso(engine, id, spawn) {
  const pasta = garantirPasta(id);
  const env = agyEnv(engine.ghEnv(), pasta, { gitconfigReal: gitconfigReal() });
  const { cmd, prefixo } = comandoDoAgy();
  const args = [...prefixo, ...ARGS_DO_LOGIN];
  const opcoes = { cwd: pasta, env, windowsHide: true, stdio: 'pipe', detached: !IS_WIN };
  // No Linux, agy 1.4.3 exige TTY para oferecer o login. Sem eco do código e sem
  // transcrição em disco; -e preserva a recusa do CLI como saída diferente de zero.
  if (IS_LINUX) {
    const citar = (v) => `'${String(v).replace(/'/g, "'\\''")}'`;
    const linha = `stty -echo && exec ${[cmd, ...args].map(citar).join(' ')}`;
    return spawn('/usr/bin/script', ['-q', '-e', '-c', linha, '/dev/null'], opcoes);
  }
  return spawn(cmd, args, opcoes);
}

// children depende de CONFIG_CHECKPOINT_RESTORE. O PPID em stat existe também
// nos kernels sem essa opção; o nome do processo pode conter ')'.
function filhosPorPPID(pid) {
  let entradas;
  try { entradas = fs.readdirSync('/proc'); } catch { return []; }
  return entradas.filter((p) => /^\d+$/.test(p)).filter((p) => {
    try {
      const stat = fs.readFileSync(`/proc/${p}/stat`, 'utf8');
      return Number(stat.slice(stat.lastIndexOf(')') + 2).split(/\s+/)[1]) === pid;
    } catch { return false; } // outro processo saiu durante a leitura
  }).map(Number);
}

function filhosDoWrapper(pid) {
  try {
    return fs.readFileSync(`/proc/${pid}/task/${pid}/children`, 'utf8')
      .trim().split(/\s+/).filter((p) => /^\d+$/.test(p)).map(Number);
  } catch { return filhosPorPPID(pid); }
}

// O wrapper precisa continuar vivo para recolher seu filho (waitpid). Sinalizar
// o próprio script faz versões do util-linux saírem sem esse wait, deixando zumbis.
function encerrarProcessoLinux(child) {
  let timer;
  const prazo = Date.now() + 2000;
  const parar = () => clearTimeout(timer);
  child.once('exit', parar);
  const filhos = () => {
    if (child.exitCode !== null || child.signalCode !== null) return [];
    return filhosDoWrapper(child.pid);
  };
  const sinalizar = (pid, sinal) => {
    try { process.kill(pid, sinal); } catch { /* filho já saiu */ }
  };
  const tentar = () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const pids = filhos();
    // Cancelar antes do fork também precisa encerrar o CLI que ainda vai nascer.
    if (!pids.length) {
      if (Date.now() >= prazo) { child.stdin.end(); return; }
      timer = setTimeout(tentar, 25);
      return;
    }
    pids.forEach((pid) => sinalizar(pid, 'SIGTERM'));
    child.stdin.end(); // libera o proxy de entrada enquanto script recolhe o filho
    timer = setTimeout(() => {
      // Reconfere o vínculo antes de forçar: nunca mata um PID reaproveitado.
      filhos().filter((pid) => pids.includes(pid)).forEach((pid) => sinalizar(pid, 'SIGKILL'));
    }, 2000);
  };
  tentar();
}

// O comando equivalente para quem prefere o terminal, mostrado no painel como alternativa.
function comandoManual(id) {
  const pasta = garantirPasta(id);
  if (IS_WIN) return `set "SSH_CLIENT=farol 0 0" && set "USERPROFILE=${pasta}" && agy -p /usage`;
  return `SSH_CLIENT='farol 0 0' HOME='${pasta.replace(/'/g, "'\\''")}' agy -p /usage`;
}

export default { linkDaSaida, codigoValido, motivoDaFalha, abrirProcesso, encerrarProcessoLinux, comandoManual, ARGS_DO_LOGIN };
export { linkDaSaida, codigoValido, motivoDaFalha, abrirProcesso, comandoManual, ARGS_DO_LOGIN };
