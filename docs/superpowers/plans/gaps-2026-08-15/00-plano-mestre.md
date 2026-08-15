# Correção dos 20 gaps da auditoria v2.41.1: plano mestre

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** fechar os 20 gaps lógicos confirmados na auditoria de 15/08/2026 (spec em `../../specs/2026-08-15-gaps-v2411-auditoria.md`), em 3 ondas, cada onda virando UMA release patch.

**Architecture:** correções cirúrgicas no engine existente, sem redesenho. Cada gap segue TDD (teste vermelho que reproduz o cenário da spec, depois o fix mínimo). O padrão transversal das ondas 1 e 2 é "decisão sobre PR carrega o head de que fala" (âncora por sha), o mesmo que o CLAUDE.md já institui pro dedup.

**Tech Stack:** Node puro (zero dependências, invariante 1 do CLAUDE.md), runner nativo `node --test`, comandos `gh`.

**Spec:** `docs/superpowers/specs/2026-08-15-gaps-v2411-auditoria.md` (fonte de verdade dos cenários; cada task cita seu G#).

## Estratégia de modelos (decisão do Wanderson, 15/08/2026)

Este plano foi ESCRITO assumindo que o executor é um modelo pouco capaz
(instruções completas, código pronto, zero inferência necessária). A EXECUÇÃO
roda com modelos melhores de propósito, pra folga de qualidade:

| papel | modelo | onde |
|---|---|---|
| executor padrão de task | **sonnet** | todas as tasks sem marcação |
| executor de task sutil | **opus** | tasks marcadas `[OPUS]`: concorrência, protocolo de dedup, multi-conta (1.1, 1.2, 1.5, 2.2, 2.6, 3.4) |
| revisão adversarial de fim de onda | **opus** | um agente relê o diff da onda inteira contra a spec, com mandato de refutar |
| nada roda em haiku | | o "nível haiku" é o LEITOR presumido do plano, não o executor |

## Regras globais (valem pra TODA task; repetidas aqui de propósito)

1. **TDD sempre:** primeiro o teste que falha reproduzindo o cenário do gap, rodar e VER falhar, depois o fix, rodar e VER passar. Nunca inverter.
2. **Gate por task:** `npm run check && npm test` verde antes de cada commit. Commit por task, mensagem `fix(escopo): ...` em português, SEM trailer de co-autoria.
3. **Sem travessão** em qualquer texto (comentário, toast, doc): vírgula, parênteses ou dois pontos (invariante 6).
4. **Zero dependências novas** (invariante 1). Nada de npm install.
5. **Quem mexe em dedup mexe nos três pontos** (review.js canAuto ~:436, canReject ~:472, decision.js decide ~:573) e atualiza `test/dedup-round.test.js`.
6. **Nenhum gate de postagem afrouxa.** Se a task toca shouldAutoApprove/shouldAutoReject/coverageGap/postReview, o teste precisa provar que o caminho seguro continuou (o teste existente quebrar é sinal de regressão, não de "atualizar o teste").
7. **Linhas citadas são da v2.41.1.** Se o arquivo mudou desde então, procure pelo TRECHO citado (o plano sempre cola o código atual), nunca aplique por número de linha às cegas.
8. **Fim de onda:** rodar o gate completo, a revisão adversarial (opus), e a release patch pelo checklist do CLAUDE.md (seção "Release"): conferir última release publicada, bump, CHANGELOG, RELEASE_NOTES no ui/app.js, publish-release.ps1, conferir a release, restaurar a conta gh de trabalho.

## Ondas

| onda | gaps | release alvo | arquivo |
|---|---|---|---|
| 1: integridade de postagem e custo | G1 commit_id, G2 decide idx, G3 merge headSha, G4 loop pushback, G5 multi-conta any-ok, G6 seen atômico | v2.41.2 | `onda-1.md` |
| 2: round 2 resiliente + reconcile | G7 reinício, G8 knownHead, G9 retry requested, G10 draft, G11 CLOSED, G12 mesmo-head, G13 internal_language | v2.41.3 | `onda-2.md` |
| 3: ciclo de vida e higiene | G14 update terminal, G15 parked persistido, G16 orçamento re-check, G17 capability viva, G18 mineMap, G19 double-click, G20 update-dl, G21 env login (verificar antes) | v2.41.4 | `onda-3.md` |

Ordem estrita: onda N só começa com a N-1 mergeada e publicada (regra "tudo
100% antes do próximo"). Dentro da onda, as tasks são independentes salvo
indicação (1.1 antes de 2.6; 2.4 antes de 2.5).
