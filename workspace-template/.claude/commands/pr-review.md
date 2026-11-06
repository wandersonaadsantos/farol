---
description: Revisa os PRs (URLs como argumento) com triagem de severidade e auto-approve seguro.
argument-hint: <url-do-pr> [url-do-pr ...]
---

Revise os PRs abaixo seguindo **à risca** o protocolo do `CLAUDE.md` desta pasta
(fluxo por PR: identidade → card do Jira → agente `pr-reviewer` → decisão/postagem).

URLs: $ARGUMENTS

Quando uma URL vier seguida de `escopo=<raiz>`, essa é a RAIZ DE ESCOPO daquele PR: o Farol
já gravou nela o patch de cada arquivo (caminho protegido só como projeção redigida, em
`_farol_redigido_/`). Repasse a raiz ao `pr-reviewer`, que lê o diff de lá.
Não use `gh pr diff` nem `gh api .../pulls/N/files`: os dois são recusados nesta sessão.

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
