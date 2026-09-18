// Autostart no macOS por LaunchAgent.
//
// O login item do Electron (`app.setLoginItemSettings`) registra o bundle que está rodando,
// e aqui esse bundle é o Electron.app de dentro de node_modules: no mac ele ignora `args`,
// então o login abriria o Electron pelado, sem o app. O LaunchAgent abre o lançador
// ~/Applications/Farol.app que o installer/install.sh cria, pelo `/usr/bin/open`, que é o
// mesmo caminho de um clique no Finder.
//
// O arquivo mora em ~/Library/LaunchAgents porque é lá que o launchd procura, e não por
// exceção ao invariante 2: nenhum DADO do Farol vai para Library. Não há `launchctl load`:
// o agente vale a partir do próximo login, e carregar agora abriria uma segunda instância.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROTULO = 'com.biud.farol.autostart';

function escaparXml(texto) {
  return String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function caminhoDoLancador(casa) {
  return path.join(casa, 'Applications', 'Farol.app');
}

function caminhoDoAgente(casa) {
  return path.join(casa, 'Library', 'LaunchAgents', `${ROTULO}.plist`);
}

// Sem KeepAlive de propósito: fechar o Farol pela bandeja não pode fazer o launchd reabrir.
function plistDoAgente(lancador) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${ROTULO}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/open</string>
    <string>-a</string>
    <string>${escaparXml(lancador)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
}

function lerOuVazio(arquivo) {
  try { return fs.readFileSync(arquivo, 'utf8'); } catch { return ''; }
}

// Devolve `{ ok, mudou }` ou `{ ok: false, code, motivo }`; nunca lança, porque quem chama
// é o shell Electron reagindo a uma troca de configuração.
function aplicarAutostartMac({ ligado, casa = os.homedir() } = {}) {
  const agente = caminhoDoAgente(casa);
  try {
    if (!ligado) {
      if (!fs.existsSync(agente)) return { ok: true, mudou: false };
      fs.rmSync(agente, { force: true });
      return { ok: true, mudou: true };
    }
    const lancador = caminhoDoLancador(casa);
    if (!fs.existsSync(lancador)) {
      return { ok: false, code: 'sem-lancador', motivo: `o lançador ${lancador} não existe; instale pelo Instalar.command` };
    }
    const conteudo = plistDoAgente(lancador);
    if (lerOuVazio(agente) === conteudo) return { ok: true, mudou: false };
    fs.mkdirSync(path.dirname(agente), { recursive: true });
    fs.writeFileSync(agente, conteudo, { mode: 0o644 });
    return { ok: true, mudou: true };
  } catch (err) {
    return { ok: false, code: 'falha-de-escrita', motivo: String((err && err.message) || err) };
  }
}

export default { ROTULO, plistDoAgente, aplicarAutostartMac, caminhoDoAgente };
export { ROTULO, plistDoAgente, aplicarAutostartMac, caminhoDoAgente };
