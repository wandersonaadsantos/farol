// Git da fonte de revisão: roda sobre repositório de código não confiável, então não herda nada da
// máquina (03/11/2026). `~/.gitconfig` e o config de sistema podem trazer `core.fsmonitor`,
// `core.hooksPath`, `url.*.insteadOf`, filtro de smudge e helper de credencial, e qualquer um deles
// executa comando ou troca o servidor de onde o código vem.
//
// POR QUE AQUI ISOLA E `git-env.js` NÃO: lá o repositório é descoberto pelo cwd, e o git confere o dono
// da pasta contra o `safe.directory`, que mora no config global. Aqui é sempre `--git-dir` explícito
// para o cache que o próprio Farol criou, e essa conferência só existe na descoberta. Quem lê o material
// depois pelo cwd (lib/technical-review/) continua com `envSemRepositorioHerdado`, de propósito, e leva
// só as travas de `FLAGS_GIT_SOBRE_MATERIAL`.
//
// O DISPOSITIVO NULO NÃO É `os.devNull` NO WINDOWS: medido em 03/11/2026 com o git 2.54, `\\.\nul` em
// GIT_CONFIG_GLOBAL dá "unable to access: Invalid argument" em todo comando. `nul` funciona.
//
// O QUE VOLTA EXPLÍCITO: o system do Windows traz `http.sslBackend=schannel`, que faz o fetch confiar no
// repositório de certificados da máquina, e `core.longpaths` costuma morar no global (sem ele o
// `worktree add` passa e o `status` acusa ` D` em caminho longo). A rede de quem usa proxy ou CA
// corporativa volta por `flagsDeRede`, lista fechada lida do config global só para o fetch.
//
// LIMITES: GIT_SSL_CAINFO sozinho NÃO vale com schannel, que o ignora sem `http.schannelUseSSLCAInfo`;
// por isso `flagsDeRede` o liga quando o schannel é escolha nossa. Proxy com usuário e senha na URL não
// é repassado, porque `-c` fica na linha de comando e no spawnlog: esse caso usa HTTPS_PROXY. Chave por
// URL (`http.https://github.com.proxy`) fica de fora da lista. O config dentro do repositório bare do
// cache não é conferido.
import path from 'node:path';
import io from './io.js';
import { semAsVariaveis } from './env.js';
import { envSemRepositorioHerdado, variaveisDeRepositorio } from './git-env.js';
import { IS_WIN } from './paths.js';

const NULO = IS_WIN ? 'nul' : '/dev/null';
const CAMINHOS_LONGOS = IS_WIN ? ['-c', 'core.longpaths=true'] : [];

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
  ...(IS_WIN ? ['http.sslBackend=schannel'] : []),
];
const FLAGS_GIT_ISOLADO = Object.freeze([...CONFIGURACOES.flatMap(valor => ['-c', valor]), ...CAMINHOS_LONGOS]);

// Para quem lê o material pelo cwd com o ambiente da máquina, porque precisa do `safe.directory`: o
// `git status` executava o `core.fsmonitor` do `~/.gitconfig`, que lia o GH_TOKEN do processo.
const FLAGS_GIT_SOBRE_MATERIAL = Object.freeze(['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', ...CAMINHOS_LONGOS]);

const TETO_DA_LEITURA_MS = 5_000;
const TETO_DO_VALOR = 2048;
const BACKENDS = new Set(['schannel', 'openssl', 'gnutls', 'nss', 'secure-transport', 'mbedtls', 'wolfssl']);
// Sem `@`: credencial no `-c` ficaria visível na lista de processos e no spawnlog.
const PROXY = /^(?:(?:https?|socks4a?|socks5h?):\/\/)?[A-Za-z0-9._-]+(?::\d{1,5})?\/?$|^(?:(?:https?|socks4a?|socks5h?):\/\/)?\[[0-9A-Fa-f:.]+\](?::\d{1,5})?\/?$/;
const proxyValido = valor => PROXY.test(valor);
const CHAVES_DE_REDE = Object.freeze({
  'http.proxy': proxyValido,
  'https.proxy': proxyValido,
  'http.sslCAInfo': valor => path.isAbsolute(valor),
  'http.sslBackend': valor => BACKENDS.has(valor),
  'http.schannelUseSSLCAInfo': valor => /^(?:true|false|yes|no|on|off|1|0)$/i.test(valor),
});

// Só `git config --global --get`, que lê arquivo e não executa nada. Chave ausente, valor fora da
// forma ou falha de leitura ficam de fora: sem o valor o fetch segue com o que a máquina der.
async function redeDoConfigGlobal(signal) {
  const achados = {};
  for (const [chave, valida] of Object.entries(CHAVES_DE_REDE)) {
    const tipo = chave === 'http.sslCAInfo' ? ['--type=path'] : [];
    const lido = await io.run('git', ['config', '--global', ...tipo, '--get', chave], { env: envSemRepositorioHerdado(), signal, timeout: TETO_DA_LEITURA_MS });
    const valor = lido.ok ? String(lido.stdout || '').trim() : '';
    if (valor && valor.length <= TETO_DO_VALOR && !/[\x00-\x1f\x7f]/.test(valor) && valida(valor)) achados[chave] = valor;
  }
  return achados;
}

// `-c` em ordem da lista; o último vence, então o backend declarado passa por cima do schannel padrão.
function flagsDeRede(achados, caDoAmbiente = '', windows = IS_WIN) {
  const flags = Object.entries(achados).flatMap(([chave, valor]) => ['-c', `${chave}=${valor}`]);
  const schannelNosso = windows && !achados['http.sslBackend'];
  const declarouCa = achados['http.sslCAInfo'] || caDoAmbiente;
  if (schannelNosso && declarouCa && !achados['http.schannelUseSSLCAInfo']) flags.push('-c', 'http.schannelUseSSLCAInfo=true');
  return flags;
}

async function flagsDeRedeDaMaquina(signal) {
  return flagsDeRede(await redeDoConfigGlobal(signal), envGitIsolado().GIT_SSL_CAINFO || '');
}

export { envGitIsolado, FLAGS_GIT_ISOLADO, FLAGS_GIT_SOBRE_MATERIAL, CHAVES_DE_REDE, redeDoConfigGlobal, flagsDeRede, flagsDeRedeDaMaquina };
