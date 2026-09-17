# Evidência: C1a Allowlist de Host

Plano: `docs/superpowers/plans/2026-09-15-md-c1a-allowlist-host.md`. Branch `md/c1a`, cortada de `md/integracao` em `081e9f4` (base `8c043bc`).

## Estado

Implementado e validado localmente. Aguardando validação externa só do `Origin` real do Chromium dentro da janela do Electron, que o job `electron` do CI cobre na publicação.

## Comandos e contagens

    npm run check && npm run lint && npm test

| Medida | Base `8c043bc` | `md/c1a` |
|---|---|---|
| arquivos do `check` | 287 | 290 |
| `tests` | 2841 | 2878 |
| `pass` | 2817 | 2854 |
| `fail` | 0 | 0 |
| `skipped` | 24 | 24 |
| lint | sem regressão | sem regressão, higiene limpa |

A contagem de partida (N0) é a medida da worktree `farol-md-base` em `8c043bc`: entre essa base e `081e9f4` só há commits em `docs/`, sem arquivo `.js`. Testes novos: 9 em `test/http-guard.test.js`, 28 em `test/http-host-allowlist.test.js` (2878 = 2841 + 37).

## Critério de aceite x teste

| Critério da 7.C1a | Teste |
|---|---|
| Host inválido recebe 403 sem estado, sem SSE e sem ação, por classe da A4 | 8 `Host inválido: <classe> (...)`, com 8 `controle: ...` provando que o espião estava no caminho |
| Validação antes de qualquer rota, estáticos inclusive (e os módulos de `ui/pure/`) | `Host inválido: arquivo estático recebe 403 JSON e nenhum byte da UI` (inclui `/pure/comum.js`) |
| `Origin` externo recebe 403; ausente aceito | 3 testes de Origin na integração; unitários `recusa Origin externo...` e `aceita 127.0.0.1 e localhost na porta efetiva, sem Origin` |
| Nenhum cabeçalho CORS de permissão | `nenhum cabeçalho CORS de permissão sai...` |
| Electron e navegador do aparelho continuam | `janela do Electron: ...` (inclui módulo de `ui/pure/`), `navegador do próprio aparelho: ...` |
| Porta efetiva, não a da config; porta não padrão recusa a padrão | `com a config em 0 vale a porta em que o socket escuta...`, `servidor em porta configurada diferente da padrão...` |
| Hosts exatos, sem curinga | unitários de host, porta e curinga |
| `x-farol` e capability de postagem mantidos | `x-farol continua exigido...`, `Host inválido sem x-farol...`, `x-farol-review-cap continua...` |

## Contraprovas (roteiro `scratchpad/contraprova.cjs`, restauração byte a byte conferida)

| Mutação | Resultado |
|---|---|
| `http-guard.js`: lista de hosts desligada | 5 unitários reprovaram (o plano previa 4; o quinto é `recusa host ausente, vazio ou de tipo errado`, porque `''` é string) |
| `http-guard.js`: Origin não conferido | 1 reprovou |
| `http-server.js`: guarda sem efeito | 16 reprovaram, os mesmos da execução antes da implementação |
| `http-server.js`: porta da config em vez da efetiva | 17 reprovaram |
| `http-server.js`: guarda só antes dos estáticos | 15 reprovaram; o de estático passou, o que prova que o teste distingue "antes de qualquer rota" |

## Revisão do diff

- Clientes do servidor fora dos testes conferidos por busca de URL local: todos usam `http://127.0.0.1:<porta>` (sessões, chat, protocolo do workspace, Electron). O servidor só escuta em `127.0.0.1`, então `[::1]` recusado não corta cliente legítimo.
- Nenhum defeito concreto achado. Caixa de letra do Host é exata (`LOCALHOST` recusado): nenhum cliente do Farol manda assim.

## Ajustes técnicos em relação ao plano

- Branch `md/c1a` e worktree `farol-md-exec`, no lugar de `feat/md-c1a-allowlist-host` na worktree de documentação.
- Contagem esperada da mutação A corrigida de 4 para 5 (erro de contagem do plano, não da guarda).
- Os testes de estático e da janela do Electron passaram a incluir `/pure/comum.js`, por causa da modularização do `ui/pure/` que entrou na `main`.
- A contraprova do `CLAUDE.md` (busca de travessão) foi feita pela suíte `guias-navegaveis`, verde.
