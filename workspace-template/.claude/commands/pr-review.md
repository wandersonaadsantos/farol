---
description: Revisa os PRs (URLs como argumento) com triagem de severidade e auto-approve seguro.
argument-hint: <url-do-pr> [url-do-pr ...]
---

Revise os PRs abaixo seguindo **à risca** o protocolo do `CLAUDE.md` desta pasta
(fluxo por PR: identidade → card do Jira → agente `pr-reviewer` → decisão/postagem).

URLs: $ARGUMENTS

Pontos-chave (o detalhe está no `CLAUDE.md`):
- **Um PR por vez.**
- Triagem proporcional ao risco — **não bloqueie por preferência** ou refactor desejável.
- **Auto-APPROVE** quando não houver blocker **E** o card (BT-XXX) tiver sido lido e atendido; inclua as melhorias como comentários não-bloqueantes.
- Card **não-verificável** → me pergunte antes de aprovar.
- **REQUEST CHANGES / COMMENT** só com minha confirmação explícita.
- Toda postagem usa exclusivamente o writer local descrito no `CLAUDE.md`, com
  `$FAROL_REVIEW_CAP` e `$FAROL_PORT`. Nunca escreva o review direto no GitHub;
  se o writer bloquear a redação, reescreva sem contornar a trava.
- A detecção e o "já visto" são do app Farol — você **não** gerencia estado.
