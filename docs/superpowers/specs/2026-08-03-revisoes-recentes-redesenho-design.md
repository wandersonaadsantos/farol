# Revisões recentes: data no carimbo, linha reorganizada e ações

Data: 03/08/2026
Estado: aprovado pelo Wanderson, pronto pra implementar

## O problema

Três defeitos na mesma seção do Radar, reportados olhando a tela:

1. **O carimbo de horário não diz o dia.** A linha mostra `17:51` e nada mais. Numa
   seção que guarda as 30 revisões mais recentes (o disco guarda 200), a maioria dos
   itens não é de hoje, então o número sozinho não localiza nada no tempo.
2. **Sobra espaço vazio à direita.** A `.row` é um grid `auto | minmax(0,1fr) | auto`
   onde a coluna 3 carrega só o relógio. Tudo o mais cai na coluna 2 e empilha em
   linhas novas, então a metade direita da linha fica em branco em qualquer largura
   de janela usável.
3. **Faltam ações e informação.** A linha oferece o chat e o controle de pushback. O
   estado que chega no cliente já carrega título do PR, autor e o `reportMarkdown`
   completo da revisão, e nada disso é mostrado.

## Restrições do código existente (não negociar)

- **A barra esquerda colorida significa URGÊNCIA**, decisão registrada em
  `ui/app.js` (`acctMark`, comentário do delta 2e): quem pinta é quem sabe o estado
  (fila âmbar, decisões âmbar/vermelho, sessões azul, Meus PRs pelo veredito).
  Revisões recentes é histórico resolvido, não urgência: **não ganha barra**. A cor
  do desfecho entra num selo, não na borda.
- **`.row` é compartilhado** com Panorama, Entregas e Destaques. O redesenho usa uma
  classe própria (`.rrow`) e **não altera `.row`**, senão vaza pra três telas que não
  estavam em questão.
- **O vocabulário não muda.** Os rótulos de status ("aprovado sozinho", "já revisado
  por você (não repostei)", "pulado") continuam com o texto de hoje. O que muda é
  onde e com que cor eles aparecem.
- **`ui/pure.js` só aceita função sem DOM e sem estado global.** O que depende de
  `SCOPE`/`TWEAK`/`STATE` entra por parâmetro, como o `pushbackControl` já faz com o
  mapa de pushbacks.

## Parte 1: o carimbo ganha dia

Função nova em `ui/pure.js`, testável:

```
fmtWhenDay(ts, agora = Date.now())
```

| caso | devolve |
|---|---|
| `ts` ausente | `''` |
| mesmo dia local | `hoje 17:51` |
| dia anterior | `ontem 16:29` |
| mesmo ano | `01/08 15:35` |
| outro ano | `24/07/2025 09:12` |

- A comparação de dia usa o `localDayKey` que já existe e já é testado, então o corte
  de dia é LOCAL (o mesmo motivo pelo qual o card "Hoje" do Consumo não zera às 21h).
- "Ontem" é a chave de dia de uma `Date` local construída com `getDate() - 1`, não uma
  subtração de 86400 segundos: em virada de horário de verão a subtração erra o dia.
- O `title` do elemento carrega sempre data e hora completas (`03/08/2026 17:51`),
  então o formato curto nunca esconde informação.

Aplicado em dois lugares, porque é o mesmo defeito lado a lado na mesma tela:

- `.rr-when` das Revisões recentes (era `fmtClock(r.resolvedAt)`);
- `.dec-when` do card de Precisa de você (era `fmtClock(d.createdAt)`).

Fora de escopo: Entregas, Destaques e Panorama usam `fmtRel` ("2h", "3d"), que é outro
contrato e não foi reclamado.

## Parte 2: a linha reorganizada

Grid de 3 colunas com a coluna 3 virando âncora de verdade (quando + ações):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ✅  biudtech/biud-esg#172  [BT-1119]  aprovado sozinho     hoje 16:41    │
│     Ajusta o cálculo de emissão por filial                              │
│     @Alexpraxedes                                       💬2  ↻  ⧉  ↗    │
│     ▸ ⚠ 5 pontos de atenção                                             │
│     ▸ Ver relatório completo                                            │
│     ▸ ↩ pushback?                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

Estrutura:

- **col 1** `.rr-icon`: o ícone de status de hoje, largura fixa, alinhado ao topo.
- **col 2** `.rr-main`:
  - cabeçalho: referência (link pro PR) + chip da conta + pill do card + selo do
    veredito;
  - subtítulo: título do PR e `@autor` (ambos já no estado, hoje invisíveis);
  - divulgações, na ordem: pontos de atenção (como hoje), **relatório completo (novo)**,
    pushback (como hoje).
- **col 3** `.rr-side`: o quando em cima, o cluster de ações embaixo, encostado à direita.

Selo do veredito, cor pela ação (classes que já existem no CSS):

| ação | classe | cor |
|---|---|---|
| `approve` | `rev-ok` | verde |
| `request_changes` | `rev-rc` | vermelho |
| `comment` | `rev-cm` | azul |
| pulado / sem ação | neutro | cinza |

## Parte 3: as ações

Coluna direita, sempre visíveis (ação escondida em hover é ação que não se usa), cada
uma com `title`:

| glifo | ação | condição | implementação |
|---|---|---|---|
| 💬 | conversar, com o contador que já existe | sempre | classe `.act-chat`, listener global já existe |
| ↻ | revisar de novo | há URL | classe `.act-review`, listener global já existe |
| ⧉ | copiar a URL do PR | sempre | handler novo, usa o `copyToClipboard` que já existe (com fallback e toast) |
| ↗ | abrir no GitHub | sempre | `<a target="_blank" rel="noreferrer">` |

**O relatório completo NÃO é botão da coluna direita**: fica como `<details>` na coluna
de conteúdo, junto das outras divulgações, que é onde o card de Precisa de você já põe
o dele. Dois controles pro mesmo estado aberto/fechado divergem na primeira mudança.

O `↻` não promete resultado: o tooltip diz "Revisar de novo" e nada além disso. Se o PR
já saiu da fila, o `requested` é falso e o gate nunca auto-posta; se ainda estiver
pedido a mim, vale a política da conta, igual ao botão Revisar do Panorama. Prometer
"nada é postado" seria mentira em um dos dois caminhos.

## Onde o código mora

| arquivo | o que entra |
|---|---|
| `ui/pure.js` | `fmtWhenDay(ts, agora)` e `resolvedRow(r, ctx)`, ambos puros e testados |
| `ui/app.js` | `renderResolved` monta o `ctx` e mapeia; handler do copiar; `dec-when` passa a usar `fmtWhenDay` |
| `ui/app.css` | bloco novo `.rrow` e filhos; `.row` intacto |

`ctx` de `resolvedRow` carrega o que depende de estado global, já resolvido em valor:

```
{ pushbacks, chip, chatBadge }
```

- `pushbacks`: o mapa que o `pushbackControl` já recebe;
- `chip`: a etiqueta de conta pronta (vem do `acctMark`, que lê `SCOPE`/`TWEAK`);
- `chatBadge`: o contador pronto (vem de `STATE.chats`).

## Testes

Em `test/ui-pure.test.js`:

- `fmtWhenDay`: os 5 casos da tabela, com `agora` fixo (nenhum teste depende do relógio
  da máquina), mais a virada de mês (`01/08` contra `31/07`).
- `resolvedRow`: cada um dos 5 status produz o rótulo e a classe de selo certos; o
  relatório só aparece quando há `reportMarkdown`; as 4 ações aparecem; título com
  `<script>` sai escapado; sem autor não há controle de pushback (contrato atual do
  `pushbackControl`).

## Verificação visual

Instância isolada, sem tocar dados reais nem rede:

```
FAROL_HOME=<temp> node server.js
```

com um `decisions.json` semeado cobrindo os 5 status (um deles com pontos de atenção,
um com pushback pendente, um sem card, um sem autor). Conferir em 900, 1150 e 1280px:
nenhuma linha com espaço morto à direita, nenhuma quebra feia, e o Panorama inalterado
na mesma janela.

## Fora de escopo

- O engine, em qualquer parte (é mudança só de UI).
- O `.row` das outras telas.
- O limite de 30 itens que o SSE manda em `decisions.resolved`.
- O formato `fmtRel` de Entregas, Destaques e Panorama.

## Versão

Minor: melhoria visível de interface, sem correção de defeito de comportamento e sem
quebra de contrato. Sai como v2.33.0.
