# Evidência: validação POSIX em Linux isolado (16/09/2026)

## Ambiente (identificado)

| Item | Valor |
|---|---|
| Hospedeiro | Docker Desktop sobre WSL2 (kernel `6.18.33.2-microsoft-standard-WSL2`), nesta máquina Windows 11 |
| Imagem | `node` local, id `8510330d3eb7`, Alpine Linux, **Node 24.14.1** (já existente, nada foi baixado) |
| Sistema de arquivos dos testes | `overlay` dentro do container (semântica POSIX de permissão real) |
| Usuário | `node`, uid 1000 (root recusado de propósito: a admissão local recusa uid 0) |
| Rede | `--network none` |
| Fonte | `git archive` do commit integrado (sem arquivos fora do git) |
| Faltam na imagem | `git` e `bash` |

**Não vale como prova de Android/Termux.** Não mede `scrypt` no celular nem a detecção
do modo celular.

## Resultado

Suíte inteira como uid 1000: **3793 testes, 3724 aprovados, 9 falhas, 60 pulados, 0
cancelados.** As 9 falhas são todas de testes que chamam `git` (gate do eng-behaviour,
raiz do repositório, versionamento do workspace-template), ausente na imagem. Os pulados
são ramos só de Windows e 5 execuções reais com `bash`, ausente.

Arquivos com prova POSIX específica, rodados isoladamente:

| Arquivo | Resultado | O que prova |
|---|---|---|
| `sync-cache-chave` | 8 de 8, 0 pulados | cache da chave do conjunto com modo 0600 a cada gravação |
| `sync-admin-chave` | 7 de 7 | chave do admin 0600 |
| `sync-credentials` | 10 de 10 | credencial do Firebase 0600 |
| `sync-politicas` | 14 de 14 | cache de política 0600 |
| `jira-credentials` | 5 de 5 | credencial do Jira 0600 |
| `local-auth-pareamento` | 11 de 11 | pareamentos da A4 0600 |
| `local-auth-sessoes` | 9 de 9 | sessões da A4 0600 |
| `usage-interrompida-processo` | 4 de 4 | ramo `/bin/sh -lc` com grupo destacado (A1) |
| `session-posix` | 16 aprovados, 5 pulados (sem `bash`) | `killTree` do grupo de processos |

**Intermitência observada:** `session-posix` falhou 1 vez em 18 rodadas no container, sem
reproduzir depois (0 em 17 com captura TAP). Fica registrado sem causa identificada.

## Roteiro

`roteiros/posix-container.sh <imagem-node-24> [arquivos]`, com o critério escrito no
cabeçalho.

---

## Segunda rodada, 16/09/2026 à tarde (HEAD `a576729`)

Mesma imagem local do Node 24 (`8510330d3eb7`, v24.14.1), sem rede, usuário `node` (uid 1000),
sobre a árvore commitada, com o código da tela de pareamento, da vigília do stream, das
verificações A, B e C, do Diagnóstico e de Plano e chaves.

| Medida | Resultado |
|---|---|
| Suíte completa | 3959 testes, 3882 aprovados, 68 pulados, 9 falhas, `rc=1` |
| As 9 falhas | todas de testes que chamam `git` (`eng-behaviour-gate`, 6; `protocolo-versionado`, 3), e a imagem não tem git: `spawnSync git ENOENT`. Mesmo critério da primeira rodada |
| Testes de permissão pulados | nenhum |
| `local-auth-stream-revogado`, `local-auth-tentativa`, pareamento, diagnóstico, capacidades | aprovados |
| `perfil-claude-sem-escrita` | 1 aprovado ("CLI que falha ainda apaga a cópia efêmera"); **3 pulados de propósito**: o shell de login do Alpine reescreve o PATH, o `claude` falso deixa de ser o executado, e o teste se recusa a provar com outro binário |

**O que continua sem prova em POSIX:** o `chmod 0700` da cópia efêmera do teste de perfil e a
varredura das cópias velhas. Prová-los aqui exige um `claude` falso que o shell de login
enxergue (instalar no PATH do sistema do contêiner), o que ficou fora desta rodada. No Windows
os três casos passam.

---

## Terceira rodada, com git no ambiente (16/09/2026, noite)

Ramo `md/posix-com-git`, a partir de `md/integracao` (`1a46b7a`).

### Ambiente

| Item | Valor |
|---|---|
| Imagem | `farol-posix:teste`, construída de `tools/emuladores/Dockerfile` (a mesma receita da `farol-emuladores:15.30.1`, com uma linha a mais, ver abaixo) |
| Base | `node:24-trixie-slim`, Debian GNU/Linux 13 (trixie) |
| Node | v24.21.0 |
| git | 2.47.3 (o que faltava nas duas rodadas anteriores) |
| bash | `/usr/bin/bash` (faltava na imagem Alpine, e era o que pulava 5 casos de `session-posix`) |
| Usuário | `node`, uid 1000 |
| Rede | `--network none` |
| Fonte | CLONE do repositório, montado somente leitura em `/fonte-git`; o hospedeiro não é escrito |
| Sistema de arquivos | `overlay` dentro do contêiner |

Roteiro versionado: [`roteiros/posix-com-git.md`](../roteiros/posix-com-git.md) e
[`roteiros/posix-com-git-dentro.sh`](../roteiros/posix-com-git-dentro.sh).

Comando exato (Git Bash no Windows, caminhos do hospedeiro em `C:/...`):

    MSYS_NO_PATHCONV=1 docker run --rm --name farol-posix --network none --user node \
      -e HOME=/tmp/casa -e RAMO=md/posix-com-git \
      -v "C:/Users/wanderson/Documents/farol/.git:/fonte-git:ro" \
      -v "<pasta-dos-roteiros>:/roteiro:ro" \
      farol-posix:teste sh /roteiro/posix-com-git-dentro.sh

### As duas rodadas

| Rodada | Fonte | Testes | Aprovados | Falhas | Pulados | Código de saída |
|---|---|---|---|---|---|---|
| Antes da correção (`1a46b7a`) | `git archive` (sem `.git`) | 4198 | 4168 | **3** | 27 | 1 |
| Depois da correção (`e9a97fc`) | clone | 4297 | 4275 | **0** | 22 | 0 |
| Repetição da mesma (`e9a97fc`) | clone | 4301 | 4279 | **0** | 22 | 0 |

Saídas brutas: `verificacoes-saidas/posix-com-git-1-antes.txt`,
`posix-com-git-2-depois.txt`, `posix-com-git-3-repeticao.txt`,
`posix-com-git-windows.txt`.

**As 9 falhas da segunda rodada sumiram.** Elas eram `eng-behaviour-gate` (6) e
`protocolo-versionado` (3), todas `spawnSync git ENOENT`. Com git na imagem, o gate do
eng-behaviour passa e os três de `protocolo-versionado` deixam de morrer por ENOENT.

**As 3 que sobraram na rodada "antes" têm causa MEDIDA, e não é POSIX:** `git archive`
entrega a árvore sem `.git`, e os três casos de `test/protocolo-versionado.test.js` consultam
o versionamento (`fatal: not a git repository`, na saída bruta). Trocado o transporte por um
CLONE, os três rodam e passam. Nada foi afrouxado.

**Oscilação da contagem TOTAL, sem oscilação do resultado.** Três execuções do MESMO commit
deram 4275, 4297 e 4301 testes, sempre com `fail 0` e `skipped 22`. A diferença está em
quantas linhas o relator alcança emitir antes de o `--test-force-exit` (que é o `npm test` do
projeto) encerrar o processo; sem a flag a suíte não termina no contêiner, que é a razão de
ela existir. O que decide continua sendo o código de saída do runner, e ele foi 0 nas duas
execuções pós-correção.

### Os casos que estavam pulados por causa do `claude` falso

Eram **5** nesta imagem (a segunda rodada relatou 3, com a suíte de então), todos em
`test/perfil-claude-sem-escrita.test.js`, com o motivo
`o shell de login resolve outro claude ()`. A causa medida: `io.runShell` no POSIX é
`/bin/sh -lc`, e o shell de LOGIN do Debian reescreve o PATH
(`/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games`), então a pasta temporária com o
`claude` falso some e ele deixa de ser o executado.

O que mudou, sem relaxar nenhuma asserção:

1. **Preparação do ambiente de teste** (`tools/emuladores/Dockerfile`): `chown node:node
   /usr/local/bin`, o primeiro diretório do PATH de login. Vale só na imagem de teste, e nada
   disto entra no pacote do Farol.
2. **O teste instala o MESMO falso** no primeiro diretório gravável do PATH de login, e só
   quando ali não existe `claude` nenhum (criação exclusiva, `wx`, para dois arquivos de teste
   em paralelo não disputarem o nome). O `after` desinstala. Onde não dá para instalar (uma
   máquina com `claude` de verdade, ou `/usr/local/bin` do sistema), o caso continua PULADO
   com o motivo: nada é declarado aprovado sem ter rodado.

Resultado no contêiner: `test/perfil-claude-sem-escrita.test.js` passou de **1 aprovado e 5
pulados** para **7 aprovados, 0 pulados**.

### Contraprova por mutação (dentro do contêiner)

`lib/engine/perfil-claude.js`, uma mutação por vez, restaurado byte a byte (sha256
`5ee8e4165fcc18e5a23a1a8e37ef6b3187ba3d65febb10103e06047b80967661` antes e depois de cada uma).

| Mutação | Efeito | Saída bruta |
|---|---|---|
| tirar o `fs.chmodSync(copia, 0o700)` | 1 reprovado ("a cópia efêmera é restringida (chmod 0700) antes de receber arquivo") | `posix-com-git-mutacao-1-sem-chmod.txt` |
| não apagar a cópia no `finally` | 3 reprovados (a pasta do perfil, o padrão da máquina e o CLI que falha) | `posix-com-git-mutacao-2-sem-apagar.txt` |

A primeira mutação mostra qual caso de fato prova o 0700: `mkdtempSync` já nasce 0700 no
Linux por umask, então a asserção de MODO da cópia passaria mesmo sem o chmod. Quem pega a
regressão é a asserção de ORDEM (restringir antes de copiar), e ela pegou.

### Os 22 pulos que restam, por arquivo

| Arquivo | Pulos | Motivo |
|---|---|---|
| `test/diagnostico-ia-execucao.test.js` | 3 | mesmo `claude` falso do PATH de login. O nome `claude` é um só no PATH: se este arquivo instalasse o dele também, um executaria o falso do outro. Ficou com o motivo escrito |
| `test/facades.test.js` | 4 | exceções DECLARADAS da trava de fachada (parâmetro com default zera o `Function.length`); pulam em qualquer sistema operacional, Windows inclusive |
| `test/installer-runtime.test.js` | 4 | instalador Windows: PowerShell nativo e hardlink NTFS |
| `test/installer-compatibility.test.js` | 2 | preflight do instalador Windows (PowerShell nativo) |
| `test/io-taxonomy.test.js` | 2 | `detectGitBash` e o UTF-8 do `runShell`, ramos que só existem no Windows |
| `test/jira-mcp-processo.test.js` | 2 | exigem o binário do Electron, que não é instalado neste checkout |
| `test/session-claude-profile.test.js` | 3 | caminho Windows de `spawnLoginConsole` e `spawnCodexLoginConsole` |
| `test/session-posix.test.js` | 1 | spawn headless do Windows (`cmd.exe` com verbatim args) |
| `test/session-unsee-on-exit.test.js` | 1 | caminho Windows do `spawnConsole` |

Os 5 pulos de `session-posix` por falta de `bash`, relatados nas rodadas anteriores,
**acabaram**: a imagem tem bash, e o `killTree` do grupo de processos roda de verdade.

### O que continua sem prova em POSIX

- **Android e Termux.** Nada aqui mede `scrypt` no celular nem a detecção do modo celular.
- **macOS.** O ramo `IS_MAC` (`open`, `Farol.app`, keychain, `path_helper`) não roda em Linux.
- **Os 3 casos de `diagnostico-ia-execucao`** que dependem do `claude` falso. Provados no
  Windows, pulados aqui com o motivo.
- **Os 2 casos que exigem o Electron real** (`jira-mcp-processo`): o binário não é instalado
  no contêiner.
- **A suíte sem `--test-force-exit`**: não termina no contêiner, então a contagem TOTAL exata
  de uma execução não é mensurável por esse caminho.

### Windows continua verde

`npm test` no Windows, no mesmo commit: 4334 testes, 4306 aprovados, 0 falhas, 28 pulados,
código de saída 0 (`posix-com-git-windows.txt`).
