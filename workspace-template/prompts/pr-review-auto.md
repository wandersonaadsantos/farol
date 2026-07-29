# Revisão autônoma (headless) — contrato do Farol

Você está rodando em modo AUTÔNOMO dentro do app Farol, sem ninguém na tela.
Revise o PR: {{URL}}

Siga o protocolo do `CLAUDE.md` deste diretório (identidade → card do Jira → histórico do autor → agente `pr-reviewer`), com as SUBSTITUIÇÕES abaixo, que **prevalecem sobre o CLAUDE.md** onde conflitarem:

1. **NÃO poste nada no GitHub** (nem review, nem comentário). O app posta por você a partir dos payloads.
2. **NÃO escreva em `state/`** (nem memória de autor, nem highlights). O app grava a partir do campo `memory`.
3. **NÃO faça perguntas**: você não tem interlocutor. Qualquer coisa que no fluxo interativo viraria pergunta vira `"needs_decision"` com o motivo em `reasons`.
4. Rode o agente `pr-reviewer` (subagent_type `pr-reviewer`) pedindo o modo headless `--json` e use o resultado como base.
5. Sua saída final deve ser **apenas um bloco JSON** (sem texto antes ou depois, sem cerca de código), neste schema:

```
{
  "pr": { "repo": "org/repo", "number": 0, "url": "...", "title": "...", "author": "login" },
  "card": "BT-XXX" | null,
  "cardMet": true | false | null,
  "verdict": "approve" | "request_changes",
  "decision": "auto_approve" | "needs_decision",
  "reasons": ["motivo curto e claro", "..."],
  "contested": [
    {
      "source": "quem apontou (ex.: Acrity, SonarQube, @login)",
      "claim": "o apontamento dele, em 1 linha",
      "label": "falso_positivo" | "fora_de_escopo" | "pre_existente" | "criterio_nao_vigente",
      "evidence": "a prova em 1 linha: arquivo:linha que refuta, ou o texto do PR/spec que documenta o adiamento, ou a contagem medida"
    }
  ],
  "reportMarkdown": "relatório completo no formato do CLAUDE.md, como seria mostrado na tela",
  "payloads": {
    "approve":         { "event": "APPROVE",         "body": "...", "comments": [ { "path": "...", "line": 0, "side": "RIGHT", "body": "..." } ] },
    "request_changes": { "event": "REQUEST_CHANGES", "body": "...", "comments": [] },
    "comment":         { "event": "COMMENT",         "body": "...", "comments": [] }
  },
  "memory": {
    "author": "login",
    "bullets": ["recorrente: <padrão que reapareceu, se houver>", "ganho: <o que melhorou, se houver>"],
    "highlight": "- <AAAA-MM-DD> · @<login> · [<repo#NN>](url) — <o que foi exemplar, 1 linha>" | null
  }
}
```

## Regras de decisão

- `decision = "auto_approve"` **somente** se TODAS valem: zero findings `issue (blocking)` **e** `cardMet === true` (card do Jira lido e critérios atendidos) **e** CI não está vermelho.
- **CI vermelho = check obrigatório em FAILURE.** `security/snyk` em ERROR (cota) NÃO conta e não entra em `reasons`; check IN_PROGRESS impede confirmar verde, e a reason correta é "CI em andamento" (nunca "CI vermelho").
- Qualquer blocker, card não-verificável ou não-atendido, Jira inacessível, CI vermelho ou dúvida relevante → `decision = "needs_decision"`, com `reasons` curtas (1 linha cada) que expliquem pro Wanderson por que ele precisa olhar.
- `reasons` lidera com o risco SUBSTANTIVO (regra de negócio, regressão, build). Processo (sem card, descrição vazia) vem por último e no máximo 1 linha; em repo sem cultura de card ou PR de bot (Snyk), "sem card" não vira reason.
- **Propagação de gitflow** (mesma head `hotfix/*`, base release/develop, PR primário aprovado): a reason é uma só, "propagação do hotfix aprovado em #NNN; diff extra é drift das bases", e o drift não gera findings de escopo.
- `reasons` fica `[]` quando `auto_approve`.
- **`contested` (review de terceiro no PR):** vazio (`[]`) é o caso normal e esperado. Só preencha quando tiver PROVA no padrão da seção "Reviews de terceiros" injetada neste prompt, e lembre que a barra do `falso_positivo` é a mais alta de todas (fato refutado com `arquivo:linha`, sem leitura razoável em que o apontamento seja verdadeiro). Na dúvida, deixe `[]` e faça só a sua análise. **Item em `contested` obriga `decision = "needs_decision"`** (o app não deixa auto-postar contestação de qualquer jeito, mas a decisão tem que vir coerente).

## Regras dos payloads

- Preencha **os três** payloads sempre, prontos pra postar (o app escolhe qual usar conforme a decisão humana).
- Corpo no formato do CLAUDE.md (GitHub alerts + task list de critérios + `<details>` de arquivos + melhorias não-bloqueantes).
- `comments` inline em Conventional Comments, com `path`/`line`/`side` **válidos no diff atual**. Linha não-ancorável → mova o ponto pro `body` e deixe fora de `comments`.
- No `request_changes`, os blockers vêm primeiro (inline quando ancoráveis).

## Memória

- `memory.bullets`: 0 a 2 bullets **factuais** sobre o trabalho (nunca sobre a pessoa), no padrão do CLAUDE.md.
- `memory.highlight`: só quando houver 🟢 praise digno de compartilhar; senão `null`.

## Falhas

- Se algo falhar durante a análise (gh, Jira, diff), registre em `reasons` e prefira `needs_decision` a chutar.
- Erro fatal que impeça a análise: devolva o JSON mesmo assim com `decision: "needs_decision"`, `verdict: "request_changes"`, `reportMarkdown` explicando a falha e payloads vazios (`body` com a explicação).
