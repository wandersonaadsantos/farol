# Registro de execução: operação multidispositivo

Registro único e curto. Atualizado ao começar e terminar cada entrega, ao bloquear e antes de mudanças grandes de contexto. O `HANDOFF.md` desta pasta é histórico do planejamento. Evidência detalhada de cada entrega fica em `evidencias-execucao/<id>.md`.

## Estado atual

- **Fase:** execução autônoma autorizada pelo dono em 15/09/2026 (iniciativa inteira, limites no plano mestre, seção 4).
- **Entrega em curso:** C0b. A1 e A4 concluídas e integradas em `md/integracao`.
- **Plano mestre:** `docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md`
- **Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`
- **Base:** `origin/main` em `8c043bc` (v2.59.3, Fases 0 e 1a da reorganização), fixada em 15/09/2026.
- **Branch de integração:** `md/integracao`, worktree `C:\Users\wanderson\Documents\farol-md-exec`. Os commits de documentação da antiga `docs/handoff-operacao-multidispositivo` foram trazidos por cherry-pick; aquela branch fica como histórico.
- **Worktree de referência da base:** `C:\Users\wanderson\Documents\farol-md-base` (detached em `8c043bc`, só leitura).
- **Roteiro de contraprova:** mutação aplicada na cópia de trabalho, testes rodados, conteúdo restaurado e conferido byte a byte (script em scratchpad da sessão; o resultado de cada mutação fica na evidência da entrega).

## Linha de base medida (15/09/2026, em `8c043bc`)

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 287 arquivos `.js` |
| `npm run lint` | verde, sem regressão; higiene sem referência solta |
| `npm test` | 2841 testes, 2817 aprovados, 24 pulados, 0 falhas |
| `npm run eng` | `not-run` na base sem entrega (reprova por construção, o esperado); com entrega exige `avaliacoes.jsonl` |

## Gate na linha de integração (15/09/2026, com C1a, C0, A5, A1 e A4)

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 333 arquivos `.js` |
| `npm run lint` | verde, sem regressão |
| `npm test` | 3108 testes, 3082 aprovados, 26 pulados, 0 falhas |

Windows 11, Node v24.15.0. O `npm run eng` roda no pre-push, com as avaliações escritas.

## Entregas

| Ordem | Entrega | Branch | Estado | Evidência |
|---|---|---|---|---|
| 1 | C1a Allowlist de Host | `md/c1a` | validado localmente, integrado (`be95e67`) | `evidencias-execucao/c1a.md` |
| 2 | C0 Correções da sincronização publicada | `md/c0` | validado localmente, integrado | `evidencias-execucao/c0.md` |
| 3 | A5 Retomada durável | `md/a5` | validado localmente, integrado | `evidencias-execucao/a5.md` |
| 4 | A1 Consumo fiel (sem o item 1) | `md/a1` | validado localmente, integrado (`225165a`), item 1 bloqueado | `evidencias-execucao/a1.md` |
| 5 | C0b Arbitragem de postagem no funil | `md/c0b` | plano pronto | |
| 6 | A4 Autenticação local, núcleo | `md/a4` | validado localmente, integrado (`7387179`); ativação automática desligada | `evidencias-execucao/a4.md` |
| seguintes | C1, C2, C3, C4, C4b, C5, C6, C7, C8, telas | | planos a escrever | |

## Bloqueios

| Entrega | Causa | Evidência | Tentado | Condição para continuar |
|---|---|---|---|---|
| A1, item 1 | exige sessões reais do CLI (assinatura do dono; autorização proíbe ampliar gastos) | spec 13 | não se aplica | autorização específica |
| A4, exigência automática validada | Termux real | spec 7.A4 | não se aplica | aparelho |

## Validações externas pendentes

| Entrega | O que falta provar | Onde |
|---|---|---|
| C1a | `Origin` real do Chromium na janela do Electron | job `electron` do CI, na publicação |
| A1 | `test/usage-interrompida-processo.test.js` no POSIX (o ramo `/bin/sh -lc` com grupo destacado só existe fora do Windows) | WSL ou CI |

## Decisões e ajustes técnicos

- Retenção da autoanálise sincronizada decidida pelo dono na autorização; registrada na spec, seção 16.
- Planos escritos na worktree de documentação recebem no topo a nota "Ajustes de execução" (worktree, branch `md/<id>`, evidência em arquivo próprio) em vez de edição linha a linha.
- C1a: contagem esperada de uma mutação corrigida de 4 para 5; testes de estático incluem `/pure/comum.js`.
- A `main` remota andou depois da base (reorganização Fase 1.5: seções do `CLAUDE.md` foram para `docs/REVIEW-GATES.md`, `docs/CONFIGURATION.md`, `docs/MACOS.md`, `docs/RELEASE.md`). A base segue fixa; as seções que as entregas acrescentam ao `CLAUDE.md` são reconciliadas com os guias na preparação da publicação.
- A5: isolamento de estado persistido no teste novo e ajuste do teste de rodada cega, detalhados na evidência.
- A1: `lib/engine/usage-desfechos.js` criado fora do plano para manter `usage.js` abaixo do teto de linhas do ratchet, em vez de subir a baseline. Detalhes e as outras correções de forma na evidência.
- A1: uma contraprova da Tarefa 13 não provava nada (mutava uma marca redundante) e foi refeita. Contraprova que não falha não é contraprova.

## Commits

| Commit | Branch | Conteúdo |
|---|---|---|
| `6f56c12`, `6377b08`, `e8dc8a6`, `626a16f` | `md/integracao` | handoff, spec, correção da spec e anexos, plano mestre e plano da C1a (cherry-pick) |
| `081e9f4` | `md/integracao` | autorização, retenção decidida, base `8c043bc` |
| `716650d`, `06d06bb`, merge `be95e67` | `md/c1a` | C1a: função pura, guarda no servidor, mapa e evidência |
| `a71f485`, `6ca587e`, `39cbb11`, `1d22d32`, `173c6d2`, `bdd960c` | `md/c0` | C0: os seis defeitos, um commit cada |
| `fe1ab5e`, `0181acb`, `3f5c486`, `24e1ff3`, `6c927ec` | `md/a5` | A5: módulo puro, persistência, referência com contexto, validação, desfechos |
| `5bbde8b`, `160b581`, `7ab3fc5`, `659642f`, `3ab53d3`, `75a3d15`, `a488424`, `1fd7f38`, `436305b`, `c684e38`, `8256b95`, `d436c9c`, `d478abf`, `2557b05`, `106d5bb`, `eed54ed`, `7c3bfac`, merge `225165a` | `md/a1` | A1: instrumento de medição, id opaco, falha durável, custo desconhecido, reserva no gate, Codex, recusa de envelope, teto de pushback, correção pelo carimbo da linha, diário de tentativas, fiação, prova com processo real, mapa e evidência |
| `4f8b475`, `8f0a06a`, `473de56`, `826c0b5`, `a90041c`, `855512f`, `3dbec40`, `d446efa`, `6d50526`, `bc5a872`, merge `7387179` | `md/a4` | A4: modo celular decidido no servidor, chave de arquivo fora da tela, pareamento de uso único, sessões por token, inventário das rotas, porteiro da API, comando de pareamento, transporte autenticado da UI, mapa e evidência |

## Próxima ação concreta

Executar a C0b (arbitragem de postagem no funil) na branch `md/c0b`, cortada da ponta verificada de `md/integracao`. A dependência da C0, `syncAtualizarPublicacao` em `lib/engine/sync.js`, está presente (Tarefa 0, passo 2).
