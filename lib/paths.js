// Camada base de constantes: versão, plataforma e caminhos. Os módulos colaboradores
// de lib/engine/ importam daqui em vez de depender do server.js (evita ciclo e deixa a
// dependência explícita). Ver docs/QUALITY.md (Onda 2) e CLAUDE.md (invariante 2 e 5).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

// "Fui executado direto, ou fui importado?" Substitui o `require.main === module` do
// CommonJS, que comparava OBJETOS de módulo (chaveados pelo caminho REAL, então
// symlink não atrapalhava). A tradução ingênua da migração ESM comparava
// `import.meta.url === pathToFileURL(process.argv[1]).href`, e esses dois lados não
// vêm da mesma fonte: import.meta.url já vem resolvido por realpath, argv[1] é o que
// o usuário digitou. Caminho ABSOLUTO por symlink fazia a guarda dar falso e o
// processo carregar tudo, não subir nada e sair 0, em silêncio. No macOS isso pega
// direto, porque /tmp e /var/folders SÃO symlinks. Resolver os dois lados por
// realpath é o que restaura o comportamento do CommonJS.
// argv1 inexistente (node -e, REPL) ou ilegível devolve false em vez de lançar:
// falta de dado nunca pode derrubar o boot.
function executadoDireto(metaUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try { return metaUrl === pathToFileURL(fs.realpathSync(argv1)).href; } catch { return false; }
}

// raiz do app (onde vivem server.js, workspace-template/, ui/). Como este módulo
// mora em lib/, sobe um nível. É a âncora de TEMPLATE_DIR/UI_DIR e do check de
// "rodando direto da fonte" no update.
const APP_ROOT = path.dirname(import.meta.dirname);

// package.json ilegível/corrompido não pode impedir o boot; a versão é só informativa.
let APP_VERSION = '0.0.0';
try { APP_VERSION = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version; } catch { /* fallback acima */ }
const APP_NAME = 'Farol';

// teto de PRs mergeados lidos por org na aba Entregas: 1000 é o máximo que o gh
// search devolve. Além disso não há como paginar por essa API, então a UI avisa
// (flag capped) e mostra os 1000 mais recentes.
const DELIVERIES_LIMIT = 1000;

// O Farol nasceu no Windows; o suporte a macOS vive nos branches IS_WIN/IS_MAC.
// Toda diferença de SO passa por aqui, nunca espalhada em checagens soltas.
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// Doutrina desde a v2.45.0: POSIX genuíno (runShell, spawn headless, killTree,
// PATH do boot) ramifica em !IS_WIN; o que é mac de verdade (open, Farol.app)
// usa IS_MAC; o ramo Linux fica ao lado, experimental.
const IS_LINUX = process.platform === 'linux';

// IMPORTANTE: fora do AppData de propósito. O Claude Code pode rodar empacotado
// (MSIX) e aí o %LOCALAPPDATA% é VIRTUALIZADO: o que ele escreve vai pro overlay
// do pacote (Packages\...\LocalCache) e o app nunca vê. ~/.farol não é virtualizado.
const HOME = process.env.FAROL_HOME || path.join(os.homedir(), '.farol');
const WORKSPACE = path.join(HOME, 'workspace');
const STATE_DIR = path.join(WORKSPACE, 'state');
const CONFIG_FILE = path.join(HOME, 'config.json');
const LOG_FILE = path.join(STATE_DIR, 'farol.log');
const SEEN_FILE = path.join(STATE_DIR, 'seen');
const BASELINE_FILE = path.join(STATE_DIR, 'baselined');
const INFLIGHT_FILE = path.join(STATE_DIR, 'inflight.json');
const CHATS_FILE = path.join(STATE_DIR, 'chats.json');
const SELF_FILE = path.join(STATE_DIR, 'self-analyses.json');
// PRs meus que o usuário mandou sumir de "Meus PRs" (mapa key -> { at, updatedAt }).
// Fica em state/ como o resto: é estado do app, não configuração.
const HIDDEN_FILE = path.join(STATE_DIR, 'hidden-prs.json');
const TEMPLATE_DIR = path.join(APP_ROOT, 'workspace-template');
const UI_DIR = path.join(APP_ROOT, 'ui');

export default {
  executadoDireto,
  APP_VERSION, APP_NAME, DELIVERIES_LIMIT, IS_WIN, IS_MAC, IS_LINUX, APP_ROOT,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, BASELINE_FILE,
  INFLIGHT_FILE, CHATS_FILE, SELF_FILE, HIDDEN_FILE, TEMPLATE_DIR, UI_DIR,
};
export {
  executadoDireto,
  APP_VERSION, APP_NAME, DELIVERIES_LIMIT, IS_WIN, IS_MAC, IS_LINUX, APP_ROOT,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, BASELINE_FILE,
  INFLIGHT_FILE, CHATS_FILE, SELF_FILE, HIDDEN_FILE, TEMPLATE_DIR, UI_DIR,
};
