// Sessão de login do Claude quando não existe terminal para abrir (26/09/2026).
//
// No desktop Linux o botão "Abrir sessão de login" abre um emulador de terminal com o
// script de login. No celular o Farol roda DENTRO de um proot (Ubuntu ou Debian, pelo
// proot-distro, no Termux) e não existe emulador nenhum: o botão só dizia "instale o
// gnome-terminal", que não se aplica. O dono passou um dia no aparelho refazendo o login à
// mão e a credencial nova caiu em /root/.claude, porque `claude` rodou como root com
// HOME=/root, enquanto o perfil lia /home/farol/.claude e continuava expirado.
//
// Sem terminal, então, o Farol monta o MESMO script de login, com duas linhas a mais:
//   - HOME do processo do Farol, porque o perfil "Padrão da máquina" usa $HOME/.claude, e
//     quem roda o comando no Termux entra no proot como root, com outro HOME;
//   - ~/.local/bin na frente do PATH, onde o instalador oficial põe o `claude`, para a
//     sessão de login usar o mesmo binário que as revisões usam.
// O perfil com pasta própria já vem isolado pelo CLAUDE_CONFIG_DIR do próprio script.
// E devolve SEMPRE um comando, nunca o erro (v2.62.22): a v2.62.21 só montava o comando no
// "modo celular", e a detecção dele falhou no aparelho do dono (o proot-distro esconde os
// sinais do Termux), então o botão continuou dando o erro antigo. Com sinal de proot, o
// comando é o do Termux (`proot-distro login <distro> -- bash <script>`); sem sinal, é o
// `bash <script>`, para rodar num terminal do mesmo sistema. Abrir o Termux sozinho (intent
// RUN_COMMAND) depende de configuração do aparelho e não foi validado num celular real.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { HOME, sinaisDoModoCelular, sinaisDoProot, distroDoLinux } from '../paths.js';
import { ensureDir } from '../io.js';
import { detectarModoCelular } from '../local-auth/modo.js';

// PURA: as linhas que o script de login ganha antes da autenticação do perfil.
function linhasDoCelular(home) {
  const h = String(home || '').replace(/'/g, `'\\''`);
  return [`export HOME='${h}'`, 'export PATH="$HOME/.local/bin:$PATH"'];
}

// PURA: o Farol está num proot do Android? Um sinal basta: o kernel falso do proot-distro,
// o /system do Android montado, ou a detecção do modo celular.
function dentroDoProot({ osrelease = '', sistemaAndroid = false, celular = false } = {}) {
  return celular === true || sistemaAndroid === true || /proot|android/i.test(String(osrelease || ''));
}

const aspas = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

// PURA: o comando que a pessoa roda. `bash` explícito porque o script pode ter perdido o
// bit de execução numa cópia.
function comandoDoTermux(distro, script) {
  const d = /^[A-Za-z0-9._-]+$/.test(String(distro || '')) ? distro : 'debian';
  return `proot-distro login ${d} -- bash ${aspas(script)}`;
}

function comandoDeTerminal(script) {
  return `bash ${aspas(script)}`;
}

// Chamado pelo spawnLoginConsoleLinux (lib/engine/session.js) quando não há terminal.
// `montarScript` é o buildLoginScriptMac do session.js, recebido por parâmetro para este
// módulo não importar o session.js de volta. `deps` existe para o teste.
function semTerminal(engine, dir, montarScript, deps = {}) {
  const sinais = Object.hasOwn(deps, 'sinais') ? deps.sinais : { ...sinaisDoProot(), celular: detectarModoCelular(sinaisDoModoCelular()) };
  const sessionsDir = deps.sessionsDir || path.join(HOME, 'sessions');
  ensureDir(sessionsDir);
  const id = `t${++engine.sessionSeq}`;
  const script = path.join(sessionsDir, `login-${Date.now()}.command`);
  const home = deps.home || os.homedir();
  // 0o700 como os outros scripts de sessão
  fs.writeFileSync(script, montarScript(engine, dir, id, linhasDoCelular(home)), { mode: 0o700 });
  if (dentroDoProot(sinais)) {
    return { ok: false, code: 'copiar-comando', onde: 'termux', comando: comandoDoTermux(deps.distro || distroDoLinux(), script) };
  }
  return { ok: false, code: 'copiar-comando', onde: 'terminal', comando: comandoDeTerminal(script) };
}

export default { semTerminal, linhasDoCelular, dentroDoProot, comandoDoTermux, comandoDeTerminal };
export { semTerminal, linhasDoCelular, dentroDoProot, comandoDoTermux, comandoDeTerminal };
