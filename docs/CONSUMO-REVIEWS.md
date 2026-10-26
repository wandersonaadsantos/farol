# Consumo e saída dos reviews

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
