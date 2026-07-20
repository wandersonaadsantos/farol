---
description: Compila um resumo de destaques/kudos do time a partir de state/highlights.md (e state/authors).
argument-hint: "[período: 7d | semana | mês | tudo]"
---

Gere um resumo de **destaques do time** para eu compartilhar (pt-BR, **técnico e enxuto**, sem floreio).

Período: $ARGUMENTS (padrão: últimos 7 dias).

1. Leia `state/highlights.md`. Filtre pelas datas dentro do período.
2. (Opcional) Olhe `state/authors/*.md` por evoluções dignas de nota no período (ex.: alguém que zerou um padrão recorrente).
3. Produza um texto curto e colável:
   - 1 linha de abertura.
   - **Destaques** (bullets): `@autor — <o que foi exemplar> ([repo#NN](url))`.
   - **Evoluções** (se houver): `@autor — <melhora observada>`.
   - 1 linha de fecho incentivando, sem ser piegas.
4. **Não invente** — só o que está nos arquivos. Se não houver nada no período, diga isso em uma linha.

Você **não posta** em lugar nenhum: só me devolve o texto pronto. Se eu pedir, aí sim envio para um canal.
