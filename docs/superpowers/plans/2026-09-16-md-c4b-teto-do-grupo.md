# C4b, ativação do teto do grupo (plano)

**Objetivo:** o teto do grupo de consumo, configurado na C2, passa a barrar execuções
quando está ativo, com a métrica por tipo de perfil, a admissão conjunta (reservas de
todos os aparelhos) e a cobertura incompleta tratada como "não verificável".

**Spec:** `docs/superpowers/specs/2026-09-15-operacao-multidispositivo-design.md`,
CT-GRUPO ("Configurar e ativar", "Métrica controlada", "Admissão conjunta",
"Cobertura incompleta", "Composição do gate") e 7.C4b; contrato do nó `usageDaily` no
anexo C1 (rollup por grupo de consumo).

## Global Constraints

- Zero dependências novas; Node puro; texto em português, sem travessão.
- O store do grupo depende do BANCO, nunca da autoridade do admin nem do distribuidor.
- Tipo sem métrica (Codex) é "não controlado", nunca consumo zero.
- Não verificável segura o automático SEM estacionar, e o clique também não atravessa.
- Com o compartilhamento e o teto do grupo desligados, vale o comportamento de hoje.
- Ativação protegida enquanto faltar a medição externa "atraso do consumo entre
  aparelhos" (spec, seção 13): a constante `ATIVACAO_TETO_GRUPO_C4B` nasce `false`
  (mesmo padrão da `ATIVACAO_AUTOMATICA_A4`), e só o dono a liga depois de medir com
  dois aparelhos reais. As funções recebem o valor por parâmetro, e os testes exercitam
  os dois lados.

## Decisões de desenho

1. **Rollup diário por aparelho** em `usageDaily/{dev}/{dia}` =
   `{ v: 1, u, seq, g: { [grupo]: { c, s, d, t } } }` (custo, sessões, desconhecidas,
   custo típico do grupo neste aparelho). Números em claro, como o contrato manda. O dia
   é o canônico de Brasília (D7). `seq` é a quantidade de sessões locais registradas.
2. **Detecção de lacuna** pela capacidade (cifrada, C3a/C3h): ela passa a levar
   `consumo: { seq, dia, grupos }`, o `seq` e o dia da última sessão local e as reservas
   vivas por grupo. Se o dia está no período e o rollup daquele dia não existe ou tem
   `seq` menor, é lacuna: o orçamento do grupo fica não verificável até o rollup chegar.
3. **Reservas dos outros** contam enquanto a capacidade que as publicou tem menos de
   `SYNC.RESERVA_GRUPO_TTL_MS`; depois disso, reserva ainda anunciada vira cobertura
   incompleta daquele aparelho.
4. **O próprio aparelho** entra pela verdade local (sessões e reservas em memória),
   nunca pelo que ele mesmo publicou.
5. **Custo típico do grupo**: mediana dos `t` publicados pelos participantes e o local;
   sem nenhum, o custo típico local do engine. Limite declarado: é mediana de medianas.
6. **Gate**: reusa `profileBudgetStatus` com um perfil sintético do grupo
   (`budgetDaily` para período `dia`, `budgetTotal` com `budgetSince` no início da
   semana ou do mês) e um store em memória recalculado no relógio. Reservas somam como
   projeção; desconhecidas somam como projeção e marcam "parcialmente estimado".
7. **Teto estourado** entra em `budgetBlockedFor` como um perfil sintético
   (`grupo:<id>`), e daí seguem os fluxos que já existem (toast único, espera no
   enfileiramento, estacionamento na boca da sessão). **Não verificável** é um gate
   novo, `grupoSegura(acct)`, que só espera: nunca estaciona, nunca gasta tentativa.
8. **Clique**: a admissão local recusa com `grupo-nao-verificavel`, e o escalonador
   pula a conta sem travar as outras.
9. **Ativar** é o campo `ativo` do grupo assinado pelo admin. O admin só publica
   `ativo: true` com os requisitos presentes (compartilhamento ligado, grupo com teto,
   medição feita); o consumidor confere os mesmos requisitos antes de aplicar.
10. **Perfil sem vínculo** com algum teto de grupo ativo no conjunto: espera com motivo
    `perfil-nao-identificado` (não escapa do teto por falta de pareamento), exceto
    perfil Codex, que é não controlado.

## Tarefas

1. Regras e contrato: nó `usageDaily` no gabarito (escrita por dia com forma, remoção
   só pela limpeza), `usageDaily` na lista positiva da limpeza, constantes
   (`RESERVA_GRUPO_TTL_MS`, `GRUPO_RETRATO_MAX_MS`, `ATIVACAO_TETO_GRUPO_C4B`). Testes:
   `sync-rules-contrato`, `sync-limpeza` (listas exatas, ajuste declarado).
2. Puro `lib/sync/consumo-grupo.js`: `inicioDoPeriodo`, `sanearRollup`, `somarGrupo`,
   `perfilDoGrupo`. Teste `test/sync-consumo-grupo.test.js`.
3. `grupo.ativo` no saneador e `requisitosDaAtivacao`; o admin recusa ativar sem os
   requisitos. Testes em `test/sync-grupo-remoto.test.js` (casos novos).
4. Engine `lib/engine/sync-consumo-grupo.js`: rollup local e publicação, capacidade com
   consumo, recálculo do snapshot no relógio, `statusDoGrupo`, `grupoSegura`,
   `bloqueioDoGrupo`. Teste `test/sync-consumo-grupo-remoto.test.js` cobrindo os sete
   critérios da 7.C4b.
5. Fiação: admissão com grupo (reserva por grupo, recusa não verificável), escalonador
   que pula a conta, `budgetBlockedFor` com o perfil sintético, `grupoSegura` no
   toReview, no retry, no scan de pushback, no `travaDoRound` e na boca da sessão (volta
   à fila sem estacionar), aviso único reconciliado para `grupo:<id>`.
6. Docs: `CLAUDE.md`, `firebase/README.md` (item 39), evidência e EXECUCAO.

## Contraprovas previstas

Lacuna ignorada; reserva alheia ignorada; TTL da reserva ignorado; desconhecida contada
como zero; Codex controlado; ativação sem medição; não verificável estacionando; clique
atravessando não verificável; rollup lendo o próprio aparelho do banco; regra do
`usageDaily` sem forma (manual, com regeneração).
