# Consumo e saída dos reviews

## Atividade na página Consumo

Os cartões distinguem reviews concluídas, autoanálises concluídas, PRs únicos
revisados e execuções de IA. Conclusão significa resultado técnico `ok`, não
publicação de review no GitHub. A tabela por tipo mostra resultados de tentativas;
por isso sua coluna de concluídas pode diferir dos cartões de operações.

O histórico agrupa tentativas com o mesmo ID do Farol, aparelho, conta, perfil e
tipo. IDs diferentes não são unidos por PR ou por proximidade de horário. Só o
último resultado da operação determina a conclusão; uma conclusão fora do período
ou do filtro não é atribuída ao recorte. Registros sem ID entram no consumo, mas
não permitem inferir conclusões ou retentativas. Subagentes não são reviews extras.

A consulta autenticada `GET /api/usage` lê o diário permanente completo, sem o
limite de 100 sessões recentes do snapshot. Aceita `start` e `end` inclusivos,
`account`, `repo`, `provider`, `model`, `kind`, `scope=local|all`, `search`,
`focus=review|self|pr` e `page` (base zero, oito operações por página). Datas são
interpretadas pelo dia de Brasília. Os filtros principais valem para indicadores,
recursos, gráfico e histórico; busca e foco do indicador só restringem o histórico.
As tentativas expandidas mostram a operação inteira, inclusive gasto fora da janela,
com aviso explícito. A consulta não inicia modelos, não publica e não altera dados.
O filtro de modelo seleciona o modelo principal da execução. A discriminação por
modelo usa o detalhamento da árvore quando disponível: uma execução pode participar
em mais de um modelo, sem aumentar o total de execuções. Atribuição inconsistente
preserva os tokens como sem atribuição, em vez de transferi-los ao coordenador.

Tokens de entrada e saída ficam separados do cache. Novas execuções guardam o
provedor informado e a modalidade do perfil resolvido na execução; mudanças
posteriores de configuração não reclassificam gastos antigos. Sem essa informação,
a modalidade permanece desconhecida. Custo em dólar informado pelo CLI é referência,
nunca confirmação de cobrança: assinatura não é convertida em custo de API.

Todos os aparelhos usa os eventos já sincronizados do próprio usuário, sem ampliar
o conteúdo enviado ao banco. PRs e contas remotos preservam os hashes existentes;
provedor e modalidade histórica podem estar ausentes. Só eventos recebidos entram
no consolidado. Falha de leitura é indisponibilidade, não consumo zero. A falta de
cobertura anterior ao primeiro registro também é sinalizada.

Orçamento, matriz e histórico técnico anteriores continuam disponíveis em uma
seção recolhida, com seus totais gerais explicitamente separados dos filtros de
atividade. Nenhuma nova contagem modifica os gates ou a política de revisão.

O registro de consumo do Claude distingue o uso do coordenador do uso da árvore
inteira. Quando o evento final oferece `modelUsage` completo, os tokens incluem
os subagentes e são atribuídos aos modelos que os consumiram. O raciocínio
informado é parte da saída, não uma parcela a somar novamente.

O custo continua vindo do relatório do provedor. No Claude, `total_cost_usd` e
`costUSD` são estimativas calculadas pelo CLI, não confirmação da fatura. Não há
tabela de preços adicional no Farol. Consulte o [contrato de consumo do
CLI](https://code.claude.com/docs/en/agent-sdk/cost-tracking).

## Sessões novas e retomadas

O registro individual ganha `accounting`, com versão, fonte, escopo e cursor
cumulativo. O cursor fica restrito à mesma conta, perfil e sessão do provedor.
Uma retomada registra a diferença em relação ao último total confirmado, mesmo
depois de reiniciar o Farol. Eventos da mesma tentativa não duplicam consumo.

Sem cursor confiável, como na primeira retomada de uma sessão anterior a esta
mudança ou depois de uma interrupção parcial, o gasto incremental fica
desconhecido. A linha preserva os tokens conhecidos do turno principal e a causa,
em vez de registrar o total antigo como gasto novo ou anunciar economia. O
próximo total confirmado permite medir a diferença da próxima retomada.

CLI sem `modelUsage` e outros provedores continuam com seu contrato conhecido.
A linha declara o escopo principal quando não há total da árvore. Históricos
anteriores não são reescritos. O uso detalhado por modelo e os cursores são locais;
o protocolo de consolidação entre aparelhos mantém o contrato existente.

Os buckets de modelo contam a participação de cada modelo. Uma sessão com dois
modelos participa dos dois buckets, mas é uma sessão só no total geral. Se a
atribuição de custos por modelo não fechar com o total reportado, o custo fica
sem atribuição, preservando o total e sem inventar uma distribuição.

## Saída pública única em avaliação

`reviewSingleOutput` é uma opção experimental, desligada por padrão e não
alterável pela API comum de preferências. A configuração do piloto precisa
defini-la explicitamente como `true`. Não ative em todas as contas antes de
avaliar o comportamento das respostas do modelo.

Nesse modo, a sessão entrega `reviewOutputVersion: 1` e um único objeto `review`,
com `event`, `body` e `comments`, para o veredito escolhido. Omite `payloads` e
`reviewMarkdown`. O parser expande o resultado para o contrato já utilizado pelo
motor; resultados antigos continuam legíveis.

A investigação, os achados, a cobertura, o relatório interno, os checkpoints e
as ressalvas continuam necessários. O parser recusa versão desconhecida,
contratos misturados e evento incompatível com o veredito. Ele não cria uma
aprovação alternativa para um pedido de mudanças. A adaptação para comentário
em PR próprio mantém o texto e os comentários da conclusão original.

Os gates de publicação, o head revisado e o firewall de linguagem continuam nos
mesmos caminhos. Com a opção desligada, o prompt anterior permanece igual.
Para interromper o piloto, volte a opção para `false`; o leitor novo continua
aceitando as decisões já gravadas nos dois formatos.

## Verificação offline e avaliação de qualidade

`node tools/replay-saida-review.js arquivo.json [outro.jsonl ...]` compara o
envelope antigo com a representação única equivalente. Só lê os arquivos
explicitamente informados, não chama modelos e não publica reviews. O relatório
mostra preservação do conteúdo escolhido e tamanho serializado, sem copiar
texto interno das revisões. Falta de fonte ou contrato resulta em replay
inconclusivo. Perda de achado, ressalva, corpo, comentário ou texto de tela
reprova a comparação.

Esse replay mede a representação de uma conclusão já produzida. Ele não prova
que um modelo, recebendo o prompt novo, chegará à mesma conclusão. Por isso o
relatório declara `decisionQualityMeasured: false`; bytes poupados não são uma
medição de tokens economizados em execução.

Antes da adoção, compare base e candidato em sessões independentes com fontes
fixadas, casos com defeitos conhecidos, controles compatíveis e sequências com
consumidores inalterados afetados por mudanças. Preserve conta, autorização,
requisitos e versões das regras. Randomize a ordem e separe cache frio de quente.
Uma nova falsa aprovação ou omissão crítica interrompe o candidato. Divergências
exigem avaliação técnica humana; acordo entre modelos não substitui essa prova.

Defina o orçamento antes de abrir as sessões comparativas. Inclua subagentes,
retentativas e falhas no custo por decisão útil. Compactação do repasse,
reaproveitamento adicional de contexto e redução de modelo ou esforço precisam
de candidatos e evidências separados. Esta entrega não ativa essas mudanças.

O [gate offline de qualidade](REVIEW-QUALITY.md) confere os registros dessas
comparações, preserva controles que a própria referência perdeu e distingue
regressão de avaliação inconclusiva. Uma execução sintética verde valida o gate;
não substitui as reviews reais nem demonstra economia.
