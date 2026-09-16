# Evidência: A1b Medição real do stream e correção do acumulador (A1, item 1)

Branch `md/a1b`, da ponta de `md/integracao` (`33f2a0e`). Autorização: adendo do dono de
16/09/2026, item 4 (até três sessões pequenas do CLI, uma por vez).

## As três sessões, e como foram restringidas

| Restrição pedida | Como foi garantida |
|---|---|
| assinatura, sem cobrança adicional | `CLAUDE_CONFIG_DIR` do perfil pessoal, com `claude auth status` dizendo `authMethod: claude.ai`, `subscriptionType: max`; `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` e `ANTHROPIC_BASE_URL` REMOVIDOS do ambiente do filho; o evento `init` de cada sessão confirmou `apiKeySource: none` |
| no máximo 5 turnos | `--max-turns 5` (as sessões usaram 3, 3 e 4) |
| no máximo 5 minutos | `timeout 300` em cada chamada |
| sem subagentes, sem MCP | `--tools "Read"` (só leitura, sem Task), `--strict-mcp-config` sem `--mcp-config` |
| sem configuração e hooks do usuário, arquivos só de teste | `--restricted` (ignora settings de usuário e projeto, confina as ferramentas ao diretório de trabalho), diretório de trabalho temporário com três arquivos sintéticos (`a.txt`, `b.txt`, `frutas.txt`, `cores.txt`) |
| sem PR, GitHub, Jira ou Firebase | nenhuma ferramenta de rede ou de comando disponível; nada fora do diretório de teste |
| sem persistir sessão | `--no-session-persistence` |

As flags de stream são as mesmas que o Farol usa (`claude -p --output-format stream-json
--verbose`), então a medição representa o fluxo real. A saída bruta ficou fora do
repositório; o que foi versionado são as fixtures sanitizadas
(`test/fixtures/medicao/stream-real-{1,2,3}.jsonl`): tipo do evento, id SINTÉTICO da
mensagem e os quatro números de uso, nada mais.

## Números (relatório do `tools/medicao/contagem-dobrada.js`)

| Sessão | eventos `assistant` | mensagens | ids repetidos (uso diferente) | entrada: acum / dedup / final | saída: acum / dedup / final | cache lido: acum / dedup / final | cache criado: acum / dedup / final |
|---|---|---|---|---|---|---|---|
| 1 | 3 | 2 | 1 (0) | 6 / 4 / 4 | 37 / 20 / 274 | 4020 / 2680 / 2680 | 8720 / 5934 / 5934 |
| 2 | 5 | 3 | 2 (0) | 10 / 6 / 6 | 48 / 32 / 540 | 12548 / 7850 / 7850 | 4174 / 2190 / 2190 |
| 3 | 8 | 4 | 4 (0) | 16 / 8 / 8 | 266 / 133 / 595 | 24658 / 12329 / 12329 | 3004 / 1502 / 1502 |

O desfecho impresso pelo instrumento foi `divergente` nas três, porque o critério dele
olha só a saída.

## O que a medição demonstrou

1. **A contagem dobrada é real.** Cada bloco de conteúdo (pensamento, texto, ferramenta)
   chega como evento separado com o MESMO `message.id` e o MESMO uso: 7 repetições nas três
   sessões, nenhuma com uso diferente. Nos campos de entrada, cache lido e cache criado, a
   soma deduplicada bate EXATAMENTE com o evento final nas três sessões; a soma atual
   dobra.
2. **A saída dos eventos intermediários é um piso, não o total.** Nem a soma atual nem a
   deduplicada chegam perto do final (a atual só parece "mais perto" porque duplica um
   piso). O `usage.iterations` do evento final traz só a ÚLTIMA mensagem. Não existe, no
   stream sem mensagens parciais, um total de saída por mensagem antes do fim.

## Decisão (registrada, e diferente da tabela do plano)

A tabela da Tarefa 2 do plano mandava não mexer no acumulador no desfecho `divergente`.
Ela foi escrita antes da medição e com um critério de campo único; a medição mostrou que a
divergência é só da saída, e que a duplicação é DEMONSTRADA nos demais campos (e é a mesma
repetição idêntica na saída). O adendo manda corrigir o que a medição demonstrar, então:

- `acumularParcial` passa a deduplicar por `message.id`, com o último uso visto;
- a saída parcial continua sendo o que é, um piso, e a linha parcial segue
  `costSource: 'estimado'`;
- **efeito declarado:** o custo estimado de uma tentativa interrompida (taxa por token de
  saída vezes a saída parcial) fica MENOR do que antes; os dois valores já eram pisos e
  ficavam abaixo do real nas três sessões, mas o de antes era inflado por um artefato.

**O que continua sem prova:** como estimar a saída real de uma tentativa interrompida no
meio de uma mensagem. Os eventos `system thinking_tokens` trazem uma estimativa de
pensamento (`estimated_tokens`), mas três sessões pequenas não bastam para validar esse
número contra o final, e o lote autorizado acabou.

## Gate

`npm run lint` sem regressão; `test/usage-parcial-stream.test.js` 11 casos verdes (5
novos); contraprovas: 5 por script, todas reprovaram (uma nasceu inerte, a do "primeiro
uso vence", e o caso ganhou uma terceira ocorrência do mesmo id).
