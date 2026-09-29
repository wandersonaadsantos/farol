# Controle do celular pelo computador

Data: 28/09/2026. Decisões do dono tomadas nesta data, em conversa.

## O pedido

> "O aparelho admin é o mais capaz, e por isso eu uso ele com frequência. Pelo aparelho admin eu
> quero ver e tomar decisões do que acontece no meu celular, pois quero deixar ele no canto sem
> mexer nele, e tomar todas as decisões e atualizar a fila do celular pelo computador também."

A v2.64.2 já devolveu ao admin a própria fila. Esta spec trata do resto: pelo computador, ver a
fila do celular, mexer nela, ver o estado do aparelho e mudar a configuração da conta dele.

## As decisões do dono

| pergunta | decisão |
|---|---|
| O que entra na primeira entrega | Ver a fila do celular, mexer nela, painel do aparelho e configuração da conta dele. |
| O remoto pode LIBERAR (ligar revisão automática, aprovação automática)? | **Sim.** O consentimento do celular continua obrigatório, e as travas de postagem (invariante 4) seguem valendo no celular. |
| A tela pode ser redesenhada? | Sim, e o desenho vem do Claude Design. |

## O que já existe (levantado no código em 28/09/2026)

- Ao vivo: as sessões rodando no celular (`live/operations`), com Cancelar e Transferir.
- Pendências do celular com decisão remota e o review completo (`live/pending`, comando `decidir`).
- Política por aparelho: pausa, teto de paralelismo e tipos de operação (`live/devicePolicies`).
  O remoto só restringe (`lib/engine/politica-efetiva.js`).
- Panorama e Meus PRs de outros aparelhos (`panorama`, `myPrs`), somente leitura. O admin só lê os
  escopos das contas configuradas NELE (`lib/engine/sync-listas.js`).
- Capacidade de cada aparelho (`live/deviceStatus`): pausado, paralelismo, `aceitarAdmin`, IA
  pronta, contas com token, contagem da admissão. Não vira painel na tela.
- Comandos assinados (`live/commands`), com recibo (`commandReceipts`). As regras do banco aceitam
  qualquer tipo, porque o tipo vai dentro do envelope cifrado.

## As lacunas

1. A fila do celular não sobe. O admin não vê os PRs pendentes nem os parados (estacionado,
   retry, conta sem revisão automática, saída de cena, limite do plano, teto do grupo).
2. Não há como pedir ao celular "revise este PR agora". `iniciar` exige candidato da
   distribuição, e `repetir` exige o commit e só aparece no histórico.
3. Não há comando para destravar estacionado, ignorar, restaurar, ocultar ou mostrar.
4. A configuração da conta do celular (`autoReview`, `onClean`, `onCaveats`, `onReject`,
   `muted`) não é remota.
5. O Panorama do celular só aparece se a conta dele também estiver configurada no admin.
6. Não há painel do aparelho, nem falhas recentes dele.

## Desenho do engine

### 1. A fila do celular viaja na linha do Panorama

O Panorama que o celular já publica contém todos os PRs pedidos à conta dele (`selos.mine`). A
linha ganha um campo `fila`, dentro do envelope cifrado, **só para os PRs pedidos a mim**:

```
fila: { estado, motivo, desde, ate }
```

`estado`, num vocabulário fechado:

| estado | quando | `motivo` / `ate` |
|---|---|---|
| `esperando` | na fila, e a revisão automática vai pegar | |
| `sem-automatica` | na fila, mas a conta não revisa sozinha (ou está silenciada) | `motivo`: `conta` ou `silenciada` |
| `revisando` | sessão viva ou na fila de execução | |
| `decidir` | revisão pronta, esperando decisão (a pendência já existe) | |
| `estacionado` | a automática parou e não relança sozinha | `motivo`: o `tipo` do estacionamento |
| `retry` | esperando nova tentativa depois de falha transitória | |
| `saiu-de-cena` | outra pessoa pegou o PR | |
| `limite-plano` | a assinatura do Claude está no limite | `ate`: hora do reset, quando conhecida |
| `espera-grupo` | o teto do grupo de consumo segura | |
| `visto` | já revisado ou marcado visto, fora da fila | |
| `ignorado` | marcado para não voltar | |

Não sobe nada além disso: nada de relatório, motivo livre ou texto do modelo. O `ctag` muda
quando o estado muda, e a linha sobe pelo caminho que já existe.

**Sem mudança nas regras do banco:** a linha continua sob o teto de 2048 do `panorama/$item`.

Quem lê: `sync-listas.js` passa a ler os escopos de **todas** as contas publicadas no conjunto,
não só das configuradas no admin (a lacuna 5). A conta aparece pelo nome que o catálogo abre;
sem nome, pela tag curta.

### 2. Comandos novos

Na allowlist de `lib/sync/comando.js`, cada um com os argumentos mínimos e a mesma ordem de
recusas de hoje (consentimento, geração, assinatura, autoridade, prazo):

| tipo | argumentos | efeito no celular |
|---|---|---|
| `revisar` | `prTag` | enfileira a revisão desse PR no próprio celular, sem desviar para a distribuição, e tira o estacionamento dele |
| `ignorar` / `restaurar` | `prTag` | o mesmo que os botões locais |
| `ocultar` / `mostrar` | `prTag` | o mesmo que os botões locais de Meus PRs |
| `config-conta` | `acctTag`, `campo`, `valor` | edita UM campo da conta pelo `aplicarEdicao` de `contas-config.js`, com origem `admin` no histórico de política |

**CT-FIO continua valendo:** `revisar` NÃO vira `pr.manual`. Ele entra com origem própria
(`viaAdmin`), que só pula a distribuição e o estacionamento. Saída de cena, gate de consciência e
checks obrigatórios seguem valendo, e quando um deles segura, o recibo diz qual. A postagem
continua passando pelos gates do celular (invariante 4); com a conta sem aprovação automática,
a revisão vira pendência e a decisão volta para o computador.

**`config-conta` libera, por decisão do dono.** Campos e valores numa allowlist:

- `autoReview`: `true` / `false`
- `muted`: `true` / `false`
- `onClean`, `onCaveats`, `onReject`: os valores que a tela local de Contas aceita

O celular recusa `config-conta` para uma conta que ele não tem (`conta_desconhecida`). Cada
mudança fica no `politica-historico.json` do celular com origem `admin` e o nome do aparelho que
mandou. O motivo "a política manda aguardar" já mostra quando e de onde a configuração veio.

### 3. O painel do aparelho

A capacidade (`live/deviceStatus`) ganha, dentro do envelope e sob o teto de 2048:

- por conta (`acctTag`): `autoReview`, `muted`, `onClean`, `onCaveats`, `onReject`. É o valor que
  a tela de configuração remota mostra como atual;
- as últimas falhas: até 3, cada uma com classe (de `lib/log-taxonomy.js`), instante e `prTag`.
  Nada de texto livre.

O resto do painel já está publicado: pausado, paralelismo, IA pronta, consentimento, ocupação,
versão e visto por último.

### 4. Consentimento

> **Revisto em 29/09/2026 (v2.65.2), por decisão do dono:** a aba Aparelhos mostra **só** os
> aparelhos que aceitaram explicitamente o controle (`aceitarAdmin === true` publicado no
> painel). Aparelho de terceiro no mesmo conjunto, que recusou ou ainda não publicou o
> consentimento, não aparece na aba, na faixa, no resumo "Seus aparelhos" nem no aviso de
> decisão pendente. O texto abaixo sobre desabilitar as ações de quem não aceita ficou sem
> uso: esse aparelho simplesmente não entra.

Continua obrigatório e continua só local. O admin mostra, por aparelho, se ele aceita comandos.
Quando não aceita, a tela diz onde ligar no celular (Sistema > Aparelhos > "Aceitar políticas e
comandos do admin") e desabilita as ações remotas, dizendo por quê.

## O que NÃO muda

- Regras do banco: nenhuma publicação no Firebase.
- Invariante 4: quem posta é o celular, com os gates dele.
- CT-FIO: comando remoto nunca vira clique.
- O admin segue revisando a própria fila (v2.64.2).

## Desenho da tela

Vem do Claude Design. O brief está em
[`2026-09-28-controle-do-celular-anexos/brief-claude-design.md`](2026-09-28-controle-do-celular-anexos/brief-claude-design.md)
e o handoff entra na mesma pasta.

## Testes

- A linha do Panorama leva `fila` só para PR pedido a mim, com cada estado da tabela; o teto de
  2048 vale com o maior título.
- A leitura mostra escopos de contas que o admin não tem.
- Cada comando novo: forma, allowlist de argumento, recusa sem consentimento e o efeito no
  engine de verdade. `revisar` não carimba `manual`, e o gate de consciência segura com o motivo
  no recibo.
- `config-conta`: campo fora da allowlist recusa; conta desconhecida recusa; a mudança chega ao
  histórico com origem `admin`.
- A capacidade leva a política por conta e as falhas recentes, sob o teto.
