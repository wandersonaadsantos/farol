# Registro de execução: operação multidispositivo

Registro único e curto. Atualizado ao começar e terminar cada entrega, ao bloquear e antes de mudanças grandes de contexto. O `HANDOFF.md` desta pasta é histórico do planejamento.

## Estado atual

- **Fase:** pacote de execução preparado; **aguardando a autorização do dono para o lote 1**.
- **Plano mestre:** `docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md`
- **Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`
- **Base:** `origin/main` em `f80394e` (v2.59.3)
- **Branch de documentação:** `docs/handoff-operacao-multidispositivo` (worktree `C:\Users\wanderson\Documents\farol-multidispositivo`), sem push
- **Branch de integração:** `md/integracao` (ainda não criada)
- **Worktree de execução:** `C:\Users\wanderson\Documents\farol-md-exec` (ainda não criada)

## Linha de base medida (15/09/2026, na base)

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 267 arquivos `.js` |
| `npm run lint` | verde, sem regressão |
| `npm test` | 2824 testes, 2800 aprovados, 24 pulados, 0 falhas |
| `npm run eng` | verde, 13 regras no escopo, nenhuma acionada |

## Lote 1

| Ordem | Entrega | Branch | Estado | Evidência |
|---|---|---|---|---|
| 1 | C1a Allowlist de Host | `md/c1a` | não iniciada | |
| 2 | C0 Correções da sincronização publicada | `md/c0` | não iniciada | |
| 3 | A5 Retomada durável | `md/a5` | não iniciada | |
| 4 | A1 Consumo fiel (sem o item 1) | `md/a1` | não iniciada | |
| 5 | C0b Arbitragem de postagem no funil | `md/c0b` | não iniciada | |
| 6 | A4 Autenticação local, núcleo | `md/a4` | não iniciada | |

## Bloqueios

| Entrega | Causa | Evidência | Tentado | Condição para continuar |
|---|---|---|---|---|
| A1, item 1 | exige sessões reais do CLI | spec 13 | não se aplica | autorização do dono |
| A4, tela e exigência automática | desenho no Claude Design e Termux real | spec 7.A4 | não se aplica | desenho aprovado e aparelho |

## Ajustes técnicos relevantes

(nenhum ainda)

## Commits

| Commit | Branch | Conteúdo |
|---|---|---|
| `3bf6130` | `docs/handoff-operacao-multidispositivo` | handoff do planejamento |
| `d417602` | `docs/handoff-operacao-multidispositivo` | spec guarda-chuva |
| `6d4252b` | `docs/handoff-operacao-multidispositivo` | rodada de correção da spec e anexos normativos |

## Próxima ação concreta

Depois da autorização: criar a worktree `farol-md-exec` e a branch `md/integracao` a partir da ponta de `docs/handoff-operacao-multidispositivo`, cortar `md/c1a` e executar a Tarefa 1 do plano da C1a.
