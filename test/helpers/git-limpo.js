// Ambiente isolado para teste que roda `git` de verdade.
//
// POR QUE EXISTE: um hook de `git push` exporta GIT_DIR (e mais uma dezena de
// variaveis) para tudo que ele dispara, `npm test` incluido. Comando de git que
// herda isso para de falar com o repositorio temporario do proprio teste e passa
// a falar com o repositorio que disparou o push.
//
// Nao e hipotese, foi medido em 30/08/2026: a montagem de repositorio de prova
// rodou `git init` herdando o GIT_DIR de uma worktree ligada, e essa combinacao
// (gitdir de worktree, que nao tem arvore de trabalho ao lado) reinicializou o
// repositorio do Farol como BARE, gravando `core.bare = true` no config
// COMPARTILHADO. O `git config user.email/user.name` seguinte gravou a identidade
// do teste no mesmo lugar. Os dois estragos sao de gravidade diferente e vale
// separar: identidade contaminada poe autor errado em qualquer commit, e o
// `core.bare` derrubou todo `git check-ignore` da suite em seguida, fazendo o
// teste do `.gitignore` acusar a fonte por um defeito que estava no ambiente.
//
// Sao DUAS metades, porque os dois problemas sao diferentes:
//
// 1. As variaveis de repositorio LOCAL sao REMOVIDAS, para o git voltar a
//    descobrir o repositorio a partir do cwd, que e o que o teste controla. Essa
//    metade e a mesma de que a producao precisa, entao ela mora em
//    `tools/git-env.js` e e so reaproveitada aqui.
//
// 2. O config GLOBAL e o de SISTEMA sao apontados para um caminho VAZIO, e nao
//    removidos: a maquina de quem roda a suite pode ter assinatura obrigatoria,
//    `init.templateDir` ou hooks proprios, e qualquer um deles muda o resultado
//    sem ter relacao nenhuma com o que o teste afirma.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { envSemRepositorioHerdado } from '../../tools/git-env.js';

// Caminho que nao existe, em vez de arquivo vazio de verdade: git le config
// ausente como config vazio (medido) e nao cria nada. `/dev/null` nao serve porque o
// dispositivo nulo tem outro nome no Windows, e esta suite roda nos tres sistemas.
// O caminho fica DENTRO de uma pasta de nome aleatorio (05/10/2026): com nome fixo no tmp
// compartilhado do Linux, outro usuario podia criar o arquivo antes e o git o leria como
// config global, com core.fsmonitor ou core.hooksPath executando comando no teste. A
// pasta vazia sai quando o processo termina.
const PASTA_NEUTRA = fs.mkdtempSync(path.join(os.tmpdir(), 'farol-teste-gitconfig-'));
process.on('exit', () => { try { fs.rmSync(PASTA_NEUTRA, { recursive: true, force: true }); } catch { /* pasta vazia, best-effort */ } });
const CONFIG_NEUTRO = path.join(PASTA_NEUTRA, 'inexistente');

/**
 * `process.env` sem o que faria o git falar com outro repositorio, nem com o
 * config da maquina.
 *
 * Use como `env` de TODA chamada de git em teste, inclusive a que so consulta:
 * consulta que responde pelo repositorio errado nao estraga nada em disco, mas
 * afirma o que nao mediu, que e o modo de falha caro aqui.
 */
export function envGitLimpo(extra = {}) {
  const env = envSemRepositorioHerdado();
  env.GIT_CONFIG_GLOBAL = CONFIG_NEUTRO;
  env.GIT_CONFIG_SYSTEM = CONFIG_NEUTRO;
  return { ...env, ...extra };
}
