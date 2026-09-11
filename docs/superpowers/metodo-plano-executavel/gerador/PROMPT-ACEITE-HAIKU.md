# Prompt do aceite (executor menor)

O plano existe para ser executado por um modelo menor sem adivinhar nada. Este é o teste
que prova isso. Ele roda num worktree NOVO, a partir da mesma base, e o critério é duplo:
gate verde em cada tarefa e `git diff` final vazio contra o replay.

## Preparar

```bash
git -C C:/Users/wanderson/Documents/farol worktree add --detach .worktrees/sync-aceite 1ddee35
```

## Prompt

> Você vai executar um plano de implementação, tarefa por tarefa, EXATAMENTE como está
> escrito. Você não precisa entender o recurso para executá-lo; precisa seguir as
> instruções ao pé da letra.
>
> **Onde trabalhar:** `C:/Users/wanderson/Documents/farol/.worktrees/sync-aceite`. Todo
> comando roda com o cwd aí. NUNCA toque em nada fora desse diretório. Nunca use `git
> push`, `git stash`, nem crie branch.
>
> **O plano:**
> `C:/Users/wanderson/Documents/farol/.worktrees/sync-handoff/gerador/plano-sync.md`.
> Ele é grande: leia UMA tarefa por vez (as seções começam com `### Tarefa `), execute, e
> só então leia a próxima.
>
> **Regras de execução, e elas não têm exceção:**
>
> 1. "Crie `<arquivo>` com EXATAMENTE este conteúdo" quer dizer: o arquivo passa a ter o
>    conteúdo do bloco, byte a byte. Não acrescente, não reformate, não "melhore", não
>    corrija o que parecer errado. Se algo parecer errado, execute assim mesmo e anote no
>    relatório final.
> 2. "Em `<arquivo>`, aplique as N substituições" quer dizer: para cada par, localize o
>    PRIMEIRO bloco (o trecho a procurar) no arquivo e troque pelo SEGUNDO. O trecho
>    aparece uma única vez; isso já foi provado. Se você não achar, ou achar mais de uma
>    vez, PARE e relate, não improvise.
> 3. Depois de cada tarefa, rode nesta ordem, do diretório do worktree:
>    `node tools/check-syntax.js`, depois `node tools/quality/gate.js`, depois
>    `node tools/quality/higiene.js`, depois `node --test --test-force-exit`.
>    Os quatro precisam passar (o último com `fail 0`). Se algum falhar, PARE, não tente
>    consertar por conta própria, e relate qual tarefa e qual a primeira linha da falha.
> 4. Com os quatro verdes, faça UM commit com exatamente a mensagem que a tarefa indica.
>    Sem trailer de co-autoria, sem mencionar IA.
>
> **No fim**, rode e cole a saída:
> `git diff --stat 8cee935 HEAD` (o commit do replay; substitua pelo indicado abaixo).
> Ele TEM que sair vazio.
>
> **Relate:** quantas tarefas completou, o resultado do diff final, e qualquer ponto do
> plano que estava ambíguo ou que você precisou interpretar. Ambiguidade encontrada é o
> achado mais valioso deste exercício: ela é defeito do PLANO, não seu.

## Critério

- gate verde nas 23 tarefas;
- `git diff` vazio contra a ponta do replay;
- nenhuma ambiguidade relatada (ou, se houver, ela vira correção do gerador/plano e o
  aceite roda de novo).
