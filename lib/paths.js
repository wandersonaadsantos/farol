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

// teto TOTAL de PRs mergeados lidos por org na aba Entregas. Uma consulta de busca
// do GitHub devolve no máximo 1000 (lib/engine/entregas-fatias.js, CONSULTA_MAX),
// então acima disso a janela é fatiada por data de merge. Chegando aqui a UI avisa
// (flag capped) e mostra os merges mais recentes.
const DELIVERIES_LIMIT = 5000;

// O Farol nasceu no Windows; o suporte a macOS vive nos branches IS_WIN/IS_MAC.
// Toda diferença de SO passa por aqui, nunca espalhada em checagens soltas.
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// Doutrina desde a v2.45.0: POSIX genuíno (runShell, spawn headless, killTree,
// PATH do boot) ramifica em !IS_WIN; o que é mac de verdade (open, Farol.app)
// usa IS_MAC; o ramo Linux fica ao lado, experimental.
const IS_LINUX = process.platform === 'linux';

// "estou rodando como root?" Mora aqui junto do resto do branch de plataforma:
// `process.getuid` só existe no posix (no Windows nem a função existe, e lá não
// há uid nenhum pra comparar). Quem pergunta é o doctor, porque o claude RECUSA
// `--dangerously-skip-permissions` com uid 0, e nesse caso toda revisão autônoma
// morre no instante do spawn. Cenário real e nada exótico: o login padrão do
// proot Debian (Termux, no Android) É root.
function rodandoComoRoot() {
  try { return typeof process.getuid === 'function' && process.getuid() === 0; } catch { return false; }
}

// IMPORTANTE: fora do AppData de propósito. O Claude Code pode rodar empacotado
// (MSIX) e aí o %LOCALAPPDATA% é VIRTUALIZADO: o que ele escreve vai pro overlay
// do pacote (Packages\...\LocalCache) e o app nunca vê. ~/.farol não é virtualizado.
//
// Sob o executor de testes (`NODE_TEST_CONTEXT`) e sem FAROL_HOME, o HOME é um diretório
// temporário, NUNCA o ~/.farol real. Existe por causa de um incidente (15/09/2026): um
// teste com import estático deste módulo, rodado sozinho, resolveu HOME antes da env
// isolada e gravou config, credencial e chaves de teste por cima das reais. A trava
// estática (test/test-isolation.test.js) só roda na suíte inteira; esta vale em qualquer
// processo de teste. O aviso vai para stderr, para o descuido continuar visível.
function homeDoFarol() {
  if (process.env.FAROL_HOME) return process.env.FAROL_HOME;
  if (!process.env.NODE_TEST_CONTEXT) return path.join(os.homedir(), '.farol');
  const provisorio = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-teste-sem-home-'));
  process.emitWarning(`teste sem FAROL_HOME: dados redirecionados para ${provisorio}, nunca para o ~/.farol real`);
  return provisorio;
}
const HOME = homeDoFarol();
const WORKSPACE = path.join(HOME, 'workspace');
const STATE_DIR = path.join(WORKSPACE, 'state');
const CONFIG_FILE = path.join(HOME, 'config.json');
const LOG_FILE = path.join(STATE_DIR, 'farol.log');
const SEEN_FILE = path.join(STATE_DIR, 'seen');
const IGNORED_FILE = path.join(STATE_DIR, 'ignored');
const BASELINE_FILE = path.join(STATE_DIR, 'baselined');
const INFLIGHT_FILE = path.join(STATE_DIR, 'inflight.json');
const CHATS_FILE = path.join(STATE_DIR, 'chats.json');
const SELF_FILE = path.join(STATE_DIR, 'self-analyses.json');
// PRs meus que o usuário mandou sumir de "Meus PRs" (mapa key -> { at, updatedAt }).
// Fica em state/ como o resto: é estado do app, não configuração.
const HIDDEN_FILE = path.join(STATE_DIR, 'hidden-prs.json');
// Até quando cada assinatura do Claude está no limite do plano (lib/engine/limite-plano.js).
// Em disco porque reiniciar o Farol durante o limite disparava a fila inteira de novo.
const LIMITE_PLANO_FILE = path.join(STATE_DIR, 'limite-plano.json');
// Rastro das mudanças na política de automação (lib/engine/contas-config.js): quem mudou o
// quê, quando e de onde. Sem ele, uma conta em "aguardar" que ninguém lembra de ter posto
// não tinha como ser explicada.
const POLITICA_HISTORICO_FILE = path.join(STATE_DIR, 'politica-historico.json');
const TEMPLATE_DIR = path.join(APP_ROOT, 'workspace-template');
const UI_DIR = path.join(APP_ROOT, 'ui');

// Autenticação da API local (A4): sessões e códigos de pareamento. Fora do workspace da
// sessão de revisão, como a credencial do Jira, porque a sessão do Claude lê o workspace.
const LOCAL_AUTH_DIR = path.join(HOME, 'local-auth');

// Sinais do modo celular (A4, spec 7.A4 item 1). A leitura mora aqui por dois motivos:
// process.env só é lido em lib/paths.js e lib/env.js (gate processEnvDireto), e diferença
// de ambiente passa por este arquivo (invariante 5). Quem decide é lib/local-auth/modo.js,
// que é puro. O osrelease cobre o proot, onde as variáveis do Termux podem não chegar.
function sinaisDoModoCelular() {
  let osrelease = '';
  try { osrelease = fs.readFileSync('/proc/sys/kernel/osrelease', 'utf8'); } catch { /* fora do Linux o arquivo não existe: sinal vazio */ }
  return {
    platform: process.platform,
    env: { TERMUX_VERSION: process.env.TERMUX_VERSION || '', PREFIX: process.env.PREFIX || '' },
    osrelease,
  };
}

// Nome da distribuição Linux (o ID do /etc/os-release). No celular é o que o
// `proot-distro login <nome>` espera: o Farol roda DENTRO do proot e o comando de login
// que ele entrega é colado no Termux, FORA dele (lib/engine/login-celular.js). Sem o
// arquivo, devolve '' e quem chama decide o que dizer.
function distroDoLinux() {
  let texto = '';
  try { texto = fs.readFileSync('/etc/os-release', 'utf8'); } catch { /* fora do Linux o arquivo não existe */ }
  const m = texto.match(/^ID=["']?([A-Za-z0-9._-]+)["']?\s*$/m);
  return m ? m[1] : '';
}

export default {
  executadoDireto, rodandoComoRoot, sinaisDoModoCelular, distroDoLinux,
  APP_VERSION, APP_NAME, DELIVERIES_LIMIT, IS_WIN, IS_MAC, IS_LINUX, APP_ROOT,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, IGNORED_FILE, BASELINE_FILE,
  INFLIGHT_FILE, CHATS_FILE, SELF_FILE, HIDDEN_FILE, LIMITE_PLANO_FILE, POLITICA_HISTORICO_FILE, TEMPLATE_DIR, UI_DIR, LOCAL_AUTH_DIR,
};
export {
  executadoDireto, rodandoComoRoot, sinaisDoModoCelular, distroDoLinux,
  APP_VERSION, APP_NAME, DELIVERIES_LIMIT, IS_WIN, IS_MAC, IS_LINUX, APP_ROOT,
  HOME, WORKSPACE, STATE_DIR, CONFIG_FILE, LOG_FILE, SEEN_FILE, IGNORED_FILE, BASELINE_FILE,
  INFLIGHT_FILE, CHATS_FILE, SELF_FILE, HIDDEN_FILE, LIMITE_PLANO_FILE, POLITICA_HISTORICO_FILE, TEMPLATE_DIR, UI_DIR, LOCAL_AUTH_DIR,
};
