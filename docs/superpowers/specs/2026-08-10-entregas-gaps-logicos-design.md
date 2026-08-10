# Entregas: gaps lógicos (janela, barra fantasma, ordenação por recência)

Data: 10/08/2026
Estado: pedido do Wanderson ("revisão lógica aqui... o mais atual primeiro"),
execução autônoma; auditoria de 21 agentes (3 finders + verificação adversarial),
18 achados confirmados, 0 refutados.

## Achados e correções

### 1. Barra escura fantasma: dia SEM merge era a 2ª barra mais alta do gráfico

As duas barras escuras do print do Wanderson (25/07 e 08/08, os únicos dias com
n=0 na janela) eram o `.deliv-bar-fill` de dia zerado. `delivActivityChart`
marcava o fill com a classe `empty`, que colide com a regra GENÉRICA de estado
vazio `.empty` do app (`app.css:466`: padding 26px + borda tracejada). Com
`box-sizing: border-box`, o `height:0%` perde pro piso de padding+borda = 54px
num track de 64px: dia com ZERO merge renderizava mais alto que um dia com 54
PRs (medido em Chromium com o dado real). **Correção:** a classe da barra virou
`zero` (`pure.js` + `app.css`); regra nova comentada nos dois lados, teste trava
que `empty` nunca volta pra barra.

### 2. Cartões contavam 50 merges que o gráfico não desenhava

`deliveriesSince` cortava em `hoje - dias` (31 dias locais contando hoje) e
mandava data seca (`merged:>=2026-07-11`), que o GitHub corta em 00:00 UTC =
21:00 locais da VÉSPERA: mais um dia inteiro + franja de 3h entravam no total,
na média e nos grupos, mas `delivDayBuckets` desenha só 30 dias. Medido ao vivo:
769 no cartão, 719 na soma das barras; média exibida 25,6 contra 24,0 real; a
janela "Hoje (desde 00:00)" contava merge de ontem às 21h52; e dia de borda
nunca podia ser pico. **Correção:** o corte virou timestamp UTC completo
ancorado na meia-noite LOCAL do primeiro dia desenhado (`hoje - (dias-1)`,
`merged:>=2026-07-12T03:00:00Z`; formato validado contra o GitHub real). Agora
cartões, média, pico, grupos e gráfico contam a MESMA janela, e "Hoje" começa à
meia-noite local de verdade.

### 3. Ordenação dos grupos: mais ATUAL primeiro (decisão do Wanderson)

`deliveriesByRepo`/`deliveriesByAuthor` ordenavam por contagem. Agora ordenam
pelo último merge (recência), contagem só desempata; os sub-repos dentro de cada
pessoa seguem a mesma regra. O **ranking numérico** da visão por pessoa saiu:
com a ordem por recência ele viraria um placar falso (o "1." deixaria de ser
quem mais entrega). Quem mais entrega continua nos cartões "@X na frente" e
"repo na frente", que são por volume, papel deles.

### 4. Corte do teto era por relevância, não por recência

Com mais de 1000 entregas, o `gh search` sem `--sort` corta por "best match"
(relevância): o aviso prometia "as 1000 mais recentes" e o gráfico ganhava
buracos arbitrários. **Correção:** `--sort updated --order desc` (aproximação de
recência) + mensagem honesta ("as 1000 de atividade mais recente; números e
gráfico podem subestimar").

### 5. Menores

- Cache de entregas ganhou o corte na CHAVE (`days:org:since`): o TTL de 5 min
  não atravessa mais a virada da meia-noite servindo a janela de ontem.
- Tooltip da barra de progresso de grupo pequeno dizia "0%" com a barra visível
  (piso visual de 3%): agora diz "<1%".

## Fora de escopo (consciente)

- Trocar `gh search` por outra API pra eliminar o cap de 1000 por org.
- Off-by-one visual em fusos de offset POSITIVO (o `toISOString` da meia-noite
  local recua a data): o corte com hora resolve pra qualquer fuso, o resto do
  app já assume horário de Brasília.

## Versão

Entra na v2.40.0 junto com a centralização do Consumo.
