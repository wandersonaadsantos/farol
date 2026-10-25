# Comparação do preparo de contexto com engines completos

## Protocolo e rastreabilidade

A referência de produto é o Farol completo no commit
`3f9b8685ab0966a0d4cd339a462bfa5b29367c86`. O checkpoint da entrega medido foi
`0c10df9ec0837ccb3a820f299ed88127b1a6e2b3`. A matriz registrou em cada JSON o
commit, hash SHA-256 do diff rastreado, arquivos rastreados alterados, runtime,
arquitetura, modo e H/B/M. O diff rastreado estava vazio nesses dois checkpoints.

Foram executadas 24 configurações: Node 22.12.0 x64 com revisão e autoanálise,
regressão conhecida e controle compatível, baseline completo e entrega em
off/observe/assist; Node 24.15.0 x64 com os mesmos fluxos/controles em baseline e
assist. Cada processo executa duas análises de PRs distintos sobre fontes congeladas
iguais, na mesma autorização. Quatro processos adicionais repetem assist após
reinício com o mesmo cache de fontes e novos números de PR.

O transporte GitHub é uma fixture determinística no limite de `io.run`. A aquisição,
validação, cache de fontes, parser, seleção e engine finais são os reais. O baseline
carrega seus próprios módulos completos e suas rotinas existentes de inventário,
prompt e decisão. Nenhuma chamada externa ou publicação é executada. Tentativas
internas de label ficam recusadas pela fixture e são registradas separadamente das
leituras. Não existe checkout prévio das fontes analisadas.

O provedor é substituído por uma resposta explicitamente incompleta e sem análise.
Não há modelo, subagente, busca ou leitura autônoma de código nesta medição. Isso
mede **preparo da entrada**, não compreensão, resultado de review ou qualidade.

Comando base reproduzível, em PowerShell, com dependências de produção disponíveis:

```powershell
$env:FAROL_HOME = Join-Path $env:TEMP ('farol-engine-compare-' + [guid]::NewGuid().ToString('N'))
node tools/comparar-contexto-engine.js --flow review --mode assist --scenario breaking
# Mesmo FAROL_HOME, outro processo: cache de conteúdo persiste, parser reinicia.
node tools/comparar-contexto-engine.js --flow review --mode assist --scenario breaking --start 3
# A comparação anterior usa --root <checkout-isolado-da-base> --mode off.
```

Cada JSON `engine-matrix-*.json` contém os contadores completos. A matriz e os logs
ficam no pacote externo de evidências, sem caches ou estado privado do usuário.

## Entrada completa preparada e evidência recuperada

O tamanho soma o **prompt inteiro** entregue ao limite do provedor, patch
materializado quando existente e as instruções comuns disponíveis em
`CLAUDE.md` e no arquivo do agente `pr-reviewer`. As instruções são contabilizadas
como disponíveis, sem alegar que o provedor stub as leu. Não é o contexto final de
uma review com ferramentas: esse não pode ser medido sem executar a jornada do
agente. Tokens abaixo são **estimados por caracteres UTF-16 / 4**, sem tokenizador
nem cobrança. Bytes são UTF-8. Não se mediu apenas memória de rounds.

Cenário de regressão, Node 22.12.0:

| Fluxo/modo | Prompt inteiro, bytes | Entrada preparada, bytes | Tokens estimados | Consumidor/teste no prompt |
|---|---:|---:|---:|---|
| Revisão baseline completo | 31.714 | 81.299 | 19.720 | Nenhum |
| Revisão off | 34.138 | 83.848 | 20.350 | Nenhum |
| Revisão observe | 34.138 | 83.848 | 20.350 | Nenhum |
| Revisão assist | 36.528 | 86.238 | 20.937 | Ambos |
| Autoanálise baseline completo | 15.127 | 64.837 | 15.702 | Nenhum |
| Autoanálise assist | 19.608 | 69.318 | 16.805 | Ambos |

Assist recuperou o uso `amount().toFixed(2)` em TSX fora do diff e o teste consumidor
transitivo tanto na regressão (retorno vira objeto) quanto no controle (retorno
continua número). O mapa não decide se há defeito. Off e observe mantiveram a mesma
entrada preparada; o teste dos engines compara também o conteúdo completo dos
prompts e o resultado decisório, normalizando somente id e raiz temporária.

O baseline de revisão não materializa o patch antes do limite do provedor: sua
jornada existente pede que o agente obtenha o diff. Portanto o mínimo de leituras
adicionais para recuperar a evidência conhecida desta fixture é três no baseline
de revisão (patch, consumidor e teste), dois no baseline de autoanálise e dois nos
modos finais off/observe. Assist disponibiliza os três materiais; isso não comprova
que um agente os analisou nem elimina leitura adicional quando a tarefa exige.
Buscas e leituras efetivas de agente nesta execução foram zero em todos os casos.

A duplicação por linhas idênticas com ao menos 24 caracteres foi 3.178 bytes na
revisão e 3.170 na autoanálise, nos dois produtos. Esse indicador não captura
equivalência semântica ou duplicação entre patch e fonte com prefixos diferentes.
**Não houve economia demonstrada de tokens nesta fixture:** assist acrescentou
contexto e aumentou a entrada preparada. A hipótese de economizar buscas futuras
não equivale a economia medida numa review autônoma.

## Trabalho e recursos observados

Valores pontuais locais, sem latência remota, Node 22.12.0. O tempo inclui construção
do engine, preparo, persistências e resposta stub. CPU e RSS pertencem ao processo
inteiro, incluindo threads. O pico RSS abrange as duas análises de cada processo.

| Fluxo/modo | Primeira análise, ms | Outra análise, ms | CPU primeira, ms | Pico RSS, KiB | Leituras GH na primeira |
|---|---:|---:|---:|---:|---:|
| Revisão baseline | 75,53 | 34,28 | 48 | 71.196 | 3 |
| Revisão off | 275,02 | 114,57 | 141 | 77.104 | 10 |
| Revisão observe | 646,43 | 140,66 | 485 | 85.348 | 14 |
| Revisão assist | 637,10 | 142,76 | 531 | 87.416 | 14 |
| Autoanálise baseline | 74,53 | 54,77 | 47 | 68.312 | 3 |
| Autoanálise assist | 555,09 | 151,95 | 359 | 87.072 | 16 |

O preparo final custa mais nesses casos pequenos. Autorização atual, H/B/M,
validação de árvores, cache com propriedade/quota e análise sintática acrescentam
trabalho. Os dados não isolam quanto cada componente contribui. Observe paga o
custo do mapa/seleção sem injetar o resultado. Isso reforça manter **off por padrão**;
não permite prometer CPU, RAM ou tokens menores para reviews reais.

No Node 24.15.0, a revisão baseline/assist levou 126,82/575,98 ms na primeira análise,
com pico RSS de 77.488/94.164 KiB. Autoanálise levou 84,20/531,50 ms e
73.348/92.652 KiB. Esses resultados são diagnósticos complementares e não substituem
os gates do Node 22.12.0 na rodada histórica. O contrato vigente passou a Node 24
LTS (`>=24.15.0 <25`); a ocorrência sem causa determinada no runtime retirado
permanece registrada, sem alegação de correção.

## Reuso e reinício

Em assist, a primeira aquisição buscou quatro blobs únicos. Outra análise de PR
distinto, mesmo repositório/autorização e H/B/M, buscou **zero blobs** e realizou
**zero parses** novos. As verificações atuais de autorização e estado do PR são
repetidas; não se reutiliza uma autorização antiga como prova de acesso atual.

Após reinício, os quatro processos adicionais (dois fluxos, dois runtimes) também
buscaram zero blobs. O parser em memória começou frio: três arquivos no H foram
reinterpretados, sem hits sintáticos prévios. Conteúdo compartilhado entre H/M pôde
ser reaproveitado na mesma execução. O cache de fontes registrou 11 hits e o preparo
fez nove solicitações de leitura de fonte. Solicitação de leitura ao cache não é
transferência remota nem leitura observada do modelo.

Não foi criado índice persistente. O limite de 4 MiB mede apenas a serialização
UTF-8 retida do cache sintático, conforme [limites do parser](CONTEXTO-FRONTEND.md).
Sem avaliação paga, permanecem abertas a qualidade das reviews e a economia de
tokens da jornada real; recuperação de evidência sozinha não comprova nenhuma delas.
