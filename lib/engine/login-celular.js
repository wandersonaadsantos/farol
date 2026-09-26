// Sessão de login do Claude quando não existe terminal para abrir (26/09/2026).
//
// No desktop Linux o botão "Abrir sessão de login" abre um emulador de terminal com o
// script de login. No celular o Farol roda DENTRO de um proot (Ubuntu ou Debian, pelo
// proot-distro, no Termux) e não existe emulador nenhum: o botão só dizia "instale o
// gnome-terminal", que não se aplica. O dono passou um dia no aparelho refazendo o login à
// mão e a credencial nova caiu em /root/.claude, porque `claude` rodou como root com
// HOME=/root, enquanto o perfil lia /home/farol/.claude e continuava expirado.
//
// No celular, então, o Farol monta o MESMO script de login, com duas linhas a mais:
//   - HOME do processo do Farol, porque o perfil "Padrão da máquina" usa $HOME/.claude, e
//     quem roda o comando no Termux entra no proot como root, com outro HOME;
//   - ~/.local/bin na frente do PATH, onde o instalador oficial põe o `claude`, para a
//     sessão de login usar o mesmo binário que as revisões usam.
// O perfil com pasta própria já vem isolado pelo CLAUDE_CONFIG_DIR do próprio script.
// E devolve o comando para colar no Termux, fora do proot. Abrir o Termux sozinho
// (intent RUN_COMMAND) depende de configuração do aparelho e não foi validado num celular
// real, então não é prometido aqui.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HOME, sinaisDoModoCelular, distroDoLinux } from '../paths.js';
import { ensureDir } from '../io.js';
import { detectarModoCelular } from '../local-auth/modo.js';

// PURA: as linhas que o script de login do celular ganha antes da autenticação do perfil.
function linhasDoCelular(home) {
  const h = String(home || '').replace(/'/g, `'\\''`);
  return [`export HOME='${h}'`, 'export PATH="$HOME/.local/bin:$PATH"'];
}

// PURA: o comando que a pessoa cola no Termux. `bash` explícito porque o script está
// dentro do proot e pode ter perdido o bit de execução numa cópia.
function comandoDoTermux(distro, script) {
  const d = /^[A-Za-z0-9._-]+$/.test(String(distro || '')) ? distro : 'debian';
  return `proot-distro login ${d} -- bash '${String(script).replace(/'/g, `'\\''`)}'`;
}

function avisarSemTerminal(engine) {
  engine.log('ERROR', 'login do Claude: nenhum emulador de terminal encontrado (x-terminal-emulator/gnome-terminal/konsole/xterm)');
  engine.emit('toast', { kind: 'error', text: 'Nenhum emulador de terminal encontrado. Instale um (ex.: sudo apt install gnome-terminal) pra abrir a sessão de login.' });
  return { ok: false, code: 'sem-terminal' };
}

// Chamado pelo spawnLoginConsoleLinux (lib/engine/session.js) quando não há terminal.
// `montarScript` é o buildLoginScriptMac do session.js, recebido por parâmetro para este
// módulo não importar o session.js de volta. `deps` existe para o teste.
function semTerminal(engine, dir, montarScript, deps = {}) {
  const celular = Object.hasOwn(deps, 'celular') ? deps.celular : detectarModoCelular(sinaisDoModoCelular());
  if (!celular) return avisarSemTerminal(engine);
  const sessionsDir = deps.sessionsDir || path.join(HOME, 'sessions');
  ensureDir(sessionsDir);
  const id = `t${++engine.sessionSeq}`;
  const script = path.join(sessionsDir, `login-${Date.now()}.command`);
  const home = deps.home || os.homedir();
  // 0o700 como os outros scripts de sessão
  fs.writeFileSync(script, montarScript(engine, dir, id, linhasDoCelular(home)), { mode: 0o700 });
  return { ok: false, code: 'copiar-comando', comando: comandoDoTermux(deps.distro || distroDoLinux(), script) };
}

export default { semTerminal, linhasDoCelular, comandoDoTermux };
export { semTerminal, linhasDoCelular, comandoDoTermux };
