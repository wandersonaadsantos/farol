# Registro de execução: operação multidispositivo

Registro único e curto. Atualizado ao começar e terminar cada entrega, ao bloquear e antes de mudanças grandes de contexto. O `HANDOFF.md` desta pasta é histórico do planejamento. Evidência detalhada de cada entrega fica em `evidencias-execucao/<id>.md`.

## Estado atual

- **Fase:** execução autônoma autorizada pelo dono em 15/09/2026 (iniciativa inteira, limites no plano mestre, seção 4).
- **Entrega em curso:** C1a.
- **Plano mestre:** `docs/superpowers/plans/2026-09-15-operacao-multidispositivo-mestre.md`
- **Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`
- **Base:** `origin/main` em `8c043bc` (v2.59.3, Fases 0 e 1a da reorganização), fixada em 15/09/2026.
- **Branch de integração:** `md/integracao`, worktree `C:\Users\wanderson\Documents\farol-md-exec`. Os commits de documentação da antiga `docs/handoff-operacao-multidispositivo` foram trazidos por cherry-pick; aquela branch fica como histórico e não recebe mais nada.
- **Worktree de referência da base:** `C:\Users\wanderson\Documents\farol-md-base` (detached em `8c043bc`, só leitura).

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
| 1 | C1a Allowlist de Host | `md/c1a` | em curso | |
| 2 | C0 Correções da sincronização publicada | `md/c0` | plano em escrita | |
| 3 | A5 Retomada durável | `md/a5` | plano em escrita | |
| 4 | A1 Consumo fiel (sem o item 1) | `md/a1` | plano em escrita | |
| 5 | C0b Arbitragem de postagem no funil | `md/c0b` | plano em escrita | |
| 6 | A4 Autenticação local, núcleo | `md/a4` | plano em escrita | |
| seguintes | C1, C2, C3, C4, C4b, C5, C6, C7, C8, telas | | planos a escrever | |

## Bloqueios

| Entrega | Causa | Evidência | Tentado | Condição para continuar |
|---|---|---|---|---|
| A1, item 1 | exige sessões reais do CLI (assinatura do dono; autorização proíbe ampliar gastos) | spec 13 | não se aplica | autorização específica |
| A4, exigência automática validada | Termux real | spec 7.A4 | não se aplica | aparelho |

## Decisões e ajustes técnicos

- Retenção da autoanálise sincronizada decidida pelo dono na autorização; registrada na spec, seção 16.
- Plano da C1a: branch `md/c1a` a partir de `md/integracao`; evidência em `evidencias-execucao/c1a.md`; premissas de `lib/http-server.js` conferidas em `8c043bc` (linhas idênticas).

## Commits

| Commit | Branch | Conteúdo |
|---|---|---|
| `6f56c12`, `6377b08`, `e8dc8a6`, `626a16f` | `md/integracao` | handoff, spec, correção da spec e anexos, plano mestre e plano da C1a (cherry-pick) |

## Próxima ação concreta

Executar a Tarefa 0 do plano da C1a em `farol-md-exec`.
