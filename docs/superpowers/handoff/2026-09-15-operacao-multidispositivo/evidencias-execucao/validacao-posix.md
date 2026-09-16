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
