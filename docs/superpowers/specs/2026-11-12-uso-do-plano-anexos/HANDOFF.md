# Uso do plano e validade do login: handoff do desenho

Desenho feito no Claude Design em 12/11/2026 para a ordem de uso de Sistema, Plano e chaves.
O artboard está em [`Main.dc.html`](Main.dc.html); a especificação é
[`2026-11-12-uso-do-plano-design.md`](../2026-11-12-uso-do-plano-design.md).

## O que o desenho decide

| elemento | regra |
|---|---|
| janela do plano | uma coluna de 150 px por janela: nome e percentual na mesma linha, barra de 4 px, e embaixo a hora em que volta |
| cor da barra | azul (`--info`) até 69%, âmbar (`--accent`) de 70% a 89%, vermelha (`--danger`) a partir de 90%; o percentual acompanha a cor e fica em negrito nas duas faixas altas |
| quando volta | "volta hoje HH:MM" no mesmo dia, "volta DD/MM HH:MM" nos outros |
| login longe do vencimento | linha discreta: "Login vence DD/MM HH:MM (faltam N dias)", no formato de dia e hora do app (`fmtWhenDay`) |
| login a três dias ou menos | pílula âmbar "Login vence em N dias", com a data e como renovar ao lado |
| último dia | a mesma pílula em vermelho, com as horas que faltam |
| login vencido | pílula vermelha "Login vencido"; sem uso para mostrar, a linha diz que o uso não foi lido |
| perfil desligado | continua mostrando uso e validade, com a opacidade da linha desligada |
| outro provedor | a linha fica como era (Antigravity mostra a cota dele, Codex não mostra nada) |

## O que a implementação acrescentou

- Estado "ainda não lido", antes da primeira leitura: uma frase, sem barra.
- Reset que o Farol não consegue converter (fuso desconhecido) aparece com o texto do
  Claude Code.
- O mesmo bloco aparece no cartão do perfil, abaixo dos campos.

Nenhuma cor nova entra no app: tudo usa os tokens que já existem em `ui/app.css`.
