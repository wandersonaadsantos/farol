# Avaliar otimizações sem aceitar perda de qualidade

`tools/avaliar-qualidade-review.js` compara avaliações independentes de reviews
concluídas. É uma ferramenta offline de desenvolvimento: não executa modelo,
consulta GitHub, altera configuração, ativa funcionalidade ou publica review.

```sh
node tools/avaliar-qualidade-review.js corpus.json referencia.json candidato.json
```

Os arquivos são explícitos e ficam no diretório privado da avaliação. Resultados
esperados e curadoria ficam fora das fontes e instruções entregues ao modelo.
Não usar dossiês, sessões ou configuração do usuário como fixtures.

## Preparar o corpus

O corpus tem `schema: 1`, `repetitions` (de 3 a 20) e `cases`. Cada caso contém
`id`, `target: {repo, base, head}`, `oracleSha256` e a lista de IDs `controls`. Os controles são
curados antes do experimento a partir de defeitos reproduzidos e contratos
conhecidos. A descrição de cada controle e suas provas devem acompanhar o corpus
no diretório privado; a lista de IDs não substitui essas provas. `oracleSha256`
identifica por SHA-256 as definições e provas daquele caso. A curadoria deve
conferir esse vínculo; redefinir um controle exige um hash novo e nova avaliação.

Incluir a união dos defeitos confirmados nas versões comparadas, inclusive os que
a referência perdeu. Não adotar uma execução incompleta como padrão aceitável.
No caso histórico de recuperação, verificar separadamente a âncora após espera de
CI, substituição da decisão anterior, presença bloqueada pelo envio de consumo e
projeção do estado de espera para a tela. Os testes de regressão do produto
continuam sendo provas diferentes da detecção desses defeitos por uma review.

Executar cada alteração isoladamente, nos mesmos commits e runtime, com pelo
menos três execuções independentes por caso. Alternar a ordem das variantes e
registrar o estado do cache. Nenhuma média compensa uma repetição com regressão.
Depois, ampliar o corpus para outros projetos, casos compatíveis, falhas de
infraestrutura, autorização e interações fora do diff.

## Avaliações ligadas ao resultado

Referência e candidato têm `schema: 1`, `variant` e `runs`. Cada execução informa:

| Campo | Contrato |
|---|---|
| `id`, `executionId`, `caseId`, `repetition` | Execução identificada, sessão independente e repetição numerada a partir de 1 |
| `target` | Mesmo repositório, base e head do caso |
| `model`, `effort`, `cliSha256` | Runtime principal confirmado, igual no par |
| `contextSha256` | Hash dos dados comuns congelados: fontes, card, conta/perfil, políticas e critérios. Igual no par; ausente significa comparação inconclusiva |
| `status`, `review` | Estado `complete` ou `incomplete` e texto final consolidado |
| `tokens` | `source: "result.modelUsage"`, `scope: "tree"`, `input`, `output`, `cacheRead`, `cacheCreation`; `null` se não medido |
| `assessment` | Curadoria independente ou `null` se ausente |

A curadoria contém `method: "source-and-reproduction"`, `status`, `reviewSha256`,
`corpusSha256`, `controls`, `checks`, `falsePositives` e `unsupportedClaims`.
As funções `reviewHash` e `corpusHash` de
[`contract.js`](../tools/review-quality/contract.js) calculam os vínculos.
Editar a review ou reduzir o corpus invalida a avaliação anterior.
O manifesto do contexto exclui somente a alteração declarada da variante;
não pode excluir silenciosamente conta, critérios ou política para obter igualdade.

Cada controle avaliado contém `id`, `status` (`detected`, `missed` ou
`inconclusive`) e `evidence`. Uma detecção exige evidência com `quote` literal da
review consolidada e `source: {path, start, end, commit}` do head ou da base.
Observação presente somente no texto de um subagente, abandonada no relatório
final, não é detecção final. Uma dúvida concreta pode identificar um defeito;
a correção da classificação e da explicação é avaliada separadamente.

`checks` exige cinco verificações, cada uma com `verified`, `violated` ou
`unverified`:

- `coverage`: leitura necessária e investigação das interações preservadas.
- `evidence`: arquivo, localização e justificativa preservados até o desfecho público.
- `classification`: severidade e conclusão compatíveis com as provas.
- `publication`: gates de decisão e publicação preservados, inclusive retomadas e caminhos de falha.
- `claims`: todas as alegações do resultado consolidado foram avaliadas.

A conferência deve examinar fontes e reproduções. O autorrelato do modelo,
quantidade de achados, cobertura declarada ou sucesso da sintaxe não satisfazem
esses campos. Se o experimento foi apenas estático, uma jornada que não foi
verificada permanece `unverified`.

## Interpretar a saída

- Código **0**, `passed`: os critérios fornecidos foram satisfeitos.
- Código **1**, `rejected`: houve omissão conhecida, violação ou falso positivo.
- Código **2**, `inconclusive`: faltou medição, repetição, avaliação ou vínculo válido.

`eligibleForPilot` só é verdadeiro com critérios satisfeitos, consumo comparável
e redução de tokens. Isso permite considerar um piloto controlado; nunca ativa
uma configuração e não demonstra qualidade geral ou economia na assinatura.

O total soma entrada, saída, criação de cache e leitura de cache do agregado do
provedor, incluindo subagentes. Raciocínio já incluído na saída não é somado de
novo. Eventos cumulativos de uma mesma sessão não são repetições independentes.
Preservar os resultados brutos para conferir os contadores informados.

O gate valida o contrato, os vínculos e os critérios da curadoria; não consegue
provar automaticamente que um trecho sustenta semanticamente uma conclusão.
Três repetições são um piso operacional, não uma garantia estatística. Antes da
ativação, conferir os casos críticos, ampliar a amostra, validar o fluxo completo
em ambiente isolado e manter reversão. Modelo, esforço e saída compacta não
devem ser alterados junto de uma otimização de navegação ou leitura.

## Candidato de orientação sintática

Quando o mapa atinge seus limites, os arquivos alterados e os nomes anteriores
recebem prioridade. O bloco adicional intercala arquivos, símbolos, relações e
os dois commits, para que uma lista longa não elimine todas as pistas de outra
categoria. O teto continua igual e as omissões continuam explícitas. A seleção
é parcial; não representa todos os consumidores nem dispensa investigar fontes.

`reviewNavigationFacts` é um experimento desligado por padrão, sem controle na UI.
Só o booleano `true` explícito liga a preparação adicional. Não alterar o arquivo
de configuração real para executar avaliações: usar um engine e armazenamento
isolados. A preferência padrão é omitida da gravação da configuração.

O experimento reaproveita o mapa e o parser existentes. Acrescenta ao prompt
símbolos dos arquivos alterados e dependências candidatas, com arquivo, linha,
blob, lado e commit. Preserva relações do merge-base para renomeações e mudanças
de alias. Importação de tipo continua identificada como tipo; uma dependência não
é promovida a chamada comprovada. O vínculo com o escopo das fontes e H/B/M impede
usar mapa de outra identidade. A autorização continua na aquisição canônica;
o hash do mapa não autentica nem revalida permissões. Entradas sem origem sintática ou localização ficam
omitidas e contadas, sem gerar conclusão favorável.

O bloco adicional tem teto de 12.000 caracteres, separado do orçamento de trechos
já existente. Somente os metadados novos são reduzidos para caber nesse teto;
patches, referências e contexto anterior permanecem disponíveis. As contagens de
omissão são limites inferiores, pois o próprio parser e o mapa são limitados.
Os metadados nunca contam como leitura observada nem alteram a herança de leitura
do modo `off`. Se a orientação falhar, registra indisponibilidade e preserva o
bloco de contexto existente.
Sem pistas aplicáveis, nenhum bloco adicional é enviado ao modelo.

O comparador offline aceita `--navigation off` e `--navigation on`, mantendo
`--mode off` nos dois lados para isolar a orientação da seleção de trechos.
Ele mede preparação, bytes, CPU e memória com transporte congelado e provedor
substituído. Não mede tokens reais nem qualidade das decisões. A orientação
acrescenta entrada e trabalho local; sua adoção depende de provar que reduz
investigação repetida sem perder qualidade nas reviews reais.

## Candidatos de leitura e responsabilidade

`reviewBatchedReads` e `reviewAgentOwnership` também são experimentos independentes,
desligados por padrão, sem controle na UI e omitidos da gravação padrão. Somente
`true` booleano explícito os habilita em um armazenamento de avaliação isolado.

O primeiro orienta até quatro chamadas Read independentes por mensagem, preservando
uma chamada por arquivo e a investigação sequencial quando houver dependência.
No stream Claude, uma chamada não concede mais leitura nesse experimento: o retorno
precisa corresponder ao caminho, à chamada e ao agente, sem erro. As linhas entregues
ao modelo e o conteúdo estruturado precisam conferir com o patch materializado.
Leituras parciais só fecham ao cobrir todas as linhas, sem lacunas. Formato de retorno
desconhecido ou conteúdo truncado não concede cobertura. Isso comprova entrega do
patch, nunca compreensão ou suficiência da análise. Outros provedores ainda não
foram validados para esse experimento e não são elegíveis para ativação.

O segundo reaproveita os lotes existentes, sem mudar limiares, modelo ou distribuição.
Só acrescenta responsabilidades quando cada patch tiver exatamente um responsável
primário e o plano conferir com o inventário. O coordenador assume as interações
entre lotes, código relevante fora do diff, verificação dos achados e tarefas de
agentes que falharem. Nenhum resumo ou silêncio dispensa investigação; a releitura
necessária continua obrigatória. A instrução não prova que o modelo a cumpriu.

O comparador offline aceita `--reads on` para verificar o preparo nos dois fluxos.
Testar uma variante por vez antes da combinação. Economia e qualidade reais só
podem ser concluídas com os resultados e a curadoria exigidos pelo gate acima.
