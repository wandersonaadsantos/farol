# Retro dos reviews do Farol (13 e 14/07/2026)

Estudo do que funcionou e do que falhou nos últimos reviews, com o que aconteceu de verdade em cada PR depois do review (GitHub como ground truth). As conclusões viraram mudanças aplicadas no protocolo (workspace-template) e no app (v1.5.1); este documento é a evidência e a referência.

## Amostra e método

8 decisões registradas em `state/decisions.json` (13 e 14/07), cruzadas com: reviews e comentários inline no GitHub (quem respondeu, o que foi acatado), commits posteriores ao review, estado de merge, memória por autor (`state/authors/`), chats por PR (`state/chats.json`) e o log de falhas.

| PR | Veredito do Farol | Decisão | O que aconteceu depois |
|---|---|---|---|
| biud-frontend#635 (BT-755) | approve, cardMet | auto-approve | mergeado; APPROVE saiu DUPLICADO (manual 18:55:59 + Farol 18:56:16) |
| biud-frontend#636 (BT-755) | approve, card "não atendido" | você aprovou | mergeado; era propagação de gitflow pra release |
| biud-frontend#637 (BT-755) | approve, card "não atendido" | você aprovou | mergeado; propagação pra develop |
| biud-mia#97 (Snyk) | request_changes | você comentou | corrigido no mesmo dia (lockfile + puppeteer 25 ESM), depois APPROVE |
| biud-notification#37 (Snyk) | request_changes | você reprovou | corrigido no mesmo dia (lockfile regenerado), depois APPROVE |
| biud-core#215 (Snyk) | request_changes | você reprovou | corrigido no mesmo dia (typeorm 1.x migrado); RC saiu DUPLICADO (chat 18:30 + card 19:07) |
| gestao-api#52 (release) | approve, sem card | você aprovou | mergeado 3 min depois; ❓ inline ficou sem resposta |
| gestao-api#53 (fix) | approve, sem card | você aprovou | mergeado 20 s depois do review |

## O que foi BOM (manter e reforçar)

1. **PRs do Snyk: 3 blockers verdadeiros, resolvidos no mesmo dia.** O review apontou exatamente o que precisava: lockfile pnpm não regenerado (#37), typeorm 1.x quebrando o build com TS2559 (#215), puppeteer 25 ESM-only + waitUntil (#97). Os commits de correção espelham 1:1 os achados. O review virou a lista de trabalho da regularização (BT-778).
2. **Gate de auto-approve segurou o que devia.** Nenhum auto-approve indevido na amostra; o único auto (635) tinha card lido e critérios conferidos cenário a cenário.
3. **Memória por autor está gerando sinal.** Recorrências factuais e úteis (ex.: "link interativo sem data-testid", "descrição só template", padrão dos PRs Snyk) e ganhos reconhecidos com proporção. O highlight do gestao-api#52 (predicado espelhando byte a byte o método de referência) é o tipo de registro que vale kudos.
4. **Comentários inline ancorados e verificados.** Os do gestao-api#53 confirmam o alvo do `.replace` antes de elogiar e apontam risco real de fragilidade do recorte via `.replace` sobre SQL montado.

## O que foi RUIM (cada item virou mudança)

1. **MISS comprovado no #635: `moment` novo em projeto `dayjs`.** O diff adiciona `moment().subtract(...)` no `FiltersModalContent`; o relatório analisou esse arquivo e não citou. Foi você, manualmente, quem pegou ("moment que é depreciado, no lugar do dayjs"). CAUSA: o protocolo não mandava comparar imports novos com o padrão do repo. MUDANÇA: passo "Imports novos" na ordem de análise do `pr-reviewer` + regra 5 dos Aprendizados operacionais.
2. **APPROVE duplicado no #635.** Você aprovou manualmente às 18:55:59 e o Farol postou o auto-APPROVE às 18:56:16. MUDANÇA (app v1.5.1): antes do auto-post, o engine consulta os reviews existentes e não posta se você já aprovou.
3. **REQUEST CHANGES duplicado no #215.** O RC saiu às 18:30 via chat ("Isso pode enviar o comentario e reprovar") e de novo às 19:07 pelo card de decisão (a queda de rede das 18:41/19:00 deixou o card pendente). MUDANÇA (app v1.5.1): `decide()` também consulta os reviews existentes e resolve o card como "já revisado" em vez de repostar.
4. **Propagação de gitflow tratada como escopo-extra.** #635/#636/#637 são a MESMA branch `hotfix/BT-755` indo pra master, release e develop (o fluxo correto do time). O reviewer flagou #636/#637 como "card não atendido / escopo-extra" por causa do drift entre as bases, e você teve que aprovar por cima duas vezes. MUDANÇA: regra 3 dos Aprendizados operacionais + detecção de propagação na ordem de análise (avaliar só o conteúdo novo, citar o PR primário).
5. **snyk ERROR (cota) chamado de "CI não verde".** Reasons do #636/#637 citam "security/snyk em ERROR". Na org isso é cota do Snyk, conhecido e não obrigatório. MUDANÇA: regra 1 dos Aprendizados operacionais + regra de decisão no headless: CI vermelho = só check obrigatório em FAILURE; IN_PROGRESS = "CI em andamento".
6. **"Sem card" repetido como reason em repo sem cultura de card.** No gestao-api, toda decisão veio liderada por "Card não-verificável" e a memória do Gabriel acumulou "4º PR seguido sem card", afogando o risco substantivo (mudança de semântica de métrica). MUDANÇA: regra 4 dos Aprendizados + ordem das reasons no headless (risco substantivo primeiro; processo por último e sem repetição).
7. **Tom: "Pessoal" em review com dono claro.** Seu feedback no chat do #215: quem rodou o Snyk e não cuidou do PR foi uma pessoa específica; o texto devia falar com ela, objetivo. MUDANÇA: regra 7 dos Aprendizados + anti-padrão no `pr-reviewer`.

## Limitações da amostra

Oito reviews em dois dias, todos mergeados em seguida: não dá pra medir taxa de miss pós-merge ainda (nenhum bug rastreado até um PR aprovado nesta janela). A ❓ question do gestao-api#52 ficou sem resposta e o PR mergeou em 3 minutos: em repo interno de merge rápido, pergunta que importa deve estar nas reasons (pra você), não só no inline.

## O que medir daqui pra frente

- **Acatamento**: comentário não-bloqueante gerou commit/resposta? (hoje: Snyk sim, gestao-api não)
- **Override**: quantas vezes você aprova POR CIMA de um needs_decision? Override repetido do mesmo motivo = motivo mal calibrado (foi assim que achamos propagação e snyk-cota).
- **Miss**: bug corrigido depois em arquivo aprovado há menos de 7 dias = candidato a miss; conferir se o review tinha o arquivo na mão.

## Mudanças aplicadas (14/07/2026)

- `workspace-template/CLAUDE.md`: seção nova "Aprendizados operacionais (biudtech)" com as 7 regras.
- `workspace-template/.claude/agents/pr-reviewer.md`: passo "Imports novos", detecção de propagação, nuances de CI, 4 anti-padrões novos.
- `workspace-template/prompts/pr-review-auto.md`: definição de CI vermelho, ordem das reasons, reason única de propagação.
- `server.js` (v1.5.1): `myReviewStates()` + dedup no auto-post e no `decide()`; status novo `already_reviewed` na UI e nos selos do panorama.
