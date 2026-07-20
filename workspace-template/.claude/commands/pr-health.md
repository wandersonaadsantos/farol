---
description: Lê o log de erros do Farol (state\farol.log), diagnostica falhas recorrentes e corrige o próprio app.
argument-hint: "[período: hoje | 7d | tudo]"
---

Manutenção do Farol a partir dos próprios logs de erro. Período: $ARGUMENTS (padrão: tudo).

O código do app fica em `..\app` (relativo a este workspace): `server.js` (engine de
monitoramento + servidor http da UI), `main.js` (shell Electron), `ui\` (interface).
O protocolo de review é este workspace (`CLAUDE.md`, `.claude\`).

1. Leia `state/farol.log` (e `state/farol.log.1`, se existir). São **só falhas** — `[ERROR]` / `[WARN]`, formato `[AAAA-MM-DD HH:MM:SS] [LEVEL] msg`.
2. **Agrupe** as falhas por tipo e **conte recorrências**. Priorize as que mais se repetem ou são mais graves.
3. Para cada falha sistêmica, **diagnostique a causa raiz no código do app** (`..\app\server.js`, `..\app\main.js`, `CLAUDE.md`, `.claude/agents/pr-reviewer.md`, `.claude/settings.json`). Confirme no código antes de afirmar — não chute.
4. **Apresente um resumo**: cada falha → quantas vezes → causa provável → correção proposta + risco.
5. **Aplique as correções de baixo risco direto.** Nas de risco maior (mudança de fluxo, postagem, permissões), **peça confirmação antes**.
6. **Preserve as regras do app ao editar:**
   - `server.js` e `main.js` são **Node puro, sem dependências externas** (além do Electron no shell). Não introduza pacotes novos.
   - Manter `farol.log` **só com falhas** (sem ruído operacional).
   - Validar a sintaxe ao final: `node --check ..\app\server.js` (idem para arquivos alterados).
   - O app pode estar rodando: mudanças em `server.js`/`main.js` só valem após reiniciar o Farol; avise isso no relato.
7. **Relate o que mudou** em poucas linhas. (Opcional: sugira limpar o `farol.log` depois das correções, pra começar com slate limpo — só com meu OK.)

Se o log estiver vazio ou sem falhas no período, diga isso e **não mude nada**.
