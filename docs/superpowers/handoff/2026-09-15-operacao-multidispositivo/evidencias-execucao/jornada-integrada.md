# Evidência: jornada integrada na aplicação real isolada (adendo, item 7)

16/09/2026, branch `md/jornada`, da ponta de `md/integracao` (`d24ccbd`).

Duas instâncias com estado, porta e pasta próprios, sem conta configurada e com
`autoReview: false`. Nada tocou o `~/.farol` real.

| Instância | Pasta | Porta | Ambiente |
|---|---|---|---|
| desktop | `scratchpad/farol-smoke` | 47193 | normal |
| celular | `scratchpad/farol-celular` | 47194 | `TERMUX_VERSION=0.118.0` |

Percurso: interface carregada no navegador em largura de desktop e em viewport de 375 px,
troca de abas, Sistema → Sincronização, Sistema → Diagnóstico, e leitura das rotas por HTTP.

## 1. O que a jornada confirmou

- A interface carrega nas duas larguras sem erro no console e sem rolagem horizontal.
- `GET /api/diagnostics` devolve o Markdown do diagnóstico real da máquina, mascarado.
- Sistema → Diagnóstico mostra os botões renomeados ("Apagar o log de falhas") e a frase nova
  do log, que diz que o diagnóstico com o Claude lê em sessão somente leitura.
- No desktop sem nada configurado, **nenhum** cartão de indisponibilidade aparece: a lista só
  existe quando há o que declarar.
- No modo celular, a seção mostra os dois itens ("Autenticação da API local: INDISPONÍVEL" e
  "Visão compartilhada entre aparelhos: BLOQUEADO PELO FAROL"), com motivo e o que falta,
  legíveis em 375 px.

## 2. Dois defeitos achados pela jornada, que nenhum teste pegava

**(a) O cartão do compartilhamento nunca apareceria.** A guarda do celular zera `shared` e
`distribution` na configuração que o engine carrega, então a tela lia a config já zerada e
concluía que ninguém tinha pedido. Corrigido em `lib/engine/capacidades.js`: o próprio
bloqueio é prova do pedido, porque a guarda só o marca quando havia algo ligado para zerar.

**(b) O pedido era apagado do disco, em silêncio e para sempre.** O valor forçado ia para o
`config.json` no primeiro salvamento. Medido: depois de um boot em modo celular, o arquivo
ficou com `shared.enabled: false`, e no boot seguinte nem o motivo do bloqueio existia mais,
porque não havia mais pedido. Quem ligasse o compartilhamento no celular perdia a escolha, e
ela não voltaria nem quando a autenticação passasse a ser exigida.

Corrigido em `server.js` (`configParaDisco`) com `comCompartilhamentoPedido`
(`lib/sync/config.js`): o efeito continua desligado em memória, e o disco guarda o que foi
pedido. Teste novo em `test/local-auth-compartilhamento.test.js` (grava, relê e faz um segundo
boot), e o comportamento foi reconferido na instância real.

## 3. Contraprova e gates

Seis mutações sobre a correção (gravar o valor forçado de novo, não guardar o pedido, perder a
distribuição, o efeito voltar a ligar, o bloqueio não sobreviver ao boot, o bloqueio não
provar o pedido): todas reprovaram. O lint acusou `profundidadeExcedida` 9 para 11 no
`server.js` e a montagem foi extraída para o módulo puro.

| Gate | Resultado |
|---|---|
| `npm run check` | verde, 525 arquivos `.js` |
| `npm run lint` | verde, sem regressão |
| `npm test` | 3916 testes, 3888 aprovados, 28 pulados, 0 falhas |

## 4. O que a jornada NÃO cobre

O pareamento da A4 pela tela, os fluxos de comando, transferência e tomada entre aparelhos, e
a visão compartilhada de verdade: todos dependem de telas que saem do Claude Design e, em
parte, de um segundo aparelho real com o Firebase publicado.
