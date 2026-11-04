// Git da fonte de revisão: roda sobre repositório de código não confiável, então não herda nada da
// máquina (03/11/2026). `~/.gitconfig` e o config de sistema podem trazer `core.fsmonitor`,
// `core.hooksPath`, `url.*.insteadOf`, filtro de smudge e helper de credencial, e qualquer um deles
// executa comando ou troca o servidor de onde o código vem.
//
// POR QUE AQUI ISOLA E `git-env.js` NÃO: lá o repositório é descoberto pelo cwd, e o git confere o dono
// da pasta contra o `safe.directory`, que mora no config global. Aqui é sempre `--git-dir` explícito
// para o cache que o próprio Farol criou, e essa conferência só existe na descoberta. Quem lê o material
// depois pelo cwd (lib/technical-review/) continua com `envSemRepositorioHerdado`, de propósito.
//
// O DISPOSITIVO NULO NÃO É `os.devNull` NO WINDOWS: medido em 03/11/2026 com o git 2.54, `\\.\nul` em
// GIT_CONFIG_GLOBAL dá "unable to access: Invalid argument" em todo comando. `nul` funciona.
//
// O QUE SE PERDE JUNTO, e por isso volta explícito no Windows: o system traz `http.sslBackend=schannel`,
// o que faz o fetch confiar no repositório de certificados da máquina, e `core.longpaths` costuma morar
// no global (a pasta do material já é funda). Proxy e CA próprios do `~/.gitconfig` deixam de valer;
// HTTPS_PROXY e GIT_SSL_CAINFO continuam, porque são da máquina e não executam nada.
import { semAsVariaveis } from './env.js';
import { variaveisDeRepositorio } from './git-env.js';
import { IS_WIN } from './paths.js';

const NULO = IS_WIN ? 'nul' : '/dev/null';

// Variáveis que executam comando ou passam por cima das travas abaixo: GIT_ALLOW_PROTOCOL vence o
// `protocol.*`, e a lista do git (`variaveisDeRepositorio`) sai vazia se a consulta falhar.
const VARIAVEIS_PROIBIDAS = [
  'GIT_SSH', 'GIT_SSH_COMMAND', 'GIT_SSH_VARIANT', 'GIT_PROXY_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS',
  'GIT_ALLOW_PROTOCOL', 'GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'GIT_EDITOR', 'GIT_TEMPLATE_DIR',
  'GIT_CONFIG', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_SYSTEM',
];

function envGitIsolado() {
  return {
    ...semAsVariaveis([...variaveisDeRepositorio(), ...VARIAVEIS_PROIBIDAS]),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: NULO, GIT_ATTR_NOSYSTEM: '1',
    GIT_LFS_SKIP_SMUDGE: '1', GIT_TERMINAL_PROMPT: '0',
  };
}

const CONFIGURACOES = [
  `core.hooksPath=${NULO}`, 'core.fsmonitor=false', `core.attributesFile=${NULO}`,
  // só https: o endereço do fetch é montado aqui, e nada no repositório o troca
  'protocol.allow=never', 'protocol.https.allow=always',
  'submodule.recurse=false', 'fetch.recurseSubmodules=false',
  'credential.helper=',
  'filter.lfs.smudge=', 'filter.lfs.process=', 'filter.lfs.required=false',
  ...(IS_WIN ? ['core.longpaths=true', 'http.sslBackend=schannel'] : []),
];
const FLAGS_GIT_ISOLADO = Object.freeze(CONFIGURACOES.flatMap(valor => ['-c', valor]));

export { envGitIsolado, FLAGS_GIT_ISOLADO };
