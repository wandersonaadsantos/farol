# Handoff: a autoanálise em andamento, na largura do card

Desenho de 08/11/2026 no Claude Design. Quadros em `Main.dc.html` (card), `Estados.dc.html` (os
estados) e `Compacta.dc.html` (linha da Compacta e celular).

## Por que mudou

O box flutuante ficava preso no canto do card, descentralizado, e passava minutos sem dizer nada:
a barra só andava depois que o modelo começava a ler. O clique não dava retorno até o servidor
responder.

## Decisões

1. **A faixa substitui o box.** Fica dentro do card, na largura dele, e some quando a análise
   termina, porque o resultado aparece no mesmo lugar.
2. **Quatro etapas:** Código, Leitura, Verificação e Conclusão. A etapa vem do feed da sessão e
   nunca recua, mesmo quando as linhas antigas saem da janela do feed.
3. **A barra só anda de verdade na Leitura**, a única etapa com denominador (arquivos lidos sobre o
   total). Nas outras ela é indefinida: porcentagem inventada é pior que nenhuma.
4. **O clique responde na hora**, antes do servidor, com "Iniciando a autoanálise".
5. **Sem sinal é estado próprio:** "Sem sinal do modelo há X. A sessão segue aberta.", com o
   Cancelar à mão. O preparo silencioso não conta como sem sinal.
6. **Falha diz que nada foi publicado** e oferece "Tentar de novo". A sessão que some sem deixar
   análise nova cai aqui.
7. **Compacta:** a linha troca o estado pela frase da etapa, com o tempo, o Cancelar e um fio de
   2 px na base.
8. **Celular:** etapas na vertical, botão com 44 px.

## Diferenças em relação ao desenho

A etapa "Avaliação técnica" dos quadros saiu: ela é da revisão, e a autoanálise não a roda.
O "costuma levar N min" ficou de fora: a autoanálise não guarda histórico de duração
(`anotarEstimativa` só existe no fluxo da revisão). O tempo decorrido aparece sempre.

## Onde mora

- `ui/pure/autoanalise-faixa.js`: etapa, texto e desenho, puro e travado em
  `test/ui-autoanalise-faixa.test.js`.
- `ui/telas/autoanalise-andamento.js`: o que só a tela sabe (clique, cancelamento, sessão que sumiu)
  e o relógio de 1 s, que troca só o texto do tempo para não tirar o foco do Cancelar.
