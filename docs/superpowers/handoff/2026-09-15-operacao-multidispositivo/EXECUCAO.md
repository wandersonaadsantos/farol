# Registro de execução: operação multidispositivo

Registro único e curto. Atualizado ao começar e terminar cada entrega, ao bloquear e antes de mudanças grandes de contexto. O `HANDOFF.md` desta pasta é histórico do planejamento. Evidência detalhada de cada entrega fica em `evidencias-execucao/<id>.md`.

## Estado atual

- **Fase:** execução autônoma autorizada pelo dono em 15/09/2026 (iniciativa inteira, limites no plano mestre, seção 4).
- **Entrega em curso:** C0.
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

## Entregas

| Ordem | Entrega | Branch | Estado | Evidência |
|---|---|---|---|---|
| 1 | C1a Allowlist de Host | `md/c1a` | validado localmente, integrado (`be95e67`) | `evidencias-execucao/c1a.md` |
| 2 | C0 Correções da sincronização publicada | `md/c0` | em curso | |
| 3 | A5 Retomada durável | `md/a5` | plano pronto | |
| 4 | A1 Consumo fiel (sem o item 1) | `md/a1` | plano em escrita | |
| 5 | C0b Arbitragem de postagem no funil | `md/c0b` | plano em escrita | |
| 6 | A4 Autenticação local, núcleo | `md/a4` | plano pronto | |
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

## Decisões e ajustes técnicos

- Retenção da autoanálise sincronizada decidida pelo dono na autorização; registrada na spec, seção 16.
- Planos escritos na worktree de documentação recebem no topo a nota "Ajustes de execução" (worktree, branch `md/<id>`, evidência em arquivo próprio) em vez de edição linha a linha.
- C1a: contagem esperada de uma mutação corrigida de 4 para 5; testes de estático incluem `/pure/comum.js`.

## Commits

| Commit | Branch | Conteúdo |
|---|---|---|
| `6f56c12`, `6377b08`, `e8dc8a6`, `626a16f` | `md/integracao` | handoff, spec, correção da spec e anexos, plano mestre e plano da C1a (cherry-pick) |
| `081e9f4` | `md/integracao` | autorização, retenção decidida, base `8c043bc` |
| `716650d`, `06d06bb`, merge `be95e67` | `md/c1a` | C1a: função pura, guarda no servidor, mapa e evidência |

## Próxima ação concreta

Executar a Tarefa 1 do plano da C0 em `md/c0`.
