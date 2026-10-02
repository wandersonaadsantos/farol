# Outra pessoa revisando: o que a fila mostra e a chave de revisar junto

Data: 02/10/2026. Pedido do dono: "Se caso tiver alguém já com a label de revisando no GitHub,
precisamos indicar pra quem vê a fila que já tem alguém revisando, assim a pessoa que for
revisar tem a intenção real de revisar junto também." E uma chave nova: revisar sozinho mesmo
com outra pessoa revisando.

Este documento descreve ESTADOS, DADOS e JORNADAS. O desenho (onde o aviso fica no card, se é
selo, nota ou ícone, como a chave aparece em Sistema > Automação) sai do Claude Design.

## O problema, medido

Hoje, quando o Farol vê a label `<login>:revisando` de outra pessoa num PR pedido a mim, ele
SAI DE CENA naquele commit (não revisa sozinho) e avisa só por um toast, que some em segundos.
O card em Pra mim fica idêntico ao de um PR que ninguém pegou: mesmo botão Revisar, nenhuma
menção a quem está lá. Quem abre a fila mais tarde não tem como saber que clicar em Revisar
é revisar JUNTO com alguém.

Captura de referência: `fila-pra-mim.png` (a fila hoje, três cards, nenhum com o aviso).

## Os dados que o motor entrega (por PR)

| campo | o que é | de onde vem |
|---|---|---|
| `outrosRevisando` | lista de logins (0 a N) com a label `<login>:revisando` agora, tirando a minha conta e ferramentas (Acrity) | labels do PR, com relógio local: label vista há mais de 1 h deixa de contar (sessão que morreu) |
| `foraDeCena` | o Farol saiu de cena neste PR: `{ quem: [logins], desde, coAssinado }` | registro durável por PR |
| `coAssinado` | dentro de `foraDeCena`: quem pegou aprovou, e o Farol aprovou em meu nome (só com "Aprovar junto com quem pegou o PR" ligada) | idem |
| `revisarJunto` | a chave nova, geral do aparelho | config |

Pessoa sempre aparece com foto e link pro perfil (regra das menções navegáveis do app).

## A chave nova

- Nome de trabalho: "Revisar sozinho mesmo com outra pessoa revisando".
- Mora em Sistema > Automação, junto de "Aprovar junto com quem pegou o PR" (com quem ela
  interage) e das duas chaves de CI.
- **Desligada (padrão):** comportamento de hoje. Com alguém revisando, a revisão automática
  sai de cena; o card avisa quem está lá; o botão Revisar continua valendo e revisa junto.
- **Ligada:** a revisão automática roda mesmo com outra pessoa revisando. Não há saída de
  cena, então também não há co-assinatura (decisão do dono: a minha aprovação vem da minha
  revisão). O aviso de quem está lá continua aparecendo, só informando.

## Estados obrigatórios

### Em Pra mim (card da fila)

1. **Ninguém revisando.** Como hoje.
2. **Uma pessoa revisando, chave desligada.** O Farol não vai revisar sozinho. O card diz quem
   está revisando e que o Farol saiu de cena por isso, e deixa claro que Revisar = revisar junto.
   Texto de partida: "@ana-dev está revisando este PR. Não reviso sozinho para não
   duplicar; se você quiser revisar junto, use Revisar."
3. **Duas ou mais pessoas revisando.** Mesma coisa com a lista ("@a e @b estão revisando").
4. **Chave ligada, outra pessoa revisando, minha revisão ainda não começou.** Informa quem está
   lá e que o Farol vai revisar junto mesmo assim.
5. **Chave ligada, minha revisão rodando ao mesmo tempo.** O card já mostra a revisão em
   andamento (estado existente); o aviso de quem mais está revisando continua visível.
6. **Saí de cena e a pessoa já terminou** (label sumiu, review dela postado). O Farol segue fora
   naquele commit e o PR espera você. O card diz que @fulano revisou e que a decisão é sua.
7. **Co-assinado.** Quem pegou aprovou e o Farol aprovou em meu nome. (Hoje sai da fila; o
   aviso só existe se o desenho achar que ele pertence a Revisões recentes.)
8. **Saída de cena caducou** (label sumiu sem review: a sessão da pessoa morreu). O Farol
   assume de volta e revisa sozinho; o card volta ao estado 1.
9. **Convive com os outros avisos do card:** "pedida de novo", "rascunho", revisão
   automática parada (nota vermelha da captura), coordenação entre aparelhos. Definir a
   precedência quando dois valem ao mesmo tempo (hoje: estacionamento vence coordenação).

### Estado extra (achado no mesmo dia): esperando o limite do plano

12. **A assinatura do Claude desta conta bateu no limite do plano.** Medido em 02/10/2026: a
    sessão voltou com "You've hit your weekly limit · resets 9pm", o Farol registrou a
    assinatura no limite até 21:00, e um PR que chegou à fila às 16:09 ficou com o card
    idêntico ao de qualquer outro, sem revisão automática e sem dizer por quê. A pessoa
    conferiu as próprias configurações e não achou nada que mandasse esperar. Dados:
    `limiteAte` (hora do reset, por conta) e o fato de que o clique em Revisar tenta mesmo
    assim (a cota pode ter voltado antes, ou ter uso extra comprado). Texto de partida:
    "Revisão automática esperando o limite do plano do Claude: recomeço sozinho às 21:00.
    O botão Revisar tenta agora, mas pode bater no mesmo limite." Definir a precedência com
    a nota de revisão parada e a de coordenação, e se vale um aviso único no topo da fila
    quando vários cards estão na mesma espera.

### No Panorama (linha compacta)

10. PR em que outra pessoa está revisando, pedido ou não a mim: quem está lá, sem tomar a
    linha (o Panorama tem 28+ linhas).

### Em Sistema > Automação

11. A chave nova desligada e ligada, com o texto que explica o efeito e a relação com
    "Aprovar junto com quem pegou o PR" (com a chave nova ligada, a co-assinatura não acontece).

## Restrições

- Funciona em largura de celular (o Farol roda no celular via Termux e é aberto pelo navegador).
- Claro e escuro, com os tokens de `ui/app.css`.
- Sem travessão em texto. Português.
- Clique que não leva a lugar nenhum é pior que texto: o login leva ao perfil no GitHub; se o
  aviso tiver ação, ela precisa existir de verdade.
- Nada disso é escrito no PR: é só tela do Farol.

## O que entregar no handoff

Marcação de cada estado, CSS com os tokens existentes e os textos exatos.
